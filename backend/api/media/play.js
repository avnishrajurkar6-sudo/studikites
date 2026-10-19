/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=
   VERIFIED REQUESTS ONLY: playback keys minted client-side via smexgod (key +
   device_id always required). course_id/content_id gate enrollment when present.

   The vendor's own player page (nt.studybeepro.site/player.html) handles
   Turnstile, 24h key verification, DRM license exchange, and HLS/Shaka
   playback — our server-side proxy cannot replicate that. So when we have a
   vdc_id we redirect the browser to the vendor player page instead of trying
   to extract a video URL server-side.
*/
const { sendJson, sendOptions, requireMethod, mirrorNig, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
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
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* When we have a vdc_id, always redirect to the vendor player page.
       The vendor player resolves Turnstile + key + DRM + HLS in-browser,
       which we cannot do server-side. */
    if (vdcId) {
      const vendorBase = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/player.html";
      const redirectUrl = new URL(vendorBase);
      if (courseId) redirectUrl.searchParams.set("courseId", courseId);
      if (contentId) redirectUrl.searchParams.set("contentId", contentId);
      redirectUrl.searchParams.set("vdc_id", vdcId);
      redirectUrl.searchParams.set("key", key);
      redirectUrl.searchParams.set("device_id", deviceId);
      return sendJson(req, res, 200, { redirect: true, url: redirectUrl.toString() });
    }

    /* No vdc_id: fall back to vendor JSON APIs. */
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (upstream.json && upstream.json.decryptedData && upstream.json.decryptedData.file_url) {
      return sendJson(req, res, upstream.status, upstream.json);
    }
    const mirror = mirrorNig();
    const mirrorRes = await fetchUpstream(`${mirror}/api/play?${params}`);
    if (mirrorRes.json && mirrorRes.json.decryptedData && mirrorRes.json.decryptedData.file_url) {
      return sendJson(req, res, mirrorRes.status, mirrorRes.json);
    }

    /* Last resort: redirect to vendor player page anyway. */
    const vendorBase2 = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/player.html";
    const redirectUrl2 = new URL(vendorBase2);
    if (courseId) redirectUrl2.searchParams.set("courseId", courseId);
    if (contentId) redirectUrl2.searchParams.set("contentId", contentId);
    redirectUrl2.searchParams.set("key", key);
    redirectUrl2.searchParams.set("device_id", deviceId);
    return sendJson(req, res, 200, { redirect: true, url: redirectUrl2.toString() });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
