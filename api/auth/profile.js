/* Phone-session profile and inbox access. A signed OTP session may only access
   the Firebase document belonging to its verified phone UID. */
const {
  sendJson,
  sendOptions,
  requireMethod,
  readJsonBody,
  rateLimit,
  sanitizeText,
} = require("../../lib/http");
const crypto = require("crypto");
const { checkSession } = require("../../lib/verify");
const {
  getDocument,
  listDocuments,
  createDocument,
  createDocumentPath,
  patchDocument,
  patchDocumentPath,
} = require("../../lib/firestore-admin");

function phoneUid(req) {
  const session = String((req.headers && req.headers["x-sk-session"]) || "");
  const identity = checkSession(session);
  if (identity.provider !== "phone" || !/^phone_[6-9]\d{9}$/.test(identity.uid)) {
    throw Object.assign(new Error("Phone sign-in required"), { status: 401 });
  }
  return identity.uid;
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const result = {};
  Object.keys(fields || {}).forEach((key) => { result[key] = decodeValue(fields[key]); });
  return result;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}

function encodeFields(fields) {
  const result = {};
  Object.keys(fields || {}).forEach((key) => { result[key] = encodeValue(fields[key]); });
  return result;
}

function documentData(document) {
  return document && document.fields ? decodeFields(document.fields) : null;
}

function documentId(document) {
  return String(document && document.name || "").split("/").pop();
}

async function loadProfile(uid) {
  return documentData(await getDocument("users", uid));
}

async function writeProfile(uid, current, action, body) {
  const now = Date.now();
  if (current && current.banned === true) {
    throw Object.assign(new Error("This account is banned"), { status: 403 });
  }

  if (action === "sync") {
    if (current) {
      await patchDocument("users", uid, { lastLoginAt: { integerValue: String(now) } }, ["lastLoginAt"]);
    } else {
      const mobile = uid.slice("phone_".length);
      await createDocument("users", uid, encodeFields({
        mobile,
        email: "",
        displayName: "",
        provider: "phone",
        banned: false,
        createdAt: now,
        lastLoginAt: now,
      }));
    }
    return { success: true };
  }

  if (!current) throw Object.assign(new Error("Phone profile is not initialized"), { status: 404 });

  if (action === "save-profile") {
    const name = sanitizeText(body.name, 60);
    const email = sanitizeText(body.email, 120).toLowerCase();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("Enter a valid name and email"), { status: 400 });
    }
    const fields = {};
    const mask = [];
    if (!String(current.displayName || "").trim()) {
      fields.displayName = { stringValue: name };
      mask.push("displayName");
    }
    if (!String(current.email || "").trim()) {
      fields.email = { stringValue: email };
      mask.push("email");
    }
    if (mask.length) await patchDocument("users", uid, fields, mask);
    return { success: true };
  }

  if (action === "save-onboarding") {
    const data = body.data && typeof body.data === "object" ? body.data : {};
    const onboarding = {
      done: true,
      batches: Array.isArray(data.batches) ? data.batches.map((id) => sanitizeText(id, 20)).filter(Boolean).slice(0, 12) : [],
      mainBatch: sanitizeText(data.mainBatch, 20),
      goal: sanitizeText(data.goal || "board", 40),
      dailyMinutes: Math.max(10, Math.min(240, Number(data.dailyMinutes) || 30)),
      reminders: data.reminders !== false,
      level: sanitizeText(data.level, 40),
      updatedAt: now,
    };
    await patchDocument("users", uid, encodeFields({ onboarding, updatedAt: now }), ["onboarding", "updatedAt"]);
    return { success: true, onboarding };
  }

  if (action === "strike") {
    if (current.role === "admin") {
      return { success: true, strikes: Number(current.strikes) || 0, banned: false, ignored: true };
    }
    const strikes = (Number(current.strikes) || 0) + 1;
    const fields = {
      strikes: { integerValue: String(strikes) },
      lastStrikeAt: { integerValue: String(now) },
      strikeReason: { stringValue: sanitizeText(body.reason || "devtools", 80) },
      banned: { booleanValue: true },
      banReason: { stringValue: "Automatic: developer tools opened" },
      bannedAt: { integerValue: String(now) },
    };
    const mask = ["strikes", "lastStrikeAt", "strikeReason", "banned", "banReason", "bannedAt"];
    await patchDocument("users", uid, fields, mask);
    return { success: true, strikes, banned: true };
  }

  if (action === "mark-inbox-read") {
    const id = sanitizeText(body.id, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Object.assign(new Error("Invalid message ID"), { status: 400 });
    await patchDocumentPath(`users/${uid}/inbox/${id}`, encodeFields({ read: true, readAt: now }), ["read", "readAt"]);
    return { success: true };
  }

  if (action === "send-message") {
    const thread = sanitizeText(body.thread, 300);
    const text = sanitizeText(body.text, 1000);
    const members = thread.split("__");
    if (!/^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(thread) ||
        members.length !== 2 ||
        members[0] === members[1] ||
        !members.includes(uid)) {
      throw Object.assign(new Error("Invalid message thread"), { status: 400 });
    }
    if (!text) throw Object.assign(new Error("Message cannot be empty"), { status: 400 });
    const other = members.find((member) => member !== uid);
    const messageId = `${now}_${crypto.randomBytes(4).toString("hex")}`;
    const displayName = sanitizeText(current.displayName || `+91 ${uid.slice(6)}`, 40);
    await createDocumentPath(`threads/${thread}/messages`, messageId, encodeFields({
      from: uid,
      name: displayName,
      authorRole: "user",
      text,
      at: now,
    }));
    const threadFields = encodeFields({
      id: thread,
      lastText: text.slice(0, 80),
      lastAt: now,
      lastBy: uid,
      lastRole: "user",
      community: false,
    });
    const existingThread = await getDocument("threads", thread);
    if (existingThread) {
      await patchDocument("threads", thread, threadFields, Object.keys(threadFields));
    } else {
      await createDocument("threads", thread, threadFields);
    }
    await createDocumentPath(`users/${other}/inbox`, messageId, encodeFields({
      from: uid,
      fromName: displayName,
      authorRole: "user",
      text: text.slice(0, 200),
      at: now,
      read: false,
      kind: "general",
      thread,
    }));
    return { success: true, id: messageId };
  }

  throw Object.assign(new Error("Unsupported profile action"), { status: 400 });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET", "POST"])) return;
  if (!rateLimit(req, res, "phone-profile", 90, 60_000)) return;

  try {
    const uid = phoneUid(req);
    if (req.method === "GET") {
      const action = String((req.query && req.query.action) || "profile");
      if (action === "inbox") {
        const limit = Math.max(1, Math.min(40, Number((req.query && req.query.limit) || 30)));
        const documents = await listDocuments(`users/${uid}/inbox`, limit, "at desc");
        const items = documents.map((document) => Object.assign({ id: documentId(document) }, documentData(document) || {}));
        return sendJson(req, res, 200, { success: true, items });
      }
      if (action !== "profile") return sendJson(req, res, 400, { success: false, error: "Unsupported profile query" });
      const profile = await loadProfile(uid);
      return sendJson(req, res, 200, { success: true, exists: !!profile, profile });
    }

    const body = await readJsonBody(req);
    const current = await loadProfile(uid);
    const result = await writeProfile(uid, current, String(body.action || ""), body);
    return sendJson(req, res, 200, result);
  } catch (error) {
    const status = error.status || 503;
    return sendJson(req, res, status, {
      success: false,
      error: status < 500 ? error.message : "Phone profile service unavailable",
    });
  }
};