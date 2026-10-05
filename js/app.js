// Coquille de l'application : bibliothèque de projets/gabarits, navigation, import/export.
(function(){
  "use strict";

  var libraryEl = document.getElementById("library");
  var localReason = null;

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

  // Ordre des gabarits : Projet de recherche (UQTR), puis les gabarits fournis dans l'ordre de
  // window.SEEDS_GABARITS (baccalauréat, maîtrise, doctorat), puis les gabarits personnels
  // (du plus récent au plus ancien, comme avant).
  function orderedTemplates(){
    var builtin = (window.SEEDS_GABARITS || []).map(function(seed){ return seed.key; });
    function rank(m){
      if (!m.builtinKey && m.title === "Projet de recherche (UQTR)") return 0;
      var i = m.builtinKey ? builtin.indexOf(m.builtinKey) : -1;
      if (i >= 0) return 1 + i;
      return m.builtinKey ? 1 + builtin.length : 2 + builtin.length;
    }
    return Store.list("template").map(function(m, i){ return {m:m, i:i}; })
      .sort(function(a, b){ return (rank(a.m) - rank(b.m)) || (a.i - b.i); })
      .map(function(x){ return x.m; });
  }

  function newProject(templateId){
    var templates = orderedTemplates();
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
    var linksByEntity = new Map();
    (state.links || []).forEach(function(link){ [link.a, link.b].forEach(function(id){ if (!linksByEntity.has(id)) linksByEntity.set(id, []); linksByEntity.get(id).push(link); }); });
    var anchorTypes = {question:"répond à", objectif:"répond à", axe:"s'inscrit dans", concept:"mobilise", theorie:"s'appuie sur", reference:"vient de la lecture de"};
    function inheritedAnchorType(table){
      var current = table;
      while (current){
        if (current.anchorType && anchorTypes[current.anchorType]) return current.anchorType;
        current = current.parentId ? state.tables.find(function(t){ return t.id === current.parentId; }) : null;
      }
      return null;
    }
    function anchorText(id){
      var m = /^r:([^:]+):([^:]+)$/.exec(id || ""), table = m && state.tables.find(function(t){ return t.id === m[1]; });
      var row = table && table.rows.find(function(r){ return r.id === m[2]; });
      if (!table || !row) return "(supprimé)";
      var col = table.columns.find(function(c){ return /^sources?$/i.test(c.label || ""); }) || table.columns[0];
      return htmlToText(row.cells[col.id] && row.cells[col.id].text) || "(sans titre)";
    }
    function linkNotes(entityId){
      return (linksByEntity.get(entityId) || []).map(function(link){
        var other = link.a === entityId ? link.b : (link.b === entityId ? link.a : null);
        if (!other || !/^r:/.test(other)) return null;
        var m = /^r:([^:]+):/.exec(other), table = m && state.tables.find(function(t){ return t.id === m[1]; });
        var type = table && inheritedAnchorType(table); if (!type) return null;
        return (anchorTypes[type] || "lié à") + " : " + anchorText(other);
      }).filter(Boolean);
    }
    function cellMd(c){
      if (!c) return "";
      var t = htmlToText(c.text).replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
      var tags = (c.tags || []).map(function(id){ return tagLabel[id]; }).filter(Boolean);
      return t + (tags.length ? " _(" + tags.join(", ") + ")_" : "");
    }
    function table(t, depth){
      if (t.ficheVersion === 2){
        out.push("## Référence", "", htmlToText(t.title || ""), "");
        (t.ficheItems || []).forEach(function(item){
          if (item.type === "row"){
            var ficheRow = (t.rows || []).find(function(row){ return row.id === item.id; });
            if (!ficheRow) return;
            var rubric = t.columns[0] && ficheRow.cells[t.columns[0].id] ? htmlToText(ficheRow.cells[t.columns[0].id].text) : "Rubrique";
            var answer = t.columns[1] && ficheRow.cells[t.columns[1].id] ? htmlToText(ficheRow.cells[t.columns[1].id].text) : "";
            out.push("**" + rubric + "** : " + answer, "");
          } else if (item.type === "table"){
            var embedded = state.tables.find(function(child){ return child.id === item.id; });
            if (!embedded) return;
            out.push("### " + (embedded.title || "Tableau"), "");
            out.push("| " + embedded.columns.map(function(col){ return htmlToText(col.label || "").replace(/\|/g,"\\|"); }).join(" | ") + " |");
            out.push("| " + embedded.columns.map(function(){ return "---"; }).join(" | ") + " |");
            embedded.rows.forEach(function(row){
              out.push("| " + embedded.columns.map(function(col){ return row.cells[col.id] ? cellMd(row.cells[col.id]) : ""; }).join(" | ") + " |");
            });
            out.push("");
          }
        });
        return;
      }
      out.push("#".repeat(Math.min(depth + 2, 6)) + " " + (t.title || "Tableau"), "");
      var cols = t.columns || [];
      var rows = t.rows || [], regularOpen = false;
      function openTable(){
        if (!cols.length || regularOpen) return;
        out.push("| " + cols.map(function(c){ return c.label || " "; }).join(" | ") + " |");
        out.push("|" + cols.map(function(){ return "---"; }).join("|") + "|");
        regularOpen = true;
      }
      rows.forEach(function(r){
        if (r.kind){
          if (regularOpen){ out.push(""); regularOpen = false; }
          var source = cols.find(function(c){ return /^sources?$/i.test(c.label || ""); }) || cols[0];
          var text = source && r.cells[source.id] ? htmlToText(r.cells[source.id].text) : "";
          if (text) out.push(r.kind === "header" ? "#### " + text : "*" + text + "*", "");
          return;
        }
        if (!cols.some(function(c){ return r.cells[c.id] && htmlToText(r.cells[c.id].text); })) return;
        openTable();
        out.push("| " + cols.map(function(c){ return cellMd(r.cells[c.id]); }).join(" | ") + " |");
        cols.forEach(function(c){
          var notes = linkNotes("t:" + t.id + ":" + r.id + ":" + c.id);
          if (notes.length) out.push("  *→ " + notes.join(" · ") + "*");
        });
      });
      if (regularOpen) out.push("");
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

  var CARD_COLORS = ["pink","violet","blue","teal","green","amber","coral","indigo"];
  var cardIndex = 0;
  function cardMenu(anchor, items){
    var old = document.querySelector(".lib-pop"); if (old) old.remove();
    var pop = h("div", {class:"pop menu-pop lib-pop", role:"menu"});
    items.forEach(function(it){
      pop.appendChild(h("button", {class:"menu-item" + (it.danger ? " danger" : ""), type:"button", role:"menuitem", text: it.label, onclick:function(e){ e.stopPropagation(); pop.remove(); it.fn(); }}));
    });
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + "px";
    pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - pop.offsetWidth - 10)) + "px";
    function away(ev){ if (!pop.contains(ev.target)){ pop.remove(); document.removeEventListener("mousedown", away, true); } }
    setTimeout(function(){ document.addEventListener("mousedown", away, true); }, 0);
  }

  function card(m){
    var isTpl = m.kind === "template";
    var menu = h("div", {class:"card-actions"});
    var items = [];
    function act(label, fn, danger){ items.push({label:label, fn:fn, danger:danger}); }
    var primary = isTpl
      ? h("button", {class:"btn small primary", text:"Utiliser ce gabarit", onclick:function(e){ e.stopPropagation(); newProject(m.id); }})
      : h("button", {class:"btn small primary", text:"Ouvrir", onclick:function(e){ e.stopPropagation(); go("#/p/" + m.id); }});
    menu.appendChild(primary);
    if (isTpl) act("Modifier le gabarit", function(){ go("#/p/" + m.id); });
    else act("En faire un gabarit", function(){ saveAsTemplate(m.id); });
    act("Renommer", function(){
      promptBox("Renommer", "Nouveau titre", m.title, "Renommer", function(v){ Store.rename(m.id, v); renderLibrary(); });
    });
    var admin = Cloud.isCloud() && Cloud.user() && Cloud.user().role === "admin";
    var published = isTpl && m.publishedKey && m.publishedVersion > 0;
    if (isTpl && admin && !m.builtinKey){
      act(published ? "Publier une nouvelle version…" : "Publier pour tous les comptes…", function(){ approvePublication(m); });
      if (published) act("Retirer la publication", function(){ unpublishTemplate(m); });
    }
    act("Dupliquer", function(){ duplicate(m.id); });
    act("Exporter (.json)", function(){ exportJSON(m.id); });
    act("Supprimer", function(){
      confirmBox("Supprimer définitivement « " + m.title + " » ? Exporte-le d'abord si tu veux en garder une copie.", "Supprimer", function(){ Store.remove(m.id); renderLibrary(); }, true);
    }, true);
    var more = h("button", {class:"btn small ghost card-more-lib", type:"button", title:"Plus d'actions", "aria-label":"Plus d'actions", text:"⋯"});
    more.addEventListener("click", function(e){ e.stopPropagation(); cardMenu(more, items); });
    menu.appendChild(more);

    var s = Store.load(m.id);
    var stats = s ? (s.tables || []).filter(function(t){ return !t.parentId; }).length + " sections" : "";
    var prog = null;
    if (s && !isTpl){
      try {
        var p = Editor.progressOf(Store.clone(s)), v = p.total ? Math.round(100 * p.filled / p.total) : 0;
        var bar = h("div", {class:"pbar"}); var fill = h("span"); fill.style.width = v + "%"; bar.appendChild(fill);
        prog = h("div", {class:"lib-card-progress"}, [bar, h("span", {text: v + " %"})]);
      } catch(e){}
    }
    var c = h("article", {class:"lib-card" + (isTpl ? " is-template" : ""), tabindex:"0", "data-sec": CARD_COLORS[(cardIndex++) % CARD_COLORS.length]}, [
      h("div", {class:"lib-card-kind"}, [h("span", {text: isTpl ? "Gabarit" : "Projet"}),
        published ? h("span", {class:"pub-badge", text:"Publié · v" + m.publishedVersion}) : null,
        isTpl && m.builtinKey && /^pub-/.test(m.builtinKey) ? h("span", {class:"pub-badge", text:"Fourni par l'administration"}) : null]),
      h("h3", {text: m.title}),
      prog,
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

  /* ---------------- publication des gabarits (administration) ---------------- */

  // Copie publiable : sans liens vers d'autres projets ni documents déposés (propres à ce compte).
  function publishableState(state){
    var copy = Store.clone(state);
    copy.links = (copy.links || []).filter(function(l){ return !/^@/.test(l.a || "") && !/^@/.test(l.b || ""); });
    (copy.tables || []).forEach(function(t){ if (t.documents) delete t.documents; });
    return copy;
  }

  function approvePublication(m){
    var state = Store.load(m.id);
    if (!state) return;
    var update = m.publishedKey && m.publishedVersion > 0;
    var sections = (state.tables || []).filter(function(t){ return !t.parentId; }).map(function(t){ return t.title || "(sans titre)"; });
    modal(function(box, close){
      box.classList.add("publish-modal");
      box.appendChild(h("h3", {text: update ? "Publier une nouvelle version" : "Approbation finale avant publication"}));
      box.appendChild(h("p", {text: update
        ? "La version " + (m.publishedVersion + 1) + " de « " + m.title + " » remplacera la copie des personnes qui ne l'ont pas modifiée. Les copies modifiées sont laissées telles quelles."
        : "« " + m.title + " » sera ajouté à la bibliothèque de tous les comptes, à leur prochaine ouverture de l'app. Chaque personne reçoit sa propre copie : elle pourra la modifier ou la supprimer sans toucher à la tienne."}));
      box.appendChild(h("p", {class:"publish-sections-title", text: sections.length + " section" + (sections.length > 1 ? "s" : "") + " :"}));
      box.appendChild(h("ol", {class:"publish-sections"}, sections.map(function(t){ return h("li", {text:t}); })));
      box.appendChild(h("p", {class:"publish-note", text:"Les liens vers tes autres projets et les documents déposés ne sont pas publiés."}));
      var check = h("input", {type:"checkbox", id:"publish-approve"});
      box.appendChild(h("label", {class:"publish-approve", for:"publish-approve"}, [check, h("span", {text:"J'ai relu ce gabarit et j'approuve sa publication pour tous les comptes."})]));
      var err = h("p", {class:"login-error", role:"alert"});
      box.appendChild(err);
      var publish = h("button", {class:"btn primary", type:"button", disabled:"disabled", text: update ? "Publier la nouvelle version" : "Publier", onclick:function(){
        publish.disabled = true; err.textContent = "";
        Cloud.request("POST", "/api/templates", {action:"publish", key: m.publishedKey || undefined, title: m.title, state: publishableState(state)}).then(function(res){
          if (!res.ok) throw new Error(res.data.error || "Publication impossible.");
          Store.patchMeta(m.id, {publishedKey: res.data.template.key, publishedVersion: res.data.template.version, pending: true});
          Cloud.push(m.id);
          close(); renderLibrary();
          toast(update ? "Nouvelle version publiée." : "Gabarit publié pour tous les comptes.");
        }).catch(function(e){ publish.disabled = false; err.textContent = e.message; });
      }});
      check.addEventListener("change", function(){ publish.disabled = !check.checked; });
      box.appendChild(h("div", {class:"row"}, [
        h("button", {class:"btn ghost", type:"button", text:"Relire le gabarit", onclick:function(){ close(); go("#/p/" + m.id); }}),
        h("button", {class:"btn ghost", type:"button", text:"Annuler", onclick:close}),
        publish
      ]));
    });
  }

  function unpublishTemplate(m){
    confirmBox("Retirer « " + m.title + " » du catalogue ? Les nouveaux comptes ne le recevront plus. Les personnes qui l'ont déjà gardent leur copie.", "Retirer la publication", function(){
      Cloud.request("POST", "/api/templates", {action:"unpublish", key:m.publishedKey}).then(function(res){
        if (!res.ok) throw new Error(res.data.error || "Action impossible.");
        Store.patchMeta(m.id, {publishedVersion: 0, pending: true});
        Cloud.push(m.id);
        renderLibrary(); toast("Publication retirée.");
      }).catch(function(e){ toast(e.message); });
    }, true);
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
    cardIndex = 0;
    var projects = Store.list("project");
    var templates = orderedTemplates();
    var kb = Math.round(Store.usage() / 1024);

    libraryEl.appendChild(h("header", {class:"lib-top"}, [
      h("div", {class:"titleblock"}, [
        h("div", {class:"eyebrow", text:"Atelier de recherche"}),
        h("h1", {text:"Mes projets de recherche"}),
        h("p", {class:"sub", text:"Chaque projet est une cartographie modifiable : question, objectifs, concepts, méthodologie, éthique… Crée un projet à partir d'un gabarit, ou transforme un projet en gabarit pour le réutiliser."})
      ]),
      h("div", {class:"lib-toolbar"}, [
        Cloud.isCloud() ? syncBadge() : null,
        Cloud.isCloud() && Cloud.user() ? h("button", {class:"btn lib-account", type:"button", text:"Mon compte · " + (Cloud.user().name || Cloud.user().email), onclick:openAccount}) : null,
        h("button", {class:"btn primary", text:"+ Nouveau projet", onclick: function(){ newProject(); }}),
        h("button", {class:"btn", text:"Importer (.json)", onclick: importFile}),
        h("button", {class:"btn", text:"Tout sauvegarder (.json)", onclick: exportAll})
      ])
    ]));

    libraryEl.appendChild(section("Projets", "Tes recherches en cours.", projects, "Aucun projet pour l'instant. Choisis plus bas le gabarit qui convient à tes besoins (baccalauréat, maîtrise, doctorat ou projet de recherche), puis « Utiliser ce gabarit ».", null));
    libraryEl.appendChild(section("Gabarits", "Des structures de départ réutilisables. « Utiliser » crée un nouveau projet ; « Modifier » change le gabarit lui-même.", templates,
      "Aucun gabarit. Ouvre un projet et choisis « En faire un gabarit ».",
      h("button", {class:"btn small", text:"+ Gabarit vide", onclick: function(){
        promptBox("Nouveau gabarit", "Nom du gabarit", "", "Créer", function(v){
          var m = Store.create("template", {title:v, sub:"", showIntro:true, tags:[], tables:[], diagrams:[], links:[], order:[]});
          go("#/p/" + m.id);
        });
      }})));

    var footLeft = Cloud.isCloud()
      ? h("span", {text:"Tes projets sont enregistrés en ligne et disponibles sur tous tes appareils. Une copie reste aussi sur cet appareil pour travailler hors ligne."})
      : h("span", {text: localReason === "not-configured"
          ? "Sauvegarde en ligne pas encore configurée dans Vercel : pour l'instant, les données restent sur cet appareil (" + kb + " Ko)."
          : "Mode local : les données restent dans ce navigateur (" + kb + " Ko). Exporte une sauvegarde régulièrement."});
    var footRight = Cloud.isCloud()
      ? h("button", {class:"btn small ghost", text:"Se déconnecter", onclick:function(){
          confirmBox("Se déconnecter ? Il faudra entrer ton courriel et ton mot de passe à nouveau sur cet appareil. Tes projets restent en ligne.", "Se déconnecter", signOut);
        }})
      : h("span", {text:"Atelier de recherche"});
    libraryEl.appendChild(h("footer", {class:"foot"}, [footLeft, footRight]));
  }

  /* ---------------- routeur ---------------- */

  function go(hash){ if (location.hash === hash) route(); else location.hash = hash; }

  function openEditor(id, meta, state){
    document.title = meta.title + " · Atelier de recherche";
    Editor.open(state, {
      id: id, kind: meta.kind, cloud: Cloud.isCloud(),
      initialStatus: Cloud.isCloud() ? (meta.pending ? (Cloud.status() === "offline" ? "offline" : "syncing") : "synced") : "saved",
      save: function(s){ Store.save(id, s); document.title = (s.title || "Sans titre") + " · Atelier de recherche"; },
      onBack: function(){ go("#/"); },
      onAccount: Cloud.isCloud() ? openAccount : null,
      onExport: function(kind){
        if (kind === "json") exportJSON(id);
        else if (kind === "md") exportMarkdown(id);
        else if (kind === "template") saveAsTemplate(id);
        else if (kind === "history") showHistory(id);
      }
    });
  }

  // Recharge le projet ouvert (arrivé d'un autre appareil/onglet) sans perdre la position.
  function reloadOpen(force){
    var id = Editor.currentId(); if (!id) return false;
    if (!force && (Editor.isDirty() || (document.activeElement && document.activeElement.isContentEditable))) return false;
    var meta = Store.meta(id), state = Store.load(id);
    if (!meta || !state){ toast("Ce projet a été supprimé sur un autre appareil."); go("#/"); return true; }
    var y = window.scrollY;
    Editor.close();
    openEditor(id, meta, state);
    window.scrollTo(0, y);
    return true;
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

  /* ---------------- versions précédentes ---------------- */

  function showHistory(id){
    modal(function(box, close){
      box.classList.add("history-modal");
      box.appendChild(h("h3", {text:"Versions précédentes"}));
      box.appendChild(h("p", {class:"lib-hint", text:"Une copie est archivée en ligne au plus toutes les 10 minutes pendant que tu travailles (60 dernières conservées). Restaurer remplace le contenu actuel ; la version actuelle est archivée avant."}));
      var list = h("div", {class:"history-list", text:"Chargement…"});
      box.appendChild(list);
      box.appendChild(h("div", {class:"row"}, [h("button", {class:"btn ghost", text:"Fermer", onclick: close})]));
      Editor.flush();
      Cloud.history(id).then(function(versions){
        list.textContent = "";
        if (!versions.length){ list.appendChild(h("p", {class:"lib-hint", text:"Aucune version archivée pour l'instant. Elles apparaîtront au fil de tes modifications."})); return; }
        versions.forEach(function(v){
          var when = new Date(v.t * 1000).toLocaleString("fr-CA", {weekday:"short", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit"});
          list.appendChild(h("div", {class:"history-row"}, [
            h("span", {}, [h("strong", {text: when}), h("small", {text: " · " + Math.max(1, Math.round(v.size / 1024)) + " Ko"})]),
            h("span", {class:"history-actions"}, [
              h("button", {class:"btn small ghost", text:"Copie", title:"Créer un nouveau projet à partir de cette version", onclick: function(){
                Cloud.version(id, v.i).then(function(d){
                  var st = d.state; st.title = (st.title || "Projet") + " — version du " + when;
                  var m = Store.meta(id);
                  Store.create(m ? m.kind : "project", st);
                  close(); toast("Copie créée dans « Mes projets ».");
                }).catch(function(e){ toast(e.message); });
              }}),
              h("button", {class:"btn small", text:"Restaurer", onclick: function(){
                confirmBox("Restaurer la version du " + when + " ? Le contenu actuel sera remplacé (il reste disponible dans l'historique).", "Restaurer", function(){
                  Cloud.version(id, v.i).then(function(d){
                    Store.save(id, d.state);
                    return Cloud.push(id, {snapshot:true});
                  }).then(function(){ close(); reloadOpen(true); toast("Version restaurée."); })
                    .catch(function(e){ toast(e.message); });
                });
              }})
            ])
          ]));
        });
      }).catch(function(e){ list.textContent = e.message; });
    });
  }

  /* ---------------- page d'accueil et connexion ---------------- */

  // Page d'accueil : présentation de l'app et formulaire (connexion, premier compte, nouveau mot de passe).
  function authPage(opts){
    Editor.close();
    libraryEl.hidden = false;
    libraryEl.innerHTML = "";
    var err = h("p", {class:"login-error", role:"alert", text: opts.message || ""});
    var btn = h("button", {class:"btn primary", type:"submit", text: opts.submit});
    var inputs = {};
    var fields = opts.fields.map(function(f){
      var input = h("input", {class:"field", type:f.type || "text", autocomplete:f.autocomplete || "off", required:"required"});
      inputs[f.name] = input;
      return h("label", {class:"login-field"}, [h("span", {text:f.label}), input]);
    });
    var form = h("form", {class:"login-card"}, [
      h("h2", {text: opts.title}),
      opts.intro ? h("p", {class:"sub", text: opts.intro}) : null
    ].concat(fields).concat([err, btn, opts.footer || null]));
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var values = {};
      Object.keys(inputs).forEach(function(k){ values[k] = inputs[k].value; });
      var problem = opts.check ? opts.check(values) : null;
      if (problem){ err.textContent = problem; return; }
      btn.disabled = true; err.textContent = "";
      opts.onSubmit(values).catch(function(e){ btn.disabled = false; err.textContent = e.message; });
    });
    libraryEl.appendChild(h("div", {class:"welcome"}, [
      h("section", {class:"welcome-intro"}, [
        h("div", {class:"eyebrow", text:"Atelier de recherche"}),
        h("h1", {text:"Ta recherche, reliée d'un bout à l'autre."}),
        h("p", {text:"Cartographie tes projets de recherche, rédige tes fiches de lecture, garde tes documents et relie tes idées d'un projet à l'autre. Tout est enregistré en ligne et disponible sur tous tes appareils."})
      ]),
      form
    ]));
    setTimeout(function(){ var first = form.querySelector("input"); if (first) first.focus(); }, 0);
  }

  function samePasswords(v){
    if ((v.next || "").length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
    if (v.next !== v.confirm) return "Les deux mots de passe ne sont pas identiques.";
    return null;
  }

  function renderLogin(message){
    authPage({
      title:"Connexion", intro:"Entre ton courriel et ton mot de passe pour retrouver tes projets.", message: message,
      fields:[{name:"email", label:"Courriel", type:"email", autocomplete:"username"}, {name:"password", label:"Mot de passe", type:"password", autocomplete:"current-password"}],
      submit:"Se connecter",
      footer: h("p", {class:"login-help", text:"Mot de passe oublié ? Demande une réinitialisation à la personne qui gère les comptes. Les comptes se créent sur invitation."}),
      onSubmit:function(v){ return Cloud.login(v.email, v.password).then(afterLogin); }
    });
  }

  function renderSetup(possible){
    if (!possible){
      authPage({title:"Configuration à terminer", intro:"Aucun compte n'existe encore, et l'ancien mot de passe de l'application (APP_PASSWORD) est absent de Vercel. Ajoute-le dans Vercel, puis recharge cette page pour créer le compte administrateur.", fields:[], submit:"Recharger", onSubmit:function(){ location.reload(); return Promise.resolve(); }});
      return;
    }
    authPage({
      title:"Créer ton compte", intro:"Première connexion depuis l'arrivée des comptes. Confirme avec le mot de passe actuel de l'application, puis choisis ton courriel et ton nouveau mot de passe. Ce compte (administrateur) garde tous tes projets, fiches et documents.",
      fields:[
        {name:"password", label:"Mot de passe actuel de l'application", type:"password", autocomplete:"current-password"},
        {name:"name", label:"Ton nom", autocomplete:"name"},
        {name:"email", label:"Ton courriel", type:"email", autocomplete:"username"},
        {name:"next", label:"Nouveau mot de passe (8 caractères ou plus)", type:"password", autocomplete:"new-password"},
        {name:"confirm", label:"Confirme le nouveau mot de passe", type:"password", autocomplete:"new-password"}
      ],
      submit:"Créer mon compte", check:samePasswords,
      onSubmit:function(v){ return Cloud.setup({password:v.password, name:v.name, email:v.email, newPassword:v.next}).then(afterLogin); }
    });
  }

  // Mot de passe provisoire (invitation ou réinitialisation) : à remplacer avant d'accéder aux projets.
  function renderForcePassword(){
    var user = Cloud.user() || {};
    authPage({
      title:"Choisis ton mot de passe", intro:"Bienvenue" + (user.name ? ", " + user.name : "") + " ! Remplace le mot de passe provisoire reçu par un mot de passe à toi.",
      fields:[
        {name:"current", label:"Mot de passe provisoire", type:"password", autocomplete:"current-password"},
        {name:"next", label:"Nouveau mot de passe (8 caractères ou plus)", type:"password", autocomplete:"new-password"},
        {name:"confirm", label:"Confirme le nouveau mot de passe", type:"password", autocomplete:"new-password"}
      ],
      submit:"Enregistrer et continuer", check:samePasswords,
      onSubmit:function(v){ return Cloud.changePassword(v.current, v.next).then(function(){ startCloud(); }); }
    });
  }

  function afterLogin(user){
    if (user && user.mustChange) renderForcePassword(); else startCloud();
  }

  /* ---------------- mon compte ---------------- */

  function openAccount(){
    var user = Cloud.user();
    if (!user) return;
    modal(function(box, close){
      box.classList.add("account-modal");
      box.appendChild(h("h3", {text:"Mon compte"}));
      box.appendChild(h("p", {class:"account-who"}, [h("strong", {text:user.name || user.email}), user.name ? h("span", {text:user.email}) : null, user.role === "admin" ? h("span", {class:"account-role", text:"Administration"}) : null]));
      var actions = h("div", {class:"account-actions"}, [
        h("button", {class:"btn", type:"button", text:"Changer mon mot de passe", onclick:function(){ close(); openPasswordChange(); }}),
        user.role === "admin" ? h("button", {class:"btn", type:"button", text:"Gérer les comptes", onclick:function(){ close(); openUsers(); }}) : null,
        h("button", {class:"btn ghost", type:"button", text:"Se déconnecter", onclick:function(){ close(); signOut(); }})
      ]);
      box.appendChild(actions);
      box.appendChild(h("div", {class:"row"}, [h("button", {class:"btn primary", type:"button", text:"Fermer", onclick:close})]));
    });
  }

  function signOut(){
    Editor.flush();
    Cloud.sync().catch(function(){}).then(function(){ return Cloud.logout(); }).then(function(){
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      renderLogin();
    });
  }

  function openPasswordChange(){
    modal(function(box, close){
      var fields = {}, err = h("p", {class:"login-error", role:"alert"});
      box.appendChild(h("h3", {text:"Changer mon mot de passe"}));
      [["current","Mot de passe actuel","current-password"],["next","Nouveau mot de passe (8 caractères ou plus)","new-password"],["confirm","Confirme le nouveau mot de passe","new-password"]].forEach(function(f){
        fields[f[0]] = h("input", {class:"field", type:"password", autocomplete:f[2]});
        box.appendChild(h("label", {class:"login-field"}, [h("span", {text:f[1]}), fields[f[0]]]));
      });
      box.appendChild(err);
      var save = h("button", {class:"btn primary", type:"button", text:"Enregistrer", onclick:function(){
        var v = {current:fields.current.value, next:fields.next.value, confirm:fields.confirm.value};
        var problem = samePasswords(v);
        if (problem){ err.textContent = problem; return; }
        save.disabled = true;
        Cloud.changePassword(v.current, v.next).then(function(){ close(); toast("Mot de passe changé. Tes autres appareils devront se reconnecter."); })
          .catch(function(e){ save.disabled = false; err.textContent = e.message; });
      }});
      box.appendChild(h("div", {class:"row"}, [h("button", {class:"btn ghost", type:"button", text:"Annuler", onclick:close}), save]));
    });
  }

  /* ---------------- gestion des comptes (administration) ---------------- */

  function usersApi(method, body){
    return Cloud.request(method, "/api/users", body).then(function(res){
      if (!res.ok) throw new Error(res.data.error || "Action impossible.");
      return res.data;
    });
  }

  // Montre un mot de passe provisoire à transmettre soi-même à la personne.
  // Montre le mot de passe provisoire et une invitation prête à envoyer : elle dirige simplement
  // la personne vers la page d'accueil, où elle se connecte puis choisit son gabarit.
  function showTempPassword(box, user, temp, intro, isReset){
    var home = location.origin + "/";
    var hello = "Bonjour" + (user.name ? " " + user.name : "") + ",";
    var message = isReset
      ? [hello, "", "Ton mot de passe de l'Atelier de recherche a été réinitialisé.", "", "Page d'accueil : " + home, "Courriel : " + user.email, "Mot de passe provisoire : " + temp, "", "Connecte-toi, puis choisis ton nouveau mot de passe."].join("\n")
      : [hello, "", "Tu as maintenant accès à l'Atelier de recherche.", "", "Page d'accueil : " + home, "Courriel : " + user.email, "Mot de passe provisoire : " + temp, "", "À ta première connexion, tu choisiras ton propre mot de passe. Tu pourras ensuite créer ton projet à partir du gabarit qui convient à tes besoins (baccalauréat, maîtrise, doctorat ou projet de recherche)."].join("\n");
    function copyButton(label, text){
      var button = h("button", {class:"btn small", type:"button", text:label, onclick:function(){
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ button.textContent = "Copié ✓"; }).catch(function(){ area.select(); });
        else area.select();
      }});
      return button;
    }
    var area = h("textarea", {class:"field invite-message", readonly:"readonly", rows:"9", "aria-label":"Message d'invitation à envoyer"});
    area.value = message;
    box.appendChild(h("div", {class:"temp-box", role:"status"}, [
      h("p", {text:intro}),
      h("p", {class:"temp-line"}, [h("span", {text:"Mot de passe provisoire : "}), h("code", {class:"temp-password", text:temp}), copyButton("Copier", temp)]),
      h("p", {class:"temp-line"}, [h("strong", {text:"Message à envoyer"}), copyButton("Copier l'invitation", message)]),
      area,
      h("small", {text:"Envoie ce message toi-même (courriel, Teams…) : le mot de passe provisoire ne sera plus affiché. La personne arrive sur la page d'accueil, se connecte et choisit son gabarit."})
    ]));
  }

  function openUsers(){
    modal(function(box, close){
      box.classList.add("users-modal");
      box.appendChild(h("h3", {text:"Gérer les comptes"}));
      box.appendChild(h("p", {class:"sub", text:"Les comptes se créent sur invitation. Chaque personne ne voit que ses propres projets, fiches et documents."}));
      var notice = h("div", {class:"users-notice"});
      var list = h("div", {class:"users-list", "aria-live":"polite"}, [h("p", {class:"lib-hint", text:"Chargement…"})]);
      var name = h("input", {class:"field", type:"text", placeholder:"Nom", "aria-label":"Nom de la personne"});
      var email = h("input", {class:"field", type:"email", placeholder:"Courriel", "aria-label":"Courriel de la personne"});
      var err = h("p", {class:"login-error", role:"alert"});
      var create = h("button", {class:"btn primary", type:"button", text:"Créer le compte", onclick:function(){
        if (!email.value.trim()){ err.textContent = "Indique le courriel de la personne."; email.focus(); return; }
        create.disabled = true; err.textContent = "";
        usersApi("POST", {action:"create", name:name.value, email:email.value}).then(function(d){
          create.disabled = false; name.value = ""; email.value = "";
          notice.innerHTML = ""; showTempPassword(notice, d.user, d.tempPassword, "Compte créé pour " + (d.user.name || d.user.email) + ".");
          load();
        }).catch(function(e){ create.disabled = false; err.textContent = e.message; });
      }});
      function act(user, action, label){
        return h("button", {class:"btn small" + (action === "disable" ? " ghost" : ""), type:"button", text:label, onclick:function(){
          var run = function(){
            usersApi("POST", {action:action, id:user.id}).then(function(d){
              notice.innerHTML = "";
              if (d.tempPassword) showTempPassword(notice, d.user, d.tempPassword, "Nouveau mot de passe provisoire pour " + (d.user.name || d.user.email) + ".", true);
              else toast(action === "disable" ? "Compte désactivé." : "Compte réactivé.");
              load();
            }).catch(function(e){ toast(e.message); });
          };
          if (action === "disable") confirmBox("Désactiver le compte de " + (user.name || user.email) + " ? La personne ne pourra plus se connecter ; ses données sont gardées.", "Désactiver", run, true);
          else if (action === "reset") confirmBox("Créer un nouveau mot de passe provisoire pour " + (user.name || user.email) + " ? L'ancien ne fonctionnera plus.", "Réinitialiser", run);
          else run();
        }});
      }
      function load(){
        usersApi("GET").then(function(d){
          list.innerHTML = "";
          var me = Cloud.user() || {};
          d.users.forEach(function(u){
            var state = u.disabled ? "Désactivé" : (u.mustChange ? "En attente de première connexion" : (u.lastLoginAt ? "Dernière connexion : " + fmtDate(u.lastLoginAt) : "Actif"));
            list.appendChild(h("div", {class:"user-row" + (u.disabled ? " disabled" : "")}, [
              h("div", {class:"user-main"}, [h("strong", {text:(u.name || u.email) + (u.id === me.id ? " (toi)" : "")}), h("span", {text:u.email}), h("small", {text:(u.role === "admin" ? "Administration · " : "") + state})]),
              u.id === me.id ? null : h("div", {class:"user-actions"}, [act(u, "reset", "Nouveau mot de passe"), u.disabled ? act(u, "enable", "Réactiver") : act(u, "disable", "Désactiver")])
            ]));
          });
        }).catch(function(e){ list.innerHTML = ""; list.appendChild(h("p", {class:"login-error", text:e.message})); });
      }
      box.appendChild(list);
      box.appendChild(h("h4", {text:"Inviter une personne"}));
      box.appendChild(h("div", {class:"users-create"}, [name, email, create]));
      box.appendChild(err);
      box.appendChild(notice);
      box.appendChild(h("div", {class:"row"}, [h("button", {class:"btn ghost", type:"button", text:"Fermer", onclick:close})]));
      load();
    });
  }

  function startCloud(){
    libraryEl.innerHTML = "";
    libraryEl.appendChild(h("p", {class:"lib-loading", text:"Synchronisation de tes projets…"}));
    Cloud.sync().then(function(res){
      // Seulement après une synchronisation réussie : sinon un 2e appareil créerait un doublon.
      if (!(res && res.ok)) return;
      Store.ensureBuiltinTemplates();
      return Cloud.publishedTemplates().then(function(list){ if (list.length) Store.ensureBuiltinTemplates(list); });
    }).then(function(){ route(); });
  }

  Cloud.hooks.onAuthLost = function(){ Editor.flush(); renderLogin("Ta session a expiré. Reconnecte-toi : tes modifications non envoyées sont gardées sur l'appareil."); };
  Cloud.hooks.onRemoteUpdate = function(ids){
    var open = Editor.currentId();
    if (open && ids.indexOf(open) >= 0){ if (reloadOpen(false)) toast("Mis à jour depuis un autre appareil."); }
    else if (!open && !libraryEl.hidden && !document.querySelector(".overlay")) renderLibrary();
  };
  Cloud.hooks.onConflict = function(id, copyId){
    if (Editor.currentId() === id) reloadOpen(true);
    else if (!libraryEl.hidden) renderLibrary();
    toast("Ce projet avait été modifié sur un autre appareil : la version en ligne est affichée, et tes changements d'ici sont gardés dans une copie.");
  };
  Cloud.onStatus(function(s){
    if (Editor.currentId()) Editor.setStatus(s);
    var el = document.querySelector(".lib-sync");
    if (el) el.replaceWith(syncBadge());
  });

  function syncBadge(){
    var s = Cloud.status();
    var label = {synced:"Tout est enregistré en ligne", syncing:"Synchronisation…", offline:"Hors ligne — modifications gardées sur l'appareil", error:"Problème de synchronisation", idle:"…"}[s] || "…";
    return h("span", {class:"lib-sync status " + ({synced:"saved", syncing:"saving", offline:"offline", error:"error"}[s] || "")}, [h("span", {class:"dot"}), h("span", {text:label})]);
  }

  // Un autre onglet a modifié le projet ouvert : on recharge si rien n'est en cours ici.
  window.addEventListener("storage", function(e){
    if (!e.key || e.key.indexOf(Store.PREFIX) !== 0) return;
    var id = Editor.currentId();
    if (!id){ if (!libraryEl.hidden && document.querySelector(".lib-top") && !document.querySelector(".overlay")) renderLibrary(); return; }
    if (e.key === Store.DOC_KEY(id)) reloadOpen(false);
  });

  window.addEventListener("hashchange", function(){ if (document.querySelector(".login-card")) return; route(); });
  window.addEventListener("beforeunload", function(e){
    Editor.flush();
    if (Cloud.isCloud() && Store.readIndex().some(function(m){ return m.pending; }) && navigator.onLine !== false){
      Cloud.sync();
    }
  });

  var isLocalStatic = location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "::1";
  (isLocalStatic ? Promise.resolve({mode:"local", reason:"local"}) : Cloud.init()).then(function(res){
    if (res.mode === "setup") return renderSetup(res.possible);
    if (res.mode === "login") return renderLogin();
    if (res.mode === "password") return renderForcePassword();
    if (res.mode === "cloud") return res.offline ? route() : startCloud();
    localReason = res.reason;
    Store.seedIfEmpty();
    Store.ensureBuiltinTemplates();
    route();
  });
})();
