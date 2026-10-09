/* Verified-requests-only gate (CommonJS, no deps).
 *
 * Tiers:
 *   catalog (/api/courses/content) — public, course listings are public data.
 *   live listing (/api/media/live) — needs a well-formed app key+device (minted
 *     client-side via smexgod anon auth; forging the shape is trivial, minting
 *     a real one is not).
 *   playback (/api/media/play) — needs a VERIFIED user, except the course's
 *     free-preview file (checked server-side, unforgeable):
 *       1. Firebase ID token (Google users) in `Authorization: Bearer ...`,
 *          verified against Google's accounts:lookup, OR
 *       2. backend session from POST /api/auth/verify-otp (phone users) in
 *          `x-sk-session` header or `?session=`, HMAC-checked here, OR
 *       3. free-preview content for the course.
 *   Anything else on playback -> 401. SESSION_SECRET must be set on Vercel.
 */
const crypto = require("crypto");
const { mediaRoutes, fetchUpstream } = require("./http");

function sessionSecret() {
  if (!process.env.SESSION_SECRET) {
    throw Object.assign(new Error("SESSION_SECRET is not configured"), { status: 500 });
  }
  return process.env.SESSION_SECRET;
}

function mintSession(uid, provider, ttlMs) {
  const exp = Date.now() + (ttlMs || 30 * 24 * 3600 * 1000);
  const body = `${uid}.${provider}.${exp}`;
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${Buffer.from(uid).toString("base64url")}.${Buffer.from(provider).toString("base64url")}.${exp}.${sig}`;
}

function checkSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) throw Object.assign(new Error("Invalid session"), { status: 401 });
  let uid, provider;
  try {
    uid = Buffer.from(parts[0], "base64url").toString();
    provider = Buffer.from(parts[1], "base64url").toString();
  } catch {
    throw Object.assign(new Error("Invalid session"), { status: 401 });
  }
  const exp = Number(parts[2]);
  if (!uid || !provider || !Number.isFinite(exp) || exp <= Date.now()) {
    throw Object.assign(new Error("Session expired — sign in again"), { status: 401 });
  }
  const sig = crypto.createHmac("sha256", sessionSecret()).update(`${uid}.${provider}.${exp}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error("Invalid session"), { status: 401 });
  }
  return { uid, provider };
}

async function checkIdToken(idToken) {
  if (!idToken || String(idToken).split(".").length !== 3) {
    throw Object.assign(new Error("Invalid sign-in"), { status: 401 });
  }
  const key = process.env.STUDIKI_API_KEY || "AIzaSyCG2zFEsE5Fr8Vx-5of_PL0xQeP773MNFM";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });
    const j = await res.json().catch(() => null);
    const uid = j && j.users && j.users[0] && j.users[0].localId;
    if (!res.ok || !uid) throw Object.assign(new Error("Invalid sign-in"), { status: 401 });
    return { uid, provider: "google" };
  } catch (e) {
    if (e && e.status === 401) throw e;
    throw Object.assign(new Error("Sign-in check failed"), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

/* Server-side free-preview check: first file at root, else first file one folder down. */
async function freePreviewId(courseId) {
  const routes = mediaRoutes();
  const get = async (folder) => {
    const r = await fetchUpstream(`${routes.nig}?content=${encodeURIComponent(courseId)}&folder=${encodeURIComponent(folder)}`, { timeout: 8000 });
    if (!r.json) return null;
    const data = Array.isArray(r.json.data) ? r.json.data : (Array.isArray(r.json) ? r.json : null);
    return data;
  };
  const root = await get("0").catch(() => null);
  if (!root) return null;
  let f = root.find((x) => x && x.type === "file") || null;
  if (!f) {
    const folder = root.find((x) => x && x.type === "folder");
    if (folder) {
      const sub = await get(String(folder.entity_id)).catch(() => null);
      if (sub) f = sub.find((x) => x && x.type === "file") || null;
    }
  }
  return f ? String(f.entity_id) : null;
}

/* Authorize a playback request. Returns {uid, via} or {preview:true}. Throws 401/500. */
async function authorize(req, { courseId, contentId } = {}) {
  const headers = req.headers || {};
  const bearer = String(headers.authorization || "");
  if (/^Bearer\s+\S+$/i.test(bearer)) {
    const u = await checkIdToken(bearer.replace(/^Bearer\s+/i, ""));
    return { uid: u.uid, via: "google" };
  }
  const sess = headers["x-sk-session"] || (req.query && req.query.session);
  if (sess) {
    const u = checkSession(sess);
    return { uid: u.uid, via: u.provider };
  }
  if (courseId && contentId) {
    const free = await freePreviewId(courseId).catch(() => null);
    if (free && free === String(contentId)) return { preview: true };
  }
  throw Object.assign(new Error("Sign in required — this lecture is not free"), { status: 401 });
}

function validAppKey(key, deviceId) {
  return /^SB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(String(key || "")) && String(deviceId || "").length >= 3 && String(deviceId).length <= 128;
}

module.exports = { mintSession, checkSession, checkIdToken, authorize, freePreviewId, validAppKey };
