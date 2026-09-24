// Coquille de l'application : bibliothèque de projets/gabarits, navigation, import/export.
(function(){
  "use strict";

  var libraryEl = document.getElementById("library");

  /* ---------------- petits utilitaires ---------------- */

  function h(tag, attrs, kids){
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function(c){ if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function fmtDate(iso){
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("fr-CA", {day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit"}); }
    catch(e){ return iso; }
  }

  function slug(s){
    return (s || "projet").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "projet";
  }

  function download(filename, text, type){
    var blob = new Blob([text], {type: type || "application/octet-stream"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function toast(msg){
    var t = h("div", {class:"toast", text: msg});
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 3200);
  }

  /* ---------------- fenêtres modales ---------------- */

  function modal(build){
    var overlay = h("div", {class:"overlay"});
    var box = h("div", {class:"modal lib-modal", role:"dialog", "aria-modal":"true"});
    overlay.appendChild(box);
    function close(){ overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e){ if (e.key === "Escape") close(); }
    overlay.addEventListener("mousedown", function(e){ if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    build(box, close);
    document.body.appendChild(overlay);
    var f = box.querySelector("input, select, button.primary");
    if (f) setTimeout(function(){ f.focus(); if (f.select) f.select(); }, 0);
  }

  function confirmBox(message, okLabel, onOk, danger){
    modal(function(box, close){
      box.appendChild(h("p", {text: message}));
      box.appendChild(h("div", {class:"row"}, [
        h("button", {class:"btn ghost", text:"Annuler", onclick: close}),
        h("button", {class:"btn primary" + (danger ? " btn-danger" : ""), text: okLabel, onclick: function(){ close(); onOk(); }})
      ]));
    });
  }

  function promptBox(title, label, value, okLabel, onOk){
    modal(function(box, close){
      var input = h("input", {class:"field", type:"text", value: value || ""});
      function ok(){ var v = input.value.trim(); if (!v) { input.focus(); return; } close(); onOk(v); }
      input.addEventListener("keydown", function(e){ if (e.key === "Enter") ok(); });
      box.appendChild(h("h3", {text: title}));
      box.appendChild(h("label", {class:"field-label"}, [label, input]));
      box.appendChild(h("div", {class:"row"}, [
        h("button", {class:"btn ghost", text:"Annuler", onclick: close}),
        h("button", {class:"btn primary", text: okLabel, onclick: ok})
      ]));
    });
  }

  /* ---------------- actions ---------------- */

  function newProject(templateId){
    var templates = Store.list("template");
    modal(function(box, close){
      var title = h("input", {class:"field", type:"text", placeholder:"Ex. : Les pratiques numériques des aîné·es"});
      var select = h("select", {class:"field"});
      select.appendChild(h("option", {value:"", text:"Projet vide (aucune structure)"}));
      templates.forEach(function(t){
        var o = h("option", {value:t.id, text:"Gabarit : " + t.title});
        if (t.id === templateId || (!templateId && t === templates[0])) o.selected = true;
        select.appendChild(o);
      });
      function ok(){
        var v = title.value.trim();
        if (!v){ title.focus(); return; }
        var base = select.value ? Store.load(select.value) : null;
        var state = base ? Store.clone(base) : {title:"", sub:"", showIntro:true, tags:[], tables:[], diagrams:[], links:[], order:[]};
        state.title = v;
        state.showIntro = true;
        var tplMeta = select.value ? Store.meta(select.value) : null;
        var m = Store.create("project", state, {fromTemplate: tplMeta ? tplMeta.title : null});
        close();
        go("#/p/" + m.id);
      }
      title.addEventListener("keydown", function(e){ if (e.key === "Enter") ok(); });
      box.appendChild(h("h3", {text:"Nouveau projet de recherche"}));
      box.appendChild(h("label", {class:"field-label"}, ["Titre du projet", title]));
      box.appendChild(h("label", {class:"field-label"}, ["Partir de", select]));
      box.appendChild(h("div", {class:"row"}, [
        h("button", {class:"btn ghost", text:"Annuler", onclick: close}),
        h("button", {class:"btn primary", text:"Créer le projet", onclick: ok})
      ]));
    });
  }

  function saveAsTemplate(id){
    var m = Store.meta(id); var s = Store.load(id);
    if (!m || !s) return;
    modal(function(box, close){
      var name = h("input", {class:"field", type:"text", value: "Gabarit — " + m.title});
      var mode = "structure";
      var opts = h("div", {class:"choice-list"});
      [["structure", "Structure seulement", "Garde les tableaux, colonnes, consignes (1re colonne) et repères. Vide les réponses, liens et schémas."],
       ["full", "Structure et contenu", "Copie tout le projet tel quel."]].forEach(function(o){
        var radio = h("input", {type:"radio", name:"tplmode", value:o[0]});
        if (o[0] === mode) radio.checked = true;
        radio.addEventListener("change", function(){ mode = o[0]; });
        opts.appendChild(h("label", {class:"choice"}, [radio, h("span", {}, [h("strong", {text:o[1]}), h("small", {text:o[2]})])]));
      });
      function ok(){
        var v = name.value.trim(); if (!v){ name.focus(); return; }
        var st = mode === "structure" ? Store.structureOnly(s) : Store.clone(s);
        st.title = v;
        Store.create("template", st);
        close();
        toast("Gabarit « " + v + " » créé.");
        if (!Editor.currentId()) renderLibrary();
      }
      box.appendChild(h("h3", {text:"Enregistrer comme gabarit"}));
      box.appendChild(h("label", {class:"field-label"}, ["Nom du gabarit", name]));
      box.appendChild(opts);
      box.appendChild(h("div", {class:"row"}, [
        h("button", {class:"btn ghost", text:"Annuler", onclick: close}),
        h("button", {class:"btn primary", text:"Créer le gabarit", onclick: ok})
      ]));
    });
  }

  function duplicate(id){
    var m = Store.meta(id); var s = Store.load(id);
    if (!m || !s) return;
    var copy = Store.clone(s);
    copy.title = m.title + " (copie)";
    Store.create(m.kind, copy, {fromTemplate: m.fromTemplate || null});
    toast("Copie créée.");
    renderLibrary();
  }

  function exportJSON(id){
    var m = Store.meta(id);
    download(slug(m.title) + ".json", JSON.stringify(Store.exportOne(id), null, 1), "application/json");
  }

  function exportAll(){
    var d = new Date().toISOString().slice(0,10);
    download("atelier-recherche-sauvegarde-" + d + ".json", JSON.stringify(Store.exportAll(), null, 1), "application/json");
  }

  function importFile(){
    var input = h("input", {type:"file", accept:".json,application/json"});
    input.addEventListener("change", function(){
      var f = input.files && input.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function(){
        try {
          var created = Store.importData(JSON.parse(r.result));
          toast(created.length + " élément" + (created.length > 1 ? "s importés" : " importé") + ".");
          renderLibrary();
        } catch(e){ toast("Import impossible : " + e.message); }
      };
      r.readAsText(f);
    });
    input.click();
  }

  /* ---------------- export Markdown ---------------- */

  function htmlToText(html){
    var d = document.createElement("div");
    d.innerHTML = (html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n").replace(/<(div|p|li)[^>]*>/gi, "\n");
    return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  function toMarkdown(state){
    var out = ["# " + (state.title || "Projet"), ""];
    if (state.sub) out.push(state.sub, "");
    var tagLabel = {}; (state.tags || []).forEach(function(t){ tagLabel[t.id] = t.label; });
    function cellMd(c){
      if (!c) return "";
      var t = htmlToText(c.text).replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
      var tags = (c.tags || []).map(function(id){ return tagLabel[id]; }).filter(Boolean);
      return t + (tags.length ? " _(" + tags.join(", ") + ")_" : "");
    }
    function table(t, depth){
      out.push("#".repeat(Math.min(depth + 2, 6)) + " " + (t.title || "Tableau"), "");
      var cols = t.columns || [];
      var rows = (t.rows || []).filter(function(r){ return cols.some(function(c){ return r.cells[c.id] && htmlToText(r.cells[c.id].text); }); });
      if (cols.length && rows.length){
        out.push("| " + cols.map(function(c){ return c.label || " "; }).join(" | ") + " |");
        out.push("|" + cols.map(function(){ return "---"; }).join("|") + "|");
        rows.forEach(function(r){ out.push("| " + cols.map(function(c){ return cellMd(r.cells[c.id]); }).join(" | ") + " |"); });
        out.push("");
      }
      state.tables.filter(function(x){ return x.parentId === t.id; }).forEach(function(c){ table(c, depth + 1); });
      state.diagrams.filter(function(x){ return x.parentId === t.id; }).forEach(function(c){ diagram(c, depth + 1); });
    }
    function diagram(d, depth){
      out.push("#".repeat(Math.min(depth + 2, 6)) + " " + (d.title || "Espace libre"), "");
      (d.notes || []).forEach(function(n){ var t = htmlToText(n.text); if (t) out.push(t, ""); });
      (d.nodes || []).forEach(function(n){
        var t = htmlToText(n.text); if (!t) return;
        out.push("- **" + t + "**");
        var notes = (n.notes && n.notes.length) ? n.notes.map(function(x){ return x.text; }) : [n.sub];
        notes.forEach(function(x){ var tt = htmlToText(x); if (tt) out.push("  - " + tt); });
      });
      out.push("");
    }
    (state.order || []).forEach(function(id){
      var t = state.tables.find(function(x){ return x.id === id; });
      if (t) return table(t, 0);
      var d = state.diagrams.find(function(x){ return x.id === id; });
      if (d) diagram(d, 0);
    });
    return out.join("\n");
  }

  function exportMarkdown(id){
    var s = Store.load(id); var m = Store.meta(id);
    download(slug(m.title) + ".md", toMarkdown(s), "text/markdown");
  }

  /* ---------------- bibliothèque ---------------- */

  function card(m){
    var isTpl = m.kind === "template";
    var menu = h("div", {class:"card-actions"});
    function act(label, fn, cls){ menu.appendChild(h("button", {class:"btn small " + (cls || "ghost"), text: label, onclick: function(e){ e.stopPropagation(); fn(); }})); }
    if (isTpl){
      act("Utiliser", function(){ newProject(m.id); }, "primary");
      act("Modifier", function(){ go("#/p/" + m.id); });
    } else {
      act("Ouvrir", function(){ go("#/p/" + m.id); }, "primary");
      act("En faire un gabarit", function(){ saveAsTemplate(m.id); });
    }
    act("Renommer", function(){
      promptBox("Renommer", "Nouveau titre", m.title, "Renommer", function(v){ Store.rename(m.id, v); renderLibrary(); });
    });
    act("Dupliquer", function(){ duplicate(m.id); });
    act("Exporter", function(){ exportJSON(m.id); });
    act("Supprimer", function(){
      confirmBox("Supprimer définitivement « " + m.title + " » ? Exporte-le d'abord si tu veux en garder une copie.", "Supprimer", function(){ Store.remove(m.id); renderLibrary(); }, true);
    }, "ghost danger-text");

    var s = Store.load(m.id);
    var stats = s ? (s.tables || []).filter(function(t){ return !t.parentId; }).length + " sections" : "";
    var c = h("article", {class:"lib-card" + (isTpl ? " is-template" : ""), tabindex:"0"}, [
      h("div", {class:"lib-card-kind", text: isTpl ? "Gabarit" : "Projet"}),
      h("h3", {text: m.title}),
      h("div", {class:"lib-card-meta"}, [
        h("span", {text: "Modifié le " + fmtDate(m.updatedAt)}),
        stats ? h("span", {text: stats}) : null,
        (!isTpl && m.fromTemplate) ? h("span", {text: "Gabarit : " + m.fromTemplate}) : null
      ]),
      menu
    ]);
    c.addEventListener("click", function(){ if (isTpl) newProject(m.id); else go("#/p/" + m.id); });
    c.addEventListener("keydown", function(e){ if (e.key === "Enter" && e.target === c) c.click(); });
    return c;
  }

  function section(title, hint, items, emptyText, headerBtn){
    var grid = h("div", {class:"lib-grid"});
    if (!items.length) grid.appendChild(h("div", {class:"lib-empty", text: emptyText}));
    items.forEach(function(m){ grid.appendChild(card(m)); });
    return h("section", {class:"lib-section"}, [
      h("div", {class:"lib-section-head"}, [h("div", {}, [h("h2", {text: title}), h("p", {class:"lib-hint", text: hint})]), headerBtn]),
      grid
    ]);
  }

  function renderLibrary(){
    libraryEl.innerHTML = "";
    var projects = Store.list("project");
    var templates = Store.list("template");
    var kb = Math.round(Store.usage() / 1024);

    libraryEl.appendChild(h("header", {class:"lib-top"}, [
      h("div", {class:"titleblock"}, [
        h("div", {class:"eyebrow", text:"Atelier de recherche"}),
        h("h1", {text:"Mes projets de recherche"}),
        h("p", {class:"sub", text:"Chaque projet est une cartographie modifiable : question, objectifs, concepts, méthodologie, éthique… Crée un projet à partir d'un gabarit, ou transforme un projet en gabarit pour le réutiliser."})
      ]),
      h("div", {class:"lib-toolbar"}, [
        h("button", {class:"btn primary", text:"+ Nouveau projet", onclick: function(){ newProject(); }}),
        h("button", {class:"btn", text:"Importer (.json)", onclick: importFile}),
        h("button", {class:"btn", text:"Tout sauvegarder (.json)", onclick: exportAll})
      ])
    ]));

    libraryEl.appendChild(section("Projets", "Tes recherches en cours.", projects, "Aucun projet pour l'instant — crée-en un à partir d'un gabarit.", null));
    libraryEl.appendChild(section("Gabarits", "Des structures de départ réutilisables. « Utiliser » crée un nouveau projet ; « Modifier » change le gabarit lui-même.", templates,
      "Aucun gabarit. Ouvre un projet et choisis « En faire un gabarit ».",
      h("button", {class:"btn small", text:"+ Gabarit vide", onclick: function(){
        promptBox("Nouveau gabarit", "Nom du gabarit", "", "Créer", function(v){
          var m = Store.create("template", {title:v, sub:"", showIntro:true, tags:[], tables:[], diagrams:[], links:[], order:[]});
          go("#/p/" + m.id);
        });
      }})));

    libraryEl.appendChild(h("footer", {class:"foot"}, [
      h("span", {text:"Tes données restent dans ce navigateur, sur cet appareil (" + kb + " Ko utilisés). Elles ne sont pas synchronisées : exporte une sauvegarde régulièrement."}),
      h("span", {text:"Atelier de recherche"})
    ]));
  }

  /* ---------------- routeur ---------------- */

  function go(hash){ if (location.hash === hash) route(); else location.hash = hash; }

  function openEditor(id, meta, state){
    document.title = meta.title + " · Atelier de recherche";
    Editor.open(state, {
      id: id, kind: meta.kind,
      save: function(s){ Store.save(id, s); document.title = (s.title || "Sans titre") + " · Atelier de recherche"; },
      onBack: function(){ go("#/"); },
      onExport: function(kind){
        if (kind === "json") exportJSON(id);
        else if (kind === "md") exportMarkdown(id);
        else if (kind === "template") saveAsTemplate(id);
      }
    });
  }

  function route(){
    var m = /^#\/p\/([\w-]+)/.exec(location.hash);
    if (m){
      var id = m[1];
      var meta = Store.meta(id), state = Store.load(id);
      if (!meta || !state){ toast("Projet introuvable."); go("#/"); return; }
      if (Editor.currentId() === id) return;
      Editor.close();
      libraryEl.hidden = true;
      openEditor(id, meta, state);
    } else {
      Editor.close();
      document.title = "Atelier de recherche";
      libraryEl.hidden = false;
      renderLibrary();
      window.scrollTo(0, 0);
    }
  }

  // Un autre onglet a modifié le projet ouvert : on recharge si rien n'est en cours ici.
  window.addEventListener("storage", function(e){
    var id = Editor.currentId();
    if (!e.key || e.key.indexOf(Store.PREFIX) !== 0) return;
    if (!id){ if (!libraryEl.hidden) renderLibrary(); return; }
    if (e.key === Store.DOC_KEY(id) && !Editor.isDirty() && !document.activeElement.isContentEditable){
      var meta = Store.meta(id), state = Store.load(id);
      if (meta && state){
        var y = window.scrollY;
        Editor.close();
        openEditor(id, meta, state);
        window.scrollTo(0, y);
      }
    }
  });

  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", function(){ Editor.flush(); });

  Store.seedIfEmpty();
  route();
})();
