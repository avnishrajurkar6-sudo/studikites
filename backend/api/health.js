const { sendJson, sendOptions, requireMethod } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(req, res);
  if (!requireMethod(req, res, ["GET"])) return;
  return sendJson(req, res, 200, {
    ok: true,
    service: "studikitez-backend",
    engine: "AVkings Engine",
    brand: "AVkings",
    time: new Date().toISOString(),
  });
};
