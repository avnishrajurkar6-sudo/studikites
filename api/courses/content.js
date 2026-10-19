// backend/api/courses/content.js
const { sendJson, requireMethod, mediaRoutes, mirrorNig, fetchUpstream } = require('../../lib/http');

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  if (!requireMethod(req, res, ["GET"])) return;

  try {
    const { content, folder = "0" } = req.query;

    if (!content || !/^\d+$/.test(content)) {
      return sendJson(req, res, 400, { success: false, error: "Invalid or missing content ID" });
    }

    const routes = mediaRoutes();
    const timestamp = Date.now();
    
    // 1. PRIMARY VENDOR ATTEMPT (With Browser Spoofing & Timestamp)
    const primaryUrl = `${routes.nig}?content=${content}&folder=${folder}&_t=${timestamp}`;
    console.log(`[CONTENT] Step 1: Fetching primary URL: ${primaryUrl}`);

    let result = await fetchUpstream(primaryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://nt.studybeepro.site/content.html',
        'Origin': 'https://nt.studybeepro.site'
      }
    });

    console.log(`[CONTENT] Primary Response Status: ${result.status}, OK: ${result.ok}`);

    // 2. MIRROR FALLBACK ATTEMPT (If primary fails or returns bad JSON)
    if (!result.ok || !result.json || !result.json.success) {
      console.log(`[CONTENT] Step 2: Primary failed. Attempting mirror fallback...`);
      const mirrorUrl = `${mirrorNig()}?content=${content}&folder=${folder}&_t=${timestamp}`;
      
      result = await fetchUpstream(mirrorUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://nt.studybeepro.site/content.html'
        }
      });
      
      console.log(`[CONTENT] Mirror Response Status: ${result.status}, OK: ${result.ok}`);
    }

    // 3. FINAL VALIDATION & RESPONSE
    if (result.ok && result.json && result.json.success) {
      console.log(`[CONTENT] ✅ SUCCESS: Returning valid content data.`);
      // Ensure the data array exists, even if empty, to prevent frontend crashes
      const responseData = Array.isArray(result.json.data) ? result.json.data : [];
      return sendJson(req, res, 200, { success: true, data: responseData, source: result.json.source || 'proxy' });
    }

    // 4. GRACEFUL FAILURE (Instead of raw 502 crash)
    console.error(`[CONTENT] ❌ FAILED: Both primary and mirror failed. Raw response:`, result.text?.substring(0, 200));
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
