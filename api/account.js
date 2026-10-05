// Mon compte.
//   GET  /api/account                                          -> { user }
//   POST /api/account { action:"password", current, next }     -> { user }
//   POST /api/account { action:"logout" }                      -> { ok }
const C = require("./_lib/common");

module.exports = async function handler(req, res){
  if (!C.configured()) return C.send(res, 503, { error: "not_configured", missing: C.missingConfig() });
  try {
    const user = await C.currentUser(req);
    if (!user) return C.send(res, 401, { error: "unauthorized" });
    if (req.method === "GET") return C.send(res, 200, { user: C.publicUser(user) });
    if (req.method !== "POST") return C.send(res, 405, { error: "Méthode non permise" });

    const body = await C.readBody(req);
    if (body.action === "logout"){
      await C.destroySession(req);
      return C.send(res, 200, { ok: true });
    }
    if (body.action === "password"){
      if (!C.verifyPassword(body.current, user.hash)) return C.send(res, 400, { error: "Mot de passe actuel incorrect." });
      const problem = C.passwordProblem(body.next);
      if (problem) return C.send(res, 400, { error: problem });
      if (body.next === body.current) return C.send(res, 400, { error: "Choisis un mot de passe différent de l'actuel." });
      user.hash = C.hashPassword(body.next);
      user.mustChange = false;
      await C.saveUser(user);
      await C.destroyUserSessions(user.id, req);   // les autres appareils devront se reconnecter
      return C.send(res, 200, { user: C.publicUser(user) });
    }
    return C.send(res, 400, { error: "Action inconnue." });
  } catch(e){
    return C.send(res, 500, { error: e.message });
  }
};
