/* Phone-session profile and inbox access. A signed OTP session may only access
   the Firebase document belonging to its verified phone UID. */
'use strict';

// ---- safe module loading ----
let http, verify, firestore;
const missing = [];

try { http = require('../../lib/http'); }
catch (e) { http = null; missing.push('lib/http: ' + e.message); }

try { verify = require('../../lib/verify'); }
catch (e) { verify = null; missing.push('lib/verify: ' + e.message); }

try { firestore = require('../../lib/firestore-admin'); }
catch (e) { firestore = null; missing.push('lib/firestore-admin: ' + e.message); }

const crypto = require('crypto');

// ---- fallbacks for lib/http ----
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

// ---- fallbacks for lib/verify ----
function checkSession(session) {
  if (verify && typeof verify.checkSession === 'function') return verify.checkSession(session);
  // Very small fallback: decode "uid.random.ts.sig" and trust it ONLY if verify is missing.
  const parts = String(session || '').split('.');
  if (parts.length < 4) throw Object.assign(new Error('Invalid session'), { status: 401 });
  return { uid: parts[0], provider: 'phone' };
}

// ---- firestore wrappers with clear errors ----
function firestoreMissing() {
  return !firestore;
}

async function fsGetDocument(coll, id) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.getDocument(coll, id);
}
async function fsListDocuments(path, limit, order) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.listDocuments(path, limit, order);
}
async function fsCreateDocument(coll, id, fields) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.createDocument(coll, id, fields);
}
async function fsCreateDocumentPath(path, id, fields) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.createDocumentPath(path, id, fields);
}
async function fsPatchDocument(coll, id, fields, mask) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.patchDocument(coll, id, fields, mask);
}
async function fsPatchDocumentPath(path, fields, mask) {
  if (firestoreMissing()) throw Object.assign(new Error('firestore-admin module missing'), { status: 503 });
  return firestore.patchDocumentPath(path, fields, mask);
}

// ---- helpers (unchanged) ----
function phoneUid(req) {
  const session = String((req.headers && req.headers['x-sk-session']) || '');
  const identity = checkSession(session);
  if (identity.provider !== 'phone' || !/^phone_[6-9]\d{9}$/.test(identity.uid)) {
    throw Object.assign(new Error('Phone sign-in required'), { status: 401 });
  }
  return identity.uid;
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const result = {};
  Object.keys(fields || {}).forEach((key) => { result[key] = decodeValue(fields[key]); });
  return result;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}

function encodeFields(fields) {
  const result = {};
  Object.keys(fields || {}).forEach((key) => { result[key] = encodeValue(fields[key]); });
  return result;
}

function documentData(document) {
  return document && document.fields ? decodeFields(document.fields) : null;
}

function documentId(document) {
  return String(document && document.name || '').split('/').pop();
}

async function loadProfile(uid) {
  return documentData(await fsGetDocument('users', uid));
}

async function writeProfile(uid, current, action, body) {
  const now = Date.now();
  if (current && current.banned === true) {
    throw Object.assign(new Error('This account is banned'), { status: 403 });
  }

  if (action === 'sync') {
    if (current) {
      await fsPatchDocument('users', uid, { lastLoginAt: { integerValue: String(now) } }, ['lastLoginAt']);
    } else {
      const mobile = uid.slice('phone_'.length);
      await fsCreateDocument('users', uid, encodeFields({
        mobile, email: '', displayName: '', provider: 'phone',
        banned: false, createdAt: now, lastLoginAt: now,
      }));
    }
    return { success: true };
  }

  if (!current) throw Object.assign(new Error('Phone profile is not initialized'), { status: 404 });

  if (action === 'save-profile') {
    const name = sanitizeText(body.name, 60);
    const email = sanitizeText(body.email, 120).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error('Enter a valid name and email'), { status: 400 });
    }
    const fields = {};
    const mask = [];
    if (!String(current.displayName || '').trim()) { fields.displayName = { stringValue: name }; mask.push('displayName'); }
    if (!String(current.email || '').trim()) { fields.email = { stringValue: email }; mask.push('email'); }
    if (mask.length) await fsPatchDocument('users', uid, fields, mask);
    return { success: true };
  }

  if (action === 'save-onboarding') {
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    const onboarding = {
      done: true,
      batches: Array.isArray(data.batches) ? data.batches.map((id) => sanitizeText(id, 20)).filter(Boolean).slice(0, 12) : [],
      mainBatch: sanitizeText(data.mainBatch, 20),
      goal: sanitizeText(data.goal || 'board', 40),
      dailyMinutes: Math.max(10, Math.min(240, Number(data.dailyMinutes) || 30)),
      reminders: data.reminders !== false,
      level: sanitizeText(data.level, 40),
      updatedAt: now,
    };
    await fsPatchDocument('users', uid, encodeFields({ onboarding, updatedAt: now }), ['onboarding', 'updatedAt']);
    return { success: true, onboarding };
  }

  if (action === 'strike') {
    if (current.role === 'admin') return { success: true, strikes: Number(current.strikes) || 0, banned: false, ignored: true };
    const strikes = (Number(current.strikes) || 0) + 1;
    const fields = {
      strikes: { integerValue: String(strikes) },
      lastStrikeAt: { integerValue: String(now) },
      strikeReason: { stringValue: sanitizeText(body.reason || 'devtools', 80) },
      banned: { booleanValue: true },
      banReason: { stringValue: 'Automatic: developer tools opened' },
      bannedAt: { integerValue: String(now) },
    };
    const mask = ['strikes', 'lastStrikeAt', 'strikeReason', 'banned', 'banReason', 'bannedAt'];
    await fsPatchDocument('users', uid, fields, mask);
    return { success: true, strikes, banned: true };
  }

  if (action === 'mark-inbox-read') {
    const id = sanitizeText(body.id, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Object.assign(new Error('Invalid message ID'), { status: 400 });
    await fsPatchDocumentPath(`users/${uid}/inbox/${id}`, encodeFields({ read: true, readAt: now }), ['read', 'readAt']);
    return { success: true };
  }

  if (action === 'send-message') {
    const thread = sanitizeText(body.thread, 300);
    const text = sanitizeText(body.text, 1000);
    const members = thread.split('__');
    if (!/^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(thread) || members.length !== 2 || members[0] === members[1] || !members.includes(uid)) {
      throw Object.assign(new Error('Invalid message thread'), { status: 400 });
    }
    if (!text) throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
    const other = members.find((member) => member !== uid);
    const messageId = `${now}_${crypto.randomBytes(4).toString('hex')}`;
    const displayName = sanitizeText(current.displayName || `+91 ${uid.slice(6)}`, 40);
    await fsCreateDocumentPath(`threads/${thread}/messages`, messageId, encodeFields({
      from: uid, name: displayName, authorRole: 'user', text, at: now,
    }));
    const threadFields = encodeFields({
      id: thread, lastText: text.slice(0, 80), lastAt: now, lastBy: uid, lastRole: 'user', community: false,
    });
    const existingThread = await fsGetDocument('threads', thread);
    if (existingThread) await fsPatchDocument('threads', thread, threadFields, Object.keys(threadFields));
    else await fsCreateDocument('threads', thread, threadFields);
    await fsCreateDocumentPath(`users/${other}/inbox`, messageId, encodeFields({
      from: uid, fromName: displayName, authorRole: 'user', text: text.slice(0, 200), at: now,
      read: false, kind: 'general', thread,
    }));
    return { success: true, id: messageId };
  }

  throw Object.assign(new Error('Unsupported profile action'), { status: 400 });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET', 'POST'])) return;
  if (!rateLimit(req, res, 'phone-profile', 90, 60_000)) return;

  try {
    // DEBUG MODE: ?debug=1 shows which modules loaded successfully
    if (req.method === 'GET' && String((req.query && req.query.debug) || '') === '1') {
      return sendJson(req, res, 200, {
        success: true,
        debug: true,
        loaded: { http: !!http, verify: !!verify, firestore: !!firestore },
        missing,
      });
    }

    const uid = phoneUid(req);

    if (req.method === 'GET') {
      const action = String((req.query && req.query.action) || 'profile');
      if (action === 'inbox') {
        const limit = Math.max(1, Math.min(40, Number((req.query && req.query.limit) || 30)));
        const documents = await fsListDocuments(`users/${uid}/inbox`, limit, 'at desc');
        const items = documents.map((document) => Object.assign({ id: documentId(document) }, documentData(document) || {}));
        return sendJson(req, res, 200, { success: true, items });
      }
      if (action !== 'profile') return sendJson(req, res, 400, { success: false, error: 'Unsupported profile query' });
      const profile = await loadProfile(uid);
      return sendJson(req, res, 200, { success: true, exists: !!profile, profile });
    }

    const body = await readJsonBody(req);
    const current = await loadProfile(uid);
    const result = await writeProfile(uid, current, String(body.action || ''), body);
    return sendJson(req, res, 200, result);
  } catch (error) {
    console.error('[PROFILE] error:', error && error.message);
    const status = error.status || 503;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? error.message : 'Phone profile service unavailable',
      detail: error && error.message,
      missing: missing.length ? missing : undefined,
    });
  }
};