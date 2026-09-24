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
    if (isNodeEntity(entityId)) return { kind:"node", obj: findNode(entityId) };
    var c = findCell(entityId);
    return c ? { kind:"cell", obj:c } : null;
  }
  function stripHtml(html){
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent || "";
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
    if (e.kind === "node") return stripHtml(e.obj.text) || "(sans titre)";
    var m = /^t:([^:]+):([^:]+):([^:]+)$/.exec(entityId);
    var table = state.tables.find(function(t){return t.id===m[1];});
    var col = table ? table.columns.find(function(c){return c.id===m[3];}) : null;
    var text = stripHtml(e.obj.text).trim();
    var short = text.length>46 ? text.slice(0,46)+"…" : text;
    return (table?table.title:"Tableau") + " · " + (col?col.label:"") + (short ? " — "+short : "");
  }
  function linksFor(entityId){
    return state.links.filter(function(l){return l.a===entityId || l.b===entityId;});
  }
  function tagById(id){ return state.tags.find(function(t){return t.id===id;}); }

  /* ---------------- render ---------------- */

  function render(){
    var app = document.getElementById("app");
    app.innerHTML = "";
    var scrim = el("div", {class:"nav-scrim", onclick:function(){ document.body.classList.remove("nav-open"); }});
    app.appendChild(scrim);
    var shell = el("div", {class:"page-shell"});
    shell.appendChild(renderSideNav());
    var main = el("div", {class:"main-col"});
    main.appendChild(renderTop());
    if (state.showIntro) main.appendChild(renderIntro());
    main.appendChild(renderTagbar());
    main.appendChild(renderToolbar());
    normalizeOrder();
    var board = el("div", {class:"board"});
    state.order.forEach(function(id){
      var d = state.diagrams.find(function(x){return x.id===id;});
      if (d) board.appendChild(renderDiagram(d));
      else {
        var t = state.tables.find(function(x){return x.id===id;});
        if (t) board.appendChild(renderTable(t));
      }
    });
    main.appendChild(board);
    main.appendChild(renderFooter());
    shell.appendChild(main);
    app.appendChild(shell);
    applyDim();
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
    bar.appendChild(el("span", {class:"tagbar-label", text:"Repères :"}));
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
    var input = el("input", {placeholder:"+ repère…"});
    function commit(){
      var v = input.value.trim();
      if (!v) return;
      state.tags.push({id:uid("tag"), label:v, color:picked});
      input.value = "";
      scheduleSave(true); render();
    }
    input.addEventListener("keydown", function(e){ if (e.key==="Enter"){ e.preventDefault(); commit(); } });
    wrap.appendChild(sws); wrap.appendChild(input);
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
    var head = el("div", {class:"table-card-head"});
    var handle = el("button", {class:"drag-handle", title: nested ? "Déplacer ce sous-tableau (dans ce tableau, vers un autre, ou hors des tableaux)" : "Déplacer ce tableau", text:"⠿"});
    head.appendChild(handle);
    var h2 = el("h2", {contenteditable:"true", spellcheck:"false", "data-table-title":t.id, text:t.title});
    plainPaste(h2);
    h2.addEventListener("input", function(){ t.title = h2.textContent; dirty = true; });
    h2.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:null, colId:null, diagramId:null}; });
    h2.addEventListener("blur", function(){ scheduleSave(true); });
    head.appendChild(h2);
    var actions = el("div", {class:"table-card-actions"});
    var colorBtn = el("button", {class:"table-color-btn", title:"Changer la couleur du tableau"});
    var colorDot = el("span", {class:"table-color-dot"});
    if (t.color) colorDot.style.background = "var(--tag-"+t.color+")";
    colorBtn.appendChild(colorDot);
    colorBtn.addEventListener("click", function(){ openTableColorPopover(colorBtn, t); });
    actions.appendChild(colorBtn);
    actions.appendChild(el("button", {class:"btn small ghost", title:"Ajouter une colonne (juste après celle où tu es, si tu y étais)", text:"+ Colonne", onclick:function(){
      var col = {id:uid("col"), label:"Nouvelle colonne"};
      var insertAt = t.columns.length;
      if (lastFocus.kind==="table" && lastFocus.tableId===t.id && lastFocus.colId){
        var curCol = t.columns.find(function(c){ return c.id===lastFocus.colId; });
        if (curCol) insertAt = t.columns.indexOf(curCol)+1;
      }
      t.columns.splice(insertAt, 0, col);
      t.rows.forEach(function(r){ r.cells[col.id] = {text:"", tags:[]}; });
      scheduleSave(true); render();
    }}));
    actions.appendChild(el("button", {class:"btn small ghost", title:"Ajouter un sous-tableau imbriqué dans celui-ci (juste après celui où tu es, si tu y étais)", text:"+ Sous-tableau", onclick:function(){
      var child = {id:uid("tbl"), parentId:t.id, title:"Nouveau sous-tableau", columns:[{id:uid("col"),label:"Colonne 1"},{id:uid("col"),label:"Colonne 2"}], rows:[{id:uid("row"),cells:{}}]};
      var colIds = child.columns.map(function(c){return c.id;});
      child.rows[0].cells = {}; colIds.forEach(function(cid){ child.rows[0].cells[cid] = {text:"", tags:[]}; });
      insertNestedChildAfterFocus(state.tables, child, t.id, "table");
      scheduleSave(true); render();
      setTimeout(function(){ var h = document.querySelector('[data-table-title="'+child.id+'"]'); if (h) h.focus(); }, 0);
    }}));
    actions.appendChild(el("button", {class:"btn small ghost", title:"Ajouter un espace libre imbriqué dans ce tableau (juste après celui où tu es, si tu y étais)", text:"+ Espace libre", onclick:function(){
      var d = {id:uid("dgr"), parentId:t.id, title:"Nouvel espace libre", nodes:[], arrows:[], notes:[]};
      insertNestedChildAfterFocus(state.diagrams, d, t.id, "diagram");
      scheduleSave(true); render();
    }}));
    actions.appendChild(el("button", {class:"btn small danger", title:"Supprimer ce tableau", text:"✕", onclick:function(){
      var descCount = countDescendants(t.id);
      var msg = "Supprimer le tableau « " + t.title + " »" + (descCount ? " ainsi que ses " + descCount + " élément(s) imbriqué(s) (sous-tableaux / espaces libres)" : "") + " et tout son contenu ?";
      askConfirm(msg, function(){
        deleteTableCascade(t.id);
        scheduleSave(true); render();
      });
    }}));
    head.appendChild(actions);

    var table = el("table", {class:"datatable"});
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
    t.rows.forEach(function(row){
      var tr = el("tr");
      var rowdragTd = el("td", {class:"rowdrag-td"});
      var rowHandle = el("button", {class:"row-drag-handle", title:"Déplacer cette ligne (dans ce tableau ou vers un autre)", text:"⠿"});
      rowdragTd.appendChild(rowHandle);
      tr.appendChild(rowdragTd);
      makeRowDraggable(rowHandle, tr, t, row);
      t.columns.forEach(function(col, ci){
        var cell = row.cells[col.id] || {text:"",tags:[]};
        row.cells[col.id] = cell;
        var td = el("td");
        var wrap = el("div", {class:"cellwrap entity-wrap"});
        var eid = entityKeyForCell(t.id,row.id,col.id);
        wrap.setAttribute("data-entity", eid);
        if (dimTag && cell.tags.indexOf(dimTag)>=0) wrap.classList.add("tag-match");
        if (ci===0 && t.rows.length>1){
          wrap.appendChild(el("button", {class:"rowrm", title:"Supprimer la ligne", text:"✕ ligne", onclick:function(){
            askConfirm("Supprimer cette ligne dans « " + t.title + " » ?", function(){
              t.columns.forEach(function(c2){
                var eid2 = entityKeyForCell(t.id,row.id,c2.id);
                state.links = state.links.filter(function(l){return l.a!==eid2 && l.b!==eid2;});
              });
              t.rows = t.rows.filter(function(r){return r.id!==row.id;});
              scheduleSave(true); render();
            });
          }}));
        }
        var txt = el("div", {class:"celltext rich", contenteditable:"true", spellcheck:"false", "data-ph":"…"});
        txt.innerHTML = cell.text || "";
        attachRichText(txt, cell, "text");
        plainPaste(txt);
        txt.addEventListener("focus", function(){ lastFocus = {kind:"table", tableId:t.id, rowId:row.id, colId:col.id, diagramId:null}; });
        wrap.appendChild(txt);
        wrap.appendChild(renderCellTags(cell));
        wrap.appendChild(renderIcons(eid, cell));
        td.appendChild(wrap);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var addRowBtn = el("div", {class:"table-add-row"}, [
      el("button", {class:"btn small ghost addrow", title:"Ajouter une ligne (juste après celle où tu es, si tu y étais)", text:"+ Ajouter une ligne", onclick:function(){
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
    var card = el("div", {class:"table-card" + (nested ? " nested" : ""), "data-table-id": t.id, "data-color": t.color}, cardKids);
    if (nested) makeBlockDraggable(handle, card, t, "table");
    else makeReorderable(handle, card, t.id);
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

  function renderIcons(entityId, cellOrNode, isNode){
    var box = el("div", {class:"cell-icons"});
    var linkBtn = el("button", {class:"icon-btn" + (armedEntity===entityId?" armed":""), title:"Relier cette case à une autre", text:"🔗"});
    linkBtn.addEventListener("click", function(e){
      e.stopPropagation();
      handleLinkClick(entityId);
    });
    var n = linksFor(entityId).length;
    if (n>0){ linkBtn.classList.add("has-links"); linkBtn.setAttribute("data-count", n); }
    box.appendChild(linkBtn);
    var tagBtn = el("button", {class:"icon-btn", title:"Ajouter des repères", text:"◐"});
    tagBtn.addEventListener("click", function(e){ e.stopPropagation(); openTagPopover(tagBtn, cellOrNode); });
    box.appendChild(tagBtn);
    var showLinksBtn = null;
    if (n>0){
      showLinksBtn = el("button", {class:"icon-btn", title:"Voir les liens", text:"→"});
      showLinksBtn.addEventListener("click", function(e){ e.stopPropagation(); openLinksPopover(showLinksBtn, entityId); });
      box.appendChild(showLinksBtn);
    }
    if (isNode){
      var shapeBtn = el("button", {class:"icon-btn", title:"Forme et contour", text:"▭"});
      shapeBtn.addEventListener("click", function(e){ e.stopPropagation(); openNodeStylePopover(shapeBtn, cellOrNode); });
      box.appendChild(shapeBtn);
    }
    return box;
  }

  function renderDiagram(diagram, opts){
    opts = opts || {};
    var nested = !!opts.nested;
    var handle = el("button", {class:"drag-handle", title: nested ? "Déplacer cet espace libre (dans ce tableau, vers un autre, ou hors des tableaux)" : "Déplacer cet espace libre", text:"⠿"});
    var headKids = [handle];
    var h2 = el("h2", {contenteditable:"true", spellcheck:"false", text: diagram.title});
    plainPaste(h2);
    h2.addEventListener("input", function(){ diagram.title = h2.textContent; dirty = true; });
    h2.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; });
    h2.addEventListener("blur", function(){ scheduleSave(true); });
    headKids.push(h2);
    headKids.push(el("button", {class:"btn small ghost", text:"+ Élément", onclick:function(){
      var node = {id:uid("n").replace("_",""), x: 30 + Math.random()*260, y: 30+Math.random()*200, text:"Nouvel élément", notes:[{id:uid("note"), text:""}], tags:[], shape:"rect", border:"solid"};
      diagram.nodes.push(node);
      scheduleSave(true); render();
    }}));
    headKids.push(el("button", {class:"btn small ghost", text:"+ Flèche", title:"Ajouter une flèche indépendante", onclick:function(){
      diagram.arrows = diagram.arrows || [];
      diagram.arrows.push({id:uid("arw"), x1:40, y1:40, x2:220, y2:40, dir:"right", style:"solid"});
      scheduleSave(true); render();
    }}));
    headKids.push(el("button", {class:"btn small danger", title:"Supprimer cet espace libre", text:"✕", onclick:function(){
      askConfirm("Supprimer l'espace libre « " + diagram.title + " » et tout son contenu ?", function(){
        deleteDiagram(diagram.id);
        scheduleSave(true); render();
      });
    }}));
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
      title.addEventListener("focus", function(){ lastFocus = {kind:"diagram", tableId:null, rowId:null, colId:null, diagramId:diagram.id}; });
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
        scheduleSave(true); closePopover(); render();
      }}));
      pop.appendChild(row);
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
  function goToBlock(kind, id){
    var sel = kind==="diagram" ? '[data-diagram-id="'+cssEscape(id)+'"]' : '[data-table-id="'+cssEscape(id)+'"]';
    var target = document.querySelector(sel);
    if (!target) return;
    target.scrollIntoView({behavior:"smooth", block:"start"});
    target.classList.add("flash");
    setTimeout(function(){ target.classList.remove("flash"); }, 1200);
    document.body.classList.remove("nav-open");
  }

  function goTo(entityId){
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

  function askConfirm(message, onYes){
    var overlay = el("div", {class:"overlay"});
    var modal = el("div", {class:"modal"});
    modal.appendChild(el("p", {text:message}));
    var row = el("div", {class:"row"});
    row.appendChild(el("button", {class:"btn ghost", text:"Annuler", onclick:function(){ document.body.removeChild(overlay); }}));
    row.appendChild(el("button", {class:"btn danger", text:"Supprimer", onclick:function(){ document.body.removeChild(overlay); onYes(); }}));
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

  function removeEntitiesForTable(tableId){
    var prefix = "t:"+tableId+":";
    state.links = state.links.filter(function(l){ return l.a.indexOf(prefix)!==0 && l.b.indexOf(prefix)!==0; });
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
    elmt.addEventListener("input", function(){ obj[prop] = elmt.innerHTML; dirty = true; });
    elmt.addEventListener("blur", function(){
      if (stripHtml(elmt.innerHTML).trim()==="") elmt.innerHTML = "";
      obj[prop] = elmt.innerHTML;
      scheduleSave(true);
    });
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
    render();
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
    getState: function(){ return state; }
  };
})();
