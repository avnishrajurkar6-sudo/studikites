const { sendJson, sendOptions, requireMethod, readJsonBody, otpBase, fetchUpstream, validIndianMobile, asId } = require("../../lib/http");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["POST"])) return;
  try {
    const body = await readJsonBody(req);
    const mobile = validIndianMobile(body.mobile);
    if (!mobile) return sendJson(req, res, 400, { success: false, error: "Enter a valid 10-digit Indian mobile number" });
    const deviceId = asId(body.deviceId || body.device_id, 128) || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = otpBase();
    const upstream = await fetchUpstream(`${base}/api/check-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, device_id: deviceId, mobile_otp_login: 1, otp: "" }),
    });
    if (!upstream.json || upstream.json.success !== true) {
      return sendJson(req, res, upstream.json ? 400 : upstream.status || 502, upstream.json || { success: false, error: "Failed to send OTP" });
    }
    return sendJson(req, res, 200, { success: true, deviceId, provider: upstream.json });
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Failed to send OTP" });
  }
};
