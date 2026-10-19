/* GET /api/media/play?course_id=&content_id=&key=&device_id=
   VERIFIED REQUESTS ONLY: Firebase ID token, backend phone session, or the
   course's free-preview file (checked server-side). Playback keys are still
   minted client-side in smexgod and forwarded here. */
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, mirrorNig, asId } = require("../../lib/http");
const { authorize } = require("../../lib/verify");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  try {
    const q = req.query || {};
    const courseId = /^[0-9]+$/.test(String(q.course_id || "")) ? String(q.course_id) : "";
    const contentId = /^[0-9]+$/.test(String(q.content_id || "")) ? String(q.content_id) : "";
    const key = asId(q.key, 64);
    const deviceId = asId(q.device_id, 128);
    if (!courseId || !contentId || !key || !deviceId) {
      return sendJson(req, res, 400, { success: false, error: "Missing playback parameters" });
    }
    await authorize(req, { courseId, contentId });
    const routes = mediaRoutes();
    const mirror = mirrorNig();
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (!upstream.json || !upstream.json.decryptedData || !upstream.json.decryptedData.file_url) {
      const mirrorRes = await fetchUpstream(`${mirror}/api/play?${params}`);
      if (mirrorRes.json && mirrorRes.json.decryptedData && mirrorRes.json.decryptedData.file_url) {
        return sendJson(req, res, mirrorRes.status, mirrorRes.json);
      }
      /* Vendor now serves its own player page (Turnstile + 24h key) instead of
         JSON. Redirect the browser there so the vendor's player handles playback.
         VENDOR_PLAYER_URL in Vercel env overrides the default path. */
      const vendorBase = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/player";
      const redirectUrl = new URL(vendorBase);
      redirectUrl.searchParams.set("courseId", courseId);
      redirectUrl.searchParams.set("contentId", contentId);
      redirectUrl.searchParams.set("key", key);
      redirectUrl.searchParams.set("device_id", deviceId);
      return sendJson(req, res, 200, { redirect: true, url: redirectUrl.toString() });
    }
    return sendJson(req, res, upstream.status, upstream.json);
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
