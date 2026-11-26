// api/courses/content.js
'use strict';

let http;
try {
  http = require('../../lib/http');
} catch (e) {
  http = null;
  console.error('[CONTENT] Failed to load ../../lib/http:', e.message);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/content.html',
  'Origin': 'https://nt.studybeepro.site'
};

// ---- helpers with safe fallbacks ----
function safeJson(req, res, status, body) {
  if (http && typeof http.sendJson === 'function') return http.sendJson(req, res, status, body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function safeOptions(req, res) {
  if (http && typeof http.sendOptions === 'function') return http.sendOptions(req, res);
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, x-sk-session, x-sk-sitekey');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

function safeMethod(req, res, allowed) {
  if (http && typeof http.requireMethod === 'function') return http.requireMethod(req, res, allowed);
  if (!allowed.includes(req.method)) {
    safeJson(req, res, 405, { success: false, error: 'Method not allowed' });
    return false;
  }
  return true;
}

function safeRateLimit(req, res, key, max, windowMs) {
  if (http && typeof http.rateLimit === 'function') return http.rateLimit(req, res, key, max, windowMs);
  return true; // no limiter available -> allow
}

function safeRoutes() {
  try {
    if (http && typeof http.mediaRoutes === 'function') {
      const r = http.mediaRoutes();
      if (r && r.nig) return r;
    }
  } catch (e) {
    console.error('[CONTENT] mediaRoutes() threw:', e.message);
  }
  // Fallback: default upstream
  return { nig: 'https://nt.studybeepro.site/api/nig' };
}

function safeMirror() {
  try {
    if (http && typeof http.mirrorNig === 'function') {
      const m = http.mirrorNig();
      if (m) return String(m);
    }
  } catch (e) {
    console.error('[CONTENT] mirrorNig() threw:', e.message);
  }
  // Fallback: same as primary host (no mirror)
  return 'https://nt.studybeepro.site';
}

async function tryUrl(url) {
  let result;
  try {
    if (http && typeof http.fetchUpstream === 'function') {
      result = await http.fetchUpstream(url, { headers: BROWSER_HEADERS });
    } else {
      const r = await fetch(url, { headers: BROWSER_HEADERS });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      result = { ok: r.ok, status: r.status, text, json };
    }
  } catch (e) {
    result = { ok: false, status: 0, text: String(e && e.message), json: null, error: String(e && e.message) };
  }
  console.log(`[CONTENT] ${url} -> status=${result.status} ok=${result.ok} hasJson=${!!result.json}`);
  return result;
}

function hostOf(url) {
  try { return new URL(url).origin; } catch { return url; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return safeOptions(req, res);
  if (!safeMethod(req, res, ['GET'])) return;
  if (!safeRateLimit(req, res, 'content', 120, 60_000)) return;

  try {
    const q = req.query || {};
    const content = q.content;
    const folder = q.folder === undefined ? '0' : q.folder;
    const debug = String(q.debug || '') === '1';

    const folderId = /^\d+$/.test(String(folder)) && String(folder).length <= 12 ? String(folder) : '0';

    if (!content || !/^\d+$/.test(String(content)) || String(content).length > 12) {
      return safeJson(req, res, 400, { success: false, error: 'Invalid or missing content ID' });
    }

    const timestamp = Date.now();
    const routes = safeRoutes();
    const mirrorBase = safeMirror().replace(/\/$/, '');
    const primaryHost = hostOf(routes.nig);

    const candidates = [
      `${mirrorBase}/?content=${content}&folder=${folderId}&_t=${timestamp}`,
      `${mirrorBase}/api/nt?content=${content}&folder=${folderId}&_t=${timestamp}`,
      `${primaryHost}/api/nt?content=${content}&folder=${folderId}&_t=${timestamp}`,
      `${routes.nig}?content=${content}&folder=${folderId}&_t=${timestamp}`
    ];

    if (debug) {
      return safeJson(req, res, 200, {
        success: true,
        debug: true,
        routes,
        mirrorBase,
        primaryHost,
        candidates
      });
    }

    const attempts = [];
    let lastResult = null;
    let successResult = null;
    let successUrl = null;

    for (const url of candidates) {
      const result = await tryUrl(url);
      attempts.push({ url, status: result.status, ok: !!result.ok, hasJson: !!result.json });
      lastResult = result;
      if (result.ok && result.json && result.json.success) {
        successResult = result;
        successUrl = url;
        console.log(`[CONTENT] ✅ SUCCESS via ${url}`);
        break;
      }
    }

    if (successResult) {
      const data = Array.isArray(successResult.json.data) ? successResult.json.data : [];
      return safeJson(req, res, 200, {
        success: true,
        data,
        source: successResult.json.source || 'proxy',
        via: successUrl
      });
    }

    console.error('[CONTENT] ❌ All candidates failed. Last raw:', (lastResult && lastResult.text || '').substring(0, 200));
    return safeJson(req, res, 502, {
      success: false,
      error: 'Content provider temporarily unavailable. Please try again later.',
      debug_status: lastResult ? lastResult.status : null,
      attempts
    });
  } catch (err) {
    console.error('[CONTENT] ❌ CRITICAL ERROR:', err && err.message, err && err.stack);
    return safeJson(req, res, 500, {
      success: false,
      error: 'Internal server error',
      detail: err && err.message
    });
  }
};
