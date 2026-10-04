# Fiches de lecture v2 · Prompt 3 sur 4 : déplacer les éléments d'une fiche

> Colle tout ce qui suit la ligne dans le chat de VS Code, en mode **Agent**. À lancer **après** le prompt 2.

---

> **Important :** une partie de ce travail a peut-être déjà été faite (des changements non publiés existent dans `js/editor.js`, `js/app.js`, `css/theme.css` et `js/fiche-template.js`). **Vérifie d'abord ce qui existe déjà**, complète seulement ce qui manque, ne refais rien en double et corrige ce qui ne respecte pas ce prompt.

Tu travailles sur **Atelier de recherche** (`js/editor.js`, `css/theme.css`, JavaScript vanilla). Les fiches de lecture v2 (`ficheVersion: 2`) affichent leurs éléments dans l'ordre de `fiche.ficheItems`. Il s'agit des rubriques texte, des tableaux intégrés et des zones de rédaction.

Lis `renderFichePage` et les fonctions de glisser-déposer existantes (`makeRowDraggable`, `makeBlockDraggable`, `makeReorderable`, classes `row-drag-handle` et `drag-handle`). Propose-moi ensuite un plan court.

## À faire

Je veux pouvoir **réorganiser moi-même** tous les éléments de ma fiche, comme le reste des tableaux de l'app.

- **Poignée ⠿** à gauche de chaque élément, visible au survol, dans le même style que les poignées existantes.
  - On glisse l'élément vers le haut ou le bas.
  - Une ligne d'insertion colorée montre où il va se placer, comme ailleurs dans l'app.
- **Monter / Descendre** : ajoute ces deux actions dans un petit menu ⋯ sur chaque élément, pour le clavier et le mobile.
- **Tous les éléments** se déplacent : rubriques de base, tableaux et zones. Le **titre** (la référence APA) reste toujours en haut.
- **Ordre enregistré** : le nouvel ordre est sauvegardé dans `fiche.ficheItems` (`scheduleSave(true)`).
- **Nouveaux éléments** : un tableau ou une zone qu'on ajoute arrive d'abord à la fin. On le déplace ensuite.

## Contraintes

- Ne touche pas à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- Le glisser-déposer des autres tableaux de l'app doit continuer de fonctionner comme avant.
- N'appelle jamais `render()` pendant la frappe.

## Tests

- [ ] Je glisse « Notes » au-dessus de « Résumé ». L'ordre reste le même après un rechargement.
- [ ] Je place une zone de rédaction entre « Définitions » et « Concepts et théories ».
- [ ] « Monter » et « Descendre » fonctionnent au clavier.
- [ ] Le titre ne bouge pas.
- [ ] Les autres tableaux de l'app se déplacent toujours normalement.
- [ ] Aucune erreur dans la console.

Publie :

```
git add -A && git commit -m "Fiches : déplacer les éléments" && git push
```
