/* POST /api/auth/is-admin
   Admin status is based only on a verified Firebase ID token and a private
   email allowlist or the caller's own admin role document. */
'use strict';

// ---- Safe module loading ----
let http, verify;
const missing = [];

try { http = require('../../lib/http'); }
catch (e) { http = null; missing.push('lib/http: ' + e.message); }

try { verify = require('../../lib/verify'); }
catch (e) { verify = null; missing.push('lib/verify: ' + e.message); }

// ---- Fallbacks for lib/http ----
function sendJson(req, res, status, body) {
  if (http && typeof http.sendJson === 'function') return http.sendJson(req, res, status, body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function sendOptions(req, res) {
  if (http && typeof http.sendOptions === 'function') return http.sendOptions(req, res);
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

function requireMethod(req, res, methods) {
  if (http && typeof http.requireMethod === 'function') return http.requireMethod(req, res, methods);
  if (!methods.includes(req.method)) {
    sendJson(req, res, 405, { success: false, error: 'Method not allowed' });
    return false;
  }
  return true;
}

function rateLimit(req, res, key, max, windowMs) {
  if (http && typeof http.rateLimit === 'function') return http.rateLimit(req, res, key, max, windowMs);
  return true;
}

// ---- Fallbacks for lib/verify ----
async function checkIdToken(idToken) {
  if (verify && typeof verify.checkIdToken === 'function') return verify.checkIdToken(idToken);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

async function userRecord(uid, idToken) {
  if (verify && typeof verify.userRecord === 'function') return verify.userRecord(uid, idToken);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['POST'])) return;
  if (!rateLimit(req, res, 'is-admin', 30, 60_000)) return;

  const authorization = String((req.headers && req.headers.authorization) || '');
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return sendJson(req, res, 401, { success: false, admin: false, error: 'Sign in required' });

  try {
    const identity = await checkIdToken(match[1]);
    const user = await userRecord(identity.uid, match[1]);
    const admin = !(user && user.banned) &&
      (adminEmails().includes(identity.email) || !!(user && user.role === 'admin'));
    return sendJson(req, res, 200, {
      success: true,
      admin,
      uid: identity.uid,
      via: adminEmails().includes(identity.email) ? 'allowlist' : admin ? 'role' : 'none',
    });
  } catch (error) {
    console.error('[IS-ADMIN] error:', error && error.message);
    const status = error.status || 503;
    return sendJson(req, res, status, {
      success: false,
      admin: false,
      error: status < 500 ? error.message : 'Admin status unavailable',
      detail: error && error.message,
      missing: missing.length ? missing : undefined,
    });
  }
};