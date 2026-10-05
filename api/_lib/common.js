// Utilitaires partagés par les fonctions serverless (Vercel, Node.js, sans dépendance).
const crypto = require("crypto");

const PREFIX = "ar:";
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
// Ancien mot de passe unique de l'application : ne sert plus qu'à créer le premier compte (administrateur).
const PASSWORD = process.env.APP_PASSWORD || "";
const SESSION_TTL = 60 * 24 * 3600;   // 60 jours

function configured(){ return !!(REDIS_URL && REDIS_TOKEN); }

function missingConfig(){
  const m = [];
  if (!REDIS_URL || !REDIS_TOKEN) m.push("base de données (Upstash Redis)");
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

function safeEqual(a, b){
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/* ---------------- mots de passe ---------------- */

// Chiffrement à sens unique (scrypt) avec un sel propre à chaque compte.
function hashPassword(password){
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt$" + salt + "$" + crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function verifyPassword(password, stored){
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const computed = crypto.scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
// Mot de passe provisoire lisible (sans caractères ambigus).
function tempPassword(){
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++){ out += alphabet[bytes[i] % alphabet.length]; if (i === 3 || i === 7) out += "-"; }
  return out;
}
function passwordProblem(password){
  if (typeof password !== "string" || password.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (password.length > 200) return "Le mot de passe est trop long.";
  return null;
}

/* ---------------- comptes ---------------- */

const UK = {
  users: PREFIX + "users",                    // hash  id -> compte (JSON)
  emails: PREFIX + "emails",                  // hash  courriel -> id
  session: t => PREFIX + "session:" + crypto.createHash("sha256").update(t).digest("hex"),
  userSessions: id => PREFIX + "usersessions:" + id
};

function normEmail(email){ return String(email || "").trim().toLowerCase(); }
function validEmail(email){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200; }
function newUserId(){ return "u_" + crypto.randomBytes(8).toString("hex"); }

async function getUser(id){
  const raw = await redis(["HGET", UK.users, id]);
  return raw ? JSON.parse(raw) : null;
}
async function saveUser(user){ await redis(["HSET", UK.users, user.id, JSON.stringify(user)]); }
async function userByEmail(email){
  const id = await redis(["HGET", UK.emails, normEmail(email)]);
  return id ? getUser(id) : null;
}
async function listUsers(){
  const flat = await redis(["HGETALL", UK.users]) || [];
  const users = [];
  for (let i = 0; i < flat.length; i += 2){ try { users.push(JSON.parse(flat[i + 1])); } catch(e){} }
  return users;
}
async function hasUsers(){ return Number(await redis(["HLEN", UK.users]) || 0) > 0; }

// Espace de données d'un compte. Le compte administrateur d'origine garde les clés existantes
// (« ar: ») : ses projets, fiches et documents ne bougent pas. Les autres ont « ar:u:<id>: ».
function nsFor(user){ return user.legacy ? PREFIX : PREFIX + "u:" + user.id + ":"; }

// Ce que le navigateur peut savoir du compte (jamais l'empreinte du mot de passe).
function publicUser(user){
  return { id: user.id, email: user.email, name: user.name || "", role: user.role, mustChange: !!user.mustChange,
    disabled: !!user.disabled, legacy: !!user.legacy, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null };
}

/* ---------------- sessions ---------------- */

function bearer(req){
  const m = /^Bearer\s+([a-f0-9]{64})$/.exec(req.headers["authorization"] || "");
  return m ? m[1] : null;
}
async function createSession(user){
  const token = crypto.randomBytes(32).toString("hex");
  const key = UK.session(token);
  await pipeline([
    ["SET", key, user.id, "EX", String(SESSION_TTL)],
    ["SADD", UK.userSessions(user.id), key],
    ["EXPIRE", UK.userSessions(user.id), String(SESSION_TTL)]
  ]);
  return token;
}
async function destroySession(req){
  const token = bearer(req);
  if (token) await redis(["DEL", UK.session(token)]);
}
// Ferme toutes les sessions d'un compte (désactivation, réinitialisation), sauf éventuellement la courante.
async function destroyUserSessions(userId, keepReq){
  const keys = await redis(["SMEMBERS", UK.userSessions(userId)]) || [];
  const keepToken = keepReq && bearer(keepReq);
  const keep = keepToken ? UK.session(keepToken) : null;
  const drop = keys.filter(k => k !== keep);
  const cmds = drop.map(k => ["DEL", k]);
  cmds.push(["DEL", UK.userSessions(userId)]);
  if (keep) cmds.push(["SADD", UK.userSessions(userId), keep]);
  await pipeline(cmds);
}
async function currentUser(req){
  const token = bearer(req);
  if (!token) return null;
  const id = await redis(["GET", UK.session(token)]);
  if (!id) return null;
  const user = await getUser(id);
  return user && !user.disabled ? user : null;
}
// Pour les données : session valide ET mot de passe provisoire déjà remplacé.
async function requireUser(req, res){
  const user = await currentUser(req);
  if (!user){ send(res, 401, { error: "unauthorized" }); return null; }
  if (user.mustChange){ send(res, 403, { error: "must_change_password" }); return null; }
  return user;
}

/* ---------------- HTTP ---------------- */

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

module.exports = {
  PREFIX, PASSWORD, configured, missingConfig, redis, pipeline, safeEqual, send, readBody, clientIp,
  hashPassword, verifyPassword, tempPassword, passwordProblem,
  UK, normEmail, validEmail, newUserId, getUser, saveUser, userByEmail, listUsers, hasUsers, nsFor, publicUser,
  createSession, destroySession, destroyUserSessions, currentUser, requireUser
};
