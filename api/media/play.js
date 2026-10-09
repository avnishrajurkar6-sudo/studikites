/* GET /api/media/play?course_id=&content_id=&key=&device_id=
   VERIFIED REQUESTS ONLY: Firebase ID token, backend phone session, or the
   course's free-preview file (checked server-side). Playback keys are still
   minted client-side in smexgod and forwarded here. */
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
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
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (!upstream.json || !upstream.json.decryptedData || !upstream.json.decryptedData.file_url) {
      const reason = (upstream.json && (upstream.json.reason || upstream.json.error)) || "Play API rejected request";
      return sendJson(req, res, upstream.json ? 400 : upstream.status || 502, upstream.json || { success: false, error: reason });
    }
    return sendJson(req, res, upstream.status, upstream.json);
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
