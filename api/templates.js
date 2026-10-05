// Gabarits publiés par l'administration pour tous les comptes (catalogue commun).
//   GET  /api/templates                                        -> { templates: [{key, title, version, publishedAt, state}] }
//   POST /api/templates { action:"publish", key?, title, state } -> { template }   (administration)
//   POST /api/templates { action:"unpublish", key }             -> { ok }         (administration)
// Chaque compte installe sa propre copie (voir Store.ensureBuiltinTemplates) : retirer une
// publication n'efface rien chez les personnes qui l'ont déjà.
const C = require("./_lib/common");
const crypto = require("crypto");

const CATALOG = C.PREFIX + "published-templates";
const MAX_STATE = 2000000;

function validKey(key){ return typeof key === "string" && /^pub-[a-z0-9]{6,32}$/.test(key); }

module.exports = async function handler(req, res){
  if (!C.configured()) return C.send(res, 503, { error: "not_configured", missing: C.missingConfig() });
  try {
    const user = await C.requireUser(req, res);
    if (!user) return;

    if (req.method === "GET"){
      const flat = await C.redis(["HGETALL", CATALOG]) || [];
      const templates = [];
      for (let i = 0; i < flat.length; i += 2){ try { templates.push(JSON.parse(flat[i + 1])); } catch(e){} }
      templates.sort((a, b) => (a.firstPublishedAt || "").localeCompare(b.firstPublishedAt || ""));
      return C.send(res, 200, { templates });
    }
    if (req.method !== "POST") return C.send(res, 405, { error: "Méthode non permise" });
    if (user.role !== "admin") return C.send(res, 403, { error: "Réservé à l'administration des comptes." });

    const body = await C.readBody(req);
    if (body.action === "publish"){
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title || !body.state || typeof body.state !== "object") return C.send(res, 400, { error: "Gabarit incomplet." });
      const stateStr = JSON.stringify(body.state);
      if (stateStr.length > MAX_STATE) return C.send(res, 413, { error: "Gabarit trop volumineux pour être publié." });
      const key = body.key ? String(body.key) : "pub-" + crypto.randomBytes(6).toString("hex");
      if (!validKey(key)) return C.send(res, 400, { error: "Identifiant de publication invalide." });
      const previousRaw = await C.redis(["HGET", CATALOG, key]);
      const previous = previousRaw ? JSON.parse(previousRaw) : null;
      const now = new Date().toISOString();
      const template = { key, title, state: body.state, version: (previous ? previous.version : 0) + 1,
        publishedAt: now, firstPublishedAt: previous ? previous.firstPublishedAt : now, publishedBy: user.id };
      await C.redis(["HSET", CATALOG, key, JSON.stringify(template)]);
      return C.send(res, 200, { template: { key, title, version: template.version, publishedAt: now } });
    }
    if (body.action === "unpublish"){
      if (!validKey(body.key)) return C.send(res, 400, { error: "Identifiant de publication invalide." });
      await C.redis(["HDEL", CATALOG, body.key]);
      return C.send(res, 200, { ok: true });
    }
    return C.send(res, 400, { error: "Action inconnue." });
  } catch(e){
    return C.send(res, 500, { error: e.message });
  }
};
