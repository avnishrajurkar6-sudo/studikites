/* POST /api/auth/is-admin
   Admin status is based only on a verified Firebase ID token and a private
   email allowlist or the caller's own admin role document. */
const { sendJson, sendOptions, requireMethod, rateLimit } = require("../../lib/http");
const { checkIdToken, userRecord } = require("../../lib/verify");

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["POST"])) return;
  if (!rateLimit(req, res, "is-admin", 30, 60_000)) return;

  const authorization = String((req.headers && req.headers.authorization) || "");
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return sendJson(req, res, 401, { success: false, admin: false, error: "Sign in required" });

  try {
    const identity = await checkIdToken(match[1]);
    const user = await userRecord(identity.uid, match[1]);
    const admin = !(user && user.banned) &&
      (adminEmails().includes(identity.email) || !!(user && user.role === "admin"));
    return sendJson(req, res, 200, {
      success: true,
      admin,
      uid: identity.uid,
      via: adminEmails().includes(identity.email) ? "allowlist" : admin ? "role" : "none",
    });
  } catch (error) {
    const status = error.status || 503;
    return sendJson(req, res, status, {
      success: false,
      admin: false,
      error: status < 500 ? error.message : "Admin status unavailable",
    });
  }
};
