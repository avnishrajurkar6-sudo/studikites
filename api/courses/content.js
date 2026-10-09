/* GET /api/courses/content?content=<batchId>&folder=<folderId>
   Stable backend route; vendor URLs stay in MEDIA_ROUTES_JSON/MIRROR_NIG_URL. */
const { sendJson, sendOptions, requireMethod, mirrorNig, mediaRoutes, fetchUpstream } = require("../../lib/http");

function validId(value) {
  return /^[0-9]+$/.test(String(value || "")) ? String(value) : "";
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  try {
    const q = req.query || {};
    const content = validId(q.content);
    const folder = validId(q.folder || "0") || "0";
    if (!content) return sendJson(req, res, 400, { success: false, error: "Missing content id" });
    const routes = mediaRoutes();
    const params = new URLSearchParams({ content, folder }).toString();
    const upstream = await fetchUpstream(`${routes.nig}?${params}`);
    if (upstream.json) return sendJson(req, res, upstream.status, upstream.json);
    const mirror = mirrorNig();
    const fallback = await fetchUpstream(`${mirror}/?${params}`);
    if (fallback.json) return sendJson(req, res, fallback.status, fallback.json);
    return sendJson(req, res, 502, { success: false, error: "Content API unreachable" });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Content API unreachable" });
  }
};
