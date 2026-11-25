/* GET /api/courses/batches
   Always-fresh batch catalog. Proxies https://nt.studybeepro.site/batches.json
   with a short cache and falls back to the bundled snapshot when upstream is
   down, so the site never shows an empty catalog. Vercel cron warms the cache
   daily (see vercel.json). */
const fs = require("fs");
const path = require("path");
const {
  BRAND,
  sendJson,
  sendOptions,
  requireMethod,
  batchesUrl,
  fetchUpstream,
  rateLimit,
  sanitizeText,
} = require("../../lib/http");

const FALLBACK_PATH = path.join(__dirname, "..", "..", "lib", "batches.json");
const CACHE_MS = 15 * 60 * 1000;

let cache = { at: 0, data: null, source: "" };

function fallback() {
  try {
    const data = JSON.parse(fs.readFileSync(FALLBACK_PATH, "utf8"));
    if (data && Array.isArray(data.new)) return data;
  } catch {}
  return { new: [], old: [] };
}

function normalize(data) {
  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((b) => {
        const id = String(b && b.id !== undefined ? b.id : "").replace(/[^0-9]/g, "").slice(0, 8);
        const title = sanitizeText(b && b.title, 200);
        const thumbnail = String((b && b.thumbnail) || "");
        if (!id || !title) return null;
        if (!/^https:\/\//i.test(thumbnail)) return null;
        return { id: Number(id), title, thumbnail };
      })
      .filter(Boolean);
  return { new: clean(data.new), old: clean(data.old), updatedAt: Date.now() };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  if (!rateLimit(req, res, "batches", 90, 60_000)) return;

  const force = String((req.query && req.query.refresh) || "") === "1";
  if (force) {
    const { requireAdmin } = require("../../lib/verify");
    try {
      await requireAdmin(req);
    } catch (error) {
      const status = error.status || 503;
      return sendJson(req, res, status, {
        success: false,
        error: status < 500 ? error.message : "Catalog refresh unavailable",
      });
    }
  }
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    return sendJson(req, res, 200, Object.assign({ success: true, source: cache.source, cached: true }, cache.data));
  }

  try {
    const r = await fetchUpstream(`${batchesUrl()}?_t=${Date.now()}`, { timeout: 9000 });
    const raw = r.json || (r.text && r.text.trim().startsWith("[") ? { new: JSON.parse(r.text), old: [] } : null);
    if (!r.ok || !raw || !Array.isArray(raw.new) || !raw.new.length) {
      throw Object.assign(new Error("upstream catalog empty"), { status: 502 });
    }
    cache = { at: Date.now(), data: normalize(raw), source: "live" };
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    return sendJson(req, res, 200, Object.assign({ success: true, source: "live", cached: false }, cache.data));
  } catch (e) {
    const data = normalize(fallback());
    cache = { at: Date.now(), data, source: "bundled-fallback" };
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return sendJson(req, res, 200, Object.assign({ success: true, source: "bundled-fallback", degraded: true }, data));
  }
};
