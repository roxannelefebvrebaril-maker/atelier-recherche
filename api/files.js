// Documents déposés dans les fiches (PDF, etc.), gardés à part des projets pour ne pas
// alourdir leur sauvegarde ni leur historique. Chaque fichier est découpé en morceaux
// (base64, environ 1 Mo chacun) pour rester sous les limites de taille des requêtes.
//   POST   /api/files?id=F&i=N   {data}                          -> { ok }   (un morceau)
//   POST   /api/files?id=F&done=1 {name, type, size, chunks}     -> { ok }   (fin d'envoi)
//   GET    /api/files?id=F                                       -> { meta }
//   GET    /api/files?id=F&i=N                                   -> { data }
//   DELETE /api/files?id=F                                       -> { ok }
const { PREFIX, configured, missingConfig, redis, pipeline, authorized, send, readBody } = require("./_lib/common");

const MAX_CHUNKS = 40;              // environ 30 Mo par document
const MAX_CHUNK_LENGTH = 1500000;   // base64

const K = {
  meta: id => PREFIX + "file:" + id + ":meta",
  chunk: (id, i) => PREFIX + "file:" + id + ":" + i
};

function validId(id){ return typeof id === "string" && /^[\w-]{1,64}$/.test(id); }
function validIndex(i){ return Number.isInteger(i) && i >= 0 && i < MAX_CHUNKS; }

module.exports = async function handler(req, res){
  if (!configured()) return send(res, 503, { error: "not_configured", missing: missingConfig() });
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const id = q.id;
  if (!validId(id)) return send(res, 400, { error: "id invalide" });
  const hasIndex = q.i !== undefined;
  const index = Number(q.i);

  try {
    if (req.method === "POST" && q.done){
      const body = await readBody(req);
      const chunks = Number(body.chunks);
      if (!body.name || !Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return send(res, 400, { error: "document invalide" });
      const meta = { name: String(body.name).slice(0, 255), type: String(body.type || "application/octet-stream").slice(0, 120), size: Number(body.size) || 0, chunks, addedAt: new Date().toISOString() };
      await redis(["SET", K.meta(id), JSON.stringify(meta)]);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST"){
      if (!validIndex(index)) return send(res, 400, { error: "morceau invalide" });
      const body = await readBody(req);
      if (typeof body.data !== "string" || !body.data || body.data.length > MAX_CHUNK_LENGTH) return send(res, 413, { error: "morceau trop volumineux" });
      await redis(["SET", K.chunk(id, index), body.data]);
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && hasIndex){
      if (!validIndex(index)) return send(res, 400, { error: "morceau invalide" });
      const data = await redis(["GET", K.chunk(id, index)]);
      if (!data) return send(res, 404, { error: "introuvable" });
      return send(res, 200, { data });
    }

    if (req.method === "GET"){
      const raw = await redis(["GET", K.meta(id)]);
      if (!raw) return send(res, 404, { error: "introuvable" });
      return send(res, 200, { meta: JSON.parse(raw) });
    }

    if (req.method === "DELETE"){
      const keys = [K.meta(id)];
      for (let i = 0; i < MAX_CHUNKS; i++) keys.push(K.chunk(id, i));
      await pipeline([["DEL"].concat(keys)]);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: "Méthode non permise" });
  } catch(e){
    return send(res, 500, { error: e.message });
  }
};
