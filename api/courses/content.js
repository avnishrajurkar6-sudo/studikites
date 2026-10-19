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

function hostOf(url) {
  try { return new URL(url).origin; } catch { return url; }
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
    const mirrorBase = mirrorNig().replace(/\/$/, '');
    const primaryHost = hostOf(routes.nig);

    /* Build every URL variant worth trying, in order of likelihood. */
    const candidates = [];

    /* 1. Mirror root path (confirmed working from tests) */
    candidates.push(`${mirrorBase}/?content=${content}&folder=${folder}&_t=${timestamp}`);

    /* 2. Mirror /api/nt (vendor's real content path) */
    candidates.push(`${mirrorBase}/api/nt?content=${content}&folder=${folder}&_t=${timestamp}`);

    /* 3. Primary /api/nt (vendor's real content path — was missing before) */
    candidates.push(`${primaryHost}/api/nt?content=${content}&folder=${folder}&_t=${timestamp}`);

    /* 4. Primary configured route (/api/nig or whatever MEDIA_ROUTES_JSON says) */
    candidates.push(`${routes.nig}?content=${content}&folder=${folder}&_t=${timestamp}`);

    let result = null;
    for (const url of candidates) {
      console.log(`[CONTENT] Trying: ${url}`);
      result = await tryUrl(url);
      if (result.ok && result.json && result.json.success) {
        console.log(`[CONTENT] ✅ SUCCESS via ${url}`);
        break;
      }
    }

    if (result.ok && result.json && result.json.success) {
      const responseData = Array.isArray(result.json.data) ? result.json.data : [];
      return sendJson(req, res, 200, { success: true, data: responseData, source: result.json.source || 'proxy' });
    }

    console.error(`[CONTENT] ❌ All candidates failed. Last raw:`, result.text?.substring(0, 200));
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
