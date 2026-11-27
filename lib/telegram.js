/* Telegram account linking (CommonJS, no deps).
   A signed-in learner mints a short random token; the bot redeems it after the
   learner proves group membership. Tokens are single-use, expire in 15 minutes,
   and are stored in Firestore so they survive serverless cold starts. */
'use strict';

const crypto = require('crypto');
let firestore = null;
try { firestore = require('./firestore-admin'); } catch (e) { firestore = null; }

const TTL_MS = 15 * 60 * 1000;

function enabled() {
  return !!(firestore && typeof firestore.createDocument === 'function');
}

function randomToken() {
  /* 32 random bytes -> 43 base64url chars (fits Telegram's 64-char start param
     together with the "skv1_" prefix). */
  return crypto.randomBytes(32).toString('base64url');
}

function asLong(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function fieldString(fields, key) {
  const f = fields && fields[key];
  if (!f) return '';
  if (typeof f.stringValue === 'string') return f.stringValue;
  if (typeof f.integerValue === 'number') return String(f.integerValue);
  if (typeof f.integerValue === 'string') return f.integerValue;
  if (f.booleanValue !== undefined) return String(f.booleanValue);
  return '';
}

async function createLink(uid) {
  if (!enabled()) {
    throw Object.assign(new Error('Telegram linking is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing)'), { status: 503 });
  }
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  await firestore.createDocument('telegram_links', token, {
    uid: { stringValue: String(uid) },
    createdAt: { integerValue: String(now) },
    expiresAt: { integerValue: String(expiresAt) },
    used: { booleanValue: false },
  });
  return { token, expiresAt };
}

async function redeemLink(token, telegram) {
  if (!enabled()) {
    throw Object.assign(new Error('Telegram linking is not configured'), { status: 503 });
  }
  const clean = String(token || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(clean)) {
    throw Object.assign(new Error('Invalid verification token'), { status: 400 });
  }
  const doc = await firestore.getDocument('telegram_links', clean);
  if (!doc) throw Object.assign(new Error('This verification link has expired'), { status: 404 });
  const fields = doc.fields || {};
  const used = String(fieldString(fields, 'used')) === 'true';
  if (used) throw Object.assign(new Error('This verification link has already been used'), { status: 409 });
  const expiresAt = asLong(fieldString(fields, 'expiresAt'));
  if (expiresAt && Date.now() > expiresAt) {
    throw Object.assign(new Error('This verification link has expired'), { status: 410 });
  }
  const uid = fieldString(fields, 'uid');
  if (!uid) throw Object.assign(new Error('This verification link is invalid'), { status: 404 });

  const tgId = String(telegram && telegram.id || '');
  if (!/^\d{4,20}$/.test(tgId)) throw Object.assign(new Error('Invalid Telegram account'), { status: 400 });
  const username = String((telegram && telegram.username) || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32);
  const firstName = String((telegram && telegram.firstName) || '').slice(0, 64);
  const now = Date.now();

  /* Single-use: claim the token first so two concurrent redeems can't both win. */
  await firestore.patchDocument('telegram_links', clean, {
    used: { booleanValue: true },
    usedAt: { integerValue: String(now) },
    telegramId: { stringValue: tgId },
  }, ['used', 'usedAt', 'telegramId']);

  await firestore.patchDocument('users', uid, {
    telegramVerified: { booleanValue: true },
    telegramId: { stringValue: tgId },
    telegramUsername: { stringValue: username },
    telegramFirstName: { stringValue: firstName },
    telegramLinkedAt: { integerValue: String(now) },
    telegram: {
      mapValue: {
        fields: {
          id: { stringValue: tgId },
          username: { stringValue: username },
          firstName: { stringValue: firstName },
          linkedAt: { integerValue: String(now) },
        },
      },
    },
  }, ['telegramVerified', 'telegramId', 'telegramUsername', 'telegramFirstName', 'telegramLinkedAt', 'telegram']);

  return { uid, telegramId: tgId };
}

module.exports = { enabled, createLink, redeemLink, TTL_MS };
