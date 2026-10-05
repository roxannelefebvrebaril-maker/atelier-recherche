// Gestion des comptes (administrateur seulement). Les comptes se créent sur invitation.
//   GET  /api/users                                   -> { users }
//   POST /api/users { action:"create", name, email }  -> { user, tempPassword }
//   POST /api/users { action:"reset", id }            -> { user, tempPassword }
//   POST /api/users { action:"disable" | "enable", id } -> { user }
const C = require("./_lib/common");

module.exports = async function handler(req, res){
  if (!C.configured()) return C.send(res, 503, { error: "not_configured", missing: C.missingConfig() });
  try {
    const admin = await C.requireUser(req, res);
    if (!admin) return;
    if (admin.role !== "admin") return C.send(res, 403, { error: "Réservé à l'administration des comptes." });

    if (req.method === "GET"){
      const users = (await C.listUsers()).map(C.publicUser).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      return C.send(res, 200, { users });
    }
    if (req.method !== "POST") return C.send(res, 405, { error: "Méthode non permise" });

    const body = await C.readBody(req);
    if (body.action === "create"){
      const email = C.normEmail(body.email);
      if (!C.validEmail(email)) return C.send(res, 400, { error: "Courriel invalide." });
      const claimed = await C.redis(["HSETNX", C.UK.emails, email, "pending"]);
      if (!Number(claimed)) return C.send(res, 409, { error: "Un compte existe déjà pour ce courriel." });
      const temp = C.tempPassword();
      const user = { id: C.newUserId(), email, name: String(body.name || "").trim().slice(0, 120), role: "member",
        hash: C.hashPassword(temp), mustChange: true, createdAt: new Date().toISOString(), invitedBy: admin.id };
      await C.saveUser(user);
      await C.redis(["HSET", C.UK.emails, email, user.id]);
      return C.send(res, 200, { user: C.publicUser(user), tempPassword: temp });
    }

    const user = body.id ? await C.getUser(String(body.id)) : null;
    if (!user) return C.send(res, 404, { error: "Compte introuvable." });

    if (body.action === "reset"){
      if (user.id === admin.id) return C.send(res, 400, { error: "Pour ton propre compte, utilise « Changer mon mot de passe »." });
      const temp = C.tempPassword();
      user.hash = C.hashPassword(temp);
      user.mustChange = true;
      await C.saveUser(user);
      await C.destroyUserSessions(user.id);
      return C.send(res, 200, { user: C.publicUser(user), tempPassword: temp });
    }
    if (body.action === "disable" || body.action === "enable"){
      if (user.id === admin.id) return C.send(res, 400, { error: "Tu ne peux pas désactiver ton propre compte." });
      user.disabled = body.action === "disable";
      await C.saveUser(user);
      if (user.disabled) await C.destroyUserSessions(user.id);
      return C.send(res, 200, { user: C.publicUser(user) });
    }
    return C.send(res, 400, { error: "Action inconnue." });
  } catch(e){
    return C.send(res, 500, { error: e.message });
  }
};
