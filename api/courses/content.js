// backend/api/courses/content.js
const { sendJson, requireMethod, mediaRoutes, mirrorNig, fetchUpstream } = require('../../lib/http');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://nt.studybeepro.site/content.html',
  'Origin': 'https://nt.studybeepro.site'
};

async function tryUrl(url) {
  const result = await fetchUpstream(url, { headers: BROWSER_HEADERS });
  console.log(`[CONTENT] ${url} -> status=${result.status} ok=${result.ok} hasJson=${!!result.json}`);
  return result;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const { content, folder = "0" } = req.query;

    if (!content || !/^\d+$/.test(content)) {
      return sendJson(req, res, 400, { success: false, error: "Invalid or missing content ID" });
    }

    const timestamp = Date.now();
    const routes = mediaRoutes();
    const mirror = mirrorNig();

    /* Try mirror first — Vercel IPs are often blocked on the vendor's primary domain. */
    const mirrorUrl = `${mirror}?content=${content}&folder=${folder}&_t=${timestamp}`;
    console.log(`[CONTENT] Step 1: Mirror URL: ${mirrorUrl}`);
    let result = await tryUrl(mirrorUrl);

    /* Fallback to primary vendor if mirror fails. */
    if (!result.ok || !result.json || !result.json.success) {
      const primaryUrl = `${routes.nig}?content=${content}&folder=${folder}&_t=${timestamp}`;
      console.log(`[CONTENT] Step 2: Primary URL: ${primaryUrl}`);
      result = await tryUrl(primaryUrl);
    }

    if (result.ok && result.json && result.json.success) {
      console.log(`[CONTENT] ✅ SUCCESS`);
      const responseData = Array.isArray(result.json.data) ? result.json.data : [];
      return sendJson(req, res, 200, { success: true, data: responseData, source: result.json.source || 'proxy' });
    }

    console.error(`[CONTENT] ❌ Both mirror and primary failed. Last raw:`, result.text?.substring(0, 200));
    return sendJson(req, res, 502, { 
      success: false, 
      error: "Content provider temporarily unavailable. Please try again later.",
      debug_status: result.status
    });

  } catch (err) {
    console.error(`[CONTENT] ❌ CRITICAL ERROR:`, err.message, err.stack);
    return sendJson(req, res, 500, { success: false, error: "Internal server error", details: err.message });
  }
};
