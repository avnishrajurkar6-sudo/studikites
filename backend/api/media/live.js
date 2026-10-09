/* GET /api/media/live?course_id=&type=1&key=&device_id=
   type: 1 = live, 0 = upcoming, 2 = completed.
   Needs a well-formed app key+device (minted client-side via smexgod anon auth). */
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, asId } = require("../../lib/http");
const { validAppKey } = require("../../lib/verify");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  try {
    const q = req.query || {};
    const courseId = /^[0-9]+$/.test(String(q.course_id || "")) ? String(q.course_id) : "";
    const type = ["0", "1", "2"].includes(String(q.type || "1")) ? String(q.type || "1") : "";
    const key = asId(q.key, 64);
    const deviceId = asId(q.device_id, 128);
    if (!courseId || !type || !validAppKey(key, deviceId)) {
      return sendJson(req, res, 400, { success: false, error: "Missing live-class parameters" });
    }
    const routes = mediaRoutes();
    const params = new URLSearchParams({ action: "classes", type, course_id: courseId, key, device_id: deviceId }).toString();
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (!upstream.json) return sendJson(req, res, upstream.status || 502, { success: false, error: "Classes fetch failed" });
    return sendJson(req, res, upstream.status, upstream.json);
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Classes fetch failed" });
  }
};
