// Utilitaires partagés par les fonctions serverless (Vercel, Node.js, sans dépendance).
const crypto = require("crypto");

const PREFIX = "ar:";
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PASSWORD = process.env.APP_PASSWORD || "";

function configured(){ return !!(REDIS_URL && REDIS_TOKEN && PASSWORD); }

function missingConfig(){
  const m = [];
  if (!REDIS_URL || !REDIS_TOKEN) m.push("base de données (Upstash Redis)");
  if (!PASSWORD) m.push("APP_PASSWORD");
  return m;
}

// Une commande Redis via l'API REST d'Upstash.
async function redis(cmd){
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("Redis: " + (j.error || r.status));
  return j.result;
}

// Plusieurs commandes en un seul aller-retour.
async function pipeline(cmds){
  const r = await fetch(REDIS_URL.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error("Redis pipeline: " + r.status);
  return j.map(x => { if (x.error) throw new Error("Redis: " + x.error); return x.result; });
}

// Jeton de session sans état : dérivé du mot de passe. Changer APP_PASSWORD déconnecte tout le monde.
function tokenFor(password){
  return crypto.createHmac("sha256", password).update("atelier-recherche-session-v1").digest("hex");
}

function safeEqual(a, b){
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function authorized(req){
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  return !!(m && PASSWORD && safeEqual(m[1], tokenFor(PASSWORD)));
}

function send(res, status, obj){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function readBody(req){
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch(e){ return Promise.resolve({}); } }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch(e){ resolve({}); } });
  });
}

function clientIp(req){
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
}

module.exports = { PREFIX, PASSWORD, configured, missingConfig, redis, pipeline, tokenFor, safeEqual, authorized, send, readBody, clientIp };
