/* POST /api/telegram/link  { action: "create" }
   Mints a single-use Telegram verification token for the signed-in learner.
   Requires a valid Firebase ID token or a signed phone session — never a
   Telegram id from the browser. */
'use strict';

const { sendJson, sendOptions, requireMethod, readJsonBody, rateLimit, sanitizeText } = require('../../lib/http');
const { authorize } = require('../../lib/verify');
const telegram = require('../../lib/telegram');

function botUrl(token) {
  const base = String(process.env.TELEGRAM_BOT_URL || 'https://t.me/Studikitesbot').replace(/\/+$/, '');
  return `${base}?start=skv1_${token}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    if (!rateLimit(req, res, 'tg-link', 15, 10 * 60_000)) return;
    const body = await readJsonBody(req);
    const action = sanitizeText(body.action || 'create', 20);
    if (action !== 'create') {
      return sendJson(req, res, 400, { success: false, error: 'Unsupported action' });
    }
    const identity = await authorize(req, {});
    if (!identity || !identity.uid) {
      return sendJson(req, res, 401, { success: false, error: 'Sign in required' });
    }
    const link = await telegram.createLink(identity.uid);
    return sendJson(req, res, 200, {
      success: true,
      token: link.token,
      expiresAt: link.expiresAt,
      url: botUrl(link.token),
    });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? err.message || 'Could not create a Telegram link' : 'Telegram linking is temporarily unavailable',
    });
  }
};
