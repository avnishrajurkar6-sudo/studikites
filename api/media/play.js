/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=&title=&debug=1
   VERIFIED REQUESTS ONLY: playback keys minted client-side via smexgod
   (key + device_id always required). Proxies the vendor media endpoints and
   returns {success, file_url, token, file_type, title} — no redirect to the
   vendor site, no Turnstile, no 24h key page. PDF and video share this route.

   Vendor facts (verified live):
     PDF   -> /vc/media?course_id=&content_id=  ({decryptedData:{file_url,file_type:1,title}})
     Video -> /vc/{vdc_id}                      ({data:{data:{link:{file_url}}}} — no title/type)
   so the client may pass `title` to fill the gap, and we infer file_type from
   the URL when the vendor omits it.
*/
'use strict';

let http, verify;
try {
  http = require('../../lib/http');
} catch (e) {
  http = null;
  console.error('[PLAY] Failed to load ../../lib/http:', e.message);
}
try {
  verify = require('../../lib/verify');
} catch (e) {
  verify = null;
  console.error('[PLAY] Failed to load ../../lib/verify:', e.message);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/player.html',
  'Origin': 'https://nt.studybeepro.site'
};

const VIDEO_EXT = /\.(m3u8|mp4|mpd|webm|m4v|mov)(\?|#|$)/i;
const PDF_EXT = /\.pdf(\?|#|$)/i;

// ---- safe wrappers for lib/http ----
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

function asId(v, max) {
  if (http && typeof http.asId === 'function') return http.asId(v, max);
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > max) return '';
  return s.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, max);
}

function mediaRoutes() {
  try {
    if (http && typeof http.mediaRoutes === 'function') {
      const r = http.mediaRoutes();
      if (r && r.play) return r;
    }
  } catch (e) {
    console.error('[PLAY] mediaRoutes() threw:', e.message);
  }
  return { play: 'https://nt.studybeepro.site/api/play' };
}

function mirrorNig() {
  try {
    if (http && typeof http.mirrorNig === 'function') {
      const m = http.mirrorNig();
      if (m) return String(m);
    }
  } catch (e) {
    console.error('[PLAY] mirrorNig() threw:', e.message);
  }
  return 'https://nt.studybeepro.site';
}

async function fetchUpstream(url, opts) {
  if (http && typeof http.fetchUpstream === 'function') return http.fetchUpstream(url, opts);
  // minimal fallback
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 10000);
  try {
    const r = await fetch(url, { headers: (opts && opts.headers) || {}, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: r.ok, status: r.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e && e.message) };
  } finally {
    clearTimeout(t);
  }
}

function validAppKey(key, deviceId) {
  if (verify && typeof verify.validAppKey === 'function') return verify.validAppKey(key, deviceId);
  // fallback: accept anything non-empty (only used if lib/verify is missing)
  return !!(key && deviceId);
}

async function authorize(req, ctx) {
  if (verify && typeof verify.authorize === 'function') return verify.authorize(req, ctx);
  return null;
}

// ---- existing helpers (unchanged logic, with guards) ----
async function tryUrl(url) {
  try {
    const result = await fetchUpstream(url, { headers: BROWSER_HEADERS, timeout: 10000 });
    console.log(`[PLAY] ${url} -> status=${result.status} ok=${result.ok}`);
    return result;
  } catch (e) {
    console.log(`[PLAY] ${url} -> ERROR: ${e.message}`);
    return { ok: false, status: 0, json: null, text: '' };
  }
}

function findUrl(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return /^https?:\/\//i.test(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const it of obj) { const u = findUrl(it); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    const keys = ['file_url', 'download_url', 'url', 'link', 'm3u8_url', 'stream_url'];
    for (const k of keys) {
      if (obj[k] && typeof obj[k] === 'string' && obj[k].length > 8) return obj[k];
      if (obj[k] && typeof obj[k] === 'object') { const u = findUrl(obj[k]); if (u) return u; }
    }
    for (const k in obj) { const u = findUrl(obj[k]); if (u) return u; }
  }
  return null;
}

function inferType(url) {
  if (!url) return null;
  if (PDF_EXT.test(url)) return 1;
  if (VIDEO_EXT.test(url)) return 2;
  return null;
}

function titleFromUrl(url) {
  try {
    const clean = String(url).split('?')[0].split('#')[0];
    let base = decodeURIComponent(clean.substring(clean.lastIndexOf('/') + 1));
    base = base.replace(/\.(pdf|m3u8|mp4|mpd|webm|m4v|mov)$/i, '');
    base = base.replace(/^[0-9]+_[0-9]+_/, '').replace(/^[0-9]+_/, '');
    base = base.replace(/[_-]+/g, ' ').trim();
    return base.length > 3 && /[^\x00-\x7F]/.test(base) ? base : '';
  } catch {
    return '';
  }
}

function normalizeFileUrl(url, token, file_type, title, is_drm, vdcId) {
  if (!url || typeof url !== 'string') return null;
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return null;
  if (/developers\.cloudflare\.com|cloudflare\.com\/support|error\.html|captcha|challenge-platform/i.test(u)) return null;
  const type = Number(file_type) === 1 ? 1 : Number(file_type) === 2 ? 2 : inferType(u);
  if (!type) return null;
  return {
    file_url: u,
    token: token || '',
    file_type: type,
    title: String(title || '').trim() || titleFromUrl(u),
    is_drm: !!is_drm,
    vdc_id: String(vdcId || '')
  };
}

function extractMedia(json, fallbackTitle) {
  if (!json || typeof json !== 'object') return null;

  const inner = (json.data && json.data.data && json.data.data.link) ? json.data.data.link
    : (json.data && json.data.link) ? json.data.link
    : null;
  if (inner && inner.file_url) {
    return normalizeFileUrl(inner.file_url, inner.token || '', null, fallbackTitle, Number(inner.is_drm) === 1, inner.vdc_id);
  }

  const data = json.decryptedData || json.data || json;
  if (!data || typeof data !== 'object') return null;

  if (data.file_url) {
    return normalizeFileUrl(data.file_url, data.token || '', data.file_type, data.title || fallbackTitle, Number(data.is_drm) === 1, data.vdc_id);
  }

  const found = findUrl(data);
  if (found) return normalizeFileUrl(found, '', null, fallbackTitle, false);

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOptions(req, res);
  if (!requireMethod(req, res, ['GET'])) return;

  try {
    const q = req.query || {};
    const courseId = /^[0-9]+$/.test(String(q.course_id || '')) ? String(q.course_id) : '';
    const contentId = /^[0-9]+$/.test(String(q.content_id || '')) ? String(q.content_id) : '';
    const key = asId(q.key, 64);
    const deviceId = asId(q.device_id, 128);
    const vdcId = String(q.vdc_id || '').trim().slice(0, 120);
    const hintTitle = String(q.title || '').slice(0, 200).trim();
    const debug = String(q.debug || '') === '1';

    if (!key || !deviceId || !validAppKey(key, deviceId)) {
      return sendJson(req, res, 400, { success: false, error: 'Missing playback parameters' });
    }

    if (!rateLimit(req, res, 'play', 30, 60_000)) return;
    const auth = await authorize(req, { courseId, contentId });

    const routes = mediaRoutes();
    const mirrorBase = mirrorNig().replace(/\/$/, '');
    const timestamp = Date.now();
    const params = new URLSearchParams({
      content_id: contentId,
      course_id: courseId,
      key,
      device_id: deviceId
    }).toString();

    const candidates = [];
    if (courseId && contentId) {
      const qs = `content_id=${contentId}&course_id=${courseId}&key=${encodeURIComponent(key)}&device_id=${encodeURIComponent(deviceId)}&_t=${timestamp}`;
      candidates.push(`https://nt.studybeepro.site/mj.php?${qs}`);
      candidates.push(`https://nt.studybeepro.site/vc/media?${qs}`);
      candidates.push(`${mirrorBase}/vc/media?${qs}`);
    }
    if (vdcId) {
      const vq = `key=${encodeURIComponent(key)}&device_id=${encodeURIComponent(deviceId)}&_t=${timestamp}`;
      candidates.push(`https://nt.studybeepro.site/vc/${encodeURIComponent(vdcId)}?${vq}`);
      candidates.push(`${mirrorBase}/vc/${encodeURIComponent(vdcId)}?${vq}`);
    }
    candidates.push(`${routes.play}?${params}&_t=${timestamp}`);
    candidates.push(`${mirrorBase}/api/play?${params}&_t=${timestamp}`);

    // Debug mode: show plan without hitting upstream
    if (debug) {
      return sendJson(req, res, 200, {
        success: true,
        debug: true,
        routes,
        mirrorBase,
        auth: auth ? { preview: !!auth.preview } : null,
        candidates
      });
    }

    // Overall deadline: leave ~5s buffer for Vercel's 25s maxDuration
    const deadline = Date.now() + 20000;
    const attempts = [];
    let lastStatus = 0;

    for (const url of candidates) {
      if (Date.now() > deadline) {
        attempts.push({ url, status: 'skipped-deadline' });
        continue;
      }
      const result = await tryUrl(url);
      lastStatus = result.status || lastStatus;
      attempts.push({
        url,
        status: result.status,
        ok: !!result.ok,
        hadJson: !!result.json
      });
      const extracted = extractMedia(result.json, hintTitle);
      if (extracted) {
        console.log(`[PLAY] OK via ${url} type=${extracted.file_type} title="${extracted.title}"`);
        return sendJson(req, res, 200, {
          success: true,
          ...extracted,
          vdc_id: vdcId || extracted.vdc_id || '',
          via: auth && auth.preview ? 'preview' : 'verified',
          issuedAt: Date.now()
        });
      }
    }

    console.error(`[PLAY] all candidates failed (last status ${lastStatus})`);
    return sendJson(req, res, 502, {
      success: false,
      error: 'Lecture source is temporarily unavailable. Please retry in a moment.',
      detail: `upstream_status=${lastStatus}`,
      attempts
    });
  } catch (err) {
    console.error('[PLAY] handler error:', err && err.message, err && err.stack);
    const status = (err && err.status) || 500;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? (err.message || 'Playback denied') : 'Playback temporarily unavailable. Please retry.',
      detail: err && err.message
    });
  }
};