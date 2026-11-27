'use strict';

const crypto = require('crypto');

// ---- Token cache ----
// Note: Vercel serverless functions may run in parallel, so a simple in-memory
// cache is per-instance, not global. We keep the expiry check to avoid
// re-minting on every call within the same warm instance.
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
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.access_token) {
      throw Object.assign(new Error('Firebase server authorization failed'), { status: 503 });
    }
    tokenCache = {
      value: result.access_token,
      expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
    };
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
      throw Object.assign(new Error('Firebase document request failed'), {
        status: response.status === 409 ? 409 : 503,
      });
    }
    return result;
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error('Firebase document request failed'), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

async function getDocument(collection, id) {
  const account = credentials();
  return firestoreRequest(documentUrl(`${collection}/${id}`, account), 'GET');
}

async function createDocument(collection, id, fields) {
  return createDocumentPath(collection, id, fields);
}

async function createDocumentPath(collectionPath, id, fields) {
  const parts = String(collectionPath || '').split('/');
  if ((parts.length !== 1 && parts.length !== 3) ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)) ||
      !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error('Invalid document path'), { status: 400 });
  }
  const account = credentials();
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${parts.map(encodeURIComponent).join('/')}`);
  url.searchParams.set('documentId', id);
  return firestoreRequest(url.toString(), 'POST', { fields });
}

async function patchDocument(collection, id, fields, updateMask, expectedUpdateTime) {
  const account = credentials();
  return firestoreRequest(
    documentUrl(`${collection}/${id}`, account),
    'PATCH',
    { fields },
    updateMask,
    expectedUpdateTime
  );
}

async function getDocumentPath(path) {
  const account = credentials();
  return firestoreRequest(documentUrl(path, account), 'GET');
}

async function patchDocumentPath(path, fields, updateMask) {
  const account = credentials();
  return firestoreRequest(documentUrl(path, account), 'PATCH', { fields }, updateMask);
}

async function listDocuments(path, pageSize, orderBy) {
  const parts = String(path || '').split('/');
  if ((parts.length !== 1 && parts.length !== 3) || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw Object.assign(new Error('Invalid collection path'), { status: 400 });
  }
  const account = credentials();
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${parts.map(encodeURIComponent).join('/')}`);
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(50, Number(pageSize) || 30))));
  if (orderBy) url.searchParams.set('orderBy', orderBy);

  const token = await accessToken(account);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error('Firebase document request failed'), { status: 503 });
    const result = await response.json().catch(() => null);
    return result && Array.isArray(result.documents) ? result.documents : [];
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error('Firebase document request failed'), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  credentials,
  getDocument,
  getDocumentPath,
  listDocuments,
  createDocument,
  createDocumentPath,
  patchDocument,
  patchDocumentPath,
};