# CodeSphere Innovations — Email Outreach

## Windows setup
1. Install Node.js 22 LTS or newer from https://nodejs.org/.
2. Extract the ZIP, open the extracted folder in a terminal (PowerShell or Command Prompt).
3. Run `npm install`.
4. Copy `.env.example` to `.env` (Command Prompt: `copy .env.example .env`; PowerShell: `Copy-Item .env.example .env`).
5. Enable 2-Step Verification on your Google account. Visit https://myaccount.google.com/apppasswords and create an app password if your account permits it. Put that password in GMAIL_APP_PASSWORD in .env. Never use your normal password or share .env. Some Google accounts do not allow app passwords.
6. Run `npm start` and open http://localhost:3000.
7. First test with a spreadsheet containing your own email address and a sample brand. Check the received message and signature. Then import your lead sheet, review statuses and confirm sending.

## Spreadsheet
The supplied Shopify_Leads.xlsx format is supported: Shopify Leads tab, heading row containing BrandName and Email (optional Audit sent). Other columns are ignored; Read Me tab is ignored. Excel_Template.xlsx is a sample, not a real recipient list. Only .xlsx files up to 5 MB. Audit sent values Yes, Sent, True, Done, 1 are skipped. The original file is not modified.

## Behavior and limits
Runs locally on loopback only. Keep terminal open during sending. One click starts sequential personalized delivery, with a default cap of 50 attempts per UTC day and two seconds between attempts. Change .env to adjust (hard cap 100); these are application safeguards, not Gmail quota promises. Uploading does not send until confirmed. The app records attempts before sending, so failed or interrupted attempts are not automatically retried. Check Gmail Sent and errors before any manual retry. history.json holds persistent recipient history; keep it private, back it up and do not delete it to reset the app. One server instance only. Sent means SMTP accepted the message, not delivery to inbox. Opt-outs must be managed externally and removed from future lists. Use only contacts you may lawfully email; comply with destination laws and Gmail policies. Add required business identification/address where applicable before sending. The template includes a reply STOP line. No inbox tracking, bounce processing or automatic unsubscribe list. Gmail SMTP does not automatically insert Gmail's saved signature; this app recreates the screenshot with live text, links and an embedded cropped logo. Rendering varies by client.

## Troubleshooting
Authentication errors: verify app password and 2-Step Verification. Port conflict: change PORT and open matching URL. Invalid addresses require correcting the workbook. Daily cap: start remaining Ready rows on the next UTC day (or re-upload). Stop pauses after the in-flight message. On restart re-upload the sheet; recorded attempts remain excluded.

## Files
server.js backend; template.js email HTML; public/ frontend and signature logo; .env.example setup; Excel_Template.xlsx sample. Dependencies installed by npm. Syntax checks performed; actual Gmail delivery requires your credentials and has not been tested.
