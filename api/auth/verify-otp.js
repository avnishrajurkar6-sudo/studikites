const { sendJson, sendOptions, requireMethod, readJsonBody, otpBase, fetchUpstream, validIndianMobile, asId } = require("../../lib/http");
const { mintSession } = require("../../lib/verify");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["POST"])) return;
  try {
    const body = await readJsonBody(req);
    const mobile = validIndianMobile(body.mobile);
    const otp = String(body.otp || "").trim();
    const deviceId = asId(body.deviceId || body.device_id, 128);
    if (!mobile) return sendJson(req, res, 400, { success: false, error: "Enter a valid 10-digit Indian mobile number" });
    if (!/^\d{4,8}$/.test(otp)) return sendJson(req, res, 400, { success: false, error: "Enter the OTP you received" });
    if (!deviceId) return sendJson(req, res, 400, { success: false, error: "Missing device id" });
    const base = otpBase();
    const upstream = await fetchUpstream(`${base}/api/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, otp, signup_needed: "0", device_id: deviceId }),
    });
    if (!upstream.json || upstream.json.success !== true || !(upstream.json.data && upstream.json.data.accessToken)) {
      return sendJson(req, res, 400, upstream.json || { success: false, error: "Invalid OTP" });
    }
    // Backend-signed session: proves this device passed OTP, no Firebase needed.
    upstream.json.session = mintSession("phone_" + mobile, "phone");
    return sendJson(req, res, 200, upstream.json);
  } catch (err) {
    return sendJson(req, res, err.status || 500, { success: false, error: err.message || "Invalid OTP" });
  }
};
