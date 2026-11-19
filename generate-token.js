import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { google } from 'googleapis';

const credentials = JSON.parse(
    fs.readFileSync('credentials.json', 'utf8')
);

const { client_id, client_secret } = credentials.installed;

const redirectUri = 'http://127.0.0.1:3001';
const state = crypto.randomBytes(32).toString('hex');

const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    login_hint: 'codesphereinnovationsit@gmail.com',
    state
});

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, redirectUri);

    if (url.pathname !== '/') {
        res.writeHead(404);
        return res.end();
    }

    const code = url.searchParams.get('code');

    if (url.searchParams.get('state') !== state || !code) {
        res.writeHead(400);
        return res.end('Authorization failed or cancelled.');
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            throw new Error('Refresh token not received.');
        }

        fs.writeFileSync(
            'token.json',
            JSON.stringify(tokens, null, 2)
        );

        res.end('Authorization successful! You can close this tab.');

        console.log('\nGmail authorization successful!');
        console.log('Refresh token saved in token.json');

        server.close();

    } catch (error) {
        res.writeHead(500);
        res.end('Token generation failed.');
        console.error(error.message);
        server.close();
    }
});

server.listen(3001, '127.0.0.1', () => {
    console.log('\nOpen this URL in your browser:\n');
    console.log(authUrl);
});