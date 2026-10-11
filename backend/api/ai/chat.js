/* POST /api/ai/chat — AI study helper (doubt solve / explain / quiz).
   Strictly gated: verified request source (site key) + signed-in user.
   The xKiro key lives ONLY in env XKIRO_API_KEY — never in code, never shipped. */
const { sendJson, sendOptions, requireMethod, readJsonBody, fetchUpstream } = require("../../lib/http");
const { verifySiteKey } = require("../../lib/siteauth");
const { authorize } = require("../../lib/verify");

const MODES = {
  doubt: "You are StudiKitEZ AI, a friendly Indian curriculum tutor (Class 6-12, JEE/NEET). Answer the student's doubt step by step, simply, with a final answer boxed. Keep it under 250 words unless asked for more. Use plain text with minimal markdown.",
  explain: "You are StudiKitEZ AI, a friendly Indian curriculum tutor. Explain the topic clearly with a short definition, key points as a list, one everyday example, and 2 quick revision lines. Keep it under 300 words. Use plain text with minimal markdown.",
  quiz: "You are StudiKitEZ AI, a quiz master for Indian school curriculum. Make a 5-question quiz on the topic: 4 MCQ (options A-D) + 1 short answer. Give questions first, then an answer key at the end. Keep it compact.",
  notes: "You are StudiKitEZ AI, a notes writer for Indian school curriculum. Turn the topic into crisp exam notes: headings, bullets, formulas/dates highlighted, and a 3-line summary. Under 350 words. Plain text, minimal markdown.",
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["POST"])) return;
  try {
    await verifySiteKey(req);
    const who = await authorize(req, {});
    const key = String(process.env.XKIRO_API_KEY || "").trim();
    if (!key) {
      return sendJson(req, res, 503, { success: false, error: "AI is not configured yet" });
    }
    const body = await readJsonBody(req, 16 * 1024);
    const mode = MODES[body.mode] ? body.mode : "doubt";
    const input = String(body.prompt || "").trim().slice(0, 2000);
    if (!input) return sendJson(req, res, 400, { success: false, error: "Ask something first" });
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const messages = [{ role: "system", content: MODES[mode] }];
    for (const m of history) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      messages.push({ role: m.role, content: String(m.content || "").slice(0, 2000) });
    }
    messages.push({ role: "user", content: input });
    const r = await fetchUpstream("https://api.xkiro.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: process.env.XKIRO_MODEL || "qwen/qwen3.8-omni-flash:free",
        messages,
        max_tokens: 900,
        temperature: 0.7,
      }),
      timeout: 25000,
    });
    const reply =
      r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message
        ? String(r.json.choices[0].message.content || "").trim()
        : "";
    if (!r.ok || !reply) {
      const why = (r.json && (r.json.error || r.json.message)) || ("AI upstream HTTP " + r.status);
      return sendJson(req, res, 502, { success: false, error: typeof why === "string" ? why.slice(0, 200) : "AI upstream failed" });
    }
    return sendJson(req, res, 200, { success: true, reply: reply.slice(0, 6000), mode, uid: who.uid });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "AI failed" });
  }
};
