/* GET /api/courses/batches
   Always-fresh batch catalog. Proxies https://nt.studybeepro.site/batches.json
   with a short cache and falls back to the bundled snapshot when upstream is
   down, so the site never shows an empty catalog. Vercel cron warms the cache
   daily (see vercel.json). */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- Safe module loading ----
let http, verify;
const missing = [];

try { http = require('../../lib/http'); }
catch (e) { http = null; missing.push('lib/http: ' + e.message); }

try { verify = require('../../lib/verify'); }
catch (e) { verify = null; missing.push('lib/verify: ' + e.message); }

const FALLBACK_PATH = path.join(__dirname, '..', '..', 'lib', 'batches.json');
const CACHE_MS = 15 * 60 * 1000;

let cache = { at: 0, data: null, source: '' };

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

function batchesUrl() {
  if (http && typeof http.batchesUrl === 'function') return http.batchesUrl();
  return 'https://nt.studybeepro.site/batches.json';
}

async function fetchUpstream(url, opts) {
  if (http && typeof http.fetchUpstream === 'function') return http.fetchUpstream(url, opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 9000);
  try {
    const res = await fetch(url, { headers: (opts && opts.headers) || {}, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e && e.message) };
  } finally {
    clearTimeout(timer);
  }
}

async function requireAdmin(req) {
  if (verify && typeof verify.requireAdmin === 'function') return verify.requireAdmin(req);
  throw Object.assign(new Error('lib/verify module missing'), { status: 503 });
}

// ---- Helpers ----
function fallback() {
  try {
    const data = JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));
    if (data && Array.isArray(data.new)) return data;
  } catch { /* ignore */ }
  return { new: [], old: [] };
}

function normalize(data) {
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((b) => {
        const id = String(b && b.id !== undefined ? b.id : '').replace(/[^0-9]/g, '').slice(0, 8);
        const title = sanitizeText(b && b.title, 200);
        const thumbnail = String((b && b.thumbnail) || '');
        if (!id || !title) return null;
        if (!/^https:\/\//i.test(thumbnail)) return null;
        return { id: Number(id), title, thumbnail };
      })
      .filter(Boolean);
  return { new: clean(data.new), old: clean(data.old), updatedAt: Date.now() };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET'])) return;
  if (!rateLimit(req, res, 'batches', 90, 60_000)) return;

  const force = String((req.query && req.query.refresh) || '') === '1';
  if (force) {
    try {
      await requireAdmin(req);
    } catch (error) {
      const status = (error && error.status) || 503;
      return sendJson(req, res, status, {
        success: false,
        error: status < 500 ? error.message : 'Catalog refresh unavailable',
        detail: error && error.message,
        missing: missing.length ? missing : undefined,
      });
    }
  }

  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return sendJson(req, res, 200, Object.assign({ success: true, source: cache.source, cached: true }, cache.data));
  }

  try {
    const r = await fetchUpstream(`${batchesUrl()}?_t=${Date.now()}`, { timeout: 9000 });
    let raw = r.json;
    if (!raw && r.text && r.text.trim().startsWith('[')) {
      try { raw = { new: JSON.parse(r.text), old: [] }; } catch { raw = null; }
    }
    if (!r.ok || !raw || !Array.isArray(raw.new) || !raw.new.length) {
      throw Object.assign(new Error('upstream catalog empty'), { status: 502 });
    }
    cache = { at: Date.now(), data: normalize(raw), source: 'live' };
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return sendJson(req, res, 200, Object.assign({ success: true, source: 'live', cached: false }, cache.data));
  } catch (e) {
    const data = normalize(fallback());
    cache = { at: Date.now(), data, source: 'bundled-fallback' };
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return sendJson(req, res, 200, Object.assign({ success: true, source: 'bundled-fallback', degraded: true }, data));
  }
};