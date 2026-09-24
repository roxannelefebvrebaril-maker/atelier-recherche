// Stockage en ligne des projets et gabarits.
//   GET    /api/data                     -> { items: [meta…] }            (index)
//   GET    /api/data?id=X                -> { meta, state, rev }
//   PUT    /api/data?id=X  {meta, state, baseRev, snapshot?}
//                                         -> { rev }  ou 409 { error:"conflict", rev }
//   DELETE /api/data?id=X                -> { ok }   (copie gardée 30 jours dans la corbeille)
//   GET    /api/data?id=X&history=1      -> { versions: [{i, t, title}] }
//   GET    /api/data?id=X&version=N      -> { state, t }
const { PREFIX, configured, missingConfig, redis, pipeline, authorized, send, readBody } = require("./_lib/common");

const K = {
  index: PREFIX + "index",
  doc: id => PREFIX + "doc:" + id,
  rev: id => PREFIX + "rev:" + id,
  hist: id => PREFIX + "hist:" + id,
  histTs: id => PREFIX + "histts:" + id,
  trash: id => PREFIX + "trash:" + id
};

const HISTORY_EVERY = 10 * 60;   // au plus une version archivée toutes les 10 minutes…
const HISTORY_KEEP = 60;         // …et on garde les 60 dernières.

// Écriture atomique avec contrôle de version : refuse si quelqu'un a enregistré entre-temps.
// Avant d'écraser, archive la version précédente dans l'historique (au plus toutes les 10 min).
const PUT_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[2]) or '0')
local base = tonumber(ARGV[3])
if base >= 0 and cur ~= base then return {-1, cur} end
local prev = redis.call('GET', KEYS[1])
local now = tonumber(ARGV[5])
local last = tonumber(redis.call('GET', KEYS[5]) or '0')
if prev and (ARGV[6] == '1' or now - last >= tonumber(ARGV[7])) then
  redis.call('LPUSH', KEYS[4], cjson.encode({t = now, d = prev}))
  redis.call('LTRIM', KEYS[4], 0, tonumber(ARGV[8]) - 1)
  redis.call('SET', KEYS[5], now)
end
redis.call('SET', KEYS[1], ARGV[1])
local n = cur + 1
redis.call('SET', KEYS[2], n)
local meta = cjson.decode(ARGV[2])
meta['rev'] = n
redis.call('HSET', KEYS[3], ARGV[4], cjson.encode(meta))
return {1, n}
`;

function validId(id){ return typeof id === "string" && /^[\w-]{1,64}$/.test(id); }

module.exports = async function handler(req, res){
  if (!configured()) return send(res, 503, { error: "not_configured", missing: missingConfig() });
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const id = q.id;

  try {
    if (req.method === "GET" && !id){
      const flat = await redis(["HGETALL", K.index]) || [];
      const items = [];
      for (let i = 0; i < flat.length; i += 2){ try { items.push(JSON.parse(flat[i + 1])); } catch(e){} }
      return send(res, 200, { items });
    }

    if (!validId(id)) return send(res, 400, { error: "id invalide" });

    if (req.method === "GET" && q.history){
      const list = await redis(["LRANGE", K.hist(id), "0", "-1"]) || [];
      const versions = list.map((raw, i) => {
        try { const v = JSON.parse(raw); let title = ""; try { title = JSON.parse(v.d).title || ""; } catch(e){}
          return { i, t: v.t, title, size: (v.d || "").length }; } catch(e){ return null; }
      }).filter(Boolean);
      return send(res, 200, { versions });
    }

    if (req.method === "GET" && q.version !== undefined){
      const raw = await redis(["LINDEX", K.hist(id), String(Number(q.version) || 0)]);
      if (!raw) return send(res, 404, { error: "version introuvable" });
      const v = JSON.parse(raw);
      return send(res, 200, { t: v.t, state: JSON.parse(v.d) });
    }

    if (req.method === "GET"){
      const [doc, rev, meta] = await pipeline([["GET", K.doc(id)], ["GET", K.rev(id)], ["HGET", K.index, id]]);
      if (!doc) return send(res, 404, { error: "introuvable" });
      return send(res, 200, { state: JSON.parse(doc), rev: Number(rev || 0), meta: meta ? JSON.parse(meta) : null });
    }

    if (req.method === "PUT"){
      const body = await readBody(req);
      if (!body || typeof body.state !== "object" || !body.meta) return send(res, 400, { error: "données manquantes" });
      const stateStr = JSON.stringify(body.state);
      const meta = Object.assign({}, body.meta, { id, updatedAt: new Date().toISOString() });
      delete meta.pending; delete meta.lv;
      const baseRev = Number.isFinite(Number(body.baseRev)) ? Number(body.baseRev) : 0;
      const now = Math.floor(Date.now() / 1000);
      if (stateStr.length > 4000000) return send(res, 413, { error: "Projet trop volumineux (plus de 4 Mo)." });
      const out = await redis(["EVAL", PUT_SCRIPT, "5",
        K.doc(id), K.rev(id), K.index, K.hist(id), K.histTs(id),
        stateStr, JSON.stringify(meta), String(baseRev), id, String(now),
        body.snapshot ? "1" : "0", String(HISTORY_EVERY), String(HISTORY_KEEP)]);
      if (Number(out[0]) !== 1) return send(res, 409, { error: "conflict", rev: Number(out[1]) });
      return send(res, 200, { rev: Number(out[1]), updatedAt: meta.updatedAt });
    }

    if (req.method === "DELETE"){
      const doc = await redis(["GET", K.doc(id)]);
      const cmds = [["HDEL", K.index, id], ["DEL", K.doc(id), K.rev(id), K.hist(id), K.histTs(id)]];
      if (doc) cmds.unshift(["SET", K.trash(id), doc, "EX", String(30 * 24 * 3600)]);
      await pipeline(cmds);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: "Méthode non permise" });
  } catch(e){
    return send(res, 500, { error: e.message });
  }
};
