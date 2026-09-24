// Stockage local (localStorage) des projets et des gabarits.
// Index : liste des métadonnées ; chaque document est stocké sous sa propre clé.
window.Store = (function(){
  "use strict";
  var PREFIX = "atelier-recherche:v1:";
  var INDEX_KEY = PREFIX + "index";
  var DOC_KEY = function(id){ return PREFIX + "doc:" + id; };

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
    if (m){ m.title = (state.title || "").trim() || "Sans titre"; m.updatedAt = now(); writeIndex(idx); }
  }

  function create(kind, state, extra){
    var id = uid();
    var s = clone(state);
    localStorage.setItem(DOC_KEY(id), JSON.stringify(s));
    var idx = readIndex();
    var m = Object.assign({id:id, kind:kind, title:(s.title||"").trim() || "Sans titre", createdAt:now(), updatedAt:now()}, extra || {});
    idx.push(m);
    writeIndex(idx);
    return m;
  }

  function rename(id, title){
    var s = load(id); if (!s) return;
    s.title = title; save(id, s);
  }

  function remove(id){
    localStorage.removeItem(DOC_KEY(id));
    writeIndex(readIndex().filter(function(m){ return m.id !== id; }));
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

  function seedIfEmpty(){
    if (localStorage.getItem(INDEX_KEY) !== null) return false;
    var seeds = window.SEEDS || {};
    var tpl = seeds.template ? create("template", Object.assign(clone(seeds.template), {title:"Projet de recherche (UQTR)"})) : null;
    if (seeds.example) create("project", seeds.example, {fromTemplate: tpl ? tpl.title : null});
    return true;
  }

  function usage(){
    var bytes = 0;
    for (var i=0; i<localStorage.length; i++){
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) bytes += (localStorage.getItem(k) || "").length * 2;
    }
    return bytes;
  }

  return {
    PREFIX: PREFIX, DOC_KEY: DOC_KEY,
    list: list, meta: meta, load: load, save: save, create: create, rename: rename, remove: remove,
    structureOnly: structureOnly, exportAll: exportAll, exportOne: exportOne, importData: importData,
    seedIfEmpty: seedIfEmpty, usage: usage, clone: clone
  };
})();
