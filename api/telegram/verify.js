/* POST /api/telegram/verify
   Called by the StudiKitEZ Telegram bot after it has confirmed the learner is a
   member of the community group. Redeems a single-use token minted by
   /api/telegram/link and stores the Telegram identity on the Firebase profile.

   Security layers:
   - the token itself is 256-bit, single-use and expires in 15 minutes;
   - an optional shared bot secret (TELEGRAM_BOT_SECRET) is enforced when set;
   - IP rate limiting.
   The bot never sends a StudiKitEZ uid; the uid comes from the stored token. */
'use strict';

const crypto = require('crypto');
const { sendJson, sendOptions, requireMethod, readJsonBody, rateLimit, sanitizeText } = require('../../lib/http');
const telegram = require('../../lib/telegram');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  try { return crypto.timingSafeEqual(left, right); } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    if (!rateLimit(req, res, 'tg-verify', 30, 10 * 60_000)) return;
    const secret = String(process.env.TELEGRAM_BOT_SECRET || '');
    if (secret) {
      const provided = String((req.headers && (req.headers['x-sk-bot-secret'] || req.headers['x-telegram-bot-api-secret-token'])) || '');
      if (!safeEqual(secret, provided)) {
        return sendJson(req, res, 401, { success: false, error: 'Bot authorisation failed' });
      }
    }
    const body = await readJsonBody(req);
    const token = sanitizeText(body.token, 64).replace(/^skv1_/, '');
    if (!token) return sendJson(req, res, 400, { success: false, error: 'Missing token' });
    const telegramUserId = sanitizeText(body.telegramUserId || body.telegram_id, 24);
    const result = await telegram.redeemLink(token, {
      id: telegramUserId,
      username: sanitizeText(body.username, 32),
      firstName: sanitizeText(body.firstName || body.first_name, 64),
    });
    return sendJson(req, res, 200, {
      success: true,
      verified: true,
      telegramId: result.telegramId,
    });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, {
      success: false,
      verified: false,
      error: status < 500 ? err.message || 'Verification failed' : 'Verification is temporarily unavailable',
    });
  }
};
