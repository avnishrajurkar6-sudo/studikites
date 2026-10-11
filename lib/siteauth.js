/* Strict request-source verification ("our own API system").
 *
 * Browsers always send Origin/Referer and scripts CANNOT forge them, so the
 * domain claim is trustworthy. A per-domain site key travels in `x-sk-sitekey`
 * (public identifier, served via /api/config — NOT a secret). A request passes
 * only when BOTH match:
 *   1. the Origin/Referer hostname, AND
 *   2. the site key registered for that hostname.
 *
 * Key registry: Firestore collection `api-keys`, doc id = hostname, fields
 * { siteKey, active }. The fixed key for our own domain lives in env SITE_KEY
 * (FIXED_DOMAIN, default studikitesz.pages.dev). Localhost is always allowed
 * for development. Short in-memory cache (60s) so verification costs ~0ms.
 */
const { fetchUpstream } = require("./http");

const CACHE_TTL = 60 * 1000;
const cache = new Map(); // host -> { at, key, active }

function fixedDomain() {
  return String(process.env.FIXED_DOMAIN || "studikitesz.pages.dev").trim().toLowerCase();
}

function fixedSiteKey() {
  return String(process.env.SITE_KEY || "").trim();
}

function studikiKey() {
  return process.env.FIREBASE_STUDIKI_API_KEY || "AIzaSyCG2zFEsE5Fr8Vx-5of_PL0xQeP773MNFM";
}

function originHost(req) {
  const h = (req && req.headers) || {};
  const raw = String(h.origin || h.referer || h.referrer || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLocal(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

async function registryKey(host) {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit;
  let entry = { at: Date.now(), key: "", active: false };
  try {
    const url =
      `https://firestore.googleapis.com/v1/projects/studiki/databases/(default)/documents/api-keys/` +
      `${encodeURIComponent(host)}?key=${encodeURIComponent(studikiKey())}`;
    const r = await fetchUpstream(url, { timeout: 4000 });
    if (r.status === 200 && r.json && r.json.fields) {
      const f = r.json.fields;
      const sk = f.siteKey && typeof f.siteKey.stringValue === "string" ? f.siteKey.stringValue : "";
      const active = !(f.active && f.active.booleanValue === false);
      entry = { at: Date.now(), key: sk, active };
    }
  } catch {
    // Registry unreachable: fail CLOSED below (no key = no pass), but keep
    // a short negative entry so one outage doesn't serialize every request.
    entry = { at: Date.now() - (CACHE_TTL - 5000), key: "", active: false };
  }
  cache.set(host, entry);
  return entry;
}

/* Throws {status:403} unless the request verifiably comes from a registered domain. */
async function verifySiteKey(req) {
  const host = originHost(req);
  const sent = String((req.headers || {})["x-sk-sitekey"] || "").trim();
  if (!host) {
    // Non-browser clients (curl, bots) send no Origin: they never pass,
    // except same-origin server-to-server calls which carry the host header.
    throw Object.assign(new Error("Unverified request source"), { status: 403 });
  }
  if (isLocal(host)) return { domain: host, via: "local" };
  if (host === fixedDomain() && fixedSiteKey() && sent && sent === fixedSiteKey()) {
    return { domain: host, via: "fixed" };
  }
  if (!sent) throw Object.assign(new Error("Unverified request source"), { status: 403 });
  const reg = await registryKey(host);
  if (reg.active && reg.key && sent === reg.key) return { domain: host, via: "registry" };
  throw Object.assign(new Error("Unverified request source"), { status: 403 });
}

module.exports = { verifySiteKey, originHost, fixedDomain };
