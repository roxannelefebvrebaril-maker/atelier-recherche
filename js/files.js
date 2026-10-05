// Documents déposés dans les fiches de lecture.
// En ligne : envoyés à /api/files par morceaux. En mode local : gardés dans le navigateur (IndexedDB).
// Le projet ne garde que la description du document (id, nom, type, taille).
window.Files = (function(){
  "use strict";

  var CHUNK = 1024 * 1024;          // 1 Mo de fichier par morceau (environ 1,4 Mo en base64)
  var MAX_SIZE = 30 * 1024 * 1024;  // même limite que le serveur
  var DB_NAME = "atelier-recherche-files", STORE = "files";

  function uid(){ return "doc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---------------- mode local : IndexedDB ---------------- */
  var dbPromise = null;
  function db(){
    if (!dbPromise) dbPromise = new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(STORE); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
    return dbPromise;
  }
  function idb(mode, fn){
    return db().then(function(d){
      return new Promise(function(resolve, reject){
        var tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
        tx.oncomplete = function(){ resolve(req && req.result); };
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }

  /* ---------------- en ligne : morceaux base64 ---------------- */
  function toBase64(blob){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function(){ reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }
  function fromBase64(data){
    var bin = atob(data), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function check(res){
    if (!res.ok) throw new Error((res.data && res.data.error) || ("Erreur " + res.status));
    return res.data;
  }

  // Envoie un fichier ; onProgress(0..1). Résout avec la description à garder dans la fiche.
  function put(file, onProgress){
    if (file.size > MAX_SIZE) return Promise.reject(new Error("« " + file.name + " » dépasse 30 Mo."));
    var meta = {id:uid(), name:file.name, type:file.type || "application/octet-stream", size:file.size, addedAt:new Date().toISOString()};
    if (!Cloud.isCloud()){
      return idb("readwrite", function(store){ return store.put({meta:meta, blob:file}, meta.id); }).then(function(){ if (onProgress) onProgress(1); return meta; });
    }
    var total = Math.max(1, Math.ceil(file.size / CHUNK)), i = 0;
    function next(){
      if (i >= total) return Cloud.request("POST", "/api/files?id=" + meta.id + "&done=1", {name:meta.name, type:meta.type, size:meta.size, chunks:total}).then(check);
      var index = i;
      return toBase64(file.slice(index * CHUNK, (index + 1) * CHUNK))
        .then(function(data){ return Cloud.request("POST", "/api/files?id=" + meta.id + "&i=" + index, {data:data}); })
        .then(check)
        .then(function(){ i++; if (onProgress) onProgress(i / total); return next(); });
    }
    return next().then(function(){ return meta; });
  }

  // Récupère le contenu d'un document sous forme de Blob.
  function get(doc){
    if (!Cloud.isCloud()){
      return idb("readonly", function(store){ return store.get(doc.id); }).then(function(entry){
        if (!entry) throw new Error("Document introuvable sur cet appareil.");
        return entry.blob;
      });
    }
    return Cloud.request("GET", "/api/files?id=" + doc.id).then(check).then(function(data){
      var parts = [], n = data.meta.chunks, i = 0;
      function next(){
        if (i >= n) return new Blob(parts, {type:data.meta.type || doc.type});
        return Cloud.request("GET", "/api/files?id=" + doc.id + "&i=" + i).then(check).then(function(chunk){ parts.push(fromBase64(chunk.data)); i++; return next(); });
      }
      return next();
    });
  }

  function remove(doc){
    if (!Cloud.isCloud()) return idb("readwrite", function(store){ return store.delete(doc.id); });
    return Cloud.request("DELETE", "/api/files?id=" + doc.id).then(check);
  }

  return { put: put, get: get, remove: remove, maxSize: MAX_SIZE };
})();
