/* POST /api/auth/telegram-link
   Creates short-lived account-link tokens or consumes one from the bot. */
'use strict';

const crypto = require('crypto');

// ---- Safe module loading ----
let http, verify, firestore;
const missing = [];

try { http = require('../../lib/http'); }
catch (e) { http = null; missing.push('lib/http: ' + e.message); }

try { verify = require('../../lib/verify'); }
catch (e) { verify = null; missing.push('lib/verify: ' + e.message); }

try { firestore = require('../../lib/firestore-admin'); }
catch (e) { firestore = null; missing.push('lib/firestore-admin: ' + e.message); }

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

function sanitizeText(v, max) {
  if (http && typeof http.sanitizeText === 'function') return http.sanitizeText(v, max);
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max || 200);
}

async function readJsonBody(req) {
  if (http && typeof http.readJsonBody === 'function') return http.readJsonBody(req);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ---- Fallbacks for lib/verify ----
function checkSession(token) {
  if (verify && typeof verify.checkSession === 'function') return verify.checkSession(token);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

async function checkIdToken(idToken) {
  if (verify && typeof verify.checkIdToken === 'function') return verify.checkIdToken(idToken);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

async function assertNotBanned(uid, idToken) {
  if (verify && typeof verify.assertNotBanned === 'function') return verify.assertNotBanned(uid, idToken);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

// ---- Fallbacks for lib/firestore-admin ----
async function fsGetDocument(collection, id) {
  if (!firestore) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.getDocument(collection, id);
}
async function fsCreateDocument(collection, id, fields) {
  if (!firestore) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.createDocument(collection, id, fields);
}
async function fsPatchDocument(collection, id, fields, updateMask, expectedUpdateTime) {
  if (!firestore) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.patchDocument(collection, id, fields, updateMask, expectedUpdateTime);
}

// ---- Helpers ----
function decodeField(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('booleanValue' in value) return value.booleanValue;
  return null;
}

function decodeDocument(document) {
  const fields = (document && document.fields) || {};
  const result = {};
  Object.keys(fields).forEach((key) => { result[key] = decodeField(fields[key]); });
  return result;
}

function encodeFields(fields) {
  const result = {};
  Object.keys(fields).forEach((key) => {
    const value = fields[key];
    if (typeof value === 'boolean') result[key] = { booleanValue: value };
    else if (typeof value === 'number') result[key] = { integerValue: String(value) };
    else result[key] = { stringValue: String(value) };
  });
  return result;
}

async function authenticatedUid(req) {
  const session = String((req.headers && req.headers['x-sk-session']) || '');
  if (session) {
    const identity = checkSession(session);
    if (identity.provider !== 'phone' || !/^phone_[6-9]\d{9}$/.test(identity.uid)) {
      throw Object.assign(new Error('Phone sign-in required'), { status: 401 });
    }
    const profile = await fsGetDocument('users', identity.uid);
    if (!profile) throw Object.assign(new Error('Account profile not found'), { status: 404 });
    if (decodeDocument(profile).banned === true) {
      throw Object.assign(new Error('This account is banned'), { status: 403 });
    }
    return identity.uid;
  }

  const authorization = String((req.headers && req.headers.authorization) || '');
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw Object.assign(new Error('Sign in required'), { status: 401 });
  const identity = await checkIdToken(match[1]);
  await assertNotBanned(identity.uid, match[1]);
  return identity.uid;
}

async function createLink(req) {
  const uid = await authenticatedUid(req);
  const profile = await fsGetDocument('users', uid);
  if (!profile) throw Object.assign(new Error('Account profile not found'), { status: 404 });
  if (decodeDocument(profile).banned === true) {
    throw Object.assign(new Error('This account is banned'), { status: 403 });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenId = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000;

  // FIX: pass fields directly, NOT { fields: ... }
  await fsCreateDocument('telegram_link_tokens', tokenId, encodeFields({ uid, expiresAt, used: false }));
  return { success: true, token, expiresAt };
}

async function verifyLink(body) {
  const token = String(body.token || '');
  const telegramUserId = String(body.telegramUserId || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[1-9]\d{0,19}$/.test(telegramUserId)) {
    throw Object.assign(new Error('Invalid Telegram link'), { status: 400 });
  }

  const tokenId = crypto.createHash('sha256').update(token).digest('hex');
  const tokenDocument = await fsGetDocument('telegram_link_tokens', tokenId);
  if (!tokenDocument) throw Object.assign(new Error('Telegram link is invalid or expired'), { status: 404 });
  const link = decodeDocument(tokenDocument);

  if (link.used === true) {
    if (link.claimedTelegramId === telegramUserId) {
      const profile = await fsGetDocument('users', link.uid);
      if (!profile) throw Object.assign(new Error('Account profile not found'), { status: 404 });
      const user = decodeDocument(profile);
      if (user.banned === true) throw Object.assign(new Error('This account is banned'), { status: 403 });
      if (user.telegramUserId === telegramUserId) {
        return { success: true, alreadyVerified: true };
      }
      await writeTelegramProfile(link.uid, telegramUserId, body);
      return { success: true, verified: true };
    }
    throw Object.assign(new Error('Telegram link has already been used'), { status: 409 });
  }

  if (!link.uid || !Number.isFinite(link.expiresAt) || link.expiresAt <= Date.now()) {
    throw Object.assign(new Error('Telegram link is invalid or expired'), { status: 410 });
  }
  if (!tokenDocument.updateTime) {
    throw Object.assign(new Error('Telegram link could not be securely verified'), { status: 503 });
  }

  const profile = await fsGetDocument('users', link.uid);
  if (!profile) throw Object.assign(new Error('Account profile not found'), { status: 404 });
  const user = decodeDocument(profile);
  if (user.banned === true) throw Object.assign(new Error('This account is banned'), { status: 403 });

  const now = Date.now();

  // FIX: pass fields directly (not wrapped)
  await fsPatchDocument(
    'telegram_link_tokens',
    tokenId,
    encodeFields({ used: true, claimedTelegramId: telegramUserId, claimedAt: now }),
    ['used', 'claimedTelegramId', 'claimedAt'],
    tokenDocument.updateTime
  );

  await writeTelegramProfile(link.uid, telegramUserId, body);
  return { success: true, verified: true };
}

async function writeTelegramProfile(uid, telegramUserId, body) {
  const profile = await fsGetDocument('users', uid);
  if (!profile) throw Object.assign(new Error('Account profile not found'), { status: 404 });
  if (decodeDocument(profile).banned === true) {
    throw Object.assign(new Error('This account is banned'), { status: 403 });
  }

  const username = sanitizeText(body.username, 64).replace(/^@/, '');
  const displayName = sanitizeText(body.firstName, 80);
  const now = Date.now();

  // FIX: pass fields directly (not wrapped)
  await fsPatchDocument(
    'users',
    uid,
    encodeFields({
      telegramVerified: true,
      telegramUserId,
      telegramUsername: username,
      telegramLinkedAt: now,
      telegramDisplayName: displayName,
    }),
    ['telegramVerified', 'telegramUserId', 'telegramUsername', 'telegramLinkedAt', 'telegramDisplayName']
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET', 'POST'])) return;

  try {
    // ---- HEALTH CHECK (GET ?debug=1) ----
    // This lets you confirm the function is deployed and modules load.
    if (req.method === 'GET' && String((req.query && req.query.debug) || '') === '1') {
      return sendJson(req, res, 200, {
        success: true,
        debug: true,
        route: '/api/auth/telegram-link',
        loaded: { http: !!http, verify: !!verify, firestore: !!firestore },
        missing,
        timestamp: Date.now(),
      });
    }

    // Only POST is allowed for actual actions
    if (req.method !== 'POST') {
      return sendJson(req, res, 405, { success: false, error: 'Method not allowed' });
    }

    const body = await readJsonBody(req);
    const action = String(body.action || '');

    if (action === 'create') {
      if (!rateLimit(req, res, 'telegram-link-create', 12, 60_000)) return;
      return sendJson(req, res, 200, await createLink(req));
    }

    if (action === 'verify') {
      if (!rateLimit(req, res, 'telegram-link-verify', 30, 60_000)) return;
      return sendJson(req, res, 200, await verifyLink(body));
    }

    return sendJson(req, res, 400, { success: false, error: 'Unsupported Telegram link action' });
  } catch (error) {
    console.error('[TELEGRAM-LINK] error:', error && error.message);
    const status = (error && error.status) || 503;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? error.message : 'Telegram linking is temporarily unavailable',
      detail: error && error.message,
      missing: missing.length ? missing : undefined,
    });
  }
};