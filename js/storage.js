// Stockage local (localStorage) des projets et des gabarits.
// Index : liste des métadonnées ; chaque document est stocké sous sa propre clé.
window.Store = (function(){
  "use strict";
  var BASE = "atelier-recherche:v1:";
  var PREFIX = BASE;
  var INDEX_KEY = PREFIX + "index";
  var DOC_KEY = function(id){ return PREFIX + "doc:" + id; };

  // Copie locale séparée par compte : deux personnes sur le même ordinateur ne voient pas
  // les projets l'une de l'autre. Le compte d'origine (legacy) garde les clés existantes.
  function useAccount(user){
    PREFIX = user && !user.legacy ? BASE + "u:" + user.id + ":" : BASE;
    INDEX_KEY = PREFIX + "index";
    api.PREFIX = PREFIX;
  }

  var listeners = [];
  function emit(type, id, extra){ listeners.forEach(function(fn){ try { fn(type, id, extra); } catch(e){ console.error(e); } }); }
  function onChange(fn){ listeners.push(fn); }

  function uid(){ return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function now(){ return new Date().toISOString(); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  function readIndex(){
    try { var v = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch(e){ return []; }
  }
  function writeIndex(list){ localStorage.setItem(INDEX_KEY, JSON.stringify(list)); }

  function list(kind){
    return readIndex().filter(function(m){ return !kind || m.kind === kind; })
      .sort(function(a,b){ return (b.updatedAt||"").localeCompare(a.updatedAt||""); });
  }
  function meta(id){ return readIndex().find(function(m){ return m.id === id; }) || null; }

  function load(id){
    var raw = localStorage.getItem(DOC_KEY(id));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e){ return null; }
  }

  // Throws if the browser refuses (quota) — the editor shows an error status.
  function save(id, state){
    localStorage.setItem(DOC_KEY(id), JSON.stringify(state));
    var idx = readIndex();
    var m = idx.find(function(x){ return x.id === id; });
    if (m){ m.title = (state.title || "").trim() || "Sans titre"; m.updatedAt = now(); m.pending = true; m.lv = (m.lv || 0) + 1; writeIndex(idx); }
    emit("save", id);
  }

  // Métadonnées facultatives qui voyagent avec la synchronisation (gabarits fournis ou publiés).
  var SYNCED_META = ["builtinKey", "builtinVersion", "builtinHash", "publishedKey", "publishedVersion", "position"];

  // Used by the sync engine: write what came from the server without marking it pending.
  function putFromServer(meta, state){
    localStorage.setItem(DOC_KEY(meta.id), JSON.stringify(state));
    var idx = readIndex();
    var m = idx.find(function(x){ return x.id === meta.id; });
    var clean = {id:meta.id, kind:meta.kind === "template" ? "template" : "project", title:meta.title || state.title || "Sans titre",
      createdAt:meta.createdAt, updatedAt:meta.updatedAt, fromTemplate:meta.fromTemplate || null, rev:meta.rev || 0, pending:false, lv:0};
    SYNCED_META.forEach(function(k){ if (meta[k] != null) clean[k] = meta[k]; });
    if (m) Object.assign(m, clean); else idx.push(clean);
    writeIndex(idx);
  }
  function patchMeta(id, patch){
    var idx = readIndex();
    var m = idx.find(function(x){ return x.id === id; });
    if (m){ Object.assign(m, patch); writeIndex(idx); }
    return m;
  }
  function forget(id){
    localStorage.removeItem(DOC_KEY(id));
    writeIndex(readIndex().filter(function(m){ return m.id !== id; }));
  }

  function create(kind, state, extra){
    var id = uid();
    var s = clone(state);
    localStorage.setItem(DOC_KEY(id), JSON.stringify(s));
    var idx = readIndex();
    var m = Object.assign({id:id, kind:kind, title:(s.title||"").trim() || "Sans titre", createdAt:now(), updatedAt:now(), rev:0, pending:true, lv:1}, extra || {});
    idx.push(m);
    writeIndex(idx);
    emit("save", id);
    return m;
  }

  function rename(id, title){
    var s = load(id); if (!s) return;
    s.title = title; save(id, s);
  }

  function remove(id){
    var m = meta(id);
    forget(id);
    emit("remove", id, m);
  }

  // Strip a project down to its skeleton: keeps every table/column/diagram and the first
  // column of each table (the prompts/labels), empties the other cells, drops links and nodes.
  function structureOnly(state){
    var s = clone(state);
    s.links = [];
    (s.tables || []).forEach(function(t){
      var firstCol = t.columns && t.columns[0] ? t.columns[0].id : null;
      (t.rows || []).forEach(function(r){
        Object.keys(r.cells || {}).forEach(function(cid){
          r.cells[cid].tags = [];
          if (cid !== firstCol) r.cells[cid].text = "";
        });
      });
    });
    (s.diagrams || []).forEach(function(d){ d.nodes = []; d.arrows = []; (d.notes||[]).forEach(function(n){ n.text = ""; }); });
    s.showIntro = true;
    return s;
  }

  function exportAll(){
    return {
      app: "atelier-recherche", version: 1, exportedAt: now(),
      items: readIndex().map(function(m){ return {meta: m, state: load(m.id)}; }).filter(function(x){ return x.state; })
    };
  }
  function exportOne(id){
    var m = meta(id);
    return {app:"atelier-recherche", version:1, exportedAt: now(), items:[{meta:m, state:load(id)}]};
  }

  // Accepts: a full/one-item export from this app, or a bare state object (e.g. an old
  // artifact's state). Always imports as NEW items so nothing existing is overwritten.
  function importData(obj){
    var created = [];
    if (obj && Array.isArray(obj.items)){
      obj.items.forEach(function(it){
        if (!it || !it.state) return;
        var kind = it.meta && it.meta.kind === "template" ? "template" : "project";
        created.push(create(kind, it.state));
      });
    } else if (obj && Array.isArray(obj.tables)){
      created.push(create("project", obj));
    } else {
      throw new Error("Format de fichier non reconnu.");
    }
    return created;
  }

  // opts.example === false : nouveau compte, on ne met que le gabarit de départ.
  function seedIfEmpty(opts){
    if (localStorage.getItem(INDEX_KEY) !== null) return false;
    var seeds = window.SEEDS || {};
    var tpl = seeds.template ? create("template", Object.assign(clone(seeds.template), {title:"Projet de recherche (UQTR)"})) : null;
    if (seeds.example && !(opts && opts.example === false)) create("project", seeds.example, {fromTemplate: tpl ? tpl.title : null});
    return true;
  }

  // Gabarits fournis avec l'app (window.SEEDS_GABARITS) et gabarits publiés par l'administration
  // (passés en paramètre) : ajoutés une seule fois par compte.
  // Le gabarit est marqué par builtinKey dans ses métadonnées (synchronisées, jamais recopiées par
  // « Utiliser »). Les clés déjà installées sont retenues : un gabarit supprimé ne revient pas.
  // Une nouvelle version (seed.version) remplace la copie seulement si elle n'a pas été modifiée.
  function builtinSeenKey(){ return PREFIX + "builtin-installed"; }
  function contentHash(state){
    var str = JSON.stringify(state || {}), h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36) + ":" + str.length;
  }
  function ensureBuiltinTemplates(list){
    var seeds = list || window.SEEDS_GABARITS || [], seen = [];
    try { seen = JSON.parse(localStorage.getItem(builtinSeenKey()) || "[]"); } catch(e){}
    if (!Array.isArray(seen)) seen = [];
    var present = {}, sources = {};
    readIndex().forEach(function(m){
      if (m.kind !== "template") return;
      if (m.builtinKey) present[m.builtinKey] = m;
      if (m.publishedKey) sources[m.publishedKey] = true;   // l'original, dans le compte qui l'a publié
    });
    var changed = 0;
    seeds.forEach(function(seed){
      if (!seed || !seed.key || !seed.state) return;
      var version = seed.version || 1, installed = present[seed.key];
      if (sources[seed.key]){ if (seen.indexOf(seed.key) < 0) seen.push(seed.key); return; }
      if (installed){
        if (seen.indexOf(seed.key) < 0) seen.push(seed.key);
        if (version > (installed.builtinVersion || 1) && installed.builtinHash && installed.builtinHash === contentHash(load(installed.id))){
          var fresh = clone(seed.state);
          if (seed.title) fresh.title = seed.title;
          save(installed.id, fresh);
          patchMeta(installed.id, {builtinVersion: version, builtinHash: contentHash(fresh)});
          changed++;
        }
        return;
      }
      if (seen.indexOf(seed.key) >= 0) return;
      var state = clone(seed.state);
      if (seed.title) state.title = seed.title;
      create("template", state, {builtinKey: seed.key, builtinVersion: version, builtinHash: contentHash(state)});
      seen.push(seed.key); changed++;
    });
    try { localStorage.setItem(builtinSeenKey(), JSON.stringify(seen)); } catch(e){}
    return changed;
  }

  // Ordre choisi par la personne (glisser-déposer) : un nombre « position » dans les métadonnées,
  // synchronisé entre appareils. ids = nouvel ordre complet d'une liste (projets ou gabarits).
  // Seuls les éléments déplacés reçoivent une nouvelle position (les autres gardent la leur),
  // pour ne renvoyer en ligne que ce qui a vraiment bougé.
  function reorder(ids){
    var idx = readIndex(), byId = {};
    idx.forEach(function(m){ byId[m.id] = m; });
    var pos = ids.map(function(id){ var m = byId[id]; return m && typeof m.position === "number" ? m.position : null; });
    // Plus longue suite déjà croissante : ces éléments ne bougent pas.
    var n = ids.length, best = [], prev = [], keep = {};
    for (var i = 0; i < n; i++){
      best[i] = pos[i] === null ? 0 : 1; prev[i] = -1;
      if (pos[i] === null) continue;
      for (var j = 0; j < i; j++) if (pos[j] !== null && pos[j] < pos[i] && best[j] + 1 > best[i]){ best[i] = best[j] + 1; prev[i] = j; }
    }
    var end = -1;
    for (var k = 0; k < n; k++) if (best[k] > 0 && (end < 0 || best[k] > best[end])) end = k;
    for (; end >= 0; end = prev[end]) keep[end] = true;
    var changed = [];
    for (var a = 0; a < n; ){
      if (keep[a]){ a++; continue; }
      var b = a; while (b < n && !keep[b]) b++;
      var lo = a > 0 ? pos[a - 1] : null, hi = b < n ? pos[b] : null, count = b - a;
      for (var c = 0; c < count; c++){
        var p;
        if (lo !== null && hi !== null) p = lo + (hi - lo) * (c + 1) / (count + 1);
        else if (lo !== null) p = lo + c + 1;
        else if (hi !== null) p = hi - (count - c);
        else p = c + 1;
        pos[a + c] = p;
        var m = byId[ids[a + c]];
        if (m){ m.position = p; m.pending = true; m.lv = (m.lv || 0) + 1; changed.push(m.id); }
      }
      a = b;
    }
    if (changed.length){ writeIndex(idx); changed.forEach(function(id){ emit("save", id); }); }
    return changed.length;
  }

  // Trie selon l'ordre choisi. Les éléments sans position gardent l'ordre par défaut,
  // en tête (nouveaux projets) ou en fin de liste (nouveaux gabarits).
  function byPosition(list, unpositionedFirst){
    var placed = list.filter(function(m){ return typeof m.position === "number"; }).sort(function(a, b){ return a.position - b.position; });
    var rest = list.filter(function(m){ return typeof m.position !== "number"; });
    return unpositionedFirst ? rest.concat(placed) : placed.concat(rest);
  }

  function usage(){
    var bytes = 0;
    for (var i=0; i<localStorage.length; i++){
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) bytes += (localStorage.getItem(k) || "").length * 2;
    }
    return bytes;
  }

  var api = {
    PREFIX: PREFIX, DOC_KEY: DOC_KEY, useAccount: useAccount,
    onChange: onChange, putFromServer: putFromServer, patchMeta: patchMeta, forget: forget, readIndex: readIndex,
    list: list, meta: meta, load: load, save: save, create: create, rename: rename, remove: remove,
    structureOnly: structureOnly, exportAll: exportAll, exportOne: exportOne, importData: importData,
    seedIfEmpty: seedIfEmpty, ensureBuiltinTemplates: ensureBuiltinTemplates, SYNCED_META: SYNCED_META, reorder: reorder, byPosition: byPosition, usage: usage, clone: clone
  };
  return api;
})();
