/* POST /api/auth/telegram-link
   Creates short-lived account-link tokens or consumes one from the bot. */
const crypto = require("crypto");
const {
  sendJson,
  sendOptions,
  requireMethod,
  readJsonBody,
  rateLimit,
  sanitizeText,
} = require("../../lib/http");
const { checkIdToken, checkSession, assertNotBanned } = require("../../lib/verify");
const { getDocument, createDocument, patchDocument } = require("../../lib/firestore-admin");

function decodeField(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("booleanValue" in value) return value.booleanValue;
  return null;
}

function decodeDocument(document) {
  const fields = document && document.fields || {};
  const result = {};
  Object.keys(fields).forEach((key) => { result[key] = decodeField(fields[key]); });
  return result;
}

function encodeFields(fields) {
  const result = {};
  Object.keys(fields).forEach((key) => {
    const value = fields[key];
    if (typeof value === "boolean") result[key] = { booleanValue: value };
    else if (typeof value === "number") result[key] = { integerValue: String(value) };
    else result[key] = { stringValue: String(value) };
  });
  return result;
}

async function authenticatedUid(req) {
  const session = String((req.headers && req.headers["x-sk-session"]) || "");
  if (session) {
    const identity = checkSession(session);
    if (identity.provider !== "phone" || !/^phone_[6-9]\d{9}$/.test(identity.uid)) {
      throw Object.assign(new Error("Phone sign-in required"), { status: 401 });
    }
    const profile = await getDocument("users", identity.uid);
    if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 404 });
    if (decodeDocument(profile).banned === true) {
      throw Object.assign(new Error("This account is banned"), { status: 403 });
    }
    return identity.uid;
  }

  const authorization = String((req.headers && req.headers.authorization) || "");
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const identity = await checkIdToken(match[1]);
  await assertNotBanned(identity.uid, match[1]);
  return identity.uid;
}

async function createLink(req) {
  const uid = await authenticatedUid(req);
  const profile = await getDocument("users", uid);
  if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 404 });
  if (decodeDocument(profile).banned === true) {
    throw Object.assign(new Error("This account is banned"), { status: 403 });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenId = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await createDocument("telegram_link_tokens", tokenId, {
    fields: encodeFields({ uid, expiresAt, used: false }),
  });
  return { success: true, token, expiresAt };
}

async function verifyLink(body) {
  const token = String(body.token || "");
  const telegramUserId = String(body.telegramUserId || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[1-9]\d{0,19}$/.test(telegramUserId)) {
    throw Object.assign(new Error("Invalid Telegram link"), { status: 400 });
  }

  const tokenId = crypto.createHash("sha256").update(token).digest("hex");
  const tokenDocument = await getDocument("telegram_link_tokens", tokenId);
  if (!tokenDocument) throw Object.assign(new Error("Telegram link is invalid or expired"), { status: 404 });
  const link = decodeDocument(tokenDocument);
  if (link.used === true) {
    if (link.claimedTelegramId === telegramUserId) {
      const profile = await getDocument("users", link.uid);
      if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 404 });
      const user = decodeDocument(profile);
      if (user.banned === true) throw Object.assign(new Error("This account is banned"), { status: 403 });
      if (user.telegramUserId === telegramUserId) {
        return { success: true, alreadyVerified: true };
      }
      await writeTelegramProfile(link.uid, telegramUserId, body);
      return { success: true, verified: true };
    }
    throw Object.assign(new Error("Telegram link has already been used"), { status: 409 });
  }
  if (!link.uid || !Number.isFinite(link.expiresAt) || link.expiresAt <= Date.now()) {
    throw Object.assign(new Error("Telegram link is invalid or expired"), { status: 410 });
  }
  if (!tokenDocument.updateTime) {
    throw Object.assign(new Error("Telegram link could not be securely verified"), { status: 503 });
  }

  const profile = await getDocument("users", link.uid);
  if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 404 });
  const user = decodeDocument(profile);
  if (user.banned === true) throw Object.assign(new Error("This account is banned"), { status: 403 });

  const now = Date.now();
  await patchDocument("telegram_link_tokens", tokenId, {
    fields: encodeFields({ used: true, claimedTelegramId: telegramUserId, claimedAt: now }),
  }, ["used", "claimedTelegramId", "claimedAt"], tokenDocument.updateTime);
  await writeTelegramProfile(link.uid, telegramUserId, body);
  return { success: true, verified: true };
}

async function writeTelegramProfile(uid, telegramUserId, body) {
  const profile = await getDocument("users", uid);
  if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 404 });
  if (decodeDocument(profile).banned === true) {
    throw Object.assign(new Error("This account is banned"), { status: 403 });
  }
  const username = sanitizeText(body.username, 64).replace(/^@/, "");
  const displayName = sanitizeText(body.firstName, 80);
  const now = Date.now();
  await patchDocument("users", uid, {
    fields: encodeFields({
      telegramVerified: true,
      telegramUserId,
      telegramUsername: username,
      telegramLinkedAt: now,
      telegramDisplayName: displayName,
    }),
  }, ["telegramVerified", "telegramUserId", "telegramUsername", "telegramLinkedAt", "telegramDisplayName"]);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["POST"])) return;

  try {
    const body = await readJsonBody(req);
    const action = String(body.action || "");
    if (action === "create") {
      if (!rateLimit(req, res, "telegram-link-create", 12, 60_000)) return;
      return sendJson(req, res, 200, await createLink(req));
    }
    if (action === "verify") {
      if (!rateLimit(req, res, "telegram-link-verify", 30, 60_000)) return;
      return sendJson(req, res, 200, await verifyLink(body));
    }
    return sendJson(req, res, 400, { success: false, error: "Unsupported Telegram link action" });
  } catch (error) {
    const status = error.status || 503;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? error.message : "Telegram linking is temporarily unavailable",
    });
  }
};
