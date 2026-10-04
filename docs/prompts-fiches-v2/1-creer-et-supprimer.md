# Fiches de lecture v2 · Prompt 1 sur 4 : créer et supprimer une fiche

> Colle tout ce qui suit la ligne dans le chat de VS Code, en mode **Agent**. Lance le prompt suivant **seulement** quand celui-ci est publié.

---

> **Important :** une partie de ce travail a peut-être déjà été faite (des changements non publiés existent dans `js/editor.js`, `js/app.js`, `css/theme.css` et `js/fiche-template.js`). **Vérifie d'abord ce qui existe déjà**, complète seulement ce qui manque, ne refais rien en double et corrige ce qui ne respecte pas ce prompt.

Tu travailles sur **Atelier de recherche** : du HTML, du CSS et du JavaScript « vanilla », sans framework, déployé sur Vercel. L'interface est en français. L'éditeur se trouve dans `js/editor.js`.

La section 15 « Fiches de lecture » est une **galerie qui contient des fiches**. Chaque fiche est un tableau `kind: "fiche"`, enfant de la section.

Lis d'abord `ensureFicheContainer`, `createFicheSection`, `createBlankFiche`, `openFicheCreationModal`, `renderFicheSectionCards`, `renderFichePage`, `deleteTableCascade`, `askConfirm` et `showToast`. Propose-moi ensuite un plan court.

## À faire

1. **Le bouton « + Nouvelle fiche de lecture » crée la fiche dans la section affichée.**
   - Il ne crée **jamais** de nouvelle section.
   - Si la section affichée n'a pas `childKind: "fiche"`, ajoute-le, sans rien toucher d'autre.
   - `ensureFicheContainer()` ne doit plus créer de section à partir de ce bouton.
   - Ne supprime aucune section automatiquement, même en double.
2. **Fenêtre de création.**
   - Remplace le `window.prompt` de « Fiche vide » par une fenêtre de l'app.
   - Elle contient un seul champ : **« Référence APA 7 »**. Sa valeur devient le titre de la fiche (`fiche.title`).
   - Si le champ est vide, le titre est « Nouvelle fiche ».
3. **Bouton rouge « Supprimer la fiche ».**
   - Place-le en haut à droite de chaque fiche, et ajoute aussi l'action dans le menu ⋯.
   - Il fonctionne aussi pour les **anciennes fiches**, celles du modèle à 17 rubriques.
   - Il demande d'abord une confirmation avec `askConfirm` : « Supprimer définitivement toute la fiche « … » avec tout son contenu ? ».
   - Il supprime ensuite la fiche, ses sous-tableaux et les liens qui pointent vers eux.
   - Il revient à la galerie et affiche `showToast("Fiche supprimée", "Annuler", …)`. « Annuler » restaure la fiche telle quelle.

## Contraintes

- Ne touche pas à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- Ne change ni l'ordre ni le contenu du menu de gauche.
- Pas de `window.prompt`, de `confirm` ni d'`alert`.
- N'appelle jamais `render()` pendant la frappe.

## Tests

Lance `python3 -m http.server 8000`, en mode local.

- [ ] Crée une section avec « + Nouvelle section » et nomme-la « Fiches de lecture ». Clique ensuite sur « + Nouvelle fiche de lecture » : la fiche est créée **dans cette section**, sans nouvelle section.
- [ ] La référence saisie dans la fenêtre devient le titre de la fiche.
- [ ] « Supprimer la fiche » demande une confirmation, supprime la fiche et revient à la galerie. « Annuler » la restaure.
- [ ] Le bouton fonctionne aussi sur une ancienne fiche.
- [ ] Aucune erreur dans la console.

Quand tout est vert, publie :

```
git add -A && git commit -m "Fiches : création dans la section, suppression de fiche" && git push
```
