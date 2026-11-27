/* Daily housekeeping, triggered by vercel.json cron.
   Removes used/expired Telegram link tokens and stale presence heartbeats.
   Protected by CRON_SECRET (or Vercel's own cron header when no secret is set). */
'use strict';

const { sendJson, sendOptions, requireMethod, rateLimit } = require('../../lib/http');

let firestore = null;
try { firestore = require('../../lib/firestore-admin'); } catch { firestore = null; }

function docId(document) {
  return String((document && document.name) || '').split('/').pop();
}
function num(fields, key) {
  const f = fields && fields[key];
  if (!f) return 0;
  const raw = f.integerValue !== undefined ? f.integerValue : f.stringValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
function authorized(req) {
  const secret = String(process.env.CRON_SECRET || '');
  const auth = String((req.headers && req.headers.authorization) || '');
  if (secret) return auth === `Bearer ${secret}`;
  const cron = String((req.headers && req.headers['x-vercel-cron']) || '');
  const ua = String((req.headers && req.headers['user-agent']) || '');
  return cron === '1' || /vercel-cron/i.test(ua);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET', 'POST'])) return;
  if (!rateLimit(req, res, 'cron-maintenance', 5, 60_000)) return;
  if (!authorized(req)) return sendJson(req, res, 401, { success: false, error: 'Cron authorisation failed' });
  if (!firestore) return sendJson(req, res, 503, { success: false, error: 'Firestore not configured' });

  try {
    const now = Date.now();
    let links = 0, presence = 0;

    const tokens = await firestore.listDocuments('telegram_links', 50);
    for (const document of tokens) {
      const f = document.fields || {};
      const expired = num(f, 'expiresAt') && now > num(f, 'expiresAt');
      const used = String(f.used && f.used.booleanValue === true);
      if (expired || used === 'true') {
        await firestore.deleteDocument('telegram_links', docId(document)).catch(() => {});
        links++;
      }
    }

    const heartbeats = await firestore.listDocuments('presence', 50);
    for (const document of heartbeats) {
      const at = num(document.fields || {}, 'at');
      if (at && now - at > 15 * 60_000) {
        await firestore.deleteDocument('presence', docId(document)).catch(() => {});
        presence++;
      }
    }

    return sendJson(req, res, 200, { success: true, removed: { telegramLinks: links, presence } });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || 'Maintenance failed' });
  }
};
