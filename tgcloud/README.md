# Telegram account verification

`handlers/message.js` handles private `/start` messages from Telegram Serverless. It accepts only a short-lived link token created by an authenticated StudiKitEZ session, then asks the backend to record the Telegram identity on that user's Firebase profile. Telegram IDs are never accepted directly from the browser.

To enable the handler:

1. Enable Serverless for the existing bot in BotFather.
2. From the repository root, initialize the Telegram Serverless project with `npm create @tgcloud/bot .`; the initializer leaves existing files untouched.
3. Link this repository to that bot with `npx tgcloud login`.
4. Use `npx tgcloud run handlers/message '{ chat: { id: 1, type: "private" }, text: "/start" }'` to test the unlinked response.
5. Deploy the handler with `npx tgcloud push tgcloud/handlers/message.js`.

The backend requires `FIREBASE_SERVICE_ACCOUNT_JSON` to be configured as a private deployment secret. The token is single-use, expires after ten minutes, and must not be copied or shared.
