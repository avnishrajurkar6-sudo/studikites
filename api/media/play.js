/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=
   VERIFIED REQUESTS ONLY: playback keys minted client-side via smexgod
   (key + device_id always required). Proxy vendor media endpoints directly
   and return {success, file_url, token, file_type} — no redirect, no Turnstile,
   no 24h key page. PDF and video share this exact route.
*/
const { sendJson, sendOptions, requireMethod, mirrorNig, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
const { validAppKey } = require("../../lib/verify");

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/player.html',
  'Origin': 'https://nt.studybeepro.site'
};

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
    for (const k of keys) { if (obj[k] && typeof obj[k] === "string" && obj[k].length > 8) return obj[k]; }
    for (const k in obj) { const u = findUrl(obj[k]); if (u) return u; }
  }
  return null;
}

function extractMedia(json) {
  if (!json || typeof json !== 'object') return null;

  let data = json.decryptedData || json.data || json;
  if (!data || typeof data !== 'object') return null;

  /* Vendor /vc/{vdc_id}: {data: {data: {link: {file_url, token}}}} */
  if (data.data && data.data.link && data.data.link.file_url) {
    return {
      file_url: data.data.link.file_url,
      token: data.data.link.token || "",
      file_type: data.file_type || null,
      title: data.title || "",
      is_drm: data.is_drm == 1,
      vdc_id: data.vdc_id || ""
    };
  }

  /* Direct file_url at top level of data (vendor /vc/media) */
  if (data.file_url) {
    return {
      file_url: data.file_url,
      token: data.token || "",
      file_type: data.file_type || null,
      title: data.title || "",
      is_drm: data.is_drm == 1,
      vdc_id: data.vdc_id || ""
    };
  }

  /* Deep search fallback */
  const found = findUrl(data);
  if (found) {
    return { file_url: found, token: "", file_type: null, title: "", is_drm: false, vdc_id: "" };
  }

  return null;
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
    const vdcId = String(q.vdc_id || "").trim();

    if (!key || !deviceId || !validAppKey(key, deviceId)) {
      return sendJson(req, res, 400, { success: false, error: "Missing playback parameters" });
    }

    const routes = mediaRoutes();
    const mirrorBase = mirrorNig().replace(/\/$/, '');
    const timestamp = Date.now();
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* Candidate URLs in priority order — PDF and video both use these. */
    const candidates = [];

    if (courseId && contentId) {
      candidates.push(`https://nt.studybeepro.site/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`);
      candidates.push(`${mirrorBase}/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`);
    }

    if (vdcId) {
      candidates.push(`https://nt.studybeepro.site/vc/${encodeURIComponent(vdcId)}`);
      candidates.push(`${mirrorBase}/vc/${encodeURIComponent(vdcId)}`);
    }

    candidates.push(`${routes.play}?${params}&_t=${timestamp}`);
    candidates.push(`${mirrorBase}/api/play?${params}&_t=${timestamp}`);

    for (const url of candidates) {
      const result = await tryUrl(url);
      const extracted = extractMedia(result.json);
      if (extracted) {
        console.log(`[PLAY] ✅ SUCCESS via ${url}`);
        return sendJson(req, res, 200, { success: true, ...extracted });
      }
    }

    /* Absolute last resort — vendor player page redirect. */
    console.error(`[PLAY] ❌ All proxy attempts failed`);
    const vendorBase = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/player.html";
    const redirectUrl = new URL(vendorBase);
    if (courseId) redirectUrl.searchParams.set("courseId", courseId);
    if (contentId) redirectUrl.searchParams.set("contentId", contentId);
    if (vdcId) redirectUrl.searchParams.set("vdc_id", vdcId);
    redirectUrl.searchParams.set("key", key);
    redirectUrl.searchParams.set("device_id", deviceId);
    return sendJson(req, res, 200, { redirect: true, url: redirectUrl.toString() });

  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
