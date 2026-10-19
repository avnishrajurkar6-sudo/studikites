/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=
   VERIFIED REQUESTS ONLY: playback keys minted client-side via smexgod (key +
   device_id always required). course_id/content_id gate enrollment when present.
   Vendor /api/play now returns its own player HTML instead of JSON, so we:
     1. proxy nt.studybeepro.site/vc/{vdc_id}  (WORKS → {file_url, token})
     2. vendor /api/play + workers mirror (JSON {decryptedData.file_url})
     3. redirect browser to vendor play.html (plays smoothly, user's key logic)
*/
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, mirrorNig, asId } = require("../../lib/http");
const { validAppKey } = require("../../lib/verify");

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
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* 1. vdc direct: nt.studybeepro.site/vc/{vdc_id} → {data:{data:{link:{file_url,token}}}} */
    if (vdcId) {
      const vdcRes = await fetchUpstream(`https://nt.studybeepro.site/vc/${encodeURIComponent(vdcId)}`, { timeout: 15000 });
      if (vdcRes.json) {
        let stream = null, token = null;
        const link = vdcRes.json.data && vdcRes.json.data.data && vdcRes.json.data.data.link;
        if (link && link.file_url) { stream = link.file_url; token = link.token || ""; }
        else { stream = findUrl(vdcRes.json.data || vdcRes.json); }
        if (stream) {
          return sendJson(req, res, 200, {
            success: true, file_url: stream, token: token || "",
            file_type: vdcRes.json.data && vdcRes.json.data.data && vdcRes.json.data.data.file_type,
            title: String(contentId || vdcId),
          });
        }
      }
    }

    /* 2. vendor /api/play + workers mirror (JSON) */
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (upstream.json && upstream.json.decryptedData && upstream.json.decryptedData.file_url) {
      return sendJson(req, res, upstream.status, upstream.json);
    }
    const mirrorRes = await fetchUpstream(`${mirror}/api/play?${params}`);
    if (mirrorRes.json && mirrorRes.json.decryptedData && mirrorRes.json.decryptedData.file_url) {
      return sendJson(req, res, mirrorRes.status, mirrorRes.json);
    }

    /* 3. vendor returned HTML — redirect browser to vendor player page */
    const vendorBase = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/play.html";
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
