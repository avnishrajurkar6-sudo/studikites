/* GET /api/media/play?course_id=&content_id=&key=&device_id=&vdc_id=
   VERIFIED REQUESTS ONLY: Firebase ID token, backend phone session, or the
   course's free-preview file (checked server-side). Playback keys are still
   minted client-side in smexgod and forwarded here.

   Vendor now serves its own player HTML at /api/play instead of JSON, so we:
     1. try vendor /api/play + workers mirror (JSON {decryptedData.file_url})
     2. if vdc_id given, proxy nt.studybeepro.site/vc/{vdc_id}  (WORKS, returns {file_url, token})
     3. last resort: redirect browser to vendor player page
*/
const { sendJson, sendOptions, requireMethod, mediaRoutes, fetchUpstream, mirrorNig, asId } = require("../../lib/http");
const { authorize } = require("../../lib/verify");

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
    if (!courseId || !contentId || !key || !deviceId) {
      return sendJson(req, res, 400, { success: false, error: "Missing playback parameters" });
    }
    await authorize(req, { courseId, contentId });
    const routes = mediaRoutes();
    const mirror = mirrorNig();
    const params = new URLSearchParams({ content_id: contentId, course_id: courseId, key, device_id: deviceId }).toString();

    /* 1. vendor /api/play + workers mirror (JSON) */
    const upstream = await fetchUpstream(`${routes.play}?${params}`);
    if (upstream.json && upstream.json.decryptedData && upstream.json.decryptedData.file_url) {
      return sendJson(req, res, upstream.status, upstream.json);
    }
    const mirrorRes = await fetchUpstream(`${mirror}/api/play?${params}`);
    if (mirrorRes.json && mirrorRes.json.decryptedData && mirrorRes.json.decryptedData.file_url) {
      return sendJson(req, res, mirrorRes.status, mirrorRes.json);
    }

    /* 2. vdc direct: nt.studybeepro.site/vc/{vdc_id} → {data:{data:{link:{file_url,token}}}} */
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
            title: String(contentId),
          });
        }
      }
    }

    /* 3. vendor returned HTML (own player page) — redirect browser there */
    const vendorBase = process.env.VENDOR_PLAYER_URL || "https://nt.studybeepro.site/player";
    const redirectUrl = new URL(vendorBase);
    redirectUrl.searchParams.set("courseId", courseId);
    redirectUrl.searchParams.set("contentId", contentId);
    redirectUrl.searchParams.set("key", key);
    redirectUrl.searchParams.set("device_id", deviceId);
    if (vdcId) redirectUrl.searchParams.set("vdc_id", vdcId);
    return sendJson(req, res, 200, { redirect: true, url: redirectUrl.toString() });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Play API rejected request" });
  }
};
