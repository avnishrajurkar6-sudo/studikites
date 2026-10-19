/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=
   VERIFIED REQUESTS ONLY: playback keys minted client-side via smexgod (key +
   device_id always required). course_id/content_id gate enrollment when present.

   Proxies the vendor's /vc/media endpoint (same one their own player.html
   calls) and returns the direct file_url + token — no redirect to the vendor
   site, no Turnstile, no 24h key page. PDF and video share this route.
*/
const { sendJson, sendOptions, requireMethod, mirrorNig, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
const { validAppKey } = require("../../lib/verify");

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/player.html',
  'Origin': 'https://nt.studybeepro.site'
};

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
  if (!json) return null;
  const contentData = json.decryptedData || json.data || json;
  if (!contentData) return null;
  const fileUrl = contentData.file_url || findUrl(contentData);
  if (!fileUrl) return null;
  return {
    file_url: fileUrl,
    token: contentData.token || "",
    file_type: contentData.file_type,
    title: contentData.title || "",
    is_drm: contentData.is_drm == 1,
    vdc_id: contentData.vdc_id || ""
  };
}

async function tryUrl(url) {
  const result = await fetchUpstream(url, { headers: BROWSER_HEADERS, timeout: 15000 });
  console.log(`[PLAY] ${url} -> status=${result.status} ok=${result.ok} hasJson=${!!result.json}`);
  return result;
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
    /* Enrollment / free-preview gate only when course+content given. */
    if (courseId && contentId) {
      const { authorize } = require("../../lib/verify");
      await authorize(req, { courseId, contentId });
    }
    const routes = mediaRoutes();
    const mirror = mirrorNig();
    const timestamp = Date.now();
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* 1. Vendor /vc/media?course_id=&content_id= (what vendor's own player.html calls) */
    if (courseId && contentId) {
      const mediaUrl = `https://nt.studybeepro.site/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`;
      console.log(`[PLAY] Step 1: vendor /vc/media: ${mediaUrl}`);
      let result = await tryUrl(mediaUrl);
      const extracted = extractMedia(result.json);
      if (extracted) {
        console.log(`[PLAY] ✅ SUCCESS via /vc/media`);
        return sendJson(req, res, 200, { success: true, ...extracted });
      }
      /* Mirror fallback for /vc/media */
      const mirrorMedia = `${mirror.replace(/\/$/, '')}/vc/media?course_id=${courseId}&content_id=${contentId}&_t=${timestamp}`;
      console.log(`[PLAY] Step 2: mirror /vc/media: ${mirrorMedia}`);
      result = await tryUrl(mirrorMedia);
      const extracted2 = extractMedia(result.json);
      if (extracted2) {
        console.log(`[PLAY] ✅ SUCCESS via mirror /vc/media`);
        return sendJson(req, res, 200, { success: true, ...extracted2 });
      }
    }

    /* 2. Vendor /vc/{vdc_id} direct (if vdc_id provided) */
    if (vdcId) {
      const vdcUrl = `https://nt.studybeepro.site/vc/${encodeURIComponent(vdcId)}`;
      console.log(`[PLAY] Step 3: vendor /vc/{vdc_id}: ${vdcUrl}`);
      let result = await tryUrl(vdcUrl);
      const extracted = extractMedia(result.json);
      if (!extracted && result.json) {
        /* vendor wraps as {data:{data:{link:{file_url,token}}}} */
        const link = result.json.data && result.json.data.data && result.json.data.data.link;
        if (link && link.file_url) extracted = { file_url: link.file_url, token: link.token || "", file_type: null, title: String(contentId || vdcId) };
      }
      if (extracted) {
        console.log(`[PLAY] ✅ SUCCESS via /vc/{vdc_id}`);
        return sendJson(req, res, 200, { success: true, ...extracted });
      }
      /* Mirror fallback for /vc/{vdc_id} */
      const mirrorVdc = `${mirror.replace(/\/$/, '')}/vc/${encodeURIComponent(vdcId)}`;
      console.log(`[PLAY] Step 4: mirror /vc/{vdc_id}: ${mirrorVdc}`);
      result = await tryUrl(mirrorVdc);
      const extracted3 = extractMedia(result.json);
      if (extracted3) {
        console.log(`[PLAY] ✅ SUCCESS via mirror /vc/{vdc_id}`);
        return sendJson(req, res, 200, { success: true, ...extracted3 });
      }
    }

    /* 3. Vendor /api/play + mirror (JSON) */
    const upstream = await tryUrl(`${routes.play}?${params}&_t=${timestamp}`);
    const extracted4 = extractMedia(upstream.json);
    if (extracted4) {
      console.log(`[PLAY] ✅ SUCCESS via vendor /api/play`);
      return sendJson(req, res, 200, { success: true, ...extracted4 });
    }
    const mirrorRes = await tryUrl(`${mirror}/api/play?${params}&_t=${timestamp}`);
    const extracted5 = extractMedia(mirrorRes.json);
    if (extracted5) {
      console.log(`[PLAY] ✅ SUCCESS via mirror /api/play`);
      return sendJson(req, res, 200, { success: true, ...extracted5 });
    }

    /* 4. Absolute last resort: redirect to vendor player page. */
    console.error(`[PLAY] ❌ All proxy attempts failed. Redirecting to vendor player.`);
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
