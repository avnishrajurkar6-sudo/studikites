/* GET /api/avkings — tiny signed-brand identity endpoint.
   Public, rate-limited, no secrets. Shows who built the engine. */
const { BRAND, VERSION, sendJson, sendOptions, requireMethod, rateLimit } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  if (!rateLimit(req, res, "avkings", 60, 60_000)) return;
  return sendJson(req, res, 200, {
    success: true,
    brand: BRAND,
    engine: `${BRAND} Engine`,
    version: VERSION,
    product: "StudiKitEZ",
    tagline: "Learn calmly. Built by AVkings.",
    endpoints: [
      "/api/config",
      "/api/courses/batches",
      "/api/courses/content",
      "/api/media/play",
      "/api/media/live",
      "/api/auth/send-otp",
      "/api/auth/verify-otp",
      "/api/auth/is-admin",
      "/api/auth/profile",
      "/api/auth/telegram-link",
    ],
    time: new Date().toISOString(),
  });
};
