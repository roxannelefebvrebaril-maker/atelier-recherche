// Synchronisation en ligne (fonctions /api sur Vercel + Upstash Redis).
// Principe : tout est d'abord écrit dans le navigateur (instantané, fonctionne hors ligne),
// puis envoyé au serveur. En cas de coupure, les envois attendent et repartent tout seuls.
window.Cloud = (function(){
  "use strict";

  var TOKEN_KEY = "atelier-recherche:session";
  var USER_KEY = "atelier-recherche:user";
  var DELETES_BASE = "atelier-recherche:pending-deletes";
  var DELETES_KEY = DELETES_BASE;
  var user = null;             // compte connecté (sans données sensibles)
  var mode = "local";          // "local" (pas de serveur) | "cloud"
  var token = null;
  var online = navigator.onLine !== false;
  var pushTimers = {};
  var inflight = {};
  var status = "idle";         // idle | syncing | synced | offline | error
  var lastSync = null;
  var statusListeners = [];
  var hooks = { onRemoteUpdate: null, onConflict: null, onAuthLost: null };

  function readToken(){ try { return localStorage.getItem(TOKEN_KEY); } catch(e){ return null; } }
  function readUser(){ try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch(e){ return null; } }
  // Range la copie locale et la file d'attente des suppressions dans l'espace du compte.
  function setUser(u){
    user = u || null;
    try { if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY); } catch(e){}
    Store.useAccount(user);
    DELETES_KEY = user && !user.legacy ? DELETES_BASE + ":" + user.id : DELETES_BASE;
  }
  function setSession(data){
    token = data.token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch(e){}
    setUser(data.user);
    mode = "cloud";
  }
  function setStatus(s){ status = s; if (s === "synced") lastSync = new Date(); statusListeners.forEach(function(fn){ fn(s); }); }

  function api(method, path, body){
    var payload = body ? JSON.stringify(body) : undefined;
    return fetch(path, {
      keepalive: !!(payload && payload.length < 60000 && document.visibilityState === "hidden"),
      method: method,
      headers: Object.assign({"Content-Type":"application/json"}, token ? {Authorization: "Bearer " + token} : {}),
      body: payload,
      cache: "no-store"
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (r.status === 401 && path.indexOf("/api/login") !== 0 && path.indexOf("/api/account") !== 0){ token = null; try { localStorage.removeItem(TOKEN_KEY); } catch(e){}; if (hooks.onAuthLost) hooks.onAuthLost(); }
        return {status: r.status, ok: r.ok, data: j};
      });
    });
  }

  /* ---------------- démarrage ---------------- */

  // Résout : {mode:"local"} (pas d'API : test local ou non configuré), {mode:"setup"} (aucun compte encore),
  // {mode:"login"}, {mode:"password"} (mot de passe provisoire à remplacer) ou {mode:"cloud"}.
  function init(){
    try { localStorage.removeItem("atelier-recherche:token"); } catch(e){}   // ancienne clé (mot de passe unique)
    return fetch("/api/login", {cache:"no-store"}).then(function(r){
      if (!r.ok) return {mode:"local", reason:"no-api"};
      return r.json().then(function(j){
        if (!j.configured) return {mode:"local", reason:"not-configured", missing:j.missing || []};
        mode = "cloud";
        if (j.setup) return {mode:"setup", possible:!!j.setupPossible};
        token = readToken();
        if (!token) return {mode:"login"};
        return api("GET", "/api/account").then(function(res){
          if (!res.ok){ token = null; return {mode:"login"}; }
          setUser(res.data.user);
          return {mode: user.mustChange ? "password" : "cloud"};
        });
      });
    }).catch(function(){
      // Hors ligne au démarrage : si on s'était déjà connecté, on travaille sur la copie locale.
      token = readToken();
      var cached = readUser();
      if (token && cached){ mode = "cloud"; setUser(cached); online = false; setStatus("offline"); return {mode:"cloud", offline:true}; }
      return {mode:"local", reason:"no-api"};
    });
  }

  function login(email, password){
    return api("POST", "/api/login", {email: email, password: password}).then(function(res){
      if (!res.ok) throw new Error(res.data.error || "Connexion impossible.");
      setSession(res.data);
      return user;
    });
  }

  // Tout premier compte : l'ancien mot de passe de l'application crée le compte administrateur.
  function setup(fields){
    return api("POST", "/api/login", Object.assign({action:"setup"}, fields)).then(function(res){
      if (!res.ok) throw new Error(res.data.error || "Création du compte impossible.");
      setSession(res.data);
      return user;
    });
  }

  function changePassword(current, next){
    return api("POST", "/api/account", {action:"password", current: current, next: next}).then(function(res){
      if (!res.ok) throw new Error(res.data.error || "Changement impossible.");
      setUser(res.data.user);
      return user;
    });
  }

  function logout(){
    var ending = token ? api("POST", "/api/account", {action:"logout"}).catch(function(){}) : Promise.resolve();
    return ending.then(function(){
      token = null;
      try { localStorage.removeItem(TOKEN_KEY); } catch(e){}
      setUser(null);
    });
  }

  // Catalogue des gabarits publiés par l'administration ([] si indisponible).
  function publishedTemplates(){
    if (mode !== "cloud" || !token) return Promise.resolve([]);
    return api("GET", "/api/templates").then(function(res){ return res.ok ? (res.data.templates || []) : []; }).catch(function(){ return []; });
  }

  // Appel authentifié pour les autres modules (documents, gestion des comptes).
  function request(method, path, body){ return api(method, path, body); }

  /* ---------------- envoi ---------------- */

  function readDeletes(){ try { return JSON.parse(localStorage.getItem(DELETES_KEY) || "[]"); } catch(e){ return []; } }
  function writeDeletes(l){ try { localStorage.setItem(DELETES_KEY, JSON.stringify(l)); } catch(e){} }

  function schedulePush(id, delay){
    if (mode !== "cloud") return;
    clearTimeout(pushTimers[id]);
    pushTimers[id] = setTimeout(function(){ push(id); }, delay == null ? 400 : delay);
  }

  function push(id, opts){
    opts = opts || {};
    if (mode !== "cloud" || !token) return Promise.resolve(false);
    if (inflight[id]) { schedulePush(id, 800); return inflight[id]; }
    var meta = Store.meta(id), state = Store.load(id);
    if (!meta || !state) return Promise.resolve(false);
    if (meta.rev && !meta.pending && !opts.force && !opts.snapshot) return Promise.resolve(true);   // rien de nouveau à envoyer
    var sentLv = meta.lv || 0;
    setStatus("syncing");
    var p = api("PUT", "/api/data?id=" + encodeURIComponent(id), {
      meta: Store.SYNCED_META.reduce(function(out, k){ if (meta[k] != null) out[k] = meta[k]; return out; },
        {id:id, kind:meta.kind, title:meta.title, createdAt:meta.createdAt, fromTemplate:meta.fromTemplate || null}),
      state: state, baseRev: opts.force ? -1 : (meta.rev || 0), snapshot: !!opts.snapshot
    }).then(function(res){
      inflight[id] = null;
      online = true;
      if (res.ok){
        var m = Store.meta(id);
        var still = m && (m.lv || 0) !== sentLv;   // modifié pendant l'envoi → on renverra
        Store.patchMeta(id, {rev: res.data.rev, pending: !!still});
        if (still) schedulePush(id, 300); else refreshStatus();
        return true;
      }
      if (res.status === 409) return resolveConflict(id).then(function(){ return false; });
      if (res.status === 401) { setStatus("error"); return false; }
      setStatus("error");
      return false;
    }).catch(function(){
      inflight[id] = null;
      online = false;
      setStatus("offline");
      return false;
    });
    inflight[id] = p;
    return p;
  }

  // Un autre appareil a enregistré ce projet entre-temps. On ne perd rien :
  // la version de cet appareil devient une copie, et le projet reprend la version en ligne.
  function resolveConflict(id){
    var localMeta = Store.meta(id), localState = Store.load(id);
    return api("GET", "/api/data?id=" + encodeURIComponent(id)).then(function(res){
      if (!res.ok) { setStatus("error"); return; }
      var stamp = new Date().toLocaleString("fr-CA", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"});
      var copy = Store.clone(localState);
      copy.title = (localState.title || "Projet") + " — version de cet appareil (" + stamp + ")";
      var created = Store.create(localMeta.kind, copy, {fromTemplate: localMeta.fromTemplate || null});
      Store.putFromServer(Object.assign({}, res.data.meta || localMeta, {id:id, rev:res.data.rev}), res.data.state);
      if (hooks.onConflict) hooks.onConflict(id, created.id);
      schedulePush(created.id, 100);
    });
  }

  function pushDeletes(){
    var list = readDeletes();
    if (!list.length) return Promise.resolve();
    return list.reduce(function(p, id){
      return p.then(function(){
        return api("DELETE", "/api/data?id=" + encodeURIComponent(id)).then(function(res){
          if (res.ok || res.status === 404) writeDeletes(readDeletes().filter(function(x){ return x !== id; }));
        });
      });
    }, Promise.resolve());
  }

  /* ---------------- réception ---------------- */

  function pristineSeed(state){
    var S = window.SEEDS || {};
    try {
      var a = JSON.stringify(state);
      if (S.example && a === JSON.stringify(S.example)) return true;
      if (S.template){ var t = Store.clone(S.template); t.title = state.title; if (a === JSON.stringify(t)) return true; }
    } catch(e){}
    return false;
  }

  // Synchronisation complète : envoie ce qui attend, puis récupère ce qui a changé ailleurs.
  function sync(){
    if (mode !== "cloud" || !token) return Promise.resolve({changed:[]});
    setStatus("syncing");
    return pushDeletes().then(function(){
      return api("GET", "/api/data");
    }).then(function(res){
      if (!res.ok) throw new Error(res.data.error || "sync");
      online = true;
      var remote = res.data.items || [];
      var remoteById = {}; remote.forEach(function(m){ remoteById[m.id] = m; });
      var local = Store.readIndex();
      var pendingDeletes = readDeletes();
      var jobs = [], changed = [];

      // Premier démarrage sur un compte vide : on crée le contenu de départ, qui sera envoyé.
      if (!remote.length && !local.length) { Store.seedIfEmpty({example:false}); local = Store.readIndex(); }

      local.forEach(function(m){
        var r = remoteById[m.id];
        if (!r){
          if (m.rev > 0 && !m.pending){ Store.forget(m.id); changed.push(m.id); }          // supprimé ailleurs
          else if (remote.length && !m.rev && pristineSeed(Store.load(m.id))){ Store.forget(m.id); changed.push(m.id); } // doublon du contenu de départ
          else jobs.push(function(){ return push(m.id); });                                // jamais envoyé
        } else if (m.pending){
          jobs.push(function(){ return push(m.id); });
        }
      });
      remote.forEach(function(r){
        if (pendingDeletes.indexOf(r.id) >= 0) return;
        var m = Store.meta(r.id);
        if (m && m.pending) return;
        if (!m || (r.rev || 0) > (m.rev || 0)){
          jobs.push(function(){
            return api("GET", "/api/data?id=" + encodeURIComponent(r.id)).then(function(d){
              if (d.ok){ Store.putFromServer(Object.assign({}, r, d.data.meta || {}, {rev: d.data.rev}), d.data.state); changed.push(r.id); }
            });
          });
        }
      });
      return jobs.reduce(function(p, job){ return p.then(job); }, Promise.resolve()).then(function(){
        refreshStatus();
        if (changed.length && hooks.onRemoteUpdate) hooks.onRemoteUpdate(changed);
        return {changed: changed, ok: true};
      });
    }).catch(function(e){
      if (e && e.message && e.message !== "sync" && e.message !== "Failed to fetch"){ setStatus("error"); }
      else { online = false; setStatus("offline"); }
      return {changed:[]};
    });
  }

  function refreshStatus(){
    var pending = Store.readIndex().some(function(m){ return m.pending; }) || readDeletes().length > 0;
    setStatus(pending ? (online ? "syncing" : "offline") : "synced");
  }

  /* ---------------- historique ---------------- */

  function history(id){ return api("GET", "/api/data?id=" + encodeURIComponent(id) + "&history=1").then(function(r){ if (!r.ok) throw new Error(r.data.error || "Historique indisponible."); return r.data.versions || []; }); }
  function version(id, i){ return api("GET", "/api/data?id=" + encodeURIComponent(id) + "&version=" + i).then(function(r){ if (!r.ok) throw new Error(r.data.error || "Version introuvable."); return r.data; }); }

  /* ---------------- branchements ---------------- */

  Store.onChange(function(type, id){
    if (mode !== "cloud") return;
    if (type === "save") schedulePush(id);
    if (type === "remove"){
      var l = readDeletes(); if (l.indexOf(id) < 0) l.push(id); writeDeletes(l);
      pushDeletes().then(refreshStatus).catch(function(){});
    }
  });

  window.addEventListener("online", function(){ online = true; sync(); });
  window.addEventListener("offline", function(){ online = false; setStatus("offline"); });
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "visible") sync();
    else pushPendingNow();   // on quitte l'onglet / l'appareil se met en veille : on envoie tout de suite
  });
  window.addEventListener("pagehide", pushPendingNow);
  function pushPendingNow(){
    if (mode !== "cloud" || !token) return;
    if (window.Editor) Editor.flush();
    Store.readIndex().forEach(function(m){ if (m.pending){ clearTimeout(pushTimers[m.id]); push(m.id); } });
  }
  setInterval(function(){ if (document.visibilityState === "visible") sync(); }, 45000);
  // Filet de sécurité : si des envois ont échoué (coupure), on réessaie régulièrement.
  setInterval(function(){
    if (mode === "cloud" && token && Store.readIndex().some(function(m){ return m.pending; })) sync();
  }, 15000);

  return {
    init: init, login: login, logout: logout, sync: sync, push: push, history: history, version: version,
    request: request, setup: setup, publishedTemplates: publishedTemplates, changePassword: changePassword,
    user: function(){ return user; },
    isCloud: function(){ return mode === "cloud"; },
    status: function(){ return status; },
    lastSync: function(){ return lastSync; },
    onStatus: function(fn){ statusListeners.push(fn); },
    hooks: hooks
  };
})();
