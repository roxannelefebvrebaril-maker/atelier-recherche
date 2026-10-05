// Connexion.
//   GET  /api/login                                        -> { configured, setup, setupPossible }
//   POST /api/login  { email, password }                   -> { token, user }
//   POST /api/login  { action:"setup", password, name, email, newPassword }
//        Création du tout premier compte (administrateur) avec l'ancien mot de passe de l'application.
//        Ce compte reprend tous les projets existants.                   -> { token, user }
const C = require("./_lib/common");

const MAX_FAILS = 10;
// Empreinte factice : un courriel inconnu prend le même temps qu'un mauvais mot de passe.
const DUMMY_HASH = C.hashPassword("atelier-recherche-dummy");

async function tooManyFails(keys){
  const counts = await C.pipeline(keys.map(k => ["GET", k]));
  return counts.some(n => Number(n || 0) >= MAX_FAILS);
}
async function countFail(keys){
  await C.pipeline(keys.flatMap(k => [["INCR", k], ["EXPIRE", k, "900"]]));
}

module.exports = async function handler(req, res){
  if (!C.configured()) return C.send(res, req.method === "GET" ? 200 : 503, { configured: false, missing: C.missingConfig() });
  try {
    if (req.method === "GET"){
      const setup = !(await C.hasUsers());
      return C.send(res, 200, { configured: true, setup, setupPossible: setup && !!C.PASSWORD });
    }
    if (req.method !== "POST") return C.send(res, 405, { error: "Méthode non permise" });

    const body = await C.readBody(req);
    const email = C.normEmail(body.email);
    const ipKey = C.PREFIX + "fail:" + C.clientIp(req);
    const emailKey = C.PREFIX + "failmail:" + email;
    const failKeys = email ? [ipKey, emailKey] : [ipKey];
    if (await tooManyFails(failKeys)) return C.send(res, 429, { error: "Trop de tentatives. Réessaie dans 15 minutes." });

    if (body.action === "setup"){
      if (await C.hasUsers()) return C.send(res, 409, { error: "Le compte administrateur existe déjà. Connecte-toi avec ton courriel." });
      if (!C.PASSWORD) return C.send(res, 503, { error: "Ancien mot de passe (APP_PASSWORD) absent de Vercel : impossible de créer le premier compte." });
      if (!C.safeEqual(body.password || "", C.PASSWORD)){ await countFail([ipKey]); return C.send(res, 401, { error: "Mot de passe actuel de l'application incorrect." }); }
      if (!C.validEmail(email)) return C.send(res, 400, { error: "Courriel invalide." });
      const problem = C.passwordProblem(body.newPassword);
      if (problem) return C.send(res, 400, { error: problem });
      const lock = await C.redis(["SET", C.PREFIX + "setup-lock", "1", "NX", "EX", "60"]);
      if (!lock) return C.send(res, 409, { error: "Création du compte déjà en cours. Réessaie dans une minute." });
      const now = new Date().toISOString();
      const user = { id: C.newUserId(), email, name: String(body.name || "").trim().slice(0, 120), role: "admin", legacy: true,
        hash: C.hashPassword(body.newPassword), mustChange: false, createdAt: now, lastLoginAt: now };
      await C.saveUser(user);
      await C.redis(["HSET", C.UK.emails, email, user.id]);
      await C.redis(["DEL", ipKey]);
      return C.send(res, 200, { token: await C.createSession(user), user: C.publicUser(user) });
    }

    const user = email ? await C.userByEmail(email) : null;
    if (!user) C.verifyPassword(body.password, DUMMY_HASH);
    if (!user || !C.verifyPassword(body.password, user.hash)){
      await countFail(failKeys);
      return C.send(res, 401, { error: "Courriel ou mot de passe incorrect." });
    }
    if (user.disabled) return C.send(res, 403, { error: "Ce compte est désactivé." });
    await C.pipeline([["DEL", ipKey], ["DEL", emailKey]]);
    user.lastLoginAt = new Date().toISOString();
    await C.saveUser(user);
    return C.send(res, 200, { token: await C.createSession(user), user: C.publicUser(user) });
  } catch(e){
    return C.send(res, 500, { error: e.message });
  }
};
