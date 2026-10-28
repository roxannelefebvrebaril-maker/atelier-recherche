// Rangement d'une dictée dans les rubriques d'une fiche de lecture, par Claude (API Anthropic).
//   POST /api/ranger { texte, reference, rubriques:[{key,label,hint}], tableaux:[{key,label,hint,columns}] }
//   -> { reference?, rows: { <key>: "texte" }, tables: { <key>: [["col1","col2"], …] } }
// La clé ANTHROPIC_API_KEY se met dans Vercel (Settings → Environment Variables).
// ANTHROPIC_MODEL est facultatif : par défaut, claude-sonnet-5-5.
const C = require("./_lib/common");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TEXT = 20000;

function clean(value, max){ return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max); }

module.exports = async function handler(req, res){
  if (req.method !== "POST") return C.send(res, 405, { error: "Méthode non permise" });
  if (!C.configured()) return C.send(res, 503, { error: "not_configured", missing: C.missingConfig() });
  try {
    const user = await C.requireUser(req, res);
    if (!user) return;
    if (!API_KEY) return C.send(res, 503, { error: "not_configured", missing: ["clé ANTHROPIC_API_KEY"] });

    const body = await C.readBody(req);
    const texte = String(body.texte || "").trim();
    if (!texte) return C.send(res, 400, { error: "La dictée est vide." });
    if (texte.length > MAX_TEXT) return C.send(res, 413, { error: "La dictée est trop longue : range-la en plusieurs fois." });

    const rubriques = (Array.isArray(body.rubriques) ? body.rubriques : []).slice(0, 40)
      .map(r => ({ key: clean(r.key, 80), label: clean(r.label, 120), hint: clean(r.hint, 300) })).filter(r => r.key && r.label);
    const tableaux = (Array.isArray(body.tableaux) ? body.tableaux : []).slice(0, 20)
      .map(t => ({ key: clean(t.key, 80), label: clean(t.label, 120), hint: clean(t.hint, 300),
        columns: (Array.isArray(t.columns) ? t.columns : []).slice(0, 6).map(c => clean(c, 60)) }))
      .filter(t => t.key && t.label && t.columns.length);
    const reference = clean(body.reference, 600);

    const rowProps = {};
    rubriques.forEach(r => { rowProps[r.key] = { type: "string", description: r.label + (r.hint ? " — " + r.hint : "") }; });
    const tableProps = {};
    tableaux.forEach(t => {
      tableProps[t.key] = { type: "array", description: t.label + (t.hint ? " — " + t.hint : "") + ". Une ligne par élément, colonnes dans cet ordre : " + t.columns.join(" | "),
        items: { type: "array", items: { type: "string" }, minItems: t.columns.length, maxItems: t.columns.length } };
    });

    const tool = {
      name: "ranger_fiche",
      description: "Répartit la dictée dans les rubriques et les tableaux de la fiche de lecture.",
      input_schema: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Référence APA 7 complète, seulement si la personne l'a dictée et que la fiche n'en a pas encore. Sinon chaîne vide." },
          rows: { type: "object", properties: rowProps, description: "Texte à ajouter dans chaque rubrique. Omettre une rubrique non abordée." },
          tables: { type: "object", properties: tableProps, description: "Lignes à ajouter dans chaque tableau. Omettre un tableau non abordé." }
        },
        required: ["rows", "tables"]
      }
    };

    const system = [
      "Tu aides une doctorante en communication sociale à remplir ses fiches de lecture scientifiques.",
      "On te donne la transcription vocale de ce qu'elle dit à propos d'un texte qu'elle a lu.",
      "Répartis ses propos dans les rubriques et les tableaux de la fiche avec l'outil ranger_fiche.",
      "Règles :",
      "- Garde ses mots et son sens. Corrige seulement les erreurs évidentes de transcription, la ponctuation et les répétitions orales.",
      "- N'ajoute AUCUNE information qu'elle n'a pas dite : pas de résumé du texte d'après tes connaissances, pas d'auteur·e ni de date inventés.",
      "- Une idée va dans la rubrique la plus juste ; n'en répète pas une dans plusieurs rubriques.",
      "- Ce qu'elle pense, critique ou veut faire pour sa thèse va dans ses réflexions ou ses critiques, pas dans ce que dit l'auteur·e.",
      "- Une citation exacte (« citation, page 120 : … ») va dans le tableau des citations, mot pour mot, avec la page.",
      "- Les définitions et les concepts vont dans leurs tableaux, une ligne par terme.",
      "- Omets toute rubrique et tout tableau qu'elle n'aborde pas.",
      "- Écris en français, au style de notes de lecture."
    ].join("\n");

    const userText = "Référence déjà inscrite dans la fiche : " + (reference || "(aucune)") + "\n\nDictée :\n\"\"\"\n" + texte + "\n\"\"\"";

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, system,
        tools: [tool], tool_choice: { type: "tool", name: "ranger_fiche" },
        messages: [{ role: "user", content: userText }]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok){
      const status = r.status === 429 || r.status === 529 ? 503 : 502;
      const msg = r.status === 401 ? "La clé ANTHROPIC_API_KEY est refusée : vérifie-la dans Vercel."
        : r.status === 429 || r.status === 529 ? "Claude est très sollicité en ce moment. Réessaie dans une minute."
        : "Claude n'a pas pu ranger la dictée (" + ((j.error && j.error.message) || r.status) + ").";
      return C.send(res, status, { error: msg });
    }
    const call = (j.content || []).find(block => block.type === "tool_use");
    const input = (call && call.input) || {};

    // On ne renvoie que les clés demandées, en texte simple.
    const rows = {}, tables = {};
    rubriques.forEach(rb => { const v = input.rows && input.rows[rb.key]; if (typeof v === "string" && v.trim()) rows[rb.key] = v.trim().slice(0, 8000); });
    tableaux.forEach(t => {
      const v = input.tables && input.tables[t.key];
      if (!Array.isArray(v)) return;
      const lines = v.filter(Array.isArray).slice(0, 40).map(line => t.columns.map((_, i) => String(line[i] == null ? "" : line[i]).trim().slice(0, 4000)));
      if (lines.length) tables[t.key] = lines;
    });
    const ref = !reference && typeof input.reference === "string" ? input.reference.trim().slice(0, 600) : "";
    return C.send(res, 200, { reference: ref, rows, tables });
  } catch(e){
    return C.send(res, 500, { error: e.message });
  }
};
