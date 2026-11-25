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
const { mediaRoutes, fetchUpstream, mirrorNig } = require("./http");
const { getDocument } = require("./firestore-admin");

function firebaseKey() {
  return process.env.FIREBASE_STUDIKI_API_KEY || process.env.STUDIKI_API_KEY ||
    "AIzaSyCG2zFEsE5Fr8Vx-5of_PL0xQeP773MNFM";
}

function firebaseProject() {
  return process.env.FIREBASE_STUDIKI_PROJECT_ID || "studiki";
}

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
  const key = firebaseKey();
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
    const user = j && j.users && j.users[0];
    const uid = user && user.localId;
    if (!res.ok || !uid || user.disabled === true) throw Object.assign(new Error("Invalid sign-in"), { status: 401 });
    return {
      uid,
      provider: "google",
      email: String(user.email || "").toLowerCase(),
      idToken,
    };
  } catch (e) {
    if (e && e.status === 401) throw e;
    throw Object.assign(new Error("Sign-in check failed"), { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

async function userRecord(uid, idToken) {
  let json;
  try {
    if (!idToken) {
      json = await getDocument("users", uid);
    } else {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProject())}/databases/(default)/documents/users/${encodeURIComponent(uid)}?key=${encodeURIComponent(firebaseKey())}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` }, signal: controller.signal });
        if (res.status === 404) return null;
        if (!res.ok) throw Object.assign(new Error("Account status could not be verified"), { status: 503 });
        json = await res.json();
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (error) {
    if (error && error.status) throw error;
    throw Object.assign(new Error("Account status could not be verified"), { status: 503 });
  }
  const fields = json && json.fields;
  if (!fields) return null;
  const value = (name) => {
    const field = fields[name];
    if (!field) return undefined;
    if (Object.prototype.hasOwnProperty.call(field, "booleanValue")) return field.booleanValue;
    if (Object.prototype.hasOwnProperty.call(field, "integerValue")) return Number(field.integerValue);
    if (Object.prototype.hasOwnProperty.call(field, "stringValue")) return field.stringValue;
    return undefined;
  };
  return { banned: value("banned") === true, role: String(value("role") || "").toLowerCase() };
}

async function assertNotBanned(uid, idToken) {
  const user = await userRecord(uid, idToken);
  if (user && user.banned) throw Object.assign(new Error("This account is banned"), { status: 403 });
  return user;
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function requireAdmin(req) {
  const authorization = String((req.headers && req.headers.authorization) || "");
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw Object.assign(new Error("Admin sign-in required"), { status: 401 });
  const identity = await checkIdToken(match[1]);
  const user = await userRecord(identity.uid, match[1]);
  if (user && user.banned) throw Object.assign(new Error("This account is banned"), { status: 403 });
  if (!adminEmails().includes(identity.email) && (!user || user.role !== "admin")) {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
  return identity;
}

/* Server-side free-preview check: first file at root, else first file one folder down.
   Cached per course for 10 minutes so playback never pays for repeated listing calls. */
const previewCache = new Map();
async function freePreviewId(courseId) {
  const id = String(courseId || "");
  const hit = previewCache.get(id);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const value = await resolvePreview(id);
  if (value) previewCache.set(id, { at: Date.now(), value });
  if (previewCache.size > 500) previewCache.clear();
  return value;
}

async function resolvePreview(courseId) {
  const routes = mediaRoutes();
  const mirror = mirrorNig();
  const get = async (url) => {
    const r = await fetchUpstream(url, { timeout: 8000 });
    if (!r.json) return null;
    const data = Array.isArray(r.json.data) ? r.json.data : (Array.isArray(r.json) ? r.json : null);
    return data;
  };
  const fetchFolder = async (folder) => {
    const nigUrl = `${routes.nig}?content=${encodeURIComponent(courseId)}&folder=${encodeURIComponent(folder)}`;
    let data = await get(nigUrl).catch(() => null);
    if (!data) data = await get(`${mirror}/?content=${encodeURIComponent(courseId)}&folder=${encodeURIComponent(folder)}`).catch(() => null);
    return data;
  };
  const root = await fetchFolder("0");
  if (!root) return null;
  let f = root.find((x) => x && x.type === "file") || null;
  if (!f) {
    const folder = root.find((x) => x && x.type === "folder");
    if (folder) {
      const sub = await fetchFolder(String(folder.entity_id));
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
    await assertNotBanned(u.uid, u.idToken);
    return { uid: u.uid, via: "google" };
  }
  const sess = headers["x-sk-session"] || (req.query && req.query.session);
  if (sess) {
    const u = checkSession(sess);
    await assertNotBanned(u.uid);
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

module.exports = {
  mintSession,
  checkSession,
  checkIdToken,
  requireAdmin,
  userRecord,
  assertNotBanned,
  authorize,
  freePreviewId,
  validAppKey,
};
