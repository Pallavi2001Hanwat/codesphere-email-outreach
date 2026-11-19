import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import path from 'node:path';
import crypto from 'node:crypto';
import { message } from './template.js';
import { sendEmail } from './gmail.js';

const app = express();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.json({ limit: '1mb' }));

// Password protection
app.use((req, res, next) => {
    const username = process.env.APP_USERNAME;
    const password = process.env.APP_PASSWORD;

    if (!username || !password) {
        return res.status(503).send('Application not configured');
    }

    const expected = 'Basic ' + Buffer.from(
        username + ':' + password
    ).toString('base64');

    const hash = value => crypto.createHash('sha256')
        .update(value).digest();

    if (!crypto.timingSafeEqual(
        hash(req.headers.authorization || ''),
        hash(expected)
    )) {
        res.setHeader(
            'WWW-Authenticate',
            'Basic realm="CodeSphere Outreach"'
        );

        return res.status(401).send('Login required');
    }

    next();
});

// Prevent cross-origin requests
app.use((req, res, next) => {
    const allowedOrigin =
        process.env.RENDER_EXTERNAL_URL ||
        `http://localhost:${process.env.PORT || 3000}`;

    if (
        req.headers.origin &&
        req.headers.origin !== allowedOrigin
    ) {
        return res.sendStatus(403);
    }

    next();
});

app.use(express.static('public'));

let rows = [];
let running = false;
let stop = false;
let history = new Map();

const norm = s => String(s).trim().toLowerCase();

const valid = email =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254 &&
    !email.includes('..');

const day = () => new Date().toISOString().slice(0, 10);

const limit = Math.max(
    1,
    Math.min(100, Number(process.env.DAILY_LIMIT) || 15)
);

const used = () =>
    [...history.values()].filter(x => x.day === day()).length;

// Sending status
app.get('/api/status', (req, res) => {
    res.json({
        rows,
        running,
        limit,
        used: used()
    });
});

// Excel upload
app.post('/api/upload', upload.single('sheet'), async (req, res) => {
    try {
        if (running) {
            throw new Error('Sending in progress');
        }

        if (
            !req.file ||
            !req.file.originalname.toLowerCase().endsWith('.xlsx')
        ) {
            throw new Error('Choose an .xlsx file');
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);

        const sheet =
            workbook.getWorksheet('Shopify Leads') ||
            workbook.worksheets[0];

        if (!sheet) {
            throw new Error('Excel sheet is empty');
        }

        const headers = sheet.getRow(1).values.map(
            x => norm(x).replace(/\s/g, '')
        );

        const bi = headers.indexOf('brandname');
        const ei = headers.indexOf('email');
        const ai = headers.indexOf('auditsent');

        if (bi < 1 || ei < 1) {
            throw new Error('Required headers: BrandName and Email');
        }

        const seen = new Set();
        const next = [];

        sheet.eachRow((row, i) => {
            if (i === 1) return;

            const brand = row.getCell(bi).text.trim();
            const email = norm(row.getCell(ei).text);

            if (!brand && !email) return;

            let status = 'Ready';

            if (!brand || /[\r\n]/.test(brand) || !valid(email)) {
                status = 'Invalid';
            } else if (seen.has(email) || history.has(email)) {
                status = 'Duplicate / previously attempted';
            } else if (
                ai > 0 &&
                /^(yes|sent|true|done|1)$/i.test(
                    row.getCell(ai).text.trim()
                )
            ) {
                status = 'Already audited';
            }

            seen.add(email);
            next.push({ id: i, brand, email, status });
        });

        rows = next;

        res.json({ count: rows.length });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Email preview
app.get('/api/preview/:id', (req, res) => {
    const row = rows.find(
        x => x.id === Number(req.params.id)
    );

    if (!row) return res.sendStatus(404);

    const mail = message(row.brand);

    res.json({
        ...mail,
        html: mail.html.replace(
            'cid:signature-logo',
            '/logo.png'
        )
    });
});

// Stop sending
app.post('/api/stop', (req, res) => {
    stop = true;
    res.json({ ok: true });
});

// Start email sending
app.post('/api/start', async (req, res) => {
    if (running) {
        return res.status(409).json({
            error: 'Already running'
        });
    }

    if (req.body.confirm !== true) {
        return res.status(400).json({
            error: 'Confirm first'
        });
    }

    if (
        !process.env.GMAIL_USER ||
        !process.env.GMAIL_CLIENT_ID ||
        !process.env.GMAIL_CLIENT_SECRET ||
        !process.env.GMAIL_REFRESH_TOKEN
    ) {
        return res.status(400).json({
            error: 'Configure Gmail API credentials first'
        });
    }

    running = true;
    stop = false;

    res.json({ ok: true });

    try {
        for (const row of rows) {
            if (stop || used() >= limit) break;

            if (
                row.status !== 'Ready' ||
                history.has(row.email)
            ) continue;

            row.status = 'Sending';

            history.set(row.email, {
                day: day(),
                status: 'Attempted'
            });

            try {
                const result = await sendEmail({
                    from: {
                        name: 'Leena | CodeSphere Innovations',
                        address: process.env.GMAIL_USER
                    },
                    to: row.email,
                    ...message(row.brand),
                    attachments: [{
                        filename: 'logo.png',
                        path: path.resolve('public/logo.png'),
                        cid: 'signature-logo'
                    }]
                });

                if (!result.data.id) {
                    throw new Error('Gmail did not confirm submission');
                }

                row.status = 'Sent';
                history.get(row.email).status = 'Sent';

            } catch (error) {
                row.status = 'Failed (not retried)';
                row.error = error.message;
                history.get(row.email).status = 'Failed / uncertain';

                if (
                    /invalid_grant|invalid_client/i.test(error.message) ||
                    [401, 403, 429].includes(error.response?.status)
                ) break;
            }

            await new Promise(resolve =>
                setTimeout(
                    resolve,
                    Math.max(
                        1000,
                        Number(process.env.DELAY_MS) || 60000
                    )
                )
            );
        }
    } finally {
        running = false;
    }
});

app.use((error, req, res, next) => {
    res.status(400).json({ error: error.message });
});

// Render server configuration
const PORT = Number(process.env.PORT) || 3000;

app.listen(
    PORT,
    process.env.RENDER ? '0.0.0.0' : '127.0.0.1',
    () => {
        console.log(`Server running on port ${PORT}`);
    }
);