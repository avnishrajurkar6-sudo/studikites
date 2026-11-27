/* POST /api/auth/strike
   Server-side strike counter for the devtools guard. Clients can no longer
   write `strikes` / `banned` directly (Firestore rules lock those fields), so
   both Google and phone sessions report strikes here instead. After 3 strikes
   the account is banned by the service account. */
'use strict';

const { sendJson, sendOptions, requireMethod, readJsonBody, rateLimit, sanitizeText } = require('../../lib/http');
const { authorize } = require('../../lib/verify');

let firestore = null;
try { firestore = require('../../lib/firestore-admin'); } catch { firestore = null; }

const MAX_STRIKES = 3;

function field(fields, key) {
  const f = fields && fields[key];
  if (!f) return undefined;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.booleanValue !== undefined) return f.booleanValue;
  return undefined;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    if (!rateLimit(req, res, 'strike', 20, 60_000)) return;
    const who = await authorize(req, {});
    if (!who || !who.uid) return sendJson(req, res, 401, { success: false, error: 'Sign in required' });
    if (!firestore) {
      return sendJson(req, res, 503, { success: false, error: 'Strike service unavailable' });
    }
    const body = await readJsonBody(req);
    const doc = await firestore.getDocument('users', who.uid);
    const fields = (doc && doc.fields) || {};
    if (String(field(fields, 'role') || '') === 'admin') {
      return sendJson(req, res, 200, { success: true, strikes: Number(field(fields, 'strikes')) || 0, banned: false, ignored: true });
    }
    const strikes = (Number(field(fields, 'strikes')) || 0) + 1;
    const now = Date.now();
    const patch = {
      strikes: { integerValue: String(strikes) },
      lastStrikeAt: { integerValue: String(now) },
      strikeReason: { stringValue: sanitizeText(body.reason || 'devtools', 80) },
    };
    const banned = strikes >= MAX_STRIKES;
    if (banned) {
      patch.banned = { booleanValue: true };
      patch.banReason = { stringValue: 'Automatic: developer tools opened' };
      patch.bannedAt = { integerValue: String(now) };
    }
    await firestore.patchDocument('users', who.uid, patch, Object.keys(patch));
    return sendJson(req, res, 200, { success: true, strikes, banned });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? err.message || 'Strike failed' : 'Strike service temporarily unavailable',
    });
  }
};
