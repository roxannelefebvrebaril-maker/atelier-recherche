# Prompt — Section 14 « Références par chapitre »

> **Mode d'emploi** : dans VS Code, ouvre le chat en mode **Agent** et colle tout ce qui suit la ligne ci-dessous. Le fichier de données `docs/section-14-references.json` est déjà dans le projet.

---

Tu travailles sur **Atelier de recherche**, une application Web en HTML/CSS/JavaScript « vanilla », sans framework ni compilation, déployée sur Vercel. Toute l'interface est en **français**. L'éditeur se trouve dans `js/editor.js` (`window.Editor`), les styles dans `css/theme.css`, et la bibliothèque, le routeur et les exports dans `js/app.js`. **Lis ces fichiers avant de commencer**, puis propose-moi un plan court.

## Objectif

Mon projet de thèse a actuellement 13 sections. Je veux y ajouter une **14e section, « Références par chapitre »** : une vue d'ensemble de ma bibliographie répartie selon les 7 chapitres de ma thèse.

- Chaque chapitre est un **tableau à trois colonnes : Sources | Résumé | Notes**.
- Chaque référence est une ligne, et **chaque référence est séparée de la suivante par une ligne bien visible**.

Mes projets sont enregistrés **en ligne, dans une base de données**, et non dans le code. Tu ne peux donc pas écrire la section directement dans mon projet. Il faut plutôt :

1. ajouter à l'app une fonction **« Importer une section (.json) »** qui ajoute une section à la fin du projet ouvert ;
2. l'importer ensuite avec le fichier déjà préparé : **`docs/section-14-references.json`**.

## Le fichier de données `docs/section-14-references.json` (ne pas le modifier)

Il a été généré à partir de mon document « Plan de lecture par chapitre ». Il contient 7 tableaux-chapitres, **300 références**, 25 lignes d'intertitre et 7 lignes de note.

```js
{
  "format": "atelier-recherche/section", "version": 1,
  "tags": [ { "id": "tag-coeur", "label": "cœur", "color": "pink" },
            { "id": "tag-appui", "label": "appui", "color": "blue" },
            { "id": "tag-synthese", "label": "synthèse", "color": "mauve" } ],
  "section": { "id": "sec14", "title": "Références par chapitre", "columns": [], "rows": [] },  // conteneur
  "tables": [ { "id": "sec14_ch1", "parentId": "sec14", "title": "Chapitre 1 — Introduction générale",
                "color": "pink", "rowLines": "strong", "view": "table",
                "columns": [ { "id": "src", "label": "Sources" }, { "id": "res", "label": "Résumé" }, { "id": "notes", "label": "Notes" } ],
                "rows": [ { "id": "c1_h2", "kind": "header", "cells": { "src": { "text": "<b>1.1 Les jeux vidéo…</b>", "tags": [] }, … } },
                          { "id": "c1_r001", "cells": { "src": { "text": "Bonenfant, M. … (2024). …", "tags": ["tag-coeur"] },
                                                        "res": { "text": "", "tags": [] },
                                                        "notes": { "text": "", "tags": [] } } },
                          … ] },
              … ],
  "diagrams": []
}
```

- Une ligne **sans `kind`** est une référence :
  - **Sources** contient la référence complète ;
  - le repère **cœur**, **appui** ou **synthèse** est posé sur la case Sources ;
  - **Notes** reprend ma précision entre parenthèses, quand il y en a une ;
  - **Résumé** est vide, c'est moi qui vais le remplir.
- `kind: "header"` est un **intertitre** (sous-section du chapitre, comme « 1.1 … » ou « Ce que la recherche sait … »). Le texte est dans la case Sources.
- `kind: "note"` est une **note de chapitre** (sous-titre ou consigne en italique). Le texte est dans la case Sources.

Le fichier introduit trois **champs nouveaux et optionnels** dans le format des données : `row.kind`, `t.rowLines` et `t.view`. Ce sont des ajouts : une ligne sans `kind` et un tableau sans ces champs doivent continuer de fonctionner exactement comme avant.

## À faire

### 1. Importer une section (.json)

- **Où** :
  - dans la barre latérale, à côté de « + Nouvelle section » et « Espace libre », ajoute un bouton **« Importer une section »** ;
  - ajoute le même bouton dans la carte « + » de la vue d'ensemble ;
  - le bouton ouvre un sélecteur de fichier `.json`.
- **Validation** : refuser, avec un message clair en français, tout fichier dont `format` n'est pas `"atelier-recherche/section"`.
- **Fusion** (sans jamais écraser quoi que ce soit du projet) :
  - **Nouveaux identifiants** pour la section, chaque tableau, chaque espace libre et chaque ligne, générés avec la fonction `uid()` d'`editor.js`. Mets à jour les `parentId` en conséquence. Les ids de colonnes peuvent rester tels quels, car ils sont propres à chaque tableau.
  - **Repères fusionnés par nom** : comparaison insensible à la casse et aux accents composés (utiliser `normalize("NFC")`). Si un repère du même nom existe déjà dans le projet, réutilise son id ; sinon, ajoute-le. Remplace ensuite les ids de repères dans toutes les cases importées.
  - **Position** : la section est ajoutée **à la fin** de `state.order`, en 14e position ici.
  - **Doublon** : si une section du même titre existe déjà, demande une confirmation avant d'importer (« Une section « Références par chapitre » existe déjà. L'importer quand même ? »). Utilise la fenêtre de confirmation de l'app, `askConfirm`, en adaptant le libellé du bouton ; pas de `confirm()` natif.
- **Ensuite** : `scheduleSave(true)`, ouvrir la nouvelle section avec `setSection(id)`, puis afficher un message (`showToast`) : « Section importée : 300 références dans 7 chapitres ». Calcule ces chiffres à partir du fichier : les références sont les lignes sans `kind`.

### 2. Lignes d'intertitre et de note (`row.kind`)

- **Affichage tableau** : une ligne `header` ou `note` s'affiche comme une **bande sur toute la largeur**, avec une seule cellule `colspan` qui contient la case Sources, restée modifiable.
  - `header` : texte en gras, fond pâle de la couleur du tableau, filet coloré au-dessus.
  - `note` : texte en italique, couleur atténuée, fond neutre.
- **Contenu** : ces lignes gardent leurs icônes lien et repère et restent déplaçables et supprimables comme les autres.
- **Hors calculs** : elles **ne comptent pas** dans l'avancement (`tableProgress`) ni dans les nombres de références.
- **Mobile** (tableaux affichés en fiches, sous 640 px) : même bande, sans le libellé de colonne.
- **Export Markdown** (`toMarkdown` dans `app.js`) :
  - `header` devient un sous-titre `#### …` placé entre deux tableaux Markdown ;
  - `note` devient un paragraphe en italique.

### 3. Séparation bien visible entre les références (`t.rowLines`)

- Quand `t.rowLines === "strong"`, chaque ligne du tableau est séparée de la suivante par un **filet de 2 px, bien contrasté** (au moins 3:1 sur le fond), dans la teinte foncée de la couleur du tableau. Ajoute un peu plus d'espace vertical dans chaque ligne.
- Même rendu en affichage mobile (fiches) et, s'il existe déjà, en affichage « Fiche ».
- Dans le menu ⋯ de chaque tableau, ajoute l'option **« Lignes de séparation marquées »**, cochée ou non, qui active ou désactive `t.rowLines` pour **n'importe quel** tableau.
- En impression (`@media print`), les filets restent visibles.

### 4. Vue d'ensemble en haut de la section

En haut de la page d'une section qui contient **au moins deux sous-tableaux**, ajoute un bloc **« Vue d'ensemble »** : un tableau récapitulatif avec une ligne par sous-tableau.

| Colonne | Contenu |
|---|---|
| Chapitre | Titre cliquable : il fait défiler jusqu'au tableau, ou ouvre sa page si les tableaux s'affichent en fichiers |
| Références | Nombre de lignes sans `kind` |
| Repères | Petites pastilles de couleur avec le compte de chaque repère posé dans le tableau (ex. « cœur 20 · appui 15 ») |
| Résumés | « x / n » : nombre de cases Résumé remplies sur le nombre de références, avec une mini-barre d'avancement |

- Une ligne de **total** figure en bas.
- Le bloc peut se replier (« Masquer la vue d'ensemble »), et ce choix est mémorisé sur l'appareil dans `localStorage`.
- **Avancement** : dans `answerColumns()`, ajoute **« Résumé »** aux colonnes prioritaires, à côté de Rédaction et Réponses. Pour ces tableaux, c'est la rédaction des résumés qui mesure l'avancement.

## Contraintes

- **Ne touche pas** à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/section-14-references.json`.
- L'API publique `Editor` utilisée par `app.js` (`open`, `close`, `flush`, `isDirty`, `currentId`, `setStatus`, `getState`, `currentSection`, `progressOf`) reste intacte.
- **Ne jamais appeler `render()` pendant la frappe.** Le texte passe par `attachRichText()`, et `render()` est réservé aux changements de structure.
- Pas de framework, pas de dépendance, pas de compilation.
- **Accessibilité** : boutons avec `aria-label`, focus visible, contrastes suffisants.
- Si le prompt `docs/PROMPT-refonte-visuelle.md` a déjà été appliqué (tableaux en fichiers cliquables), intègre-toi à cette nouvelle navigation : la vue d'ensemble apparaît au-dessus de la grille de fichiers de la section. Sinon, elle apparaît au-dessus des sous-tableaux.

## Tester avant de publier

Lance `python3 -m http.server 8000` dans le dossier et ouvre `http://localhost:8000`. En local, l'app fonctionne en « mode local » avec le projet d'exemple, qui a 13 sections. Vérifie :

- [ ] « Importer une section » avec `docs/section-14-references.json` ajoute une **14e section « Références par chapitre »** qui contient **7 tableaux**.
- [ ] Le message annonce **300 références dans 7 chapitres**, et la vue d'ensemble affiche les nombres suivants :

  | Chapitre | Références |
  |---|---|
  | 1 | 35 |
  | 2 | 88 |
  | 3 | 11 |
  | 4 | 61 |
  | 5 | 97 |
  | 6 | 6 |
  | 7 | 2 |
  | **Total** | **300** |

  Repères au total : cœur 166, appui 127, synthèse 2.
- [ ] Les repères cœur, appui et synthèse ne sont pas créés en double s'ils existaient déjà dans le projet.
- [ ] Un filet épais et bien visible sépare chaque référence ; l'option du menu ⋯ l'active et le désactive.
- [ ] Les intertitres (ex. « 1.1 … », « Ce que la recherche sait … ») s'affichent en bandes pleine largeur, modifiables, et ne comptent pas dans les totaux.
- [ ] Écrire un résumé fait progresser le compteur « Résumés » et l'anneau d'avancement de la section.
- [ ] Importer une deuxième fois demande une confirmation.
- [ ] Un ancien projet sans ces nouveaux champs s'affiche exactement comme avant.
- [ ] À 390 px de large, aucun défilement horizontal.
- [ ] L'export `.md` est lisible.
- [ ] Aucune erreur dans la console.

Quand tout est vert, publie : `git add -A && git commit -m "Section références : import, intertitres, séparateurs, vue d'ensemble" && git push`. Vercel redéploie tout seul. Ensuite, dis-moi d'aller dans l'app en ligne, d'ouvrir mon projet de thèse et de cliquer sur **« Importer une section »** avec le fichier `docs/section-14-references.json`.
