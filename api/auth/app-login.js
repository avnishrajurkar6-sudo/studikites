/* App authorization-code flow (mobile app).
   POST /api/auth/app-login
     { action: "create", app, redirect, state }  -> { code, expiresAt, redirect }
        called on the website by a signed-in user; code is temporary, single-use,
        expires in a few minutes, and is deleted on redemption.
     { action: "exchange", code }                 -> { session, uid, provider }
        called by the app; redeems + DELETES the temporary code and returns a
        backend-signed session (x-sk-session), same as phone users. */
'use strict';

const crypto = require('crypto');
const { sendJson, sendOptions, requireMethod, readJsonBody, rateLimit, sanitizeText } = require('../../lib/http');
const { authorize, mintSession } = require('../../lib/verify');

const TTL_MS = 5 * 60 * 1000; // a few minutes
let firestore = null;
try { firestore = require('../../lib/firestore-admin'); } catch (e) { firestore = null; }

function randomCode() { return crypto.randomBytes(32).toString('base64url'); }

function field(fields, key) {
  const f = fields && fields[key];
  if (!f) return undefined;
  if (typeof f.stringValue === 'string') return f.stringValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.booleanValue !== undefined) return f.booleanValue;
  return undefined;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  try {
    if (!rateLimit(req, res, 'app-login', 60, 10 * 60_000)) return;
    if (!firestore) throw Object.assign(new Error('Authorization store is not configured'), { status: 503 });
    const body = await readJsonBody(req);
    const action = sanitizeText(body.action || 'create', 20);

    if (action === 'create') {
      const identity = await authorize(req, {});
      if (!identity || !identity.uid) return sendJson(req, res, 401, { success: false, error: 'Sign in required' });
      const provider = identity.via === 'phone' ? 'phone' : 'google';
      const code = randomCode();
      const now = Date.now();
      const expiresAt = now + TTL_MS;
      const app = sanitizeText(body.app || 'studikitesz', 40);
      const redirectBase = sanitizeText(body.redirect || '', 200);
      await firestore.createDocument('app_auth_codes', code, {
        uid: { stringValue: String(identity.uid) },
        provider: { stringValue: provider },
        app: { stringValue: app },
        createdAt: { integerValue: String(now) },
        expiresAt: { integerValue: String(expiresAt) },
        used: { booleanValue: false },
      });
      let redirect = '';
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(redirectBase)) {
        const sep = redirectBase.includes('?') ? '&' : '?';
        redirect = `${redirectBase}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(sanitizeText(body.state, 200))}`;
      }
      return sendJson(req, res, 200, { success: true, code, expiresAt, redirect });
    }

    if (action === 'exchange') {
      const code = sanitizeText(body.code, 128);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) return sendJson(req, res, 400, { success: false, error: 'Invalid code' });
      const doc = await firestore.getDocument('app_auth_codes', code);
      if (!doc) return sendJson(req, res, 404, { success: false, error: 'Code not found or expired' });
      const fields = doc.fields || {};
      const used = field(fields, 'used') === true;
      const expiresAt = Number(field(fields, 'expiresAt') || 0);
      const uid = String(field(fields, 'uid') || '');
      const provider = String(field(fields, 'provider') || 'google');
      // Temporary code is deleted after a few minutes / on redemption.
      try { await firestore.deleteDocument('app_auth_codes', code); } catch (e) { /* best effort */ }
      if (used) return sendJson(req, res, 409, { success: false, error: 'Code already used' });
      if (!uid) return sendJson(req, res, 404, { success: false, error: 'Code invalid' });
      if (expiresAt && Date.now() > expiresAt) return sendJson(req, res, 410, { success: false, error: 'Code expired' });
      // verify still not banned
      // (authorize would need a session; re-check user record directly)
      const userDoc = await firestore.getDocument('users', uid);
      const userFields = (userDoc && userDoc.fields) || {};
      if (field(userFields, 'banned') === true) return sendJson(req, res, 403, { success: false, error: 'This account is banned' });
      const session = mintSession(uid, provider === 'phone' ? 'phone' : 'google', 30 * 24 * 3600 * 1000);
      return sendJson(req, res, 200, { success: true, session, uid, provider: provider === 'phone' ? 'phone' : 'google' });
    }

    return sendJson(req, res, 400, { success: false, error: 'Unsupported action' });
  } catch (err) {
    const status = err.status || 500;
    return sendJson(req, res, status, { success: false, error: status < 500 ? err.message || 'Authorization failed' : 'Authorization is temporarily unavailable' });
  }
};
