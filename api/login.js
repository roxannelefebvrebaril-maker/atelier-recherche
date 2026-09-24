// POST /api/login  { password }  ->  { token }
const { PREFIX, PASSWORD, configured, missingConfig, redis, tokenFor, safeEqual, send, readBody, clientIp } = require("./_lib/common");

module.exports = async function handler(req, res){
  if (req.method === "GET") return send(res, 200, { configured: configured(), missing: missingConfig() });
  if (req.method !== "POST") return send(res, 405, { error: "Méthode non permise" });
  if (!configured()) return send(res, 503, { error: "not_configured", missing: missingConfig() });

  const failKey = PREFIX + "fail:" + clientIp(req);
  try {
    const fails = Number(await redis(["GET", failKey]) || 0);
    if (fails >= 10) return send(res, 429, { error: "Trop de tentatives. Réessaie dans 15 minutes." });
    const body = await readBody(req);
    if (!safeEqual(body.password || "", PASSWORD)){
      await redis(["SET", failKey, String(fails + 1), "EX", "900"]);
      return send(res, 401, { error: "Mot de passe incorrect." });
    }
    await redis(["DEL", failKey]);
    return send(res, 200, { token: tokenFor(PASSWORD) });
  } catch(e){
    return send(res, 500, { error: e.message });
  }
};
