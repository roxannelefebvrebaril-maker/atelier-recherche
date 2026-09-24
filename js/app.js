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
      h("div", {class:"lib-card-kind", text: isTpl ? "Gabarit" : "Projet"}),
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
    var templates = Store.list("template");
    var kb = Math.round(Store.usage() / 1024);

    libraryEl.appendChild(h("header", {class:"lib-top"}, [
      h("div", {class:"titleblock"}, [
        h("div", {class:"eyebrow", text:"Atelier de recherche"}),
        h("h1", {text:"Mes projets de recherche"}),
        h("p", {class:"sub", text:"Chaque projet est une cartographie modifiable : question, objectifs, concepts, méthodologie, éthique… Crée un projet à partir d'un gabarit, ou transforme un projet en gabarit pour le réutiliser."})
      ]),
      h("div", {class:"lib-toolbar"}, [
        Cloud.isCloud() ? syncBadge() : null,
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

    var footLeft = Cloud.isCloud()
      ? h("span", {text:"Tes projets sont enregistrés en ligne et disponibles sur tous tes appareils. Une copie reste aussi sur cet appareil pour travailler hors ligne."})
      : h("span", {text: localReason === "not-configured"
          ? "Sauvegarde en ligne pas encore configurée dans Vercel : pour l'instant, les données restent sur cet appareil (" + kb + " Ko)."
          : "Mode local : les données restent dans ce navigateur (" + kb + " Ko). Exporte une sauvegarde régulièrement."});
    var footRight = Cloud.isCloud()
      ? h("button", {class:"btn small ghost", text:"Se déconnecter de cet appareil", onclick:function(){
          confirmBox("Se déconnecter ? Il faudra entrer le mot de passe à nouveau sur cet appareil. Tes projets restent en ligne.", "Se déconnecter", function(){
            Cloud.sync().then(function(){ Cloud.logout(); renderLogin(); });
          });
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

  /* ---------------- connexion ---------------- */

  function renderLogin(message){
    Editor.close();
    libraryEl.hidden = false;
    libraryEl.innerHTML = "";
    var input = h("input", {class:"field", type:"password", autocomplete:"current-password", placeholder:"Mot de passe"});
    var err = h("p", {class:"login-error", text: message || ""});
    var btn = h("button", {class:"btn primary", text:"Se connecter"});
    function submit(e){
      if (e) e.preventDefault();
      if (!input.value) { input.focus(); return; }
      btn.disabled = true; err.textContent = "";
      Cloud.login(input.value).then(function(){ startCloud(); })
        .catch(function(e){ btn.disabled = false; err.textContent = e.message; input.select(); });
    }
    var form = h("form", {class:"login-card"}, [
      h("div", {class:"eyebrow", text:"Atelier de recherche"}),
      h("h1", {text:"Connexion"}),
      h("p", {class:"sub", text:"Entre le mot de passe de l'application pour retrouver tes projets, quel que soit l'appareil."}),
      input, err, btn
    ]);
    form.addEventListener("submit", submit);
    libraryEl.appendChild(form);
    setTimeout(function(){ input.focus(); }, 0);
  }

  function startCloud(){
    libraryEl.innerHTML = "";
    libraryEl.appendChild(h("p", {class:"lib-loading", text:"Synchronisation de tes projets…"}));
    Cloud.sync().then(function(){ route(); });
  }

  Cloud.hooks.onAuthLost = function(){ Editor.flush(); renderLogin("Ta session a expiré (le mot de passe a peut-être changé). Reconnecte-toi : tes modifications non envoyées sont gardées sur l'appareil."); };
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

  Cloud.init().then(function(res){
    if (res.mode === "login") return renderLogin();
    if (res.mode === "cloud") return res.offline ? route() : startCloud();
    localReason = res.reason;
    Store.seedIfEmpty();
    route();
  });
})();
