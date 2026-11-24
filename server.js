import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
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
const historyPath = path.resolve(process.env.HISTORY_PATH || 'history.json');
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
const history = new Map(
    fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : []
);

function record(email, entry) {
    const next = new Map(history).set(email, entry);
    const temporaryPath = historyPath + '.tmp';
    fs.writeFileSync(temporaryPath, JSON.stringify([...next]), { mode: 0o600 });
    fs.renameSync(temporaryPath, historyPath);
    history.set(email, entry);
}

const norm = s => String(s).trim().toLowerCase();

const valid = email =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254 &&
    !email.includes('..');

const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const limit = Math.max(
    1,
    Math.min(100, Number(process.env.DAILY_LIMIT) || 5)
);

const used = () =>
    [...history.values()].filter(x => x.day === day() && x.attempted).length;

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
        const oi = headers.indexOf('observation');
        const si = headers.indexOf('suggestion');

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

            const observation = oi > 0 ? row.getCell(oi).text.trim() : '';
            const suggestion = si > 0 ? row.getCell(si).text.trim() : '';
            let status = 'Ready';

            if (!brand || /[\r\n]/.test(brand) || !valid(email)) {
                status = 'Invalid';
            } else if (history.get(email)?.suppression) {
                status = history.get(email).suppression;
            } else if (seen.has(email) || history.has(email)) {
                status = 'Duplicate / previously attempted';
            } else if (
                ai > 0 &&
                /^(yes|sent|true|done|1)$/i.test(
                    row.getCell(ai).text.trim()
                )
            ) {
                status = 'Already audited';
            } else if (!observation || !suggestion) {
                status = 'Needs personalization';
            }

            seen.add(email);
            next.push({ id: i, brand, email, observation, suggestion, status });
        });

        if (running) throw new Error('Sending in progress');
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

    if (!row.observation || !row.suggestion) {
        return res.status(400).json({ error: 'Add Observation and Suggestion in Excel first.' });
    }

    res.json(message(row));
});

app.post('/api/suppress', (req, res) => {
    const email = norm(req.body.email || '');
    const suppression = req.body.reason;
    if (!valid(email) || !['Permanent bounce', 'Opted out'].includes(suppression)) {
        return res.status(400).json({ error: 'Enter a valid email and suppression reason.' });
    }

    record(email, { ...history.get(email), suppression });
    for (const row of rows) {
        if (row.email === email) row.status = suppression;
    }
    res.json({ ok: true });
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

            record(row.email, { day: day(), attempted: true, status: 'Attempted' });
            row.status = 'Sending';

            try {
                const result = await sendEmail({
                    from: {
                        name: (process.env.SENDER_NAME?.trim() || 'Pallavi') + ' | CodeSphere Innovations',
                        address: process.env.GMAIL_USER
                    },
                    to: row.email,
                    ...message(row)
                });

                if (!result.data.id) {
                    throw new Error('Gmail did not confirm submission');
                }

                const entry = history.get(row.email);
                record(row.email, { ...entry, status: 'Submitted to Gmail', messageId: result.data.id });
                row.status = entry.suppression || 'Submitted to Gmail';

            } catch (error) {
                row.status = history.get(row.email).suppression || 'Failed / uncertain';
                row.error = error.message;

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
    } catch (error) {
        console.error('Campaign stopped:', error.message);
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