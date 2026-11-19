import { google } from 'googleapis';
import nodemailer from 'nodemailer';

export async function sendEmail(options) {
    const auth = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
    );

    auth.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    const gmail = google.gmail({
        version: 'v1',
        auth
    });

    const composer = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: 'unix'
    });

    const mail = await composer.sendMail(options);

    return gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: mail.message.toString('base64url')
        }
    });
}