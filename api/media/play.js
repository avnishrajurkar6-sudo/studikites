/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=&title=
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
const { sendJson, sendOptions, requireMethod, mirrorNig, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
const { validAppKey } = require("../../lib/verify");

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/player.html',
  'Origin': 'https://nt.studybeepro.site'
};

const VIDEO_EXT = /\.(m3u8|mp4|mpd|webm|m4v|mov)(\?|#|$)/i;
const PDF_EXT = /\.pdf(\?|#|$)/i;

async function tryUrl(url) {
  try {
    const result = await fetchUpstream(url, { headers: BROWSER_HEADERS, timeout: 15000 });
    console.log(`[PLAY] ${url} -> status=${result.status} ok=${result.ok}`);
    return result;
  } catch (e) {
    console.log(`[PLAY] ${url} -> ERROR: ${e.message}`);
    return { ok: false, status: 0, json: null, text: "" };
  }
}

function findUrl(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return /^https?:\/\//i.test(obj) ? obj : null;
  if (Array.isArray(obj)) { for (const it of obj) { const u = findUrl(it); if (u) return u; } return null; }
  if (typeof obj === "object") {
    const keys = ["file_url", "download_url", "url", "link", "m3u8_url", "stream_url"];
    for (const k of keys) {
      if (obj[k] && typeof obj[k] === "string" && obj[k].length > 8) return obj[k];
      if (obj[k] && typeof obj[k] === "object") { const u = findUrl(obj[k]); if (u) return u; }
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

/* Vendor filenames often carry the real title (percent-encoded Devanagari):
   ".../4939199_148_%E0%A4%B0%E0%A4%9A%E0%A4%A8%E0%A4%BE...pdf" */
function titleFromUrl(url) {
  try {
    const clean = String(url).split("?")[0].split("#")[0];
    let base = decodeURIComponent(clean.substring(clean.lastIndexOf("/") + 1));
    base = base.replace(/\.(pdf|m3u8|mp4|mpd|webm|m4v|mov)$/i, "");
    base = base.replace(/^[0-9]+_[0-9]+_/, "").replace(/^[0-9]+_/, "");
    base = base.replace(/[_-]+/g, " ").trim();
    return base.length > 3 && /[^\x00-\x7F]/.test(base) ? base : "";
  } catch {
    return "";
  }
}

function extractMedia(json, fallbackTitle) {
  if (!json || typeof json !== 'object') return null;

  /* /vc/{vdc_id} replies {success, source, data:{status, data:{link:{file_url}}}}.
     The link lives one level deeper than json.data, so unwrap explicitly. */
  const inner = (json.data && json.data.data && json.data.data.link) ? json.data.data.link
    : (json.data && json.data.link) ? json.data.link
    : null;
  if (inner && inner.file_url) {
    return normalizeFileUrl(inner.file_url, inner.token || "", null, fallbackTitle, Number(inner.is_drm) === 1);
  }

  const data = json.decryptedData || json.data || json;
  if (!data || typeof data !== 'object') return null;

  if (data.file_url) {
    return normalizeFileUrl(data.file_url, data.token || "", data.file_type, data.title || fallbackTitle, Number(data.is_drm) === 1);
  }

  const found = findUrl(data);
  if (found) return normalizeFileUrl(found, "", null, fallbackTitle, false);

  return null;
}

/* Only accept real media. Vendor WAF blocks surface as HTML/Cloudflare pages. */
function normalizeFileUrl(url, token, file_type, title, is_drm) {
  if (!url || typeof url !== 'string') return null;
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return null;
  if (/developers\.cloudflare\.com|cloudflare\.com\/support|error\.html|captcha|challenge-platform/i.test(u)) return null;
  const type = Number(file_type) === 1 ? 1 : Number(file_type) === 2 ? 2 : inferType(u);
  if (!type) return null; /* not a stream or a PDF — skip this candidate */
  return {
    file_url: u,
    token: token || "",
    file_type: type,
    title: String(title || "").trim() || titleFromUrl(u),
    is_drm: !!is_drm,
    vdc_id: ""
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  try {
    const q = req.query || {};
    const courseId = /^[0-9]+$/.test(String(q.course_id || "")) ? String(q.course_id) : "";
    const contentId = /^[0-9]+$/.test(String(q.content_id || "")) ? String(q.content_id) : "";
    const key = asId(q.key, 64);
    const deviceId = asId(q.device_id, 128);
    const vdcId = String(q.vdc_id || "").trim().slice(0, 120);
    const hintTitle = String(q.title || "").slice(0, 200).trim();

    if (!key || !deviceId || !validAppKey(key, deviceId)) {
      return sendJson(req, res, 400, { success: false, error: "Missing playback parameters" });
    }

    const routes = mediaRoutes();
    const mirrorBase = mirrorNig().replace(/\/$/, '');
    const timestamp = Date.now();
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* Candidate URLs in priority order. First one that yields real media wins. */
    const candidates = [];

    if (courseId && contentId) {
      candidates.push(`https://nt.studybeepro.site/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`);
      candidates.push(`${mirrorBase}/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`);
    }

    if (vdcId) {
      candidates.push(`https://nt.studybeepro.site/vc/${encodeURIComponent(vdcId)}?_t=${timestamp}`);
      candidates.push(`${mirrorBase}/vc/${encodeURIComponent(vdcId)}?_t=${timestamp}`);
    }

    candidates.push(`${routes.play}?${params}&_t=${timestamp}`);
    candidates.push(`${mirrorBase}/api/play?${params}&_t=${timestamp}`);

    let lastStatus = 0;
    for (const url of candidates) {
      const result = await tryUrl(url);
      lastStatus = result.status || lastStatus;
      const extracted = extractMedia(result.json, hintTitle);
      if (extracted) {
        console.log(`[PLAY] OK via ${url} type=${extracted.file_type} title="${extracted.title}"`);
        return sendJson(req, res, 200, { success: true, ...extracted, vdc_id: vdcId });
      }
    }

    /* Never bounce the learner to the vendor site — fail cleanly instead. */
    console.error(`[PLAY] all candidates failed (last status ${lastStatus})`);
    return sendJson(req, res, 502, {
      success: false,
      error: "Lecture source is temporarily unavailable. Please retry in a moment.",
      detail: `upstream_status=${lastStatus}`
    });

  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
