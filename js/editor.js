window.Editor = (function(){
  "use strict";

  var TAG_COLORS = ["blue","mauve","green","yellow","orange","pink"];
  var state = null;
  var lastSavedJson = null; // what was last written — lets a blur with no real change skip saving
  var persist = null;   // function(state) -> saves to the local store (set by open())
  var ctx = null;       // {id, kind, onBack, onExport} supplied by the app shell
  var armedEntity = null;
  var openPopover = null; // {el, close}
  var dimTag = null;
  var dimAnchor = null;
  var linkIndex = {byEntity:new Map(), byAnchor:new Map()};
  var contextEntity = null;
  var contextPanel = null;
  var recentAnchorsKey = null;
  var saveTimer = null;
  var saveStatus = "idle";
  var dirty = false; // true when this tab holds edits the server doesn't have yet — guards the safety-net saves below so a long-idle tab (stale local state) never overwrites newer content with nothing new to say
  // Remembers where the cursor was last placed (a cell, a column header, a table title, a diagram
  // title or node) so that "+ Colonne / + Ligne / + Sous-tableau / + Espace libre" buttons can
  // insert the new item right there instead of always at the very end.
  var lastFocus = {kind:null, tableId:null, rowId:null, colId:null, diagramId:null};

  function uid(prefix){ return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function el(tag, attrs, kids){
    var n = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs){
      if (attrs[k] === undefined || attrs[k] === null) continue;
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids||[]).forEach(function(c){ if (c) n.appendChild(c); });
    return n;
  }
  function entityKeyForCell(tableId,rowId,colId){ return "t:"+tableId+":"+rowId+":"+colId; }
  function findCell(entityId){
    var m = /^t:([^:]+):([^:]+):([^:]+)$/.exec(entityId);
    if (!m) return null;
    var table = state.tables.find(function(t){return t.id===m[1];});
    if (!table) return null;
    var row = table.rows.find(function(r){return r.id===m[2];});
    if (!row) return null;
    if (!row.cells[m[3]]) return null;
    return row.cells[m[3]];
  }
  function findNode(entityId){
    for (var i=0;i<state.diagrams.length;i++){
      var n = state.diagrams[i].nodes.find(function(n){return n.id===entityId;});
      if (n) return n;
    }
    return null;
  }
  function findNodeDiagram(entityId){
    return state.diagrams.find(function(d){ return d.nodes.some(function(n){return n.id===entityId;}); }) || null;
  }
  function isNodeEntity(entityId){ return !!findNode(entityId); }
  function getEntity(entityId){
    var anchor = anchorById(entityId);
    if (anchor) return {kind:"anchor", obj:anchor};
    if (isNodeEntity(entityId)) return { kind:"node", obj: findNode(entityId) };
    var c = findCell(entityId);
    return c ? { kind:"cell", obj:c } : null;
  }
  function stripHtml(html){
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent || "";
  }
  function normalizeText(text){ return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  var ANCHOR_TYPES = {
    question:{label:"Question / objet", color:"coral", verb:"répond à", icon:"question"},
    objectif:{label:"Objectif", color:"amber", verb:"répond à", icon:"target"},
    axe:{label:"Axe de recherche", color:"teal", verb:"s'inscrit dans", icon:"axis"},
    concept:{label:"Concept", color:"violet", verb:"mobilise", icon:"concept"},
    theorie:{label:"Théorie / auteur·e", color:"indigo", verb:"s'appuie sur", icon:"theory"},
    reference:{label:"Référence", color:"blue", verb:"vient de la lecture de", icon:"book"}
  };
  function inheritedAnchorType(table){
    var current = table;
    while (current){
      if (current.anchorType && ANCHOR_TYPES[current.anchorType]) return current.anchorType;
      current = current.parentId ? state.tables.find(function(t){ return t.id === current.parentId; }) : null;
    }
    return null;
  }
  function anchorId(tableId, rowId){ return "r:" + tableId + ":" + rowId; }
  function anchorById(id){
    var m = /^r:([^:]+):([^:]+)$/.exec(id || "");
    if (!m) return null;
    var table = state.tables.find(function(t){ return t.id === m[1]; });
    var row = table && table.rows.find(function(r){ return r.id === m[2]; });
    var type = table && inheritedAnchorType(table);
    if (!table || !row || row.kind || !type) return null;
    var first = table.columns && table.columns[0];
    var text = first && row.cells[first.id] ? stripHtml(row.cells[first.id].text).trim() : "";
    if (type === "reference"){
      var source = table.columns.find(function(c){ return /^sources?$/i.test(c.label || ""); }) || first;
      text = shortCitation(source && row.cells[source.id] ? stripHtml(row.cells[source.id].text) : text);
    }
    return {id:id, table:table, row:row, type:type, text:text || "(ancre sans titre)", fullText:first && row.cells[first.id] ? stripHtml(row.cells[first.id].text).trim() : text};
  }
  function shortCitation(text){
    var plain = stripHtml(text).replace(/\s+/g, " ").trim();
    var match = plain.match(/^(.+?)\s*\((\d{4})(?:\s*\[[^\]]+\])?\)/);
    if (!match) return plain.slice(0,40) + (plain.length > 40 ? "…" : "");
    var authors = match[1].replace(/\s*[,;:]\s*$/, "").trim();
    if (/\bet al\.?/i.test(authors)) authors = authors.replace(/\s+et al\.?/i, " et al.");
    else {
      var hasMultipleAuthors = /&|\bet\b/i.test(authors);
      var parts = hasMultipleAuthors ? authors.split(/\s*(?:&| et )\s*/i).map(function(part){ return part.trim(); }).filter(Boolean) : [authors.split(",")[0].trim()];
      var names = parts.map(function(part){
        if (part.indexOf(",") >= 0) return part.split(",")[0].trim();
        return part.split(/\s+/).filter(Boolean).pop().replace(/[,.;]$/, "");
      });
      if (names.length >= 3) authors = names[0] + " et al.";
      else if (names.length === 2) authors = names[0] + " et " + names[1];
      else authors = names[0] || authors.slice(0,40);
    }
    return authors + " (" + match[2] + ")";
  }
  function buildLinkIndex(){
    linkIndex = {byEntity:new Map(), byAnchor:new Map()};
    (state.links || []).forEach(function(link){
      [link.a, link.b].forEach(function(entity){
        if (!linkIndex.byEntity.has(entity)) linkIndex.byEntity.set(entity, []);
        linkIndex.byEntity.get(entity).push(link);
      });
      if (/^r:/.test(link.a)){ if (!linkIndex.byAnchor.has(link.a)) linkIndex.byAnchor.set(link.a, []); linkIndex.byAnchor.get(link.a).push(link); }
      if (/^r:/.test(link.b)){ if (!linkIndex.byAnchor.has(link.b)) linkIndex.byAnchor.set(link.b, []); linkIndex.byAnchor.get(link.b).push(link); }
    });
  }

  // Makes pasting into a contenteditable field strip whatever formatting the copied text
  // carried (fonts, colors, bold, bullet styles from Word/Google Docs/web pages…) so pasted
  // text always comes in looking like the rest of the tool, never like where it came from.
  function plainPaste(elmt){
    elmt.addEventListener("paste", function(e){
      e.preventDefault();
      var cd = e.clipboardData || window.clipboardData;
      var text = cd ? cd.getData("text/plain") : "";
      if (!text) return;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
      elmt.dispatchEvent(new Event("input", {bubbles:true}));
    });
  }
  function entityLabel(entityId){
    var e = getEntity(entityId);
    if (!e) return "(supprimé)";
    if (e.kind === "anchor") return e.obj.fullText || e.obj.text;
    if (e.kind === "node") return stripHtml(e.obj.text) || "(sans titre)";
    var m = /^t:([^:]+):([^:]+):([^:]+)$/.exec(entityId);
    var table = state.tables.find(function(t){return t.id===m[1];});
    var col = table ? table.columns.find(function(c){return c.id===m[3];}) : null;
    var text = stripHtml(e.obj.text).trim();
    var short = text.length>46 ? text.slice(0,46)+"…" : text;
    return (table?table.title:"Tableau") + " · " + (col?col.label:"") + (short ? " — "+short : "");
  }
  function linksFor(entityId){
    return linkIndex.byEntity.get(entityId) || [];
  }
  function tagById(id){ return state.tags.find(function(t){return t.id===id;}); }

  /* ================= NOUVELLE INTERFACE : barre latérale + une section à la fois ================= */

  var activeSection = null;   // id de la section affichée, ou null = vue d'ensemble
  var activeChild = null;     // id du sous-tableau affiché dans une section à cartes
  var activeSubchild = null;  // id virtuel du sous-titre affiché dans un chapitre
  var SECTION_COLORS = ["coral","amber","green","teal","blue","violet","pink","indigo"];
  var TAGCOLOR_TO_SECTION = {blue:"blue", mauve:"violet", green:"green", yellow:"amber", orange:"coral", pink:"pink"};

  var ICONS = {
    back:'<path d="M15 18l-6-6 6-6"/>', next:'<path d="M9 18l6-6-6-6"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', link:'<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5"/>',
    tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>', shape:'<rect x="4" y="6" width="16" height="12" rx="3"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6"/>',
    download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', drag:'<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>', trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    palette:'<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
    table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>', canvas:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M14 15l3-3"/>',
    column:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>', close:'<path d="M6 6l12 12M18 6L6 18"/>'
    ,anchor:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>', question:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6"/>', target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', axis:'<path d="M5 19V5M5 19h14M9 15l3-3 3 2 4-6"/>', concept:'<path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.8.6-1 1.1-1 2H9c0-.9-.2-1.4-1-2z"/>', theory:'<path d="M4 19h16M6 17V9M10 17V6M14 17V9M18 17V4"/>', book:'<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4zM5 20h14"/>'
  };
  function icon(name, extraClass){
    var s = document.createElement("span");
    s.className = "ico" + (extraClass ? " " + extraClass : "");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + '</svg>';
    return s;
  }
  function iconBtn(name, label, onclick, cls){
    var b = el("button", {class:"ibtn " + (cls || ""), title:label, "aria-label":label, type:"button"});
    b.appendChild(icon(name));
    if (onclick) b.addEventListener("click", onclick);
    return b;
  }
  function btn(iconName, label, onclick, cls){
    var b = el("button", {class:"btn " + (cls || ""), type:"button"});
    if (iconName) b.appendChild(icon(iconName));
    b.appendChild(el("span", {text: label}));
    if (onclick) b.addEventListener("click", onclick);
    return b;
  }

  /* ---------- sections & avancement ---------- */

  function topSections(){
    normalizeOrder();
    return state.order.map(function(id){
      var t = state.tables.find(function(x){ return x.id===id; });
      if (t) return {kind:"table", id:id, obj:t};
      var d = state.diagrams.find(function(x){ return x.id===id; });
      return d ? {kind:"diagram", id:id, obj:d} : null;
    }).filter(Boolean);
  }
  function sectionColor(sec, index){
    if (sec.obj.color && TAGCOLOR_TO_SECTION[sec.obj.color]) return TAGCOLOR_TO_SECTION[sec.obj.color];
    // Couleur stable, tirée de l'identifiant : elle ne change pas quand on réordonne les sections.
    var h = 0, id = String(sec.id);
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return SECTION_COLORS[h % SECTION_COLORS.length];
  }
  function titleOf(obj){ return stripHtml(obj.title || "").trim() || "(sans titre)"; }

  // Quelles colonnes sont « à remplir » : d'abord Rédaction/Réponses, sinon Notes/Contenu…,
  // sinon toutes sauf la première (qui porte en général la consigne).
  function answerColumns(t){
    var cols = t.columns || [];
    if (cols.length <= 1) return cols;
    var strong = cols.filter(function(c){ return /r[ée]daction|r[ée]ponse|r[ée]sum[ée]/i.test(c.label || ""); });
    if (strong.length) return strong;
    var soft = cols.slice(1).filter(function(c){ return /note|r[ée]flexion|contenu|information|d[ée]tail|moyen|d[ée]finition|explication/i.test(c.label || ""); });
    return soft.length ? soft : cols.slice(1);
  }
  function tableProgress(t){
    var total = 0, filled = 0;
    answerColumns(t).forEach(function(c){
      (t.rows || []).forEach(function(r){
        if (r.kind) return;
        total++;
        var cell = r.cells[c.id];
        if (cell && stripHtml(cell.text).trim()) filled++;
      });
    });
    state.tables.filter(function(x){ return x.parentId===t.id; }).forEach(function(ch){ var p = tableProgress(ch); total += p.total; filled += p.filled; });
    state.diagrams.filter(function(x){ return x.parentId===t.id; }).forEach(function(d){ var p = diagramProgress(d); total += p.total; filled += p.filled; });
    return {total:total, filled:filled};
  }
  function diagramProgress(d){
    var has = (d.nodes && d.nodes.length) || (d.notes || []).some(function(n){ return stripHtml(n.text).trim(); });
    return {total:1, filled: has ? 1 : 0};
  }
  function sectionProgress(sec){ return sec.kind === "table" ? tableProgress(sec.obj) : diagramProgress(sec.obj); }
  function sectionChildren(t){
    return state.tables.filter(function(x){ return x.parentId === t.id; }).map(function(x){ return {kind:"table", id:x.id, obj:x}; })
      .concat(state.diagrams.filter(function(x){ return x.parentId === t.id; }).map(function(x){ return {kind:"diagram", id:x.id, obj:x}; }));
  }
  function isCardSection(t){ return !!t && !(t.columns || []).length && t.cards !== false && sectionChildren(t).length >= 2; }
  function subtitleGroups(t){
    var groups = [], current = null;
    (t.rows || []).forEach(function(row){
      if (row.kind === "header"){
        current = {id:"sub:" + t.id + ":" + row.id, table:t, header:row, title:subtitleText(t, row), rows:[]};
        groups.push(current);
      } else if (current && !row.kind){ current.rows.push(row); }
    });
    return groups;
  }
  function subtitleText(t, row){
    var source = (t.columns || []).find(function(c){ return /^sources?$/i.test(c.label || ""); }) || t.columns[0];
    return source && row.cells[source.id] ? stripHtml(row.cells[source.id].text).trim() : "Sous-titre";
  }
  function subtitleGroupForRow(t, rowId){
    return subtitleGroups(t).find(function(group){ return group.rows.some(function(row){ return row.id === rowId; }); }) || null;
  }
  function isSubtitleCardChapter(t){ return !!t && subtitleGroups(t).length >= 2; }
  function directChildFor(id){
    var current = state.tables.find(function(t){ return t.id === id; });
    if (current && current.parentId){
      while (current.parentId){
        var parent = state.tables.find(function(t){ return t.id === current.parentId; });
        if (!parent || !parent.parentId) return current.id;
        current = parent;
      }
    }
    current = state.diagrams.find(function(d){ return d.id === id; });
    if (current && current.parentId){
      while (current.parentId){
        var diagramParent = state.tables.find(function(t){ return t.id === current.parentId; });
        if (!diagramParent || !diagramParent.parentId) return current.id;
        current = diagramParent;
      }
    }
    return null;
  }
  function pct(p){ return p.total ? Math.round(100 * p.filled / p.total) : 0; }
  function progressBar(p, cls){
    var bar = el("div", {class:"pbar " + (cls || ""), role:"progressbar", "aria-valuemin":"0", "aria-valuemax":"100", "aria-valuenow": String(pct(p))});
    var fill = el("span"); fill.style.width = pct(p) + "%";
    bar.appendChild(fill);
    return bar;
  }
  function progressRing(p, size){
    var r = 15.5, c = 2 * Math.PI * r, v = pct(p);
    var wrap = el("span", {class:"pring", title: p.filled + " / " + p.total + " cases remplies"});
    wrap.innerHTML = '<svg viewBox="0 0 36 36" width="'+(size||22)+'" height="'+(size||22)+'"><circle cx="18" cy="18" r="'+r+'" class="pr-bg"/><circle cx="18" cy="18" r="'+r+'" class="pr-fg" stroke-dasharray="'+c+'" stroke-dashoffset="'+(c*(1-v/100))+'" transform="rotate(-90 18 18)"/>' + (v === 100 ? '<path d="M11.5 18.5l4.5 4.5 8.5-9" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' : '') + '</svg>';
    if (v === 100) wrap.classList.add("done");
    return wrap;
  }

  /* ---------- mémoire de la section ouverte (par projet, sur cet appareil) ---------- */
  function viewKey(){ return "atelier-recherche:view:" + (ctx && ctx.id); }
  function setSection(id, opts){
    var ae = document.activeElement;
    if (ae && ae.isContentEditable && document.getElementById("app").contains(ae)) ae.blur();
    activeSection = id;
    if (!(opts && opts.child)) { activeChild = null; activeSubchild = null; }
    try { if (id) localStorage.setItem(viewKey(), id); else localStorage.removeItem(viewKey()); } catch(e){}
    document.body.classList.remove("nav-open");
    render();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }
  function setChild(id){
    var ae = document.activeElement;
    if (ae && ae.isContentEditable && document.getElementById("app").contains(ae)) ae.blur();
    activeChild = id;
    activeSubchild = null;
    try {
      if (id) localStorage.setItem(viewKey() + ":child:" + activeSection, id);
      else localStorage.removeItem(viewKey() + ":child:" + activeSection);
    } catch(e){}
    document.body.classList.remove("nav-open");
    render();
    window.scrollTo(0, 0);
  }
  function setSubchild(id){
    var ae = document.activeElement;
    if (ae && ae.isContentEditable && document.getElementById("app").contains(ae)) ae.blur();
    activeSubchild = id;
    try {
      if (id) localStorage.setItem(viewKey() + ":subchild:" + activeChild, id);
      else localStorage.removeItem(viewKey() + ":subchild:" + activeChild);
    } catch(e){}
    document.body.classList.remove("nav-open");
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- rendu principal ---------- */

  function render(){
    var app = document.getElementById("app");
    app.innerHTML = "";
    buildLinkIndex();
    normalizeOrder();
    var secs = topSections();
    if (activeSection && !secs.some(function(s){ return s.id===activeSection; })) activeSection = null;
    if (activeSection && activeChild){
      var activeTop = state.tables.find(function(t){ return t.id === activeSection; });
      if (!activeTop || !isCardSection(activeTop) || directChildFor(activeChild) !== activeChild) activeChild = null;
    }
    if (activeSubchild && (!activeChild || !state.tables.some(function(t){ return subtitleGroups(t).some(function(g){ return g.id === activeSubchild; }); }))) activeSubchild = null;

    var shell = el("div", {class:"ed-shell"});
    shell.appendChild(el("div", {class:"nav-scrim", onclick:function(){ document.body.classList.remove("nav-open"); }}));
    shell.appendChild(renderSidebar(secs));
    var main = el("main", {class:"ed-main"});
    main.appendChild(renderHeaderBar(secs));
    if (!state.tables.some(function(t){ return t.anchorType; }) && !localStorage.getItem("atelier-recherche:anchors-seen:" + (ctx && ctx.id))) main.appendChild(renderAnchorAssistantBanner());
    if (armedEntity) main.appendChild(el("div", {class:"link-banner"}, [
      icon("link"), el("span", {text:"Mode liaison : clique l'icône de lien d'une autre case (dans n'importe quelle section) pour les relier."}),
      el("button", {class:"btn small", text:"Annuler (Échap)", onclick:function(){ armedEntity=null; render(); }})
    ]));
    var content = el("div", {class:"ed-content"});
    if (activeSection) renderSectionView(content, secs);
    else renderOverview(content, secs);
    main.appendChild(content);
    shell.appendChild(main);
    app.appendChild(shell);
    applyDim();
  }

  function renderAnchorAssistantBanner(){
    var banner = el("div", {class:"anchor-assistant-banner"}, [
      el("span", {text:"Organise tes liens : indique quels tableaux contiennent tes objectifs, concepts, théories…"}),
      el("button", {class:"btn small", type:"button", text:"Organiser", onclick:openAnchorAssistant}),
      el("button", {class:"ibtn", type:"button", title:"Fermer", "aria-label":"Fermer", text:"×", onclick:function(){ try { localStorage.setItem("atelier-recherche:anchors-seen:" + (ctx && ctx.id), "1"); } catch(e){} render(); }})
    ]);
    return banner;
  }
  function suggestedAnchorType(title){
    var text = normalizeText(title);
    if (/question de recherche|objet/.test(text)) return "question";
    if (/objectif/.test(text)) return "objectif";
    if (/axe/.test(text)) return "axe";
    if (/concept/.test(text)) return "concept";
    if (/theorie/.test(text)) return "theorie";
    if (/reference|bibliograph/.test(text)) return "reference";
    return "";
  }
  function openAnchorAssistant(){
    try { localStorage.setItem("atelier-recherche:anchors-seen:" + (ctx && ctx.id), "1"); } catch(e){}
    var overlay = el("div", {class:"overlay"}), box = el("div", {class:"modal anchor-assistant", role:"dialog", "aria-modal":"true"});
    box.appendChild(el("h3", {text:"Organiser les référentiels"}));
    box.appendChild(el("p", {text:"Ces suggestions ne seront appliquées qu’après ta confirmation."}));
    var rows = [];
    state.tables.filter(function(t){ return !t.parentId; }).forEach(function(table){
      var suggested = suggestedAnchorType(table.title);
      var select = el("select", {class:"field"});
      select.appendChild(el("option", {value:"", text:"Aucun"}));
      Object.keys(ANCHOR_TYPES).forEach(function(type){ select.appendChild(el("option", {value:type, text:ANCHOR_TYPES[type].label})); });
      select.value = suggested;
      var check = el("input", {type:"checkbox", checked:suggested ? "checked" : null});
      var row = el("label", {class:"anchor-assistant-row"}, [check, el("span", {text:titleOf(table)}), select]);
      rows.push({table:table, check:check, select:select}); box.appendChild(row);
    });
    function close(){ overlay.remove(); }
    box.appendChild(el("div", {class:"row"}, [el("button", {class:"btn ghost", text:"Annuler", onclick:close}), el("button", {class:"btn primary", text:"Appliquer", onclick:function(){ rows.forEach(function(item){ if (item.check.checked && item.select.value) item.table.anchorType = item.select.value; else delete item.table.anchorType; }); scheduleSave(true); close(); render(); }})]));
    overlay.appendChild(box); overlay.addEventListener("mousedown", function(e){ if (e.target === overlay) close(); }); document.body.appendChild(overlay);
  }

  function renderSidebar(secs){
    var side = el("aside", {class:"ed-sidebar", "aria-label":"Sections du projet"});
    var top = el("div", {class:"sb-top"});
    top.appendChild(btn("back", "Mes projets", function(){ if (ctx && ctx.onBack) ctx.onBack(); }, "ghost sb-back"));
    top.appendChild(iconBtn("close", "Fermer le menu", function(){ document.body.classList.remove("nav-open"); }, "sb-close"));
    side.appendChild(top);

    var total = {total:0, filled:0};
    secs.forEach(function(s){ var p = sectionProgress(s); total.total += p.total; total.filled += p.filled; });
    side.appendChild(el("div", {class:"sb-project"}, [
      el("div", {class:"sb-kind", text: ctx && ctx.kind === "template" ? "Gabarit" : "Projet"}),
      el("div", {class:"sb-title", text: stripHtml(state.title) || "Sans titre"}),
      el("div", {class:"sb-progress"}, [progressBar(total), el("span", {text: pct(total) + " %"})])
    ]));

    var ov = el("button", {class:"sb-item sb-overview" + (!activeSection ? " active" : ""), type:"button", onclick:function(){ setSection(null); }}, [icon("grid"), el("span", {class:"sb-label", text:"Vue d'ensemble"})]);
    side.appendChild(ov);
    side.appendChild(el("div", {class:"sb-heading", text:"Sections"}));

    var list = el("ul", {class:"sb-list"});
    secs.forEach(function(s, i){
      var color = sectionColor(s, i);
      var p = sectionProgress(s);
      var li = el("li", {class:"sb-li", "data-sec": color});
      var handle = el("span", {class:"sb-drag", title:"Glisser pour réordonner"}); handle.appendChild(icon("drag"));
      var item = el("button", {class:"sb-item" + (activeSection===s.id ? " active" : ""), type:"button", onclick:function(){ setSection(s.id); }}, [
        el("span", {class:"sb-num", text: String(i + 1)}),
        el("span", {class:"sb-label", text: titleOf(s.obj)}),
        progressRing(p, 20)
      ]);
      li.appendChild(handle); li.appendChild(item);
      makeReorderable(handle, li, s.id);
      if (activeSection === s.id && s.kind === "table" && isCardSection(s.obj)){
        var kids = navNodeForTable(s.obj, 0).children;
        if (kids.length){
          var sub = el("ul", {class:"sb-sub"});
          kids.forEach(function(n, childIndex){
            var childObj = state.tables.find(function(t){ return t.id === n.id; }) || state.diagrams.find(function(d){ return d.id === n.id; });
            var short = childObj && childObj.title ? shortChildTitle(childObj.title, childIndex) : n.title;
            var childColor = childObj && childObj.color && TAGCOLOR_TO_SECTION[childObj.color] ? TAGCOLOR_TO_SECTION[childObj.color] : sectionColor({id:n.id, obj:childObj}, childIndex);
            sub.appendChild(el("li", {}, [el("button", {class:"sb-subitem" + (activeChild === n.id ? " active" : ""), type:"button", style:"padding-left:10px", onclick:function(){ setChild(n.id); }}, [el("span", {class:"sb-child-dot", "data-sec":childColor}), el("span", {text:short})])]));
            if (childObj && childObj.columns && isSubtitleCardChapter(childObj) && activeChild === n.id){
              subtitleGroups(childObj).forEach(function(group, groupIndex){
                sub.appendChild(el("li", {}, [el("button", {class:"sb-subitem sb-subtitle" + (activeSubchild === group.id ? " active" : ""), type:"button", style:"padding-left:28px", text:String(groupIndex + 1) + " · " + group.title, onclick:function(){ setSubchild(group.id); }})]));
              });
            }
          });
          li.appendChild(sub);
        }
      }
      list.appendChild(li);
    });
    side.appendChild(list);

    side.appendChild(el("div", {class:"sb-add"}, [
      btn("plus", "Nouvelle section", function(){ addTopTable(); }, "ghost small"),
      btn("canvas", "Espace libre", function(){ addTopDiagram(); }, "ghost small"),
      btn("download", "Importer une section", importSection, "ghost small")
    ]));
    return side;
  }

  function addTopTable(){
    var t = {id:uid("tbl"), title:"Nouvelle section", columns:[{id:uid("col"),label:"Consigne"},{id:uid("col"),label:"Rédaction"}], rows:[{id:uid("row"),cells:{}}]};
    t.columns.forEach(function(c){ t.rows[0].cells[c.id] = {text:"", tags:[]}; });
    state.tables.push(t);
    if (activeSection){ var i = state.order.indexOf(activeSection); state.order.splice(i+1, 0, t.id); } else state.order.push(t.id);
    scheduleSave(true); setSection(t.id);
    setTimeout(function(){ var h = document.querySelector('[data-table-title="'+t.id+'"]'); if (h){ h.focus(); document.execCommand && document.execCommand("selectAll"); } }, 0);
  }
  function addTopDiagram(){
    var d = {id:uid("dgr"), title:"Nouvel espace libre", nodes:[], arrows:[], notes:[]};
    state.diagrams.push(d);
    if (activeSection){ var i = state.order.indexOf(activeSection); state.order.splice(i+1, 0, d.id); } else state.order.push(d.id);
    scheduleSave(true); setSection(d.id);
  }

  function importSection(){
    var input = el("input", {type:"file", accept:".json,application/json"});
    input.addEventListener("change", function(){
      var file = input.files && input.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function(){
        var data;
        try { data = JSON.parse(reader.result); }
        catch(e){ showToast("Import impossible : le fichier n'est pas un JSON valide."); return; }
        if (!data || data.format !== "atelier-recherche/section"){
          showToast("Import impossible : ce fichier n'est pas une section Atelier de recherche."); return;
        }
        var title = stripHtml(data.section && data.section.title || "Section importée").trim() || "Section importée";
        var duplicateKey = title.normalize("NFC").toLowerCase();
        var duplicate = state.tables.some(function(t){ return !t.parentId && titleOf(t).normalize("NFC").toLowerCase() === duplicateKey; });
        var proceed = function(){ mergeImportedSection(data, title); };
        if (duplicate) askConfirm("Une section « " + title + " » existe déjà. L'importer quand même ?", proceed, "Importer");
        else proceed();
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function mergeImportedSection(data, title){
    var sourceSection = data.section || {id:"section", title:title, columns:[], rows:[]};
    var idMap = {};
    function remap(kind, oldId){
      if (!oldId) return oldId;
      if (!idMap[oldId]) idMap[oldId] = uid(kind);
      return idMap[oldId];
    }
    var importedTags = data.tags || [];
    var tagMap = {};
    importedTags.forEach(function(tag){
      var key = String(tag.label || "").trim().normalize("NFC").toLowerCase();
      var existing = state.tags.find(function(t){ return String(t.label || "").trim().normalize("NFC").toLowerCase() === key; });
      tagMap[tag.id] = existing ? existing.id : uid("tag");
      if (!existing) state.tags.push({id:tagMap[tag.id], label:tag.label || "Repère", color:tag.color || "blue"});
    });
    function copyRow(row){
      var copy = {id:remap("row", row.id), cells:{}};
      if (row.kind) copy.kind = row.kind;
      Object.keys(row.cells || {}).forEach(function(colId){
        var cell = row.cells[colId] || {};
        copy.cells[colId] = {text:cell.text || "", tags:(cell.tags || []).map(function(tagId){ return tagMap[tagId] || tagId; })};
      });
      return copy;
    }
    function copyTable(table, isRoot){
      var copy = {id:remap("tbl", table.id), title:table.title || "Tableau", columns:JSON.parse(JSON.stringify(table.columns || [])), rows:(table.rows || []).map(copyRow)};
      if (!isRoot && table.parentId) copy.parentId = remap("tbl", table.parentId);
      if (table.color) copy.color = table.color;
      if (table.rowLines) copy.rowLines = table.rowLines;
      if (table.view) copy.view = table.view;
      if (table.anchorType) copy.anchorType = table.anchorType;
      return copy;
    }
    var root = copyTable({id:sourceSection.id, title:title, columns:sourceSection.columns || [], rows:sourceSection.rows || []}, true);
    var importedTables = [root].concat((data.tables || []).map(function(t){ return copyTable(t, false); }));
    importedTables.forEach(function(t){ state.tables.push(t); });
    (data.diagrams || []).forEach(function(diagram){
      var copy = JSON.parse(JSON.stringify(diagram));
      copy.id = remap("dgr", diagram.id);
      if (diagram.parentId) copy.parentId = remap("tbl", diagram.parentId);
      (copy.nodes || []).forEach(function(node){ node.id = remap("node", node.id); node.tags = (node.tags || []).map(function(tagId){ return tagMap[tagId] || tagId; }); });
      (copy.notes || []).forEach(function(note){ note.id = remap("note", note.id); });
      state.diagrams.push(copy);
    });
    (data.links || []).forEach(function(link){
      var copy = JSON.parse(JSON.stringify(link));
      ["a","b"].forEach(function(side){
        var m = /^t:([^:]+):([^:]+):([^:]+)$/.exec(copy[side] || "");
        if (m) copy[side] = entityKeyForCell(remap("tbl", m[1]), remap("row", m[2]), m[3]);
        var a = /^r:([^:]+):([^:]+)$/.exec(copy[side] || "");
        if (a) copy[side] = anchorId(remap("tbl", a[1]), remap("row", a[2]));
        else if (idMap[copy[side]]) copy[side] = idMap[copy[side]];
      });
      state.links.push(copy);
    });
    state.order.push(root.id);
    var refs = importedTables.reduce(function(total, table){ return total + (table.rows || []).filter(function(row){ return !row.kind; }).length; }, 0);
    scheduleSave(true);
    setSection(root.id);
    showToast("Section importée : " + refs + " références dans " + (data.tables || []).length + " chapitres");
  }

  function renderHeaderBar(secs){
    var bar = el("div", {class:"ed-header"});
    bar.appendChild(iconBtn("menu", "Afficher les sections", function(){ document.body.classList.add("nav-open"); }, "hb-menu"));
    var crumb = el("div", {class:"hb-crumb"});
    if (activeSection){
      var idx = secs.findIndex(function(s){ return s.id===activeSection; });
      crumb.appendChild(el("span", {class:"hb-count", text:"Section " + (idx+1) + " sur " + secs.length}));
      if (activeChild){
        var child = state.tables.find(function(t){ return t.id === activeChild; }) || state.diagrams.find(function(d){ return d.id === activeChild; });
        var parent = state.tables.find(function(t){ return t.id === activeSection; });
        var childCount = parent ? sectionChildren(parent).length : 0;
        var childIndex = parent ? sectionChildren(parent).findIndex(function(c){ return c.id === activeChild; }) : -1;
        if (child) crumb.appendChild(el("span", {class:"hb-count", text:" › Chapitre " + (childIndex + 1) + " sur " + childCount}));
        if (child && activeSubchild){
          var subGroups = child.columns ? subtitleGroups(child) : [];
          var subIndex = subGroups.findIndex(function(g){ return g.id === activeSubchild; });
          if (subIndex >= 0) crumb.appendChild(el("span", {class:"hb-count", text:" › Sous-titre " + (subIndex + 1) + " sur " + subGroups.length}));
        }
      }
    } else {
      crumb.appendChild(el("span", {class:"hb-count", text:"Vue d'ensemble"}));
    }
    bar.appendChild(crumb);
    var status = el("div", {class:"status " + (CLOUD_CLASS[saveStatus] || saveStatus), title:"État de l'enregistrement", role:"status"}, [
      el("span", {class:"dot"}), el("span", {text: STATUS_LABELS[saveStatus] || "…"})
    ]);
    bar.appendChild(status);
    bar.appendChild(el("button", {class:"btn small header-links", type:"button", text:"Liens", onclick:function(){ toggleContextPanel(); }}));
    if (dimAnchor) bar.appendChild(el("button", {class:"btn small", type:"button", text:"× Filtre de lien", title:"Retirer le filtre de lien", onclick:function(){ dimAnchor = null; render(); }}));
    bar.appendChild(iconBtn("help", "Aide : comment utiliser l'outil", function(){ openHelp(); }, "hb-help"));
    var exp = btn("download", "Exporter", function(e){ openExportMenu(e.currentTarget); }, "small hb-export");
    bar.appendChild(exp);
    return bar;
  }

  function renderTagsRow(){
    var wrap = el("div", {class:"tags-row"});
    wrap.appendChild(el("span", {class:"tags-label"}, [icon("tag"), el("span", {text:"Repères"})]));
    wrap.appendChild(renderTagbar());
    return wrap;
  }

  function renderOverview(content, secs){
    var isTemplate = ctx && ctx.kind === "template";
    var hero = el("section", {class:"ov-hero"});
    hero.appendChild(el("div", {class:"eyebrow", text: isTemplate ? "Gabarit" : "Projet de recherche"}));
    var h1 = el("h1", {contenteditable:"true", spellcheck:"false", class:"ov-title"});
    h1.textContent = state.title;
    plainPaste(h1);
    h1.addEventListener("input", function(){ state.title = h1.textContent; dirty = true; });
    h1.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); h1.blur(); } });
    h1.addEventListener("blur", function(){ state.title = h1.textContent.trim() || "Projet sans titre"; scheduleSave(true); var t = document.querySelector(".sb-title"); if (t) t.textContent = state.title; });
    hero.appendChild(h1);
    var sub = el("div", {class:"sub", contenteditable:"true", spellcheck:"false", "data-ph":"Ajoute un sous-titre : programme, session, direction… (facultatif)"});
    sub.textContent = state.sub;
    plainPaste(sub);
    sub.addEventListener("input", function(){ state.sub = sub.textContent; dirty = true; });
    sub.addEventListener("blur", function(){ scheduleSave(true); });
    hero.appendChild(sub);
    if (isTemplate) hero.appendChild(el("div", {class:"template-banner", text:"Tu modifies un gabarit : les nouveaux projets créés à partir de lui reprendront cette structure. Les projets existants ne changent pas."}));

    var total = {total:0, filled:0}, done = 0;
    var ps = secs.map(function(s){ var p = sectionProgress(s); total.total += p.total; total.filled += p.filled; if (p.total && p.filled === p.total) done++; return p; });
    var nodeCount = state.diagrams.reduce(function(a,d){ return a + d.nodes.length; }, 0);
    hero.appendChild(el("div", {class:"ov-stats"}, [
      stat(pct(total) + " %", "du projet rempli", progressBar(total, "big")),
      stat(done + " / " + secs.length, "sections complètes"),
      stat(String(total.filled), "cases rédigées"),
      stat(String(state.links.length), "liens entre idées")
    ]));
    content.appendChild(hero);

    if (state.showIntro) content.appendChild(renderIntro());

    var last = null; try { last = localStorage.getItem(viewKey() + ":last"); } catch(e){}
    var lastSec = last && secs.find(function(s){ return s.id===last; });
    if (lastSec) content.appendChild(el("button", {class:"ov-resume", type:"button", onclick:function(){ setSection(lastSec.id); }}, [
      el("span", {class:"ov-resume-k", text:"Reprendre là où tu étais"}), el("strong", {text: titleOf(lastSec.obj)}), icon("next")
    ]));

    content.appendChild(renderTagsRow());

    var grid = el("div", {class:"ov-grid"});
    secs.forEach(function(s, i){
      var p = ps[i], color = sectionColor(s, i);
      var card = el("button", {class:"ov-card", type:"button", "data-sec": color, onclick:function(){ setSection(s.id); }}, [
        el("div", {class:"ov-card-top"}, [el("span", {class:"ov-num", text: String(i+1).padStart(2, "0")}), progressRing(p, 30)]),
        el("div", {class:"ov-card-title", text: titleOf(s.obj)}),
        el("div", {class:"ov-card-meta", text: s.kind === "diagram" ? (s.obj.nodes.length + " élément(s)") : (p.total ? p.filled + " / " + p.total + " cases remplies" : "Aucune case à remplir")}),
        progressBar(p)
      ]);
      grid.appendChild(card);
    });
    var addCard = el("div", {class:"ov-card ov-add"}, [
      btn("plus", "Nouvelle section", function(){ addTopTable(); }, "ghost"),
      btn("canvas", "Nouvel espace libre", function(){ addTopDiagram(); }, "ghost"),
      btn("download", "Importer une section", importSection, "ghost")
    ]);
    grid.appendChild(addCard);
    content.appendChild(grid);
    content.appendChild(el("p", {class:"ov-foot", text: state.tables.length + " tableaux · " + nodeCount + " éléments de schéma · " + state.tags.length + " repères"}));
  }
  function stat(value, label, extra){
    return el("div", {class:"ov-stat"}, [el("div", {class:"ov-stat-v", text:value}), el("div", {class:"ov-stat-l", text:label}), extra || null]);
  }

  function renderSectionView(content, secs){
    var idx = secs.findIndex(function(s){ return s.id===activeSection; });
    var s = secs[idx];
    if (s.kind === "table" && isCardSection(s.obj)){
      if (activeChild){ renderChildView(content, secs, s, idx); }
      else renderSectionCards(content, s, idx);
      return;
    }
    var color = sectionColor(s, idx);
    try { localStorage.setItem(viewKey() + ":last", s.id); } catch(e){}
    var p = sectionProgress(s);
    var head = el("div", {class:"sec-head", "data-sec": color}, [
      el("div", {class:"sec-num", text: String(idx+1).padStart(2, "0")}),
      el("div", {class:"sec-meta"}, [
        el("div", {class:"sec-kicker", text: s.kind === "diagram" ? "Espace libre" : "Section"}),
        el("div", {class:"sec-progress"}, [progressBar(p), el("span", {text: p.total ? p.filled + " / " + p.total + " remplies" : ""})])
      ])
    ]);
    content.appendChild(head);
    content.appendChild(renderTagsRow());
    var board = el("div", {class:"board", "data-sec": color});
    board.appendChild(s.kind === "table" ? renderTable(s.obj, {top:true}) : renderDiagram(s.obj, {top:true}));
    content.appendChild(board);

    var pager = el("nav", {class:"sec-pager", "aria-label":"Sections précédente et suivante"});
    var prev = secs[idx-1], next = secs[idx+1];
    pager.appendChild(prev ? el("button", {class:"pg-btn", type:"button", onclick:function(){ setSection(prev.id); }}, [icon("back"), el("span", {}, [el("small", {text:"Précédente"}), el("strong", {text:titleOf(prev.obj)})])]) : el("span"));
    pager.appendChild(next ? el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setSection(next.id); }}, [el("span", {}, [el("small", {text:"Suivante"}), el("strong", {text:titleOf(next.obj)})]), icon("next")]) : el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setSection(null); }}, [el("span", {}, [el("small", {text:"Terminé"}), el("strong", {text:"Retour à la vue d'ensemble"})]), icon("grid")]));
    content.appendChild(pager);
  }

  function shortChildTitle(title, index){
    var m = /^\s*Chapitre\s+(\d+)\s*[—-]\s*(.*)$/i.exec(stripHtml(title || ""));
    return m ? String(Number(m[1])) + " · " + m[2] : String(index + 1) + " · " + titleOf({title:title});
  }
  function childDisplay(child, index){
    var title = titleOf(child.obj);
    var m = /^\s*Chapitre\s+(\d+)\s*[—-]\s*(.*)$/i.exec(title);
    return {number:m ? String(m[1]).padStart(2, "0") : String(index + 1).padStart(2, "0"), title:m ? m[2] : title};
  }
  function tagCountsFor(items){
    var counts = {};
    items.forEach(function(row){ Object.keys(row.cells || {}).forEach(function(cid){
      (row.cells[cid].tags || []).forEach(function(tagId){ counts[tagId] = (counts[tagId] || 0) + 1; });
    }); });
    return counts;
  }
  function tagPills(counts){
    return state.tags.filter(function(tag){ return counts[tag.id]; }).map(function(tag){
      var pill = el("span", {class:"mini-tag", text:tag.label + " " + counts[tag.id]});
      pill.style.background = "var(--tag-" + tag.color + "-bg)";
      pill.style.color = "var(--tag-" + tag.color + ")";
      return pill;
    });
  }
  function summaryStats(table){
    var refs = (table.rows || []).filter(function(row){ return !row.kind; });
    var summaryCol = (table.columns || []).find(function(col){ return /r[ée]sum[ée]/i.test(col.label || ""); });
    var columns = summaryCol ? [summaryCol] : answerColumns(table);
    var filled = 0;
    columns.forEach(function(col){ refs.forEach(function(row){ if (row.cells[col.id] && stripHtml(row.cells[col.id].text).trim()) filled++; }); });
    return {refs:refs.length, filled:filled, total:refs.length * columns.length, hasSummary:!!summaryCol};
  }
  function renderSectionCards(content, sec, idx){
    var root = sec.obj, children = sectionChildren(root), color = sectionColor(sec, idx), p = sectionProgress(sec);
    try { localStorage.setItem(viewKey() + ":last", sec.id); } catch(e){}
    var hero = el("section", {class:"ov-hero", "data-sec":color});
    hero.appendChild(el("div", {class:"eyebrow", text:"Section " + (idx + 1)}));
    var h1 = el("h1", {contenteditable:"true", spellcheck:"false", class:"ov-title", text:root.title});
    plainPaste(h1);
    h1.addEventListener("input", function(){ root.title = h1.textContent; dirty = true; });
    h1.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); h1.blur(); } });
    h1.addEventListener("blur", function(){ root.title = h1.textContent.trim() || "Section sans titre"; scheduleSave(true); var label = document.querySelector(".sb-item.active .sb-label"); if (label) label.textContent = titleOf(root); });
    hero.appendChild(h1);
    var sectionMore = iconBtn("more", "Options de la section", null, "section-cards-more");
    sectionMore.addEventListener("click", function(){
      openMenu(sectionMore, null, [{icon:"check", label:"Afficher les sous-tableaux en cartes", run:function(){ root.cards = false; scheduleSave(true); setSection(root.id); }}]);
    });
    hero.appendChild(sectionMore);
    var totalRefs = 0, totalSummaries = 0, complete = 0, hasSources = false;
    children.forEach(function(child){
      if (child.kind === "table"){
        var stats = summaryStats(child.obj); totalRefs += stats.refs; totalSummaries += stats.filled;
        hasSources = hasSources || child.obj.columns.some(function(col){ return /^sources?$/i.test(col.label || ""); });
        if (pct(tableProgress(child.obj)) === 100) complete++;
      } else if (pct(sectionProgress(child)) === 100) complete++;
    });
    hero.appendChild(el("div", {class:"ov-stats"}, [
      stat(pct(p) + " %", "de la section", progressBar(p, "big")),
      stat(complete + " / " + children.length, "chapitres complets"),
      stat(String(totalRefs), hasSources ? "références" : "lignes"),
      stat(String(totalSummaries), "résumés rédigés")
    ]));
    content.appendChild(hero);
    var last = null; try { last = localStorage.getItem(viewKey() + ":child:" + sec.id); } catch(e){}
    var lastChild = last && children.find(function(child){ return child.id === last; });
    if (lastChild) content.appendChild(el("button", {class:"ov-resume", type:"button", onclick:function(){ setChild(lastChild.id); }}, [
      el("span", {class:"ov-resume-k", text:"Reprendre là où tu étais"}), el("strong", {text:titleOf(lastChild.obj)}), icon("next")
    ]));
    content.appendChild(renderTagsRow());
    var grid = el("div", {class:"ov-grid"});
    children.forEach(function(child, childIndex){
      var childProgress = sectionProgress(child), display = childDisplay(child, childIndex), stats = child.kind === "table" ? summaryStats(child.obj) : null;
      var card = el("button", {class:"ov-card", type:"button", "data-sec":child.kind === "table" && child.obj.color && TAGCOLOR_TO_SECTION[child.obj.color] ? TAGCOLOR_TO_SECTION[child.obj.color] : sectionColor(child, childIndex), onclick:function(){ setChild(child.id); }}, [
        el("div", {class:"ov-card-top"}, [el("span", {class:"ov-num", text:display.number}), progressRing(childProgress, 30)]),
        el("div", {class:"ov-card-title", text:display.title}),
        el("div", {class:"ov-card-meta", text:child.kind === "diagram" ? child.obj.nodes.length + " élément(s)" : (stats.hasSummary ? stats.filled + " / " + stats.refs + " résumés rédigés" : stats.filled + " / " + stats.total + " cases remplies")}),
        child.kind === "table" ? el("div", {class:"tagbar card-tags"}, tagPills(tagCountsFor((child.obj.rows || []).filter(function(row){ return !row.kind; })))) : null,
        progressBar(childProgress)
      ]);
      grid.appendChild(card);
    });
    var addCard = el("div", {class:"ov-card ov-add"}, [
      btn("plus", "+ Nouveau chapitre", function(){ addChildTable(root, children); }, "ghost"),
      btn("canvas", "+ Espace libre", function(){ addChildDiagram(root); }, "ghost")
    ]);
    grid.appendChild(addCard); content.appendChild(grid);
  }
  function addChildTable(root, children){
    var first = children.find(function(child){ return child.kind === "table"; });
    var columns = (first && first.obj.columns.length ? first.obj.columns : [{id:uid("col"),label:"Colonne 1"},{id:uid("col"),label:"Colonne 2"}]).map(function(col){ return {id:uid("col"), label:col.label}; });
    var row = {id:uid("row"), cells:{}};
    columns.forEach(function(col){ row.cells[col.id] = {text:"", tags:[]}; });
    var count = state.tables.filter(function(t){ return t.parentId === root.id; }).length + 1;
    var child = {id:uid("tbl"), parentId:root.id, title:"Chapitre " + count + " — Nouveau chapitre", columns:columns, rows:[row]};
    if (first && first.obj.rowLines) child.rowLines = first.obj.rowLines;
    insertNestedChildAfterFocus(state.tables, child, root.id, "table");
    scheduleSave(true); setChild(child.id);
  }
  function addChildDiagram(root){
    var d = {id:uid("dgr"), parentId:root.id, title:"Nouvel espace libre", nodes:[], arrows:[], notes:[]};
    insertNestedChildAfterFocus(state.diagrams, d, root.id, "diagram");
    scheduleSave(true); setChild(d.id);
  }
  function renderChildView(content, secs, sec, idx){
    var children = sectionChildren(sec.obj), childIndex = children.findIndex(function(child){ return child.id === activeChild; });
    var child = children[childIndex];
    if (!child){ activeChild = null; renderSectionCards(content, sec, idx); return; }
    if (child.kind === "table" && isSubtitleCardChapter(child.obj)){
      var groups = subtitleGroups(child.obj);
      if (activeSubchild){ renderSubtitleView(content, secs, sec, idx, child, groups); }
      else { renderSubtitleCards(content, sec, idx, child, groups); }
      return;
    }
    try { localStorage.setItem(viewKey() + ":child:" + sec.id, child.id); } catch(e){}
    var display = childDisplay(child, childIndex), color = child.kind === "table" && child.obj.color && TAGCOLOR_TO_SECTION[child.obj.color] ? TAGCOLOR_TO_SECTION[child.obj.color] : sectionColor(child, childIndex), p = sectionProgress(child);
    var crumb = el("nav", {class:"breadcrumb", "aria-label":"Fil d'Ariane"}, [
      el("button", {type:"button", text:"Vue d'ensemble", onclick:function(){ setSection(null); }}),
      el("span", {text:"›"}), el("button", {type:"button", text:(idx + 1) + " · " + titleOf(sec.obj), onclick:function(){ setChild(null); }}),
      el("span", {text:"›"}), el("strong", {text:display.number + " · " + display.title})
    ]);
    content.appendChild(crumb);
    content.appendChild(el("div", {class:"sec-head", "data-sec":color}, [
      el("div", {class:"sec-num", text:display.number}),
      el("div", {class:"sec-meta"}, [el("div", {class:"sec-kicker", text:"Section " + (idx + 1) + " · Chapitre"}), el("div", {class:"sec-progress"}, [progressBar(p), el("span", {text:p.total ? p.filled + " / " + p.total + " remplies" : ""})])])
    ]));
    content.appendChild(renderTagsRow());
    var board = el("div", {class:"board", "data-sec":color});
    board.appendChild(child.kind === "table" ? renderTable(child.obj, {top:true}) : renderDiagram(child.obj, {top:true}));
    content.appendChild(board);
    var pager = el("nav", {class:"sec-pager", "aria-label":"Chapitres précédent et suivant"});
    var previous = children[childIndex - 1], next = children[childIndex + 1];
    pager.appendChild(previous ? el("button", {class:"pg-btn", type:"button", onclick:function(){ setChild(previous.id); }}, [icon("back"), el("span", {}, [el("small", {text:"Chapitre précédent"}), el("strong", {text:childDisplay(previous, childIndex - 1).number + " · " + childDisplay(previous, childIndex - 1).title})])]) : el("span"));
    pager.appendChild(next ? el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setChild(next.id); }}, [el("span", {}, [el("small", {text:"Chapitre suivant"}), el("strong", {text:childDisplay(next, childIndex + 1).number + " · " + childDisplay(next, childIndex + 1).title})]), icon("next")]) : el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setChild(null); }}, [el("span", {}, [el("small", {text:"Terminé"}), el("strong", {text:"Retour aux chapitres"})]), icon("grid")]));
    content.appendChild(pager);
  }

  function renderSubtitleCards(content, sec, idx, child, groups){
    var table = child.obj, childIndex = sectionChildren(sec.obj).findIndex(function(item){ return item.id === child.id; }), p = sectionProgress(child);
    try { localStorage.setItem(viewKey() + ":child:" + sec.id, child.id); } catch(e){}
    var hero = el("section", {class:"ov-hero", "data-sec":sectionColor(child, childIndex)});
    hero.appendChild(el("div", {class:"eyebrow", text:"Chapitre " + childDisplay(child, childIndex).number}));
    hero.appendChild(el("h1", {class:"ov-title", text:childDisplay(child, childIndex).title}));
    var refs = groups.reduce(function(total, group){ return total + group.rows.length; }, 0);
    var complete = groups.filter(function(group){ return pct(tableProgress({columns:table.columns, rows:group.rows})) === 100; }).length;
    var summary = groups.reduce(function(total, group){
      var stats = summaryStats({columns:table.columns, rows:group.rows}); return total + stats.filled;
    }, 0);
    hero.appendChild(el("div", {class:"ov-stats"}, [
      stat(pct(p) + " %", "du chapitre", progressBar(p, "big")),
      stat(complete + " / " + groups.length, "sous-titres complets"),
      stat(String(refs), "références"),
      stat(String(summary), "résumés rédigés")
    ]));
    content.appendChild(hero);
    content.appendChild(renderTagsRow());
    var grid = el("div", {class:"ov-grid"});
    groups.forEach(function(group, groupIndex){
      var groupProgress = tableProgress({columns:table.columns, rows:group.rows});
      var stats = summaryStats({columns:table.columns, rows:group.rows});
      var card = el("button", {class:"ov-card", type:"button", "data-sec":sectionColor(child, childIndex), onclick:function(){ setSubchild(group.id); }}, [
        el("div", {class:"ov-card-top"}, [el("span", {class:"ov-num", text:String(groupIndex + 1).padStart(2, "0")}), progressRing(groupProgress, 30)]),
        el("div", {class:"ov-card-title", text:group.title}),
        el("div", {class:"ov-card-meta", text:stats.hasSummary ? stats.filled + " / " + stats.refs + " résumés rédigés" : stats.filled + " / " + stats.total + " cases remplies"}),
        el("div", {class:"tagbar card-tags"}, tagPills(tagCountsFor(group.rows))),
        progressBar(groupProgress)
      ]);
      grid.appendChild(card);
    });
    var addCard = el("div", {class:"ov-card ov-add"}, [
      btn("plus", "+ Nouveau sous-titre", function(){ addSubtitleTable(table, groups); }, "ghost")
    ]);
    grid.appendChild(addCard);
    content.appendChild(grid);
  }

  function addSubtitleTable(table, groups){
    var columns = table.columns || [];
    var source = columns.find(function(col){ return /^sources?$/i.test(col.label || ""); }) || columns[0];
    var header = {id:uid("row"), kind:"header", cells:{}};
    var reference = {id:uid("row"), cells:{}};
    columns.forEach(function(col){
      header.cells[col.id] = {text:"", tags:[]};
      reference.cells[col.id] = {text:"", tags:[]};
    });
    header.cells[source.id].text = "Nouveau sous-titre";
    table.rows.push(header, reference);
    var groupId = "sub:" + table.id + ":" + header.id;
    scheduleSave(true);
    setSubchild(groupId);
  }

  function renderSubtitleView(content, secs, sec, idx, child, groups){
    var groupIndex = groups.findIndex(function(group){ return group.id === activeSubchild; }), group = groups[groupIndex];
    if (!group){ activeSubchild = null; renderSubtitleCards(content, sec, idx, child, groups); return; }
    var childIndex = sectionChildren(sec.obj).findIndex(function(item){ return item.id === child.id; });
    var display = childDisplay(child, childIndex), color = sectionColor(child, childIndex), p = tableProgress({columns:child.obj.columns, rows:group.rows});
    try { localStorage.setItem(viewKey() + ":subchild:" + child.id, group.id); } catch(e){}
    content.appendChild(el("nav", {class:"breadcrumb", "aria-label":"Fil d'Ariane"}, [
      el("button", {type:"button", text:"Vue d'ensemble", onclick:function(){ setSection(null); }}), el("span", {text:"›"}),
      el("button", {type:"button", text:(idx + 1) + " · " + titleOf(sec.obj), onclick:function(){ setChild(null); }}), el("span", {text:"›"}),
      el("button", {type:"button", text:display.number + " · " + display.title, onclick:function(){ setSubchild(null); }}), el("span", {text:"›"}),
      el("strong", {text:group.title})
    ]));
    content.appendChild(el("div", {class:"sec-head", "data-sec":color}, [el("div", {class:"sec-num", text:String(groupIndex + 1).padStart(2, "0")}), el("div", {class:"sec-meta"}, [el("div", {class:"sec-kicker", text:"Chapitre · Sous-titre"}), el("div", {class:"sec-progress"}, [progressBar(p), el("span", {text:p.total ? p.filled + " / " + p.total + " remplies" : ""})])])]));
    content.appendChild(renderTagsRow());
    var board = el("div", {class:"board", "data-sec":color});
    board.appendChild(renderTable(child.obj, {top:true, rows:group.rows, title:group.title, header:group.header}));
    content.appendChild(board);
    var pager = el("nav", {class:"sec-pager", "aria-label":"Sous-titres précédent et suivant"});
    var previous = groups[groupIndex - 1], next = groups[groupIndex + 1];
    pager.appendChild(previous ? el("button", {class:"pg-btn", type:"button", onclick:function(){ setSubchild(previous.id); }}, [icon("back"), el("span", {}, [el("small", {text:"Sous-titre précédent"}), el("strong", {text:previous.title})])]) : el("span"));
    pager.appendChild(next ? el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setSubchild(next.id); }}, [el("span", {}, [el("small", {text:"Sous-titre suivant"}), el("strong", {text:next.title})]), icon("next")]) : el("button", {class:"pg-btn pg-next", type:"button", onclick:function(){ setSubchild(null); }}, [el("span", {}, [el("small", {text:"Terminé"}), el("strong", {text:"Retour aux sous-titres"})]), icon("grid")]));
    content.appendChild(pager);
  }

  /* ---------- menus contextuels ---------- */

  function openMenu(anchor, title, items){
    closePopover();
    var pop = el("div", {class:"pop menu-pop", role:"menu"});
    if (title) pop.appendChild(el("h4", {text:title}));
    items.forEach(function(it){
      if (!it) return;
      if (it.sep){ pop.appendChild(el("div", {class:"menu-sep"})); return; }
      var b = el("button", {class:"menu-item" + (it.danger ? " danger" : ""), type:"button", role:"menuitem", onclick:function(){ closePopover(); it.run(); }});
      if (it.icon) b.appendChild(icon(it.icon));
      b.appendChild(el("span", {text: it.label}));
      pop.appendChild(b);
    });
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  function openHelp(){
    var overlay = el("div", {class:"overlay"});
    var m = el("div", {class:"modal help-modal", role:"dialog", "aria-modal":"true"});
    m.appendChild(el("h3", {text:"Comment utiliser l'outil"}));
    var tips = [
      ["grid", "Navigue par sections", "Le menu de gauche liste les sections, avec leur avancement. Clique pour en ouvrir une ; « Suivante » et « Précédente » en bas de page te font avancer dans l'ordre."],
      ["table", "Écris directement dans les cases", "Tout est modifiable : titres, colonnes, cases. La première colonne donne souvent la consigne ; écris dans « Rédaction » ou « Réponses ». Tout s'enregistre pendant que tu tapes."],
      ["more", "Ajoute ou supprime", "Le bouton ⋯ d'un tableau permet d'ajouter une colonne, un sous-tableau ou un espace libre, de changer la couleur ou de supprimer."],
      ["tag", "Repères de couleur", "Crée des repères (ex. « à vérifier ») et applique-les à une case avec l'icône d'étiquette. Clique un repère pour surligner toutes les cases qui l'ont."],
      ["link", "Relie des idées", "Clique l'icône de lien d'une case, puis celle d'une autre case, même dans une autre section. Le nombre de liens s'affiche sur l'icône ; la flèche permet d'y naviguer."],
      ["drag", "Réorganise", "Glisse la poignée ⠿ d'une ligne, d'une colonne ou d'un sous-tableau pour le déplacer, même vers un autre tableau. Dans le menu de gauche, glisse une section pour changer l'ordre."]
    ];
    var list = el("div", {class:"help-list"});
    tips.forEach(function(t){ list.appendChild(el("div", {class:"help-item"}, [icon(t[0]), el("div", {}, [el("strong", {text:t[1]}), el("p", {text:t[2]})])])); });
    m.appendChild(list);
    function closeIt(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    m.appendChild(el("div", {class:"row"}, [el("button", {class:"btn primary", text:"Compris", onclick:closeIt})]));
    overlay.appendChild(m);
    overlay.addEventListener("mousedown", function(e){ if (e.target===overlay) closeIt(); });
    document.body.appendChild(overlay);
  }

  /* ---------------- full-width reorderable board ---------------- */

  function normalizeOrder(){
    var validIds = state.tables.filter(function(t){ return !t.parentId; }).map(function(t){ return t.id; });
    validIds = validIds.concat(state.diagrams.filter(function(d){ return !d.parentId; }).map(function(d){ return d.id; }));
    if (!Array.isArray(state.order)) state.order = validIds.slice();
    else {
      state.order = state.order.filter(function(id){ return validIds.indexOf(id) >= 0; });
      validIds.forEach(function(id){ if (state.order.indexOf(id) < 0) state.order.push(id); });
    }
  }

  /* ---------------- insert-at-cursor helpers ---------------- */
  // These let "+ Colonne / + Ligne / + Sous-tableau / + Espace libre / + Nouveau tableau" land
  // right next to whatever the person was last working in, instead of always at the bottom.

  function topLevelAncestorId(kind, id){
    if (kind === "diagram"){
      var d = state.diagrams.find(function(x){ return x.id===id; });
      if (!d) return null;
      return d.parentId ? topLevelAncestorId("table", d.parentId) : d.id;
    }
    var t = state.tables.find(function(x){ return x.id===id; });
    if (!t) return null;
    return t.parentId ? topLevelAncestorId("table", t.parentId) : t.id;
  }

  // Where a brand-new top-level table/espace libre should land in state.order: right after the
  // top-level card that contains wherever the cursor last was, or left alone (normalizeOrder then
  // appends it at the end, as before) if nothing usable was focused.
  function insertAfterFocusedTopLevel(newId){
    var anchor = null;
    if (lastFocus.kind==="table" && lastFocus.tableId) anchor = topLevelAncestorId("table", lastFocus.tableId);
    else if (lastFocus.kind==="diagram" && lastFocus.diagramId) anchor = topLevelAncestorId("diagram", lastFocus.diagramId);
    if (anchor && Array.isArray(state.order) && state.order.indexOf(anchor)>=0){
      state.order.splice(state.order.indexOf(anchor)+1, 0, newId);
    }
  }

  // Where a brand-new nested sub-tableau/espace libre should land among the siblings of parentId:
  // right after whichever sibling (of the given kind) the cursor was last focused in, or appended
  // at the end (matching the previous behaviour) if the cursor wasn't in one of those siblings.
  function insertNestedChildAfterFocus(arr, item, parentId, kind){
    var anchorObj = null;
    if (kind==="table" && lastFocus.kind==="table" && lastFocus.tableId){
      var t2 = state.tables.find(function(x){ return x.id===lastFocus.tableId; });
      if (t2 && t2.parentId===parentId) anchorObj = t2;
    } else if (kind==="diagram" && lastFocus.kind==="diagram" && lastFocus.diagramId){
      var d2 = state.diagrams.find(function(x){ return x.id===lastFocus.diagramId; });
      if (d2 && d2.parentId===parentId) anchorObj = d2;
    }
    if (anchorObj) arr.splice(arr.indexOf(anchorObj)+1, 0, item);
    else arr.push(item);
  }

  function makeReorderable(handle, blockEl, blockId){
    handle.addEventListener("pointerdown", function(e){
      e.preventDefault();
      e.stopPropagation();
      var board = blockEl.parentNode;
      var siblings = Array.prototype.slice.call(board.children);
      var startIndex = siblings.indexOf(blockEl);
      var currentIndex = startIndex;
      var rects = siblings.map(function(s){ return s.getBoundingClientRect(); });
      var draggedRect = rects[startIndex];
      var draggedHeight = draggedRect.height;
      var startY = e.clientY;
      blockEl.classList.add("dragging");
      blockEl.style.position = "relative";
      blockEl.style.zIndex = 10;
      handle.setPointerCapture(e.pointerId);

      function move(ev){
        var dy = ev.clientY - startY;
        blockEl.style.transform = "translateY(" + dy + "px)";
        var draggedCenter = draggedRect.top + draggedRect.height / 2 + dy;
        var newIndex = 0;
        for (var i = 0; i < siblings.length; i++){
          if (siblings[i] === blockEl) continue;
          var c = rects[i].top + rects[i].height / 2;
          if (draggedCenter > c) newIndex++;
        }
        if (newIndex !== currentIndex){
          siblings.forEach(function(s, i){
            if (s === blockEl) return;
            var shift = 0;
            if (currentIndex < newIndex){ if (i > currentIndex && i <= newIndex) shift = -draggedHeight; }
            else if (currentIndex > newIndex){ if (i >= newIndex && i < currentIndex) shift = draggedHeight; }
            s.style.transform = shift ? "translateY(" + shift + "px)" : "";
          });
          currentIndex = newIndex;
        }
      }
      function up(){
        blockEl.classList.remove("dragging");
        blockEl.style.position = "";
        blockEl.style.zIndex = "";
        blockEl.style.transform = "";
        siblings.forEach(function(s){ s.style.transform = ""; });
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (currentIndex !== startIndex){
          var idx = state.order.indexOf(blockId);
          if (idx >= 0){
            state.order.splice(idx, 1);
            state.order.splice(currentIndex, 0, blockId);
          }
          render();
        }
        scheduleSave(true);
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  /* ---------------- moving rows & columns (within and across tables) ---------------- */

  function normLabel(s){ return (s||"").trim().toLowerCase(); }

  function clearDropHints(){
    Array.prototype.forEach.call(document.querySelectorAll(".row-drop-before,.row-drop-after"), function(e){ e.classList.remove("row-drop-before","row-drop-after"); });
    Array.prototype.forEach.call(document.querySelectorAll(".col-drop-before,.col-drop-after"), function(e){ e.classList.remove("col-drop-before","col-drop-after"); });
    Array.prototype.forEach.call(document.querySelectorAll(".table-card.drop-target"), function(e){ e.classList.remove("drop-target"); });
    Array.prototype.forEach.call(document.querySelectorAll(".board.drop-target"), function(e){ e.classList.remove("drop-target"); });
  }

  /* ---------------- moving whole sub-tables / nested espaces libres ---------------- */

  function tableDescendantIds(tableId){
    var ids = [tableId];
    state.tables.filter(function(t){ return t.parentId===tableId; }).forEach(function(c){ ids = ids.concat(tableDescendantIds(c.id)); });
    return ids;
  }

  function moveToNewParent(arr, item, newParentId){
    item.parentId = newParentId;
    var idx = arr.indexOf(item);
    if (idx>=0) arr.splice(idx,1);
    var lastIdx = -1;
    arr.forEach(function(x,i){ if (x.parentId===newParentId) lastIdx = i; });
    if (lastIdx>=0) arr.splice(lastIdx+1, 0, item);
    else arr.push(item);
  }

  function makeBlockDraggable(handle, cardEl, item, kind){
    var siblingSel = kind==="table" ? ".table-card" : ".diagram-shell";
    handle.addEventListener("pointerdown", function(e){
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      var startParent = cardEl.parentNode;
      var siblings = Array.prototype.filter.call(startParent.children, function(c){ return c.matches && c.matches(siblingSel); });
      var startIndex = siblings.indexOf(cardEl);
      var currentIndex = startIndex;
      var rects = siblings.map(function(s){ return s.getBoundingClientRect(); });
      var draggedRect = rects[startIndex];
      var draggedHeight = draggedRect.height;
      var startY = e.clientY;
      cardEl.classList.add("dragging");
      cardEl.style.position = "relative";
      cardEl.style.zIndex = 10;

      var mode = "reorder", reparentTargetId = null;
      var selfIds = kind==="table" ? tableDescendantIds(item.id) : [item.id];

      function move(ev){
        var dy = ev.clientY - startY;
        clearDropHints();
        var el2 = document.elementFromPoint(ev.clientX, ev.clientY);
        var hoverSibling = el2 && el2.closest(siblingSel);
        var hoverCard = el2 && el2.closest(".table-card");
        var hoverBoard = el2 && el2.closest(".board");

        if (hoverSibling && hoverSibling.parentNode === startParent && siblings.indexOf(hoverSibling) >= 0){
          mode = "reorder"; reparentTargetId = null;
          cardEl.style.transform = "translateY(" + dy + "px)";
          var draggedCenter = draggedRect.top + draggedRect.height/2 + dy;
          var newIndex = 0;
          for (var i=0;i<siblings.length;i++){
            if (siblings[i]===cardEl) continue;
            var c = rects[i].top + rects[i].height/2;
            if (draggedCenter > c) newIndex++;
          }
          if (newIndex !== currentIndex){
            siblings.forEach(function(s, i){
              if (s===cardEl) return;
              var shift = 0;
              if (currentIndex < newIndex){ if (i > currentIndex && i <= newIndex) shift = -draggedHeight; }
              else if (currentIndex > newIndex){ if (i >= newIndex && i < currentIndex) shift = draggedHeight; }
              s.style.transform = shift ? "translateY(" + shift + "px)" : "";
            });
            currentIndex = newIndex;
          }
        } else {
          siblings.forEach(function(s){ if (s!==cardEl) s.style.transform = ""; });
          cardEl.style.transform = "translateY(" + dy + "px)";
          var candidateId = hoverCard ? hoverCard.getAttribute("data-table-id") : null;
          if (hoverCard && candidateId && selfIds.indexOf(candidateId) < 0){
            mode = "reparent"; reparentTargetId = candidateId;
            hoverCard.classList.add("drop-target");
          } else if (hoverBoard && !hoverCard){
            mode = "top"; reparentTargetId = null;
            hoverBoard.classList.add("drop-target");
          }
          // else: no valid target right under the pointer this frame (e.g. a transient gap
          // opened by the reorder-preview animation) — keep the previous mode/target rather
          // than resetting, so a brief mis-hit mid-drag doesn't discard the user's intent.
        }
      }

      function up(){
        cardEl.classList.remove("dragging");
        cardEl.style.position = "";
        cardEl.style.zIndex = "";
        cardEl.style.transform = "";
        siblings.forEach(function(s){ s.style.transform = ""; });
        clearDropHints();
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);

        var arr = kind==="table" ? state.tables : state.diagrams;
        var changed = false;

        if (mode==="reorder" && currentIndex !== startIndex){
          var idxInArr = arr.indexOf(item);
          arr.splice(idxInArr, 1);
          var currentSiblingsObjs = arr.filter(function(x){ return x.parentId===item.parentId; });
          var insertAt;
          if (currentIndex >= currentSiblingsObjs.length){
            var lastSib = currentSiblingsObjs[currentSiblingsObjs.length-1];
            insertAt = lastSib ? arr.indexOf(lastSib)+1 : arr.length;
          } else {
            insertAt = arr.indexOf(currentSiblingsObjs[currentIndex]);
          }
          arr.splice(insertAt, 0, item);
          changed = true;
        } else if (mode==="reparent" && reparentTargetId && reparentTargetId !== item.parentId){
          moveToNewParent(arr, item, reparentTargetId);
          changed = true;
        } else if (mode==="top" && item.parentId){
          moveToNewParent(arr, item, undefined);
          changed = true;
        }

        if (changed){ scheduleSave(true); render(); }
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function ensureColumnInTarget(targetTable, label){
    var existing = targetTable.columns.find(function(c){ return normLabel(c.label)===normLabel(label); });
    if (existing) return existing;
    var col = {id: uid("col"), label: label || "Nouvelle colonne"};
    targetTable.columns.push(col);
    targetTable.rows.forEach(function(r){ if (!r.cells[col.id]) r.cells[col.id] = {text:"", tags:[]}; });
    return col;
  }

  function moveRowAcrossTables(sourceTable, row, targetTable, targetIndex){
    var colIdMap = {};
    var newCells = {};
    sourceTable.columns.forEach(function(sc){
      var targetCol = ensureColumnInTarget(targetTable, sc.label);
      colIdMap[sc.id] = targetCol.id;
      newCells[targetCol.id] = row.cells[sc.id] || {text:"", tags:[]};
    });
    var oldTableId = sourceTable.id;
    row.cells = newCells;
    sourceTable.rows = sourceTable.rows.filter(function(r){ return r.id !== row.id; });
    var idx = Math.max(0, Math.min(targetIndex, targetTable.rows.length));
    targetTable.rows.splice(idx, 0, row);
    state.links.forEach(function(l){
      ["a","b"].forEach(function(side){
        var m = /^t:([^:]+):([^:]+):([^:]+)$/.exec(l[side]);
        if (m && m[1]===oldTableId && m[2]===row.id && colIdMap[m[3]]){
          l[side] = entityKeyForCell(targetTable.id, row.id, colIdMap[m[3]]);
        }
        if (l[side] === anchorId(oldTableId, row.id)) l[side] = anchorId(targetTable.id, row.id);
      });
    });
  }

  function moveColumnAcrossTables(sourceTable, col, targetTable, targetIndex){
    var newCol = {id: uid("col"), label: col.label};
    var idx = Math.max(0, Math.min(targetIndex, targetTable.columns.length));
    targetTable.columns.splice(idx, 0, newCol);
    var oldTableId = sourceTable.id;
    sourceTable.rows.forEach(function(srow){
      var val = srow.cells[col.id] || {text:"", tags:[]};
      var trow = targetTable.rows[sourceTable.rows.indexOf(srow)];
      if (!trow){
        trow = {id: uid("row"), cells:{}};
        targetTable.columns.forEach(function(tc){ trow.cells[tc.id] = {text:"", tags:[]}; });
        targetTable.rows.push(trow);
      }
      trow.cells[newCol.id] = val;
      var oldEid = entityKeyForCell(oldTableId, srow.id, col.id);
      var newEid = entityKeyForCell(targetTable.id, trow.id, newCol.id);
      state.links.forEach(function(l){
        if (l.a===oldEid) l.a=newEid;
        if (l.b===oldEid) l.b=newEid;
      });
      delete srow.cells[col.id];
    });
    sourceTable.columns = sourceTable.columns.filter(function(c){ return c.id !== col.id; });
  }

  function makeRowDraggable(handle, tr, sourceTable, row){
    handle.addEventListener("pointerdown", function(e){
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      tr.classList.add("row-dragging");
      var hoverTableId = null, hoverIndex = null;

      function move(ev){
        clearDropHints();
        var el2 = document.elementFromPoint(ev.clientX, ev.clientY);
        var card = el2 && el2.closest(".table-card");
        if (!card){ hoverTableId = null; return; }
        card.classList.add("drop-target");
        hoverTableId = card.getAttribute("data-table-id");
        var rows = Array.prototype.slice.call(card.querySelectorAll(":scope > .scrollwrap > table.datatable > tbody > tr"));
        if (!rows.length){ hoverIndex = 0; return; }
        var idx = rows.length, atEnd = true;
        for (var i=0;i<rows.length;i++){
          var r = rows[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height/2){ idx = i; atEnd = false; break; }
        }
        hoverIndex = idx;
        if (atEnd) rows[rows.length-1].classList.add("row-drop-after");
        else rows[idx].classList.add("row-drop-before");
      }
      function up(){
        tr.classList.remove("row-dragging");
        clearDropHints();
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (hoverTableId){
          var targetTable = state.tables.find(function(x){ return x.id===hoverTableId; });
          if (targetTable){
            if (targetTable.id === sourceTable.id){
              var curIdx = sourceTable.rows.indexOf(row);
              var insertIndex = hoverIndex;
              sourceTable.rows.splice(curIdx,1);
              if (insertIndex > curIdx) insertIndex--;
              insertIndex = Math.max(0, Math.min(insertIndex, sourceTable.rows.length));
              sourceTable.rows.splice(insertIndex,0,row);
            } else {
              moveRowAcrossTables(sourceTable, row, targetTable, hoverIndex);
            }
            scheduleSave(true); render();
          }
        }
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function makeColDraggable(handle, th, sourceTable, col){
    handle.addEventListener("pointerdown", function(e){
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      th.classList.add("col-dragging");
      var hoverTableId = null, hoverIndex = null;

      function move(ev){
        clearDropHints();
        var el2 = document.elementFromPoint(ev.clientX, ev.clientY);
        var card = el2 && el2.closest(".table-card");
        if (!card){ hoverTableId = null; return; }
        card.classList.add("drop-target");
        hoverTableId = card.getAttribute("data-table-id");
        var ths = Array.prototype.slice.call(card.querySelectorAll(":scope > .scrollwrap > table.datatable > thead > tr > th")).filter(function(x){ return !x.classList.contains("rowdrag-th"); });
        if (!ths.length){ hoverIndex = 0; return; }
        var idx = ths.length, atEnd = true;
        for (var i=0;i<ths.length;i++){
          var r = ths[i].getBoundingClientRect();
          if (ev.clientX < r.left + r.width/2){ idx = i; atEnd = false; break; }
        }
        hoverIndex = idx;
        if (atEnd) ths[ths.length-1].classList.add("col-drop-after");
        else ths[idx].classList.add("col-drop-before");
      }
      function up(){
        th.classList.remove("col-dragging");
        clearDropHints();
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (hoverTableId){
          var targetTable = state.tables.find(function(x){ return x.id===hoverTableId; });
          if (targetTable){
            if (targetTable.id === sourceTable.id){
              var curIdx = sourceTable.columns.indexOf(col);
              var insertIndex = hoverIndex;
              sourceTable.columns.splice(curIdx,1);
              if (insertIndex > curIdx) insertIndex--;
              insertIndex = Math.max(0, Math.min(insertIndex, sourceTable.columns.length));
              sourceTable.columns.splice(insertIndex,0,col);
              scheduleSave(true); render();
            } else if (sourceTable.columns.length <= 1){
              showToast("Ce tableau doit garder au moins une colonne — impossible d'en déplacer la dernière ailleurs.", null);
            } else {
              moveColumnAcrossTables(sourceTable, col, targetTable, hoverIndex);
              scheduleSave(true); render();
            }
          }
        }
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  function renderTop(){
    var status = el("div", {class:"status " + (CLOUD_CLASS[saveStatus] || saveStatus), title:"État de l'enregistrement"}, [
      el("span", {class:"dot"}),
      el("span", {text: STATUS_LABELS[saveStatus] || "…"})
    ]);
    var isTemplate = ctx && ctx.kind === "template";
    var h1 = el("h1", {contenteditable:"true", spellcheck:"false"});
    h1.textContent = state.title;
    plainPaste(h1);
    h1.addEventListener("input", function(){ state.title = h1.textContent; dirty = true; });
    h1.addEventListener("blur", function(){ state.title = h1.textContent.trim() || "Cartographie de thèse"; scheduleSave(true); });
    var sub = el("div", {class:"sub", contenteditable:"true", spellcheck:"false"});
    sub.textContent = state.sub;
    plainPaste(sub);
    sub.addEventListener("input", function(){ state.sub = sub.textContent; dirty = true; });
    sub.addEventListener("blur", function(){ scheduleSave(true); });
    sub.setAttribute("data-ph", "Sous-titre, programme, session… (facultatif)");
    var titleblock = el("div", {class:"titleblock"}, [
      el("div", {class:"eyebrow", text: isTemplate ? "Gabarit" : "Projet de recherche"}),
      h1, sub
    ]);
    var actions = el("div", {class:"top-actions"}, [
      status,
      el("button", {class:"btn small", text:"Exporter ▾", onclick:function(e){ openExportMenu(e.currentTarget); }})
    ]);
    var bar = el("div", {class:"editor-topbar"}, [
      el("button", {class:"btn ghost back-btn", text:"← Mes projets", onclick:function(){ if (ctx && ctx.onBack) ctx.onBack(); }})
    ]);
    var wrap = el("div", {}, [bar, el("div", {class:"top"}, [titleblock, actions])]);
    if (isTemplate){
      wrap.appendChild(el("div", {class:"template-banner", text:"Tu modifies un gabarit. Les nouveaux projets créés à partir de lui reprendront sa structure et son contenu ; les projets déjà créés ne changent pas."}));
    }
    return wrap;
  }

  function openExportMenu(anchor){
    closePopover();
    var pop = el("div", {class:"pop export-pop"});
    pop.appendChild(el("h4", {text:"Exporter"}));
    function item(label, fn){
      pop.appendChild(el("div", {class:"row"}, [el("span", {class:"lbl", text:label, onclick:function(){ doSave(); closePopover(); fn(); }})]));
    }
    item("Texte structuré (.md)", function(){ ctx && ctx.onExport && ctx.onExport("md"); });
    item("Sauvegarde du projet (.json)", function(){ ctx && ctx.onExport && ctx.onExport("json"); });
    item("Imprimer / PDF", function(){ window.print(); });
    if (ctx && ctx.cloud) item("Versions précédentes…", function(){ ctx.onExport && ctx.onExport("history"); });
    if (ctx && ctx.kind !== "template") item("Enregistrer comme gabarit…", function(){ ctx.onExport && ctx.onExport("template"); });
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  function renderIntro(){
    var box = el("div", {class:"intro"});
    var p = document.createElement("div");
    p.innerHTML = "";
    p.textContent = "Tout est modifiable directement : titres, colonnes, cases. Les consignes en première colonne te guident ; écris tes réponses dans les colonnes « Réponses » ou « Rédaction ». Ajoute des repères (étiquettes de couleur) pour suivre tes thèmes, et relie des cases avec 🔗. Tout s'enregistre automatiquement dans ce navigateur.";
    box.appendChild(p);
    box.appendChild(el("button", {title:"Masquer", text:"✕", onclick:function(){ state.showIntro=false; scheduleSave(true); render(); }}));
    return box;
  }

  function renderTagbar(){
    var bar = el("div", {class:"tagbar"});
    state.tags.forEach(function(tag){
      var chip = el("span", {class:"tagchip" + (dimTag===tag.id?" active":"")});
      chip.style.background = "var(--tag-"+tag.color+"-bg)";
      chip.style.color = "var(--tag-"+tag.color+")";
      var sw = el("span", {class:"swatch"}); sw.style.background = "var(--tag-"+tag.color+")";
      var lbl = el("span", {contenteditable:"true", spellcheck:"false", text: tag.label});
      lbl.addEventListener("click", function(e){ e.stopPropagation(); });
      plainPaste(lbl);
      lbl.addEventListener("input", function(){ tag.label = lbl.textContent; dirty = true; });
      lbl.addEventListener("blur", function(){ tag.label = lbl.textContent.trim() || tag.label; scheduleSave(true); });
      var rm = el("button", {class:"rm", title:"Supprimer ce repère", text:"✕", onclick:function(e){
        e.stopPropagation();
        askConfirm("Supprimer le repère « " + tag.label + " » ? Il sera retiré de toutes les cases.", function(){
          state.tags = state.tags.filter(function(t){return t.id!==tag.id;});
          state.tables.forEach(function(tb){ tb.rows.forEach(function(r){ Object.keys(r.cells).forEach(function(cid){ r.cells[cid].tags = r.cells[cid].tags.filter(function(x){return x!==tag.id;}); }); }); });
          state.diagrams.forEach(function(d){ d.nodes.forEach(function(n){ n.tags = n.tags.filter(function(x){return x!==tag.id;}); }); });
          if (dimTag===tag.id) dimTag=null;
          scheduleSave(true); render();
        });
      }});
      chip.appendChild(sw); chip.appendChild(lbl); chip.appendChild(rm);
      chip.addEventListener("click", function(){
        dimTag = (dimTag===tag.id) ? null : tag.id;
        render();
      });
      bar.appendChild(chip);
    });
    bar.appendChild(renderTagAdd());
    return bar;
  }

  function renderTagAdd(){
    var wrap = el("div", {class:"tag-add"});
    var picked = TAG_COLORS[Math.floor(Math.random()*TAG_COLORS.length)];
    var sws = el("div", {class:"tag-swatches"});
    TAG_COLORS.forEach(function(c){
      var s = el("span", {class:"tag-swatch" + (c===picked?" sel":"")});
      s.style.background = "var(--tag-"+c+")";
      s.addEventListener("click", function(){
        picked = c;
        Array.prototype.forEach.call(sws.children, function(ch,i){ ch.classList.toggle("sel", TAG_COLORS[i]===picked); });
      });
      sws.appendChild(s);
    });
    var input = el("input", {placeholder:"Nouveau repère…", "aria-label":"Nom du nouveau repère"});
    function commit(){
      var v = input.value.trim();
      if (!v) return;
      state.tags.push({id:uid("tag"), label:v, color:picked});
      input.value = "";
      scheduleSave(true); render();
    }
    input.addEventListener("keydown", function(e){ if (e.key==="Enter"){ e.preventDefault(); commit(); } });
    wrap.appendChild(sws); wrap.appendChild(input);
    var opener = el("button", {class:"tag-open", type:"button", title:"Créer un nouveau repère", text:"+ Repère"});
    opener.addEventListener("click", function(){ wrap.classList.add("open"); setTimeout(function(){ input.focus(); }, 0); });
    input.addEventListener("blur", function(){ setTimeout(function(){ if (!input.value.trim() && !wrap.contains(document.activeElement)) wrap.classList.remove("open"); }, 150); });
    wrap.insertBefore(opener, wrap.firstChild);
    return wrap;
  }

  function renderToolbar(){
    var bar = el("div", {class:"toolbar"});
    bar.appendChild(el("button", {class:"btn ghost nav-toggle", title:"Afficher le sommaire", text:"☰ Sommaire", onclick:function(){
      document.body.classList.toggle("nav-open");
    }}));
    bar.appendChild(el("button", {class:"btn primary", text:"+ Nouveau tableau", onclick:function(){
      var t = {id:uid("tbl"), title:"Nouveau tableau", columns:[{id:uid("col"),label:"Colonne 1"},{id:uid("col"),label:"Colonne 2"}], rows:[{id:uid("row"),cells:{}}]};
      var colIds = t.columns.map(function(c){return c.id;});
      t.rows[0].cells = {}; colIds.forEach(function(cid){ t.rows[0].cells[cid] = {text:"", tags:[]}; });
      state.tables.push(t);
      insertAfterFocusedTopLevel(t.id);
      scheduleSave(true); render();
      setTimeout(function(){ var h = document.querySelector('[data-table-title="'+t.id+'"]'); if (h) h.focus(); }, 0);
    }}));
    bar.appendChild(el("button", {class:"btn primary", text:"+ Espace libre", onclick:function(){
      var d = {id:uid("dgr"), title:"Nouvel espace libre", nodes:[], arrows:[], notes:[]};
      state.diagrams.push(d);
      insertAfterFocusedTopLevel(d.id);
      scheduleSave(true); render();
    }}));
    bar.appendChild(el("button", {class:"btn ghost", text:armedEntity? "Annuler la connexion (Échap)" : "🔗 Cliquer un maillon sur deux cases pour les relier", onclick:function(){
      if (armedEntity){ armedEntity=null; render(); }
    }}));
    bar.appendChild(el("span", {style:"color:var(--ink-faint); font-size:12.5px; padding-left:2px;", text:"⠿ Glisse la poignée d'un tableau (ou du schéma) pour changer son ordre sur la page. Les lignes et les colonnes ont aussi leur ⠿ — glisse-les vers un autre tableau pour les y déplacer."}));
    return bar;
  }

  function renderTable(t, opts){
    opts = opts || {};
    var nested = !!opts.nested;
    var displayRows = opts.rows || t.rows;
    var head = el("div", {class:"table-card-head"});
    var handle = el("button", {class:"drag-handle", type:"button", title: "Glisser pour déplacer ce sous-tableau (dans ce tableau, vers un autre, ou pour en faire une section)", text:"⠿"});
    if (nested) head.appendChild(handle);
    var h2 = el("h2", {contenteditable:"true", spellcheck:"false", "data-table-title":t.id, text:opts.title || t.title});
    plainPaste(h2);
    h2.addEventListener("input", function(){
      if (opts.header){
        var source = t.columns.find(function(c){ return /^sources?$/i.test(c.label || ""); }) || t.columns[0];
        if (source) opts.header.cells[source.id].text = h2.innerHTML;
      } else t.title = h2.textContent;
      dirty = true;
    });
    h2.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); h2.blur(); } });
    h2.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:null, colId:null, diagramId:null}; });
    h2.addEventListener("blur", function(){ scheduleSave(true); if (!nested && !opts.header){ var lab = document.querySelector(".sb-item.active .sb-label"); if (lab) lab.textContent = stripHtml(t.title) || "(sans titre)"; } });
    head.appendChild(h2);
    var tableAnchorType = inheritedAnchorType(t);
    if (tableAnchorType) head.appendChild(anchorTypeBadge(tableAnchorType));
    var actions = el("div", {class:"table-card-actions"});
    function addColumn(){
      var col = {id:uid("col"), label:"Nouvelle colonne"};
      var insertAt = t.columns.length;
      if (lastFocus.kind==="table" && lastFocus.tableId===t.id && lastFocus.colId){
        var curCol = t.columns.find(function(c){ return c.id===lastFocus.colId; });
        if (curCol) insertAt = t.columns.indexOf(curCol)+1;
      }
      t.columns.splice(insertAt, 0, col);
      t.rows.forEach(function(r){ r.cells[col.id] = {text:"", tags:[]}; });
      if (!t.rows.length){ var r0 = {id:uid("row"), cells:{}}; t.columns.forEach(function(c){ r0.cells[c.id] = {text:"", tags:[]}; }); t.rows.push(r0); }
      scheduleSave(true); render();
    }
    function addSubTable(){
      var child = {id:uid("tbl"), parentId:t.id, title:"Nouveau sous-tableau", columns:[{id:uid("col"),label:"Colonne 1"},{id:uid("col"),label:"Colonne 2"}], rows:[{id:uid("row"),cells:{}}]};
      child.columns.forEach(function(c){ child.rows[0].cells[c.id] = {text:"", tags:[]}; });
      insertNestedChildAfterFocus(state.tables, child, t.id, "table");
      scheduleSave(true); render();
      setTimeout(function(){ var h = document.querySelector('[data-table-title="'+child.id+'"]'); if (h){ h.focus(); h.scrollIntoView({block:"center", behavior:"smooth"}); } }, 0);
    }
    function addSubDiagram(){
      var d = {id:uid("dgr"), parentId:t.id, title:"Nouvel espace libre", nodes:[], arrows:[], notes:[]};
      insertNestedChildAfterFocus(state.diagrams, d, t.id, "diagram");
      scheduleSave(true); render();
    }
    var moreBtn = iconBtn("more", "Options du tableau", null, "card-more");
    moreBtn.addEventListener("click", function(){
      openMenu(moreBtn, null, [
        {icon:"column", label:"Ajouter une colonne", run:addColumn},
        {icon:"table", label:"Ajouter un sous-tableau", run:addSubTable},
        {icon:"canvas", label:"Ajouter un espace libre", run:addSubDiagram},
        {sep:true},
        {icon:t.anchorType ? ANCHOR_TYPES[t.anchorType].icon : "anchor", label:"Référentiel : " + (t.anchorType ? ANCHOR_TYPES[t.anchorType].label : "Aucun"), run:function(){ openMenu(moreBtn, "Type de référentiel", referenceMenu(moreBtn, t)); }},
        {sep:true},
        (!nested && !t.columns.length && sectionChildren(t).length >= 2) ? {icon:isCardSection(t) ? "check" : null, label:"Afficher les sous-tableaux en cartes", run:function(){ t.cards = isCardSection(t) ? false : true; scheduleSave(true); render(); }} : null,
        (!nested && !t.columns.length && sectionChildren(t).length >= 2) ? {sep:true} : null,
        {icon:t.rowLines === "strong" ? "check" : null, label:"Lignes de séparation marquées", run:function(){ t.rowLines = t.rowLines === "strong" ? "" : "strong"; scheduleSave(true); render(); }},
        {sep:true},
        {icon:"palette", label:"Changer la couleur", run:function(){ openTableColorPopover(moreBtn, t); }},
        {sep:true},
        {icon:"trash", label: nested ? "Supprimer ce sous-tableau" : "Supprimer cette section", danger:true, run:function(){
          var descCount = countDescendants(t.id);
          var msg = "Supprimer « " + t.title + " »" + (descCount ? " ainsi que ses " + descCount + " élément(s) imbriqué(s)" : "") + " et tout son contenu ?";
          askConfirm(msg, function(){ deleteTableCascade(t.id); scheduleSave(true); render(); });
        }}
      ]);
    });
    if (!t.columns.length) actions.appendChild(btn("table", "Sous-tableau", addSubTable, "small ghost"));
    actions.appendChild(moreBtn);
    head.appendChild(actions);

    var table = el("table", {class:"datatable" + (t.rowLines === "strong" ? " row-lines-strong" : "")});
    var thead = el("thead");
    var trh = el("tr");
    trh.appendChild(el("th", {class:"rowdrag-th"}));
    t.columns.forEach(function(col){
      var th = el("th");
      var colHandle = el("button", {class:"col-drag-handle", title:"Déplacer cette colonne (dans ce tableau ou vers un autre)", text:"⠿"});
      th.appendChild(colHandle);
      var lbl = el("span", {class:"th-label", contenteditable:"true", spellcheck:"false", text:col.label});
      plainPaste(lbl);
      lbl.addEventListener("input", function(){ col.label = lbl.textContent; dirty = true; });
      lbl.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:null, colId:col.id, diagramId:null}; });
      lbl.addEventListener("blur", function(){ scheduleSave(true); });
      th.appendChild(lbl);
      makeColDraggable(colHandle, th, t, col);
      if (t.columns.length>1){
        th.appendChild(el("button", {class:"colrm", title:"Supprimer la colonne", text:"✕", onclick:function(){
          askConfirm("Supprimer la colonne « " + col.label + " » dans « " + t.title + " » ?", function(){
            t.rows.forEach(function(r){
              var eid = entityKeyForCell(t.id,r.id,col.id);
              state.links = state.links.filter(function(l){return l.a!==eid && l.b!==eid;});
              delete r.cells[col.id];
            });
            t.columns = t.columns.filter(function(c){return c.id!==col.id;});
            scheduleSave(true); render();
          });
        }}));
      }
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = el("tbody");
    displayRows.forEach(function(row){
      var tr = el("tr");
      var rowdragTd = el("td", {class:"rowdrag-td"});
      var rowHandle = el("button", {class:"row-drag-handle", title:"Déplacer cette ligne (dans ce tableau ou vers un autre)", text:"⠿"});
      rowdragTd.appendChild(rowHandle);
      if (!row.kind) tr.appendChild(rowdragTd);
      makeRowDraggable(rowHandle, tr, t, row);
      if (row.kind){
        var sourceCol = t.columns.find(function(c){ return /^sources?$/i.test(c.label || ""); }) || t.columns[0];
        var sourceCell = sourceCol ? (row.cells[sourceCol.id] || {text:"",tags:[]}) : {text:"",tags:[]};
        if (sourceCol) row.cells[sourceCol.id] = sourceCell;
        var bandTd = el("td", {colspan:String(Math.max(1, t.columns.length)), class:"row-band row-band-" + row.kind});
        var bandWrap = el("div", {class:"cellwrap entity-wrap"});
        bandWrap.appendChild(rowHandle);
        var bandEid = sourceCol ? entityKeyForCell(t.id,row.id,sourceCol.id) : null;
        if (bandEid) bandWrap.setAttribute("data-entity", bandEid);
        var bandText = el("div", {class:"celltext rich", contenteditable:"true", spellcheck:"false", "data-ph":"…"});
        bandText.innerHTML = sourceCell.text || "";
        attachRichText(bandText, sourceCell, "text");
        plainPaste(bandText);
        bandText.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:row.id, colId:sourceCol && sourceCol.id, diagramId:null}; });
        bandWrap.appendChild(bandText);
        bandWrap.appendChild(renderCellTags(sourceCell));
        if (bandEid) bandWrap.appendChild(renderIcons(bandEid, sourceCell));
        if (t.rows.length>1) bandWrap.appendChild(el("button", {class:"rowrm", title:"Supprimer la ligne", text:"✕ ligne", onclick:function(){
          askConfirm("Supprimer cette ligne dans « " + t.title + " » ?", function(){
            removeEntitiesForRow(t.id, row.id);
            t.rows = t.rows.filter(function(r){return r.id!==row.id;}); scheduleSave(true); render();
          });
        }}));
        bandTd.appendChild(bandWrap); tr.appendChild(bandTd);
      } else t.columns.forEach(function(col, ci){
        var cell = row.cells[col.id] || {text:"",tags:[]};
        row.cells[col.id] = cell;
        var td = el("td", {"data-label": stripHtml(col.label || "")});
        var wrap = el("div", {class:"cellwrap entity-wrap"});
        var eid = entityKeyForCell(t.id,row.id,col.id);
        wrap.setAttribute("data-entity", eid);
        var rowAnchor = inheritedAnchorType(t) && !row.kind ? anchorById(anchorId(t.id, row.id)) : null;
        if (rowAnchor && ci === 0) wrap.setAttribute("data-anchor", rowAnchor.id);
        if (dimTag && cell.tags.indexOf(dimTag)>=0) wrap.classList.add("tag-match");
        if (ci===0 && t.rows.length>1){
          wrap.appendChild(el("button", {class:"rowrm", title:"Supprimer la ligne", text:"✕ ligne", onclick:function(){
            askConfirm("Supprimer cette ligne dans « " + t.title + " » ?", function(){
              removeEntitiesForRow(t.id, row.id);
              t.rows = t.rows.filter(function(r){return r.id!==row.id;});
              scheduleSave(true); render();
            });
          }}));
        }
        var txt = el("div", {class:"celltext rich", contenteditable:"true", spellcheck:"false", "data-ph":"…"});
        txt.innerHTML = cell.text || "";
        attachRichText(txt, cell, "text");
        plainPaste(txt);
        txt.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:row.id, colId:col.id, diagramId:null}; setContextEntity(rowAnchor && ci === 0 ? rowAnchor.id : eid); });
        wrap.appendChild(txt);
        if (rowAnchor && ci === 0){
          var used = linkIndex.byAnchor.get(rowAnchor.id) || [];
          wrap.appendChild(el("button", {class:"anchor-used", type:"button", text:"Utilisée dans " + used.length, title:"Ouvrir la fiche de l'ancre", onclick:function(e){ e.stopPropagation(); openAnchorSheet(rowAnchor.id); }}));
        }
        var linkEntity = rowAnchor && ci === 0 ? rowAnchor.id : eid;
        if (dimAnchor && !entityMatchesAnchor(linkEntity)) wrap.classList.add("dim-anchor");
        var attachments = renderAttachmentPills(linkEntity);
        if (attachments) wrap.appendChild(attachments);
        if (attachments){
          var attachmentMeta = anchorLinksFor(linkEntity).map(function(item){ return item.anchor && ANCHOR_TYPES[item.anchor.type]; }).filter(Boolean);
          if (attachmentMeta.length) wrap.style.borderLeft = "4px solid var(--tag-" + (attachmentMeta[0].color === "violet" ? "mauve" : attachmentMeta[0].color) + ")";
        }
        wrap.appendChild(renderCellTags(cell));
        wrap.appendChild(renderIcons(linkEntity, cell));
        td.appendChild(wrap);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var addRowBtn = el("div", {class:"table-add-row"}, [
      el("button", {class:"btn small ghost addrow", type:"button", title:"Ajouter une ligne (juste après celle où tu es, si tu y étais)", text:"+ Ligne", onclick:function(){
        var r = {id:uid("row"), cells:{}};
        t.columns.forEach(function(c){ r.cells[c.id] = {text:"", tags:[]}; });
        var insertAt = t.rows.length;
        if (lastFocus.kind==="table" && lastFocus.tableId===t.id && lastFocus.rowId){
          var curRow = t.rows.find(function(rr){ return rr.id===lastFocus.rowId; });
          if (curRow) insertAt = t.rows.indexOf(curRow)+1;
        }
        t.rows.splice(insertAt, 0, r);
        scheduleSave(true); render();
      }})
    ]);

    // Un tableau sans colonne est un conteneur pur (utilisé pour ranger des
    // sous-tableaux / espaces libres) : il n'a pas de grille de données, donc
    // pas de bouton « + Ajouter une ligne » — sinon on crée des lignes sans
    // aucune cellule où écrire.
    var cardKids = t.columns.length
      ? [head, el("div", {class:"scrollwrap"}, [table]), addRowBtn]
      : [head];
    var childTables = state.tables.filter(function(x){ return x.parentId === t.id; });
    var childDiagrams = state.diagrams.filter(function(x){ return x.parentId === t.id; });
    if (childTables.length || childDiagrams.length){
      var childrenWrap = el("div", {class:"nested-tables"});
      childTables.forEach(function(child){ childrenWrap.appendChild(renderTable(child, {nested:true})); });
      childDiagrams.forEach(function(child){ childrenWrap.appendChild(renderDiagram(child, {nested:true})); });
      cardKids.push(childrenWrap);
    }
    var card = el("div", {class:"table-card" + (nested ? " nested" : " is-top") + (t.columns.length ? "" : " container"), "data-table-id": t.id, "data-color": t.color}, cardKids);
    if (nested) makeBlockDraggable(handle, card, t, "table");
    return card;
  }

  function renderCellTags(cell){
    var box = el("div", {class:"cell-tags"});
    (cell.tags||[]).forEach(function(tid){
      var tag = tagById(tid);
      if (!tag) return;
      var m = el("span", {class:"mini-tag", text:tag.label});
      m.style.background = "var(--tag-"+tag.color+"-bg)";
      m.style.color = "var(--tag-"+tag.color+")";
      box.appendChild(m);
    });
    return box;
  }

  function anchorTypeBadge(type){
    var meta = ANCHOR_TYPES[type];
    return meta ? el("span", {class:"anchor-type-badge", "data-anchor-type":type}, [icon(meta.icon), el("span", {text:meta.label})]) : null;
  }
  function anchorLinksFor(entityId){
    return linksFor(entityId).map(function(link){
      var other = link.a === entityId ? link.b : link.a;
      return {link:link, other:other, anchor:anchorById(other)};
    });
  }
  function renderAttachmentPills(entityId){
    var related = anchorLinksFor(entityId), pills = [];
    related.forEach(function(item){
      if (item.anchor){
        var meta = ANCHOR_TYPES[item.anchor.type];
        pills.push(el("button", {class:"attachment-pill", type:"button", title:meta.verb + " : " + item.anchor.fullText, "aria-label":meta.verb + " : " + item.anchor.fullText, onclick:function(e){ e.stopPropagation(); goTo(item.anchor.id); }}, [icon(meta.icon), el("span", {text:meta.label + " · " + item.anchor.text})]));
      } else if (item.other && getEntity(item.other)){
        pills.push(el("button", {class:"attachment-pill attachment-reflection", type:"button", title:"lié à : " + entityLabel(item.other), "aria-label":"Réflexion liée : " + entityLabel(item.other), onclick:function(e){ e.stopPropagation(); goTo(item.other); }}, [icon("link"), el("span", {text:"Réflexion"})]));
      }
    });
    if (!pills.length) return null;
    var wrap = el("div", {class:"attachment-pills"});
    pills.slice(0,4).forEach(function(pill){ wrap.appendChild(pill); });
    if (pills.length > 4) wrap.appendChild(el("button", {class:"attachment-pill attachment-more", type:"button", text:"+" + (pills.length - 4), title:"Voir tous les rattachements", onclick:function(){ openContextPanel(entityId); }}));
    return wrap;
  }
  function entityMatchesAnchor(entityId){
    if (!dimAnchor) return true;
    return (linksFor(entityId) || []).some(function(link){ return link.a === dimAnchor || link.b === dimAnchor; });
  }
  function referenceMenu(anchor, table){
    var items = [{label:"Aucun", run:function(){ delete table.anchorType; scheduleSave(true); render(); }}];
    Object.keys(ANCHOR_TYPES).forEach(function(type){
      items.push({icon:ANCHOR_TYPES[type].icon, label:ANCHOR_TYPES[type].label, run:function(){ table.anchorType = type; scheduleSave(true); render(); }});
    });
    return items;
  }

  function renderIcons(entityId, cellOrNode, isNode){
    var box = el("div", {class:"cell-icons"});
    var n = linksFor(entityId).length;
    var linkBtn = iconBtn("link", armedEntity===entityId ? "Annuler la liaison" : (armedEntity ? "Relier à cette case" : "Relier cette case à une autre"), function(e){ e.stopPropagation(); handleLinkClick(entityId); }, "icon-btn" + (armedEntity===entityId ? " armed" : "") + (armedEntity && armedEntity!==entityId ? " target" : ""));
    if (n>0){ linkBtn.classList.add("has-links"); linkBtn.setAttribute("data-count", n); }
    box.appendChild(linkBtn);
    var tagBtn = iconBtn("tag", "Ajouter des repères", null, "icon-btn");
    tagBtn.addEventListener("click", function(e){ e.stopPropagation(); openTagPopover(tagBtn, cellOrNode); });
    box.appendChild(tagBtn);
    var attachBtn = iconBtn("anchor", "Rattacher cette case", null, "icon-btn attach-btn");
    attachBtn.addEventListener("click", function(e){ e.stopPropagation(); openAnchorPicker(entityId); });
    box.appendChild(attachBtn);
    if (n>0){
      var showLinksBtn = iconBtn("arrow", "Voir les " + n + " lien(s) et y aller", null, "icon-btn");
      showLinksBtn.addEventListener("click", function(e){ e.stopPropagation(); openLinksPopover(showLinksBtn, entityId); });
      box.appendChild(showLinksBtn);
    }
    if (isNode){
      var shapeBtn = iconBtn("shape", "Forme et contour", null, "icon-btn");
      shapeBtn.addEventListener("click", function(e){ e.stopPropagation(); openNodeStylePopover(shapeBtn, cellOrNode); });
      box.appendChild(shapeBtn);
    }
    if (n>0 || (cellOrNode.tags||[]).length) box.classList.add("has-state");
    return box;
  }

  function allAnchors(){
    var result = [];
    state.tables.forEach(function(table){
      if (!inheritedAnchorType(table)) return;
      (table.rows || []).forEach(function(row){
        var anchor = anchorById(anchorId(table.id, row.id));
        if (anchor) result.push(anchor);
      });
    });
    return result;
  }
  function allReflections(){
    var result = [];
    state.tables.forEach(function(table){
      if (inheritedAnchorType(table)) return;
      (table.rows || []).forEach(function(row){
        if (row.kind) return;
        (table.columns || []).forEach(function(col){
          var cell = row.cells[col.id];
          var text = cell && stripHtml(cell.text).trim();
          if (text) result.push({id:entityKeyForCell(table.id, row.id, col.id), text:text.slice(0,80) + (text.length > 80 ? "…" : ""), fullText:text, path:titleOf(table) + " › " + (col.label || "")});
        });
      });
    });
    return result;
  }
  function anchorPath(anchor){
    var parts = [], table = anchor.table;
    while (table){
      parts.unshift(titleOf(table));
      table = table.parentId ? state.tables.find(function(t){ return t.id === table.parentId; }) : null;
    }
    return parts.join(" › ");
  }
  function openAnchorPicker(entityId){
    closePopover();
    var pop = el("div", {class:"pop anchor-picker", role:"dialog", "aria-label":"Rattacher une case"});
    var input = el("input", {class:"field anchor-search", type:"search", placeholder:"Rechercher une ancre…", "aria-label":"Rechercher une ancre"});
    var filter = "all", list = el("div", {class:"anchor-results"});
    var filters = el("div", {class:"anchor-filters"});
    function draw(){
      list.innerHTML = "";
      var query = normalizeText(input.value), anchors = allAnchors().filter(function(anchor){ return filter !== "reflection" && (filter === "all" || anchor.type === filter) && (!query || normalizeText(anchor.text).indexOf(query) >= 0 || normalizeText(anchor.fullText).indexOf(query) >= 0); });
      var reflections = filter === "reflection" ? allReflections().filter(function(item){ return !query || normalizeText(item.text).indexOf(query) >= 0 || normalizeText(item.fullText).indexOf(query) >= 0; }) : [];
      var recent = [];
      if (!query && filter === "all"){
        try { recent = JSON.parse(localStorage.getItem(recentAnchorsKey || ("atelier-recherche:recent-anchors:" + (ctx && ctx.id))) || "[]").map(anchorById).filter(Boolean).slice(0,8); } catch(e){}
        if (recent.length) list.appendChild(el("h4", {class:"anchor-results-heading", text:"Récents"}));
      }
      var shown = new Set();
      recent.forEach(function(anchor){ shown.add(anchor.id); renderAnchorResult(anchor, entityId, list); });
      if (!anchors.length && !reflections.length) list.appendChild(el("p", {class:"lib-hint", text:"Aucune ancre trouvée."}));
      anchors.filter(function(anchor){ return !shown.has(anchor.id); }).forEach(function(anchor){
        renderAnchorResult(anchor, entityId, list);
      });
      reflections.forEach(function(reflection){
        var existingReflection = state.links.some(function(link){ return (link.a === entityId && link.b === reflection.id) || (link.a === reflection.id && link.b === entityId); });
        var result = el("button", {class:"anchor-result" + (existingReflection ? " selected" : ""), type:"button", title:reflection.fullText}, [icon("link"), el("span", {class:"anchor-result-main"}, [el("strong", {text:reflection.text}), el("small", {text:reflection.path})]), existingReflection ? icon("check") : null]);
        result.addEventListener("click", function(){
          var existing = state.links.find(function(link){ return (link.a === entityId && link.b === reflection.id) || (link.a === reflection.id && link.b === entityId); });
          if (existing) state.links = state.links.filter(function(link){ return link !== existing; });
          else state.links.push({id:uid("lnk"), a:entityId, b:reflection.id, rel:"lie"});
          buildLinkIndex(); scheduleSave(true); draw(); refreshAttachmentDisplay(entityId);
        });
        list.appendChild(result);
      });
    }
    function renderAnchorResult(anchor, entityId, list){
      var related = anchorLinksFor(entityId).some(function(item){ return item.other === anchor.id; });
      var meta = ANCHOR_TYPES[anchor.type];
      var result = el("button", {class:"anchor-result" + (related ? " selected" : ""), type:"button", role:"option", "aria-selected":String(related), title:anchor.fullText}, [icon(meta.icon), el("span", {class:"anchor-result-main"}, [el("strong", {text:anchor.text}), el("small", {text:anchorPath(anchor)})]), related ? icon("check") : null]);
      result.addEventListener("click", function(){
        var existing = state.links.find(function(link){ return link.a === entityId && link.b === anchor.id; }) || state.links.find(function(link){ return link.a === anchor.id && link.b === entityId; });
        if (existing) state.links = state.links.filter(function(link){ return link !== existing; });
        else state.links.push({id:uid("lnk"), a:entityId, b:anchor.id});
        recentAnchor(anchor.id); buildLinkIndex(); scheduleSave(true); draw(); refreshAttachmentDisplay(entityId);
      });
      list.appendChild(result);
    }
    var allButton = el("button", {class:"anchor-filter", type:"button", text:"Tous"});
    allButton.addEventListener("click", function(){ filter = "all"; draw(); }); filters.appendChild(allButton);
    Object.keys(ANCHOR_TYPES).forEach(function(type){
      var meta = ANCHOR_TYPES[type];
      var count = allAnchors().filter(function(anchor){ return anchor.type === type; }).length;
      var button = el("button", {class:"anchor-filter", type:"button", text:meta.label + " " + count});
      button.addEventListener("click", function(){ filter = filter === type ? "all" : type; draw(); });
      filters.appendChild(button);
    });
    var reflectionButton = el("button", {class:"anchor-filter", type:"button", text:"Réflexions " + allReflections().length});
    reflectionButton.addEventListener("click", function(){ filter = "reflection"; draw(); }); filters.appendChild(reflectionButton);
    pop.appendChild(input); pop.appendChild(filters); pop.appendChild(list);
    positionPopover(pop, document.querySelector('[data-entity="'+cssEscape(entityId)+'"] .attach-btn, [data-anchor="'+cssEscape(entityId)+'"] .attach-btn') || document.body);
    openPopover = {el:pop};
    input.addEventListener("input", draw);
    input.addEventListener("keydown", function(e){
      if (e.key === "Escape") closePopover();
      if (e.key === "Enter"){ var first = list.querySelector(".anchor-result"); if (first){ e.preventDefault(); first.click(); } }
    });
    draw(); setTimeout(function(){ input.focus(); }, 0);
  }
  function refreshAttachmentDisplay(entityId){
    var anchor = anchorById(entityId), selector = anchor ? '[data-anchor="' + cssEscape(entityId) + '"]' : '[data-entity="' + cssEscape(entityId) + '"]';
    var target = document.querySelector(selector); if (!target) return;
    var old = target.querySelector(".attachment-pills"); if (old) old.remove();
    var pills = renderAttachmentPills(entityId); if (pills) target.appendChild(pills);
    if (contextPanel) updateContextPanel();
  }
  function recentAnchor(id){
    if (!recentAnchorsKey) recentAnchorsKey = "atelier-recherche:recent-anchors:" + (ctx && ctx.id);
    try {
      var list = JSON.parse(localStorage.getItem(recentAnchorsKey) || "[]").filter(function(x){ return x !== id; });
      list.unshift(id); localStorage.setItem(recentAnchorsKey, JSON.stringify(list.slice(0,8)));
    } catch(e){}
  }

  function renderDiagram(diagram, opts){
    opts = opts || {};
    var nested = !!opts.nested;
    var handle = el("button", {class:"drag-handle", type:"button", title:"Glisser pour déplacer cet espace libre", text:"⠿"});
    var headKids = nested ? [handle] : [];
    var h2 = el("h2", {contenteditable:"true", spellcheck:"false", text: diagram.title});
    plainPaste(h2);
    h2.addEventListener("input", function(){ diagram.title = h2.textContent; dirty = true; });
    h2.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); h2.blur(); } });
    h2.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; });
    h2.addEventListener("blur", function(){ scheduleSave(true); });
    headKids.push(h2);
    headKids.push(btn("plus", "Élément", function(){
      var node = {id:uid("n").replace("_",""), x: 30 + Math.random()*260, y: 30+Math.random()*200, text:"Nouvel élément", notes:[{id:uid("note"), text:""}], tags:[], shape:"rect", border:"solid"};
      diagram.nodes.push(node);
      scheduleSave(true); render();
    }, "small ghost"));
    headKids.push(btn("arrow", "Flèche", function(){
      diagram.arrows = diagram.arrows || [];
      diagram.arrows.push({id:uid("arw"), x1:40, y1:40, x2:220, y2:40, dir:"right", style:"solid"});
      scheduleSave(true); render();
    }, "small ghost"));
    var dMore = iconBtn("more", "Options de l'espace libre", null, "card-more");
    dMore.addEventListener("click", function(){
      openMenu(dMore, null, [{icon:"trash", label:"Supprimer cet espace libre", danger:true, run:function(){
        askConfirm("Supprimer l'espace libre « " + diagram.title + " » et tout son contenu ?", function(){ deleteDiagram(diagram.id); scheduleSave(true); render(); });
      }}]);
    });
    headKids.push(dMore);
    var head = el("div", {class:"diagram-head"}, headKids);
    diagram.notes = diagram.notes || [];
    if (diagram.notes.length === 0) diagram.notes.push({id:uid("note"), text:""});
    var hint = el("div", {class:"diagram-notes"});
    diagram.notes.forEach(function(note){
      var lineWrap = el("div", {class:"diagram-note-line"});
      var lineText = el("div", {class:"celltext", contenteditable:"true", spellcheck:"false", "data-ph":"Écrire une note…", "data-note-id":note.id});
      lineText.innerHTML = note.text || "";
      lineText.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; });
      attachRichText(lineText, note, "text");
      plainPaste(lineText);
      lineWrap.appendChild(lineText);
      if (diagram.notes.length > 1){
        lineWrap.appendChild(el("button", {class:"diagram-note-rm", title:"Supprimer cette ligne", text:"✕", onclick:function(){
          diagram.notes = diagram.notes.filter(function(n){ return n.id!==note.id; });
          scheduleSave(true); render();
        }}));
      }
      hint.appendChild(lineWrap);
    });
    hint.appendChild(el("button", {class:"btn small ghost addrow diagram-note-add", text:"+ Ligne", onclick:function(){
      var newNote = {id:uid("note"), text:""};
      diagram.notes.push(newNote);
      scheduleSave(true); render();
      setTimeout(function(){
        var el2 = document.querySelector('[data-note-id="'+newNote.id+'"]');
        if (el2) el2.focus();
      }, 0);
    }}));
    var canvas = el("div", {class:"canvas"});
    var svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    canvas.appendChild(svg);
    var nodeEls = {};

    diagram.nodes.forEach(function(node){
      node.shape = node.shape || "rect";
      node.border = node.border || "solid";
      var nd = el("div", {class:"node entity-wrap shape-"+node.shape + (node.border==="dashed" ? " border-dashed" : "")});
      nd.style.left = node.x + "px";
      nd.style.top = node.y + "px";
      nd.setAttribute("data-entity", node.id);
      nodeEls[node.id] = nd;
      if (dimTag && (node.tags||[]).indexOf(dimTag)>=0) nd.classList.add("tag-match");
      var styleBtn = el("button", {class:"styleadj", title:"Forme et contour", text:"▭"});
      styleBtn.addEventListener("click", function(e){ e.stopPropagation(); openNodeStylePopover(styleBtn, node); });
      nd.appendChild(styleBtn);
      nd.appendChild(el("button", {class:"noderm", title:"Supprimer", text:"✕", onclick:function(e){
        e.stopPropagation();
        askConfirm("Supprimer « " + (stripHtml(node.text)||"cet élément") + " » de l'espace libre ?", function(){
          state.links = state.links.filter(function(l){return l.a!==node.id && l.b!==node.id;});
          diagram.nodes = diagram.nodes.filter(function(n2){return n2.id!==node.id;});
          scheduleSave(true); render();
        });
      }}));
      var title = el("div", {class:"celltext rich", contenteditable:"true", spellcheck:"false"});
      title.innerHTML = node.text || "";
      title.addEventListener("mousedown", function(e){ e.stopPropagation(); });
      title.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; setContextEntity(node.id); });
      attachRichText(title, node, "text");
      plainPaste(title);
      nd.appendChild(title);
      node.notes = node.notes || (node.sub ? [{id:uid("note"), text:node.sub}] : []);
      if (node.notes.length === 0) node.notes.push({id:uid("note"), text:""});
      var notesWrap = el("div", {class:"node-notes"});
      node.notes.forEach(function(note){
        var lineWrap = el("div", {class:"node-note-line"});
        var lineText = el("div", {class:"sub rich", contenteditable:"true", spellcheck:"false", "data-ph":"description…", "data-node-note-id":note.id});
        lineText.innerHTML = note.text || "";
        lineText.addEventListener("mousedown", function(e){ e.stopPropagation(); });
        lineText.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; });
        attachRichText(lineText, note, "text");
        plainPaste(lineText);
        lineWrap.appendChild(lineText);
        if (node.notes.length > 1){
          lineWrap.appendChild(el("button", {class:"node-note-rm", title:"Supprimer cette ligne", text:"✕", onclick:function(e){
            e.stopPropagation();
            node.notes = node.notes.filter(function(n){ return n.id!==note.id; });
            scheduleSave(true); render();
          }}));
        }
        notesWrap.appendChild(lineWrap);
      });
      var addNoteBtn = el("button", {class:"btn small ghost addrow node-note-add", text:"+ Ligne", onclick:function(e){
        e.stopPropagation();
        var newNote = {id:uid("note"), text:""};
        node.notes.push(newNote);
        scheduleSave(true); render();
        setTimeout(function(){
          var el2 = document.querySelector('[data-node-note-id="'+newNote.id+'"]');
          if (el2) el2.focus();
        }, 0);
      }});
      addNoteBtn.addEventListener("mousedown", function(e){ e.stopPropagation(); });
      notesWrap.appendChild(addNoteBtn);
      nd.appendChild(notesWrap);
      nd.appendChild(renderCellTags({tags:node.tags||[]}));
      nd.appendChild(renderIcons(node.id, node, true));

      nd.addEventListener("pointerdown", function(e){
        if (e.target.closest(".icon-btn") || e.target.closest(".noderm") || e.target.closest(".styleadj") || e.target.closest(".node-note-rm") || e.target.closest(".node-note-add") || e.target.isContentEditable) return;
        e.preventDefault();
        var startX = e.clientX, startY = e.clientY;
        var ox = node.x, oy = node.y;
        nd.classList.add("dragging");
        nd.setPointerCapture(e.pointerId);
        function move(ev){
          var dx = ev.clientX-startX, dy = ev.clientY-startY;
          node.x = Math.max(0, ox+dx); node.y = Math.max(0, oy+dy);
          nd.style.left = node.x+"px"; nd.style.top = node.y+"px";
          drawArrows(svg, diagram, nodeEls, canvas);
        }
        function up(ev){
          nd.classList.remove("dragging");
          nd.removeEventListener("pointermove", move);
          nd.removeEventListener("pointerup", up);
          scheduleSave(true);
        }
        nd.addEventListener("pointermove", move);
        nd.addEventListener("pointerup", up);
      });

      canvas.appendChild(nd);
    });

    (diagram.arrows||[]).forEach(function(arrow){
      arrow.dir = arrow.dir || "right";
      arrow.style = arrow.style || "solid";
      var ctrl = el("div", {class:"arrow-controls"});
      function positionArrowControls(){
        ctrl.style.left = ((arrow.x1+arrow.x2)/2) + "px";
        ctrl.style.top = ((arrow.y1+arrow.y2)/2) + "px";
      }
      ["a","b"].forEach(function(end){
        var hx = end==="a" ? "x1" : "x2", hy = end==="a" ? "y1" : "y2";
        var hdl = el("div", {class:"arrow-handle", title:"Déplacer cette extrémité"});
        hdl.style.left = arrow[hx] + "px"; hdl.style.top = arrow[hy] + "px";
        hdl.addEventListener("pointerdown", function(e){
          e.preventDefault(); e.stopPropagation();
          hdl.setPointerCapture(e.pointerId);
          function move(ev){
            var cr = canvas.getBoundingClientRect();
            arrow[hx] = Math.max(0, ev.clientX - cr.left + canvas.scrollLeft);
            arrow[hy] = Math.max(0, ev.clientY - cr.top + canvas.scrollTop);
            hdl.style.left = arrow[hx]+"px"; hdl.style.top = arrow[hy]+"px";
            drawArrows(svg, diagram, nodeEls, canvas);
            positionArrowControls();
          }
          function up(){
            hdl.removeEventListener("pointermove", move);
            hdl.removeEventListener("pointerup", up);
            scheduleSave(true);
          }
          hdl.addEventListener("pointermove", move);
          hdl.addEventListener("pointerup", up);
        });
        canvas.appendChild(hdl);
      });
      var dirBtn = el("button", {title:"Changer la direction (droite / gauche / bidirectionnelle / aucune)", text: arrow.dir==="right"?"→":arrow.dir==="left"?"←":arrow.dir==="both"?"↔":"–"});
      dirBtn.addEventListener("click", function(e){
        e.stopPropagation();
        var order = ["right","left","both","none"];
        arrow.dir = order[(order.indexOf(arrow.dir)+1) % order.length];
        dirBtn.textContent = arrow.dir==="right"?"→":arrow.dir==="left"?"←":arrow.dir==="both"?"↔":"–";
        scheduleSave(true);
        drawArrows(svg, diagram, nodeEls, canvas);
      });
      var styleBtn2 = el("button", {title:"Trait plein / pointillé", text: arrow.style==="dashed"?"┄":"▬"});
      styleBtn2.addEventListener("click", function(e){
        e.stopPropagation();
        arrow.style = arrow.style==="dashed" ? "solid" : "dashed";
        styleBtn2.textContent = arrow.style==="dashed"?"┄":"▬";
        scheduleSave(true);
        drawArrows(svg, diagram, nodeEls, canvas);
      });
      var rmBtn = el("button", {title:"Supprimer cette flèche", text:"✕"});
      rmBtn.addEventListener("click", function(e){
        e.stopPropagation();
        diagram.arrows = diagram.arrows.filter(function(a){return a.id!==arrow.id;});
        scheduleSave(true); render();
      });
      ctrl.appendChild(dirBtn); ctrl.appendChild(styleBtn2); ctrl.appendChild(rmBtn);
      positionArrowControls();
      canvas.appendChild(ctrl);
    });

    setTimeout(function(){ drawArrows(svg, diagram, nodeEls, canvas); }, 0);

    var shell = el("div", {class:"diagram-shell" + (nested ? " nested" : ""), "data-diagram-id": diagram.id}, [head, hint, canvas]);
    if (nested) makeBlockDraggable(handle, shell, diagram, "diagram");
    else makeReorderable(handle, shell, diagram.id);
    return shell;
  }

  function drawArrows(svg, diagram, nodeEls, canvas){
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = document.createElementNS(svg.namespaceURI,"defs");
    var endId = "arrowhead-end-"+diagram.id, startId = "arrowhead-start-"+diagram.id;
    function addMarker(id, reverse){
      var marker = document.createElementNS(svg.namespaceURI,"marker");
      marker.setAttribute("id",id); marker.setAttribute("markerWidth","8"); marker.setAttribute("markerHeight","8");
      marker.setAttribute("refX","6"); marker.setAttribute("refY","3");
      marker.setAttribute("orient", reverse ? "auto-start-reverse" : "auto");
      var path = document.createElementNS(svg.namespaceURI,"path");
      path.setAttribute("d","M0,0 L6,3 L0,6 Z");
      path.setAttribute("fill","var(--accent)");
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    addMarker(endId, false);
    addMarker(startId, true);
    svg.appendChild(defs);

    function nodeCenter(node){
      var elmt = nodeEls[node.id];
      if (!elmt) return null;
      var cr = canvas.getBoundingClientRect();
      var r = elmt.getBoundingClientRect();
      return { x: r.left - cr.left + canvas.scrollLeft + r.width/2, y: r.top - cr.top + canvas.scrollTop + r.height/2 };
    }
    function drawPath(ax,ay,bx,by,dir,style,curve){
      var d;
      if (curve){
        var mx = (ax+bx)/2, my = (ay+by)/2 - 30;
        d = "M"+ax+","+ay+" Q"+mx+","+my+" "+bx+","+by;
      } else {
        d = "M"+ax+","+ay+" L"+bx+","+by;
      }
      var p = document.createElementNS(svg.namespaceURI,"path");
      p.setAttribute("d", d);
      p.setAttribute("fill","none");
      p.setAttribute("stroke","var(--accent)");
      p.setAttribute("stroke-width","1.75");
      if (style==="dashed") p.setAttribute("stroke-dasharray","6,4");
      if (dir==="right" || dir==="both") p.setAttribute("marker-end","url(#"+endId+")");
      if (dir==="left" || dir==="both") p.setAttribute("marker-start","url(#"+startId+")");
      p.setAttribute("opacity","0.75");
      svg.appendChild(p);
    }

    state.links.forEach(function(l){
      var na = diagram.nodes.find(function(n){return n.id===l.a;});
      var nb = diagram.nodes.find(function(n){return n.id===l.b;});
      if (!na || !nb) return;
      var pa = nodeCenter(na), pb = nodeCenter(nb);
      if (!pa || !pb) return;
      drawPath(pa.x, pa.y, pb.x, pb.y, l.dir||"right", l.style||"solid", true);
    });

    (diagram.arrows||[]).forEach(function(arrow){
      drawPath(arrow.x1, arrow.y1, arrow.x2, arrow.y2, arrow.dir||"right", arrow.style||"solid", false);
    });
  }

  function deleteDiagram(diagramId){
    var d = state.diagrams.find(function(x){return x.id===diagramId;});
    if (!d) return;
    var nodeIds = d.nodes.map(function(n){return n.id;});
    state.links = state.links.filter(function(l){ return nodeIds.indexOf(l.a)<0 && nodeIds.indexOf(l.b)<0; });
    state.diagrams = state.diagrams.filter(function(x){return x.id!==diagramId;});
    if (Array.isArray(state.order)){
      var idx = state.order.indexOf(diagramId);
      if (idx>=0) state.order.splice(idx,1);
    }
  }

  function renderFooter(){
    var nodeCount = state.diagrams.reduce(function(a,d){return a+d.nodes.length;},0);
    var count = state.tables.reduce(function(a,t){return a+t.rows.length;},0) + nodeCount;
    return el("footer", {class:"foot"}, [
      el("span", {text: state.tables.length + " tableaux · " + count + " cases/éléments · " + state.links.length + " connexions"}),
      el("span", {text:"Enregistré localement dans ce navigateur — pense à exporter une sauvegarde (.json) de temps en temps."})
    ]);
  }

  /* ---------------- linking ---------------- */

  function handleLinkClick(entityId){
    closePopover();
    if (!armedEntity){
      armedEntity = entityId;
      render();
      showToast("Clique le 🔗 d'une autre case pour créer le lien, ou Échap pour annuler.", null);
      return;
    }
    if (armedEntity === entityId){
      armedEntity = null; render(); return;
    }
    var exists = state.links.some(function(l){
      return (l.a===armedEntity && l.b===entityId) || (l.a===entityId && l.b===armedEntity);
    });
    if (!exists){
      state.links.push({id:uid("lnk"), a:armedEntity, b:entityId});
      scheduleSave(true);
    }
    armedEntity = null;
    render();
  }

  // Enregistre aussi pendant la frappe (après ~1 s de pause), pour les longues séances de notes :
  // l'enregistrement ne redessine pas la page, donc il n'interrompt jamais l'écriture.
  var typingTimer = null;
  document.addEventListener("input", function(e){
    if (!state) return;
    var app = document.getElementById("app");
    if (!app || !app.contains(e.target) || e.target.tagName === "INPUT") return;
    if (saveStatus !== "saving") setStatus("saving");
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function(){ if (dirty) doSave(); }, 1000);
  });

  document.addEventListener("keydown", function(e){
    if (!state) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"){
      var focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest("[data-entity]") : null;
      if (focused){ e.preventDefault(); openAnchorPicker(focused.getAttribute("data-entity")); return; }
    }
    if (e.key === "Escape"){
      if (armedEntity){ armedEntity=null; render(); }
      closePopover();
    }
  });

  // Safety net for long uninterrupted writing sessions: fields only save on blur (see
  // attachRichText above), so if the tab is switched away from or closed while still focused
  // in a field mid-paragraph, nothing would otherwise get persisted. These fire only when the
  // person has stopped actively typing (they've left the tab), so they carry none of the
  // mid-keystroke race that autosaving on every pause did.
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "hidden" && dirty) doSave();
  });
  window.addEventListener("pagehide", function(){ if (dirty) doSave(); });

  /* ---------------- popovers ---------------- */

  function closePopover(){
    if (openPopover && openPopover.el && openPopover.el.parentNode) openPopover.el.parentNode.removeChild(openPopover.el);
    openPopover = null;
    document.removeEventListener("mousedown", outsideCloser, true);
  }
  function outsideCloser(e){
    if (openPopover && !openPopover.el.contains(e.target)) closePopover();
  }
  function positionPopover(pop, anchor){
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    var top = r.bottom + 6, left = r.left;
    var pw = 240;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    pop.style.top = top+"px"; pop.style.left = left+"px";
  }

  function openTagPopover(anchor, cellOrNode){
    closePopover();
    var pop = el("div", {class:"pop"});
    pop.appendChild(el("h4", {text:"Repères"}));
    var list = el("div", {class:"taglist"});
    cellOrNode.tags = cellOrNode.tags || [];
    state.tags.forEach(function(tag){
      var on = cellOrNode.tags.indexOf(tag.id)>=0;
      var row = el("div", {class:"tagrow" + (on?" on":"")});
      var sw = el("span", {class:"swatch"}); sw.style.background = "var(--tag-"+tag.color+")";
      row.appendChild(sw);
      row.appendChild(el("span", {text:tag.label}));
      row.appendChild(el("span", {class:"chk", text:"✓"}));
      row.addEventListener("click", function(){
        var idx = cellOrNode.tags.indexOf(tag.id);
        if (idx>=0) cellOrNode.tags.splice(idx,1); else cellOrNode.tags.push(tag.id);
        scheduleSave(true); closePopover(); render();
      });
      list.appendChild(row);
    });
    pop.appendChild(list);
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  function openLinksPopover(anchor, entityId){
    closePopover();
    var pop = el("div", {class:"pop"});
    pop.appendChild(el("h4", {text:"Cases reliées"}));
    linksFor(entityId).forEach(function(l){
      var other = l.a===entityId ? l.b : l.a;
      var row = el("div", {class:"row"});
      row.appendChild(el("span", {class:"lbl", text: entityLabel(other), title: entityLabel(other), onclick:function(){
        closePopover();
        goTo(other);
      }}));
      row.appendChild(el("button", {text:"✕", title:"Retirer ce lien", onclick:function(){
        state.links = state.links.filter(function(x){return x.id!==l.id;});
        buildLinkIndex(); scheduleSave(true); closePopover(); render();
      }}));
      pop.appendChild(row);
      if (!anchorById(other)){
        var rel = el("select", {class:"link-relation", "aria-label":"Relation du lien"});
        [{v:"lie",t:"lié à"},{v:"approfondit",t:"approfondit"},{v:"nuance",t:"nuance / contredit"},{v:"mene",t:"mène à"}].forEach(function(option){ rel.appendChild(el("option", {value:option.v, text:option.t})); });
        rel.value = l.rel || "lie";
        rel.addEventListener("change", function(){ l.rel = rel.value === "lie" ? "lie" : rel.value; scheduleSave(true); });
        pop.appendChild(rel);
      }
      var sameDiagram = isNodeEntity(entityId) && isNodeEntity(other) && findNodeDiagram(entityId) && findNodeDiagram(entityId)===findNodeDiagram(other);
      if (sameDiagram){
        l.dir = l.dir || "right"; l.style = l.style || "solid";
        var ctrl = el("div", {style:"display:flex; gap:4px; padding:2px 2px 10px; align-items:center;"});
        [["right","→"],["left","←"],["both","↔"],["none","–"]].forEach(function(d2){
          ctrl.appendChild(el("button", {class:"btn small ghost", style: l.dir===d2[0] ? "background:var(--accent-soft); color:var(--accent-ink);" : "", text:d2[1], title:"Direction de la flèche : "+d2[0], onclick:function(){
            l.dir = d2[0]; scheduleSave(true); render(); reopenLinksPopoverFor(entityId);
          }}));
        });
        ctrl.appendChild(el("button", {class:"btn small ghost", text: l.style==="dashed" ? "┄ pointillé" : "▬ plein", title:"Trait plein / pointillé", onclick:function(){
          l.style = l.style==="dashed" ? "solid" : "dashed"; scheduleSave(true); render(); reopenLinksPopoverFor(entityId);
        }}));
        pop.appendChild(ctrl);
      }
    });
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  function reopenLinksPopoverFor(entityId){
    var wrap = document.querySelector('[data-entity="'+cssEscape(entityId)+'"]');
    if (!wrap) return;
    var btn = Array.prototype.filter.call(wrap.querySelectorAll(".icon-btn"), function(b){ return b.title === "Voir les liens"; })[0];
    if (btn) openLinksPopover(btn, entityId);
  }

  function openNodeStylePopover(anchor, node){
    closePopover();
    var pop = el("div", {class:"pop"});
    pop.appendChild(el("h4", {text:"Forme"}));
    var grid = el("div", {class:"shape-grid"});
    [["rect","▭"],["square","◻"],["circle","●"],["oval","⬭"]].forEach(function(s){
      var btn = el("button", {class:"shape-opt" + (node.shape===s[0] ? " sel" : ""), title:s[0], text:s[1]});
      btn.addEventListener("click", function(){
        node.shape = s[0];
        scheduleSave(true); closePopover(); render();
      });
      grid.appendChild(btn);
    });
    pop.appendChild(grid);
    pop.appendChild(el("h4", {text:"Contour"}));
    var bgrid = el("div", {class:"border-grid"});
    [["solid","Plein"],["dashed","Pointillé"]].forEach(function(b){
      var btn = el("button", {class:"border-opt" + (node.border===b[0] ? " sel" : ""), text:b[1]});
      btn.addEventListener("click", function(){
        node.border = b[0];
        scheduleSave(true); closePopover(); render();
      });
      bgrid.appendChild(btn);
    });
    pop.appendChild(bgrid);
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  function openTableColorPopover(anchor, t){
    closePopover();
    var pop = el("div", {class:"pop"});
    pop.appendChild(el("h4", {text:"Couleur du tableau"}));
    var grid = el("div", {class:"color-swatches"});
    var none = el("button", {class:"tag-swatch" + (!t.color ? " sel" : ""), title:"Par défaut", style:"background:var(--surface-2); border:1.5px dashed var(--border-strong); padding:0;"});
    none.addEventListener("click", function(){
      delete t.color;
      scheduleSave(true); closePopover(); render();
    });
    grid.appendChild(none);
    ["blue","mauve","green","yellow","orange","pink"].forEach(function(c){
      var sw = el("button", {class:"tag-swatch" + (t.color===c ? " sel" : ""), title:c, style:"background:var(--tag-"+c+"); padding:0;"});
      sw.addEventListener("click", function(){
        t.color = c;
        scheduleSave(true); closePopover(); render();
      });
      grid.appendChild(sw);
    });
    pop.appendChild(grid);
    positionPopover(pop, anchor);
    openPopover = {el:pop};
    setTimeout(function(){ document.addEventListener("mousedown", outsideCloser, true); },0);
  }

  /* ---------------- side navigation (titles + subtitles) ---------------- */

  function navNodeForTable(t, depth){
    var kids = [];
    state.tables.filter(function(x){ return x.parentId === t.id; }).forEach(function(c){ kids.push(navNodeForTable(c, depth+1)); });
    state.diagrams.filter(function(x){ return x.parentId === t.id; }).forEach(function(c){ kids.push(navNodeForDiagram(c, depth+1)); });
    return {kind:"table", id:t.id, title: stripHtml(t.title||"").trim() || "(sans titre)", depth:depth, children:kids};
  }
  function navNodeForDiagram(d, depth){
    return {kind:"diagram", id:d.id, title: stripHtml(d.title||"").trim() || "(sans titre)", depth:depth, children:[]};
  }
  function buildNavTree(){
    var items = [];
    state.order.forEach(function(id){
      var d = state.diagrams.find(function(x){ return x.id===id; });
      if (d) items.push(navNodeForDiagram(d, 0));
      else {
        var t = state.tables.find(function(x){ return x.id===id; });
        if (t) items.push(navNodeForTable(t, 0));
      }
    });
    return items;
  }
  function renderSideNav(){
    var nav = el("nav", {class:"side-nav"});
    var head = el("div", {class:"side-nav-head"});
    head.appendChild(el("h3", {text:"Sommaire"}));
    head.appendChild(el("button", {class:"nav-close", title:"Fermer le sommaire", text:"✕", onclick:function(){
      document.body.classList.remove("nav-open");
    }}));
    nav.appendChild(head);
    var list = el("ul", {class:"nav-list"});
    function build(nodes){
      nodes.forEach(function(n){
        var li = el("li", {class:"nav-item" + (n.depth===0 ? " nav-top" : ""), style:"padding-left:"+(8+n.depth*14)+"px"});
        li.appendChild(el("a", {text:n.title, onclick:function(){ goToBlock(n.kind, n.id); }}));
        list.appendChild(li);
        if (n.children.length) build(n.children);
      });
    }
    build(buildNavTree());
    nav.appendChild(list);
    return nav;
  }
  function ensureSectionFor(kind, id){
    var top = topLevelAncestorId(kind, id);
    if (top && activeSection !== top){ setSection(top, {keepScroll:true}); return true; }
    var topTable = state.tables.find(function(t){ return t.id === top; });
    var child = topTable && isCardSection(topTable) ? directChildFor(id) : null;
    // La future navigation en fichiers cliquables doit réutiliser activeChild ici,
    // plutôt que créer un second état de navigation.
    if (child && activeChild !== child){ setChild(child); return true; }
    if (child){
      var childTable = state.tables.find(function(t){ return t.id === child; });
      var entityMatch = /^t:([^:]+):([^:]+):/.exec(id || "");
      var anchorMatch = /^r:([^:]+):([^:]+)$/.exec(id || "");
      var group = childTable && entityMatch && entityMatch[1] === child ? subtitleGroupForRow(childTable, entityMatch[2]) : null;
      if (!group && childTable && anchorMatch && anchorMatch[1] === child) group = subtitleGroupForRow(childTable, anchorMatch[2]);
      if (group && activeSubchild !== group.id){ setSubchild(group.id); return true; }
    }
    return false;
  }
  function goToBlock(kind, id){
    if (ensureSectionFor(kind, id)) return setTimeout(function(){ goToBlock(kind, id); }, 30);
    var sel = kind==="diagram" ? '[data-diagram-id="'+cssEscape(id)+'"]' : '[data-table-id="'+cssEscape(id)+'"]';
    var target = document.querySelector(sel);
    if (!target) return;
    target.scrollIntoView({behavior:"smooth", block:"start"});
    target.classList.add("flash");
    setTimeout(function(){ target.classList.remove("flash"); }, 1200);
    document.body.classList.remove("nav-open");
  }

  function goTo(entityId){
    var anchor = anchorById(entityId);
    if (anchor){
      if (ensureSectionFor("table", anchor.table.id)) return setTimeout(function(){ goTo(entityId); }, 30);
      var anchorTarget = document.querySelector('[data-anchor="'+cssEscape(entityId)+'"]');
      if (!anchorTarget) anchorTarget = document.querySelector('[data-entity="'+cssEscape(entityKeyForCell(anchor.table.id, anchor.row.id, anchor.table.columns[0].id))+'"]');
      if (!anchorTarget) return;
      anchorTarget.scrollIntoView({behavior:"smooth", block:"center"}); anchorTarget.classList.add("flash");
      setTimeout(function(){ anchorTarget.classList.remove("flash"); }, 1200); return;
    }
    var m = /^t:([^:]+):/.exec(entityId);
    var owner = m ? ["table", m[1]] : (findNodeDiagram(entityId) ? ["diagram", findNodeDiagram(entityId).id] : null);
    if (owner && ensureSectionFor(owner[0], owner[1])) return setTimeout(function(){ goTo(entityId); }, 30);
    var target = document.querySelector('[data-entity="'+cssEscape(entityId)+'"]');
    if (!target) return;
    target.scrollIntoView({behavior:"smooth", block:"center"});
    target.classList.add("flash");
    setTimeout(function(){ target.classList.remove("flash"); }, 1200);
  }
  function cssEscape(s){ return s.replace(/[^a-zA-Z0-9_\-]/g, "\\$&"); }

  function applyDim(){
    document.body.classList.toggle("dimming", !!dimTag);
  }

  /* ---------------- confirm & toast (no native dialogs) ---------------- */

  function askConfirm(message, onYes, yesLabel){
    var overlay = el("div", {class:"overlay"});
    var modal = el("div", {class:"modal"});
    modal.appendChild(el("p", {text:message}));
    var row = el("div", {class:"row"});
    row.appendChild(el("button", {class:"btn ghost", text:"Annuler", onclick:function(){ document.body.removeChild(overlay); }}));
    row.appendChild(el("button", {class:"btn danger", text:yesLabel || "Supprimer", onclick:function(){ document.body.removeChild(overlay); onYes(); }}));
    modal.appendChild(row);
    overlay.appendChild(modal);
    overlay.addEventListener("mousedown", function(e){ if (e.target===overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  }

  var toastTimer = null;
  function showToast(msg, actionLabel, actionFn){
    var old = document.querySelector(".toast");
    if (old) old.parentNode.removeChild(old);
    var t = el("div", {class:"toast"}, [el("span", {text:msg})]);
    if (actionLabel) t.appendChild(el("button", {text:actionLabel, onclick:actionFn}));
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  function setContextEntity(entityId){
    contextEntity = entityId;
    if (contextPanel) updateContextPanel();
  }
  function toggleContextPanel(){
    if (contextPanel){ contextPanel.remove(); contextPanel = null; try { localStorage.setItem("atelier-recherche:context-panel:" + (ctx && ctx.id), "closed"); } catch(e){} return; }
    contextPanel = el("aside", {class:"context-panel", "aria-label":"Liens"});
    document.body.appendChild(contextPanel); try { localStorage.setItem("atelier-recherche:context-panel:" + (ctx && ctx.id), "open"); } catch(e){} updateContextPanel();
  }
  function updateContextPanel(){
    if (!contextPanel) return;
    contextPanel.innerHTML = "";
    var entity = contextEntity && getEntity(contextEntity);
    contextPanel.appendChild(el("div", {class:"context-panel-head"}, [el("h3", {text:"Liens"}), el("button", {class:"ibtn", type:"button", title:"Fermer", "aria-label":"Fermer le panneau Liens", text:"×", onclick:toggleContextPanel})]));
    if (!entity){ contextPanel.appendChild(el("p", {class:"lib-hint", text:"Place le curseur dans une case pour voir ses liens."})); return; }
    contextPanel.appendChild(el("p", {class:"context-excerpt", text:entity.kind === "anchor" ? entity.obj.fullText : entityLabel(contextEntity)}));
    var links = linksFor(contextEntity), attached = [], incoming = [];
    links.forEach(function(link){ var other = link.a === contextEntity ? link.b : link.a; var item = {link:link, other:other, anchor:anchorById(other)}; if (item.anchor) attached.push(item); else incoming.push(item); });
    contextPanel.appendChild(el("h4", {text:"Rattachée à"}));
    attached.forEach(function(item){ contextPanel.appendChild(contextLinkRow(item, contextEntity)); });
    contextPanel.appendChild(el("h4", {text:"Réflexions liées / utilisée par"}));
    incoming.forEach(function(item){ contextPanel.appendChild(contextLinkRow(item, contextEntity)); });
    contextPanel.appendChild(el("button", {class:"btn small primary", type:"button", text:"+ Rattacher", onclick:function(){ openAnchorPicker(contextEntity); }}));
  }
  function contextLinkRow(item, entityId){
    var label = item.anchor ? ANCHOR_TYPES[item.anchor.type].verb + " : " + item.anchor.text : entityLabel(item.other);
    return el("div", {class:"context-link-row"}, [el("button", {class:"context-link-label", type:"button", text:label, title:item.anchor ? item.anchor.fullText : label, onclick:function(){ goTo(item.other); }}), el("button", {class:"ibtn", type:"button", title:"Retirer ce lien", "aria-label":"Retirer ce lien", text:"×", onclick:function(){ state.links = state.links.filter(function(link){ return link !== item.link; }); buildLinkIndex(); scheduleSave(true); updateContextPanel(); render(); }})]);
  }
  function openAnchorSheet(anchorIdValue){
    var anchor = anchorById(anchorIdValue); if (!anchor) return;
    var overlay = el("div", {class:"overlay"}), box = el("div", {class:"modal anchor-sheet", role:"dialog", "aria-modal":"true"});
    var meta = ANCHOR_TYPES[anchor.type];
    box.appendChild(el("div", {class:"anchor-sheet-type"}, [icon(meta.icon), el("span", {text:meta.label})]));
    box.appendChild(el("h3", {text:anchor.text}));
    box.appendChild(el("p", {class:"anchor-sheet-full", text:anchor.fullText}));
    box.appendChild(el("h4", {text:"Tout ce qui s'y rattache"}));
    (linkIndex.byAnchor.get(anchor.id) || []).forEach(function(link){ var other = link.a === anchor.id ? link.b : link.a; box.appendChild(contextLinkRow({link:link, other:other, anchor:null}, anchor.id)); });
    box.appendChild(el("button", {class:"btn small", type:"button", text:"Voir les cases liées à cette ancre", onclick:function(){ dimAnchor = anchor.id; overlay.remove(); render(); }}));
    box.appendChild(el("button", {class:"btn primary", type:"button", text:"Fermer", onclick:function(){ overlay.remove(); }}));
    overlay.appendChild(box); overlay.addEventListener("mousedown", function(e){ if (e.target === overlay) overlay.remove(); }); document.body.appendChild(overlay);
  }

  function removeEntitiesForTable(tableId){
    var prefix = "t:"+tableId+":";
    var anchorPrefix = "r:"+tableId+":";
    state.links = state.links.filter(function(l){ return l.a.indexOf(prefix)!==0 && l.b.indexOf(prefix)!==0 && l.a.indexOf(anchorPrefix)!==0 && l.b.indexOf(anchorPrefix)!==0; });
  }
  function removeEntitiesForRow(tableId, rowId){
    var cellPrefix = "t:" + tableId + ":" + rowId + ":";
    var anchor = anchorId(tableId, rowId);
    state.links = state.links.filter(function(l){ return l.a.indexOf(cellPrefix)!==0 && l.b.indexOf(cellPrefix)!==0 && l.a !== anchor && l.b !== anchor; });
  }

  function countDescendants(tableId){
    var kids = state.tables.filter(function(x){ return x.parentId===tableId; });
    var n = kids.length;
    kids.forEach(function(k){ n += countDescendants(k.id); });
    n += state.diagrams.filter(function(x){ return x.parentId===tableId; }).length;
    return n;
  }

  function deleteTableCascade(tableId){
    var kids = state.tables.filter(function(x){ return x.parentId===tableId; });
    kids.forEach(function(k){ deleteTableCascade(k.id); });
    state.diagrams.filter(function(x){ return x.parentId===tableId; }).forEach(function(d){ deleteDiagram(d.id); });
    removeEntitiesForTable(tableId);
    state.tables = state.tables.filter(function(x){ return x.id!==tableId; });
    if (Array.isArray(state.order)){
      var idx = state.order.indexOf(tableId);
      if (idx>=0) state.order.splice(idx,1);
    }
  }

  /* ---------------- rich text field persistence (no toolbar) ---------------- */

  function attachRichText(elmt, obj, prop){
    // Deliberately no save on "input": a save republishes the whole page, and the live view
    // resyncs to that published copy — if that happened while typing was still in progress,
    // whatever was typed after the save was captured could be wiped out when the page resynced.
    // Saving only on blur (leaving the cell) means a save never lands mid-keystroke.
    elmt.addEventListener("input", function(){ obj[prop] = elmt.innerHTML; dirty = true; updateProgressIndicators(); });
    elmt.addEventListener("blur", function(){
      if (stripHtml(elmt.innerHTML).trim()==="") elmt.innerHTML = "";
      obj[prop] = elmt.innerHTML;
      scheduleSave(true);
    });
  }

  function updateProgressIndicators(){
    if (!state || !activeSection) return;
    var sec = topSections().find(function(s){ return s.id === activeSection; });
    if (!sec) return;
    var current = activeChild ? (state.tables.find(function(t){ return t.id === activeChild; }) || state.diagrams.find(function(d){ return d.id === activeChild; })) : null;
    var currentGroup = current && activeSubchild ? subtitleGroups(current).find(function(group){ return group.id === activeSubchild; }) : null;
    var p = currentGroup ? tableProgress({columns:current.columns, rows:currentGroup.rows}) : current ? sectionProgress({kind:state.tables.indexOf(current) >= 0 ? "table" : "diagram", obj:current}) : sectionProgress(sec);
    var progress = document.querySelector(".sec-progress");
    if (progress){
      var fill = progress.querySelector(".pbar > span");
      var bar = progress.querySelector(".pbar");
      if (fill) fill.style.width = pct(p) + "%";
      if (bar) bar.setAttribute("aria-valuenow", String(pct(p)));
      var label = progress.children[1];
      if (label) label.textContent = p.total ? p.filled + " / " + p.total + " remplies" : "";
    }
  }

  /* ---------------- persistence ---------------- */

  var STATUS_LABELS = {
    saved:"Enregistré sur cet appareil", saving:"Enregistrement…", error:"Erreur d'enregistrement — exporte une copie", idle:"…",
    syncing:"Envoi en ligne…", synced:"Enregistré en ligne", offline:"Hors ligne — gardé sur l'appareil, envoi au retour du réseau"
  };
  var CLOUD_CLASS = {syncing:"saving", synced:"saved", offline:"offline", error:"error"};
  function setStatus(s){ saveStatus = s; var el2 = document.querySelector("#app .status"); if (el2){ el2.className = "status "+(CLOUD_CLASS[s] || s); var lbl = el2.querySelector("span:last-child"); if (lbl) lbl.textContent = STATUS_LABELS[s] || "…"; } }

  function scheduleSave(light){
    if (!state) return;
    dirty = true;
    setStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, light ? 250 : 800);
  }

  function doSave(){
    clearTimeout(saveTimer);
    if (!state || !persist) return;
    if (!dirty){ if (saveStatus === "saving") setStatus(ctx && ctx.cloud ? (ctx.lastCloudStatus || "synced") : "saved"); return; }
    try {
      var json = JSON.stringify(state);
      if (json === lastSavedJson){ dirty = false; if (saveStatus === "saving") setStatus(ctx && ctx.cloud ? (ctx.lastCloudStatus || "synced") : "saved"); return; }
      persist(state);
      lastSavedJson = json;
      dirty = false;
      setStatus(ctx && ctx.cloud ? "syncing" : "saved");
    } catch(err){
      console.error(err);
      setStatus("error");
      showToast("Impossible d'enregistrer (espace du navigateur plein ?). Exporte ton projet en .json.", null);
    }
  }

  /* ---------------- open / close ---------------- */

  function defaultState(){
    return {title:"Nouveau projet de recherche", sub:"", showIntro:true, tags:[], tables:[], diagrams:[], links:[]};
  }

  function migrateState(){
    if (!Array.isArray(state.diagrams)){
      if (state.diagram){
        state.diagrams = [{id:"diagram", parentId: state.diagram.parentId, title: state.diagram.title || "Schéma", nodes: state.diagram.nodes || [], arrows: state.diagram.arrows || []}];
        delete state.diagram;
      } else {
        state.diagrams = [];
      }
    }
    state.diagrams.forEach(function(d){
      d.arrows = d.arrows || [];
      d.nodes = d.nodes || [];
      d.nodes.forEach(function(n){ n.shape = n.shape || "rect"; n.border = n.border || "solid"; n.tags = n.tags || []; });
    });
    if (!Array.isArray(state.tables)) state.tables = [];
    if (!Array.isArray(state.links)) state.links = [];
    if (!Array.isArray(state.tags)) state.tags = [];
    state.tables.forEach(function(t){ t.columns = t.columns || []; t.rows = t.rows || []; t.rows.forEach(function(r){ r.cells = r.cells || {}; Object.keys(r.cells).forEach(function(k){ r.cells[k].tags = r.cells[k].tags || []; r.cells[k].text = r.cells[k].text || ""; }); }); });
    if (typeof state.title !== "string") state.title = "Projet sans titre";
    if (typeof state.sub !== "string") state.sub = "";
  }

  function open(docState, options){
    state = docState || defaultState();
    migrateState();
    ctx = options || {};
    persist = ctx.save || null;
    dirty = false; saveStatus = ctx.initialStatus || "saved";
    lastSavedJson = JSON.stringify(state); armedEntity = null; dimTag = null;
    lastFocus = {kind:null, tableId:null, rowId:null, colId:null, diagramId:null};
    document.body.classList.add("in-editor");
    activeSection = null;
    activeChild = null;
    if (ctx.keepSection) activeSection = ctx.keepSection;
    else { try { activeSection = localStorage.getItem(viewKey()) || null; } catch(e){} }
    if (activeSection){
      try { activeChild = localStorage.getItem(viewKey() + ":child:" + activeSection) || null; } catch(e){}
    }
    if (activeChild){
      try { activeSubchild = localStorage.getItem(viewKey() + ":subchild:" + activeChild) || null; } catch(e){}
    }
    render();
    try { if (localStorage.getItem("atelier-recherche:context-panel:" + (ctx && ctx.id)) === "open") toggleContextPanel(); } catch(e){}
    window.scrollTo(0,0);
  }

  function close(){
    // Fait d'abord perdre le focus au champ en cours, pour que sa dernière saisie soit enregistrée
    // pendant que le projet est encore ouvert.
    var ae = document.activeElement, appEl = document.getElementById("app");
    if (state && ae && appEl && appEl.contains(ae) && ae.blur) ae.blur();
    if (dirty) doSave();
    closePopover();
    state = null; persist = null; ctx = null; armedEntity = null;
    document.body.classList.remove("nav-open","dimming","in-editor");
    var app = document.getElementById("app");
    if (app) app.innerHTML = "";
  }

  return {
    open: open,
    close: close,
    flush: function(){ if (dirty) doSave(); },
    isDirty: function(){ return dirty; },
    currentId: function(){ return ctx ? ctx.id : null; },
    setStatus: function(s){ if (ctx) ctx.lastCloudStatus = s; if (state && !(dirty && s === "synced")) setStatus(s); },
    getState: function(){ return state; },
    currentSection: function(){ return activeSection; },
    progressOf: function(st){
      var saved = state; state = st;
      try { migrateState(); var tot = {total:0, filled:0}; topSections().forEach(function(x){ var p = sectionProgress(x); tot.total += p.total; tot.filled += p.filled; }); return tot; }
      finally { state = saved; }
    }
  };
})();
