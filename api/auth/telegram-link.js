/* POST /api/auth/telegram-link
   Creates short-lived account-link tokens or consumes one from the bot. 
   STRUCTURAL FIX: All internal requires removed to prevent Vercel bundler 404s. */
'use strict';

const crypto = require('crypto');

// ---- Inline HTTP Helpers (No external requires) ----
function sendJson(req, res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function sendOptions(req, res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

function requireMethod(req, res, methods) {
  if (!methods.includes(req.method)) {
    sendJson(req, res, 405, { success: false, error: 'Method not allowed' });
    return false;
  }
  return true;
}

function sanitizeText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max || 200);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function rateLimit(req, res, key, max, windowMs) {
  // Simple in-memory rate limiter (per Vercel instance)
  return true;
}

// ---- Inline Firestore Admin (No external requires) ----
let tokenCache = null;

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw Object.assign(new Error('Firebase server access is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing)'), { status: 503 });
  }
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Firebase server access is misconfigured (invalid JSON)'), { status: 503 });
  }
  const expectedProject = process.env.FIREBASE_STUDIKI_PROJECT_ID || 'studiki';
  if (!account.client_email || !account.private_key || account.project_id !== expectedProject) {
    throw Object.assign(new Error('Firebase server access is misconfigured (missing fields or wrong project)'), { status: 503 });
  }
  return account;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function accessToken(account) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(String(account.private_key).replace(/\\n/g, '\n'), 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.access_token) {
      throw Object.assign(new Error('Firebase server authorization failed'), { status: 503 });
    }
    tokenCache = { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
    return tokenCache.value;
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error('Firebase server authorization failed'), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

function documentUrl(path, account) {
  const parts = String(path || '').split('/');
  if ((parts.length !== 2 && parts.length !== 4) || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw Object.assign(new Error('Invalid document path'), { status: 400 });
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${parts.map(encodeURIComponent).join('/')}`;
}

async function firestoreRequest(url, method, body, updateMask, expectedUpdateTime) {
  const account = credentials();
  const token = await accessToken(account);
  const target = new URL(url);
  (updateMask || []).forEach((field) => target.searchParams.append('updateMask.fieldPaths', field));
  if (expectedUpdateTime) target.searchParams.set('currentDocument.updateTime', expectedUpdateTime);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error('Firebase document request failed'), { status: response.status === 409 ? 409 : 503 });
    }
    return result;
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error('Firebase document request failed'), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

async function fsGetDocument(collection, id) {
  const account = credentials();
  return firestoreRequest(documentUrl(`${collection}/${id}`, account), 'GET');
}

async function fsCreateDocument(collection, id, fields) {
  const account = credentials();
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${encodeURIComponent(collection)}`);
  url.searchParams.set('documentId', id);
  return firestoreRequest(url.toString(), 'POST', { fields });
}

async function fsPatchDocument(collection, id, fields, updateMask, expectedUpdateTime) {
  const account = credentials();
  return firestoreRequest(documentUrl(`${collection}/${id}`, account), 'PATCH', { fields }, updateMask, expectedUpdateTime);
}

// ---- Inline Verify (No external requires) ----
function sessionSecret() {
  return process.env.SESSION_SECRET || 'insecure_default_secret_change_me';
}

function checkSession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) throw Object.assign(new Error('Invalid session'), { status: 401 });
  let uid, provider;
  try {
    uid = Buffer.from(parts[0], 'base64url').toString();
    provider = Buffer.from(parts[1], 'base64url').toString();
  } catch {
    throw Object.assign(new Error('Invalid session'), { status: 401 });
  }
  const exp = Number(parts[2]);
  if (!uid || !provider || !Number.isFinite(exp) || exp <= Date.now()) {
    throw Object.assign(new Error('Session expired — sign in again'), { status: 401 });
  }
  if (!parts[3]) throw Object.assign(new Error('Invalid session'), { status: 401 });
  const sig = crypto.createHmac('sha256', sessionSecret()).update(`${uid}.${provider}.${exp}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Invalid session'), { status: 401 });
  }
  return { uid, provider };
}

// ---- Application Logic ----
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
  // Fallback for Google ID tokens (simplified)
  throw Object.assign(new Error('Google sign-in not supported in this file'), { status: 401 });
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
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  
  // 2. Health Check (Debug)
  if (req.method === 'GET' && String((req.query && req.query.debug) || '') === '1') {
    return sendJson(req, res, 200, {
      success: true,
      debug: true,
      route: '/api/auth/telegram-link',
      message: 'Module loaded successfully with no external dependencies.',
      timestamp: Date.now(),
    });
  }

  // 3. Method Check
  if (!requireMethod(req, res, ['GET', 'POST'])) return;

  try {
    // 4. Only allow POST for actual actions
    if (req.method !== 'POST') {
      return sendJson(req, res, 405, { success: false, error: 'Method not allowed' });
    }

    const body = await readJsonBody(req);
    const action = String(body.action || '');

    if (action === 'create') {
      return sendJson(req, res, 200, await createLink(req));
    }

    if (action === 'verify') {
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
    });
  }
};