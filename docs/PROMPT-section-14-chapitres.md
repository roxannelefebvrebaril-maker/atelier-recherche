# Prompt : section 14 en cartes de chapitres

> **Mode d'emploi** : dans VS Code, ouvre le chat en mode **Agent**, puis colle tout ce qui se trouve sous la ligne ci-dessous.

---

Tu travailles sur **Atelier de recherche**, une application Web en HTML, CSS et JavaScript « vanilla », sans framework ni compilation, déployée sur Vercel. Toute l'interface est en **français**.

Les fichiers principaux :

- `js/editor.js` : l'éditeur, exposé comme `window.Editor` ;
- `css/theme.css` : les styles ;
- `js/app.js` : la bibliothèque et le routeur.

**Lis `js/editor.js` et `css/theme.css` avant de commencer, puis propose-moi un plan court.**

## Ce que je veux

Aujourd'hui, on navigue ainsi : la **vue d'ensemble du projet**, qui montre une grande carte d'en-tête avec des statistiques et une grille de cartes (une par section), puis une **section**.

Ma **section 14, « Références par chapitre »**, est un tableau conteneur sans colonnes. Elle contient 7 sous-tableaux : « Chapitre 1 — Introduction générale », « Chapitre 2 — … », et ainsi de suite jusqu'au chapitre 7. Chacun a les colonnes Sources, Résumé et Notes, avec une référence par ligne. Pour l'instant, la page de cette section affiche un **tableau récapitulatif** (`renderSectionOverview`), puis les 7 tableaux empilés les uns sous les autres. C'est trop long.

Je veux **un niveau de navigation de plus**, avec le **même visuel que la vue d'ensemble du projet** :

1. **Vue d'ensemble du projet** : je clique sur la carte de la section 14.
2. **Vue d'ensemble de la section 14** : même présentation que la vue d'ensemble du projet, avec une grande carte d'en-tête, des tuiles de statistiques et une **grille de cartes, une par chapitre**.
3. Je clique sur une carte de chapitre, et **la page du chapitre** s'ouvre avec son tableau seul.

**Je ne veux plus le tableau récapitulatif** en haut de la section. Les cartes le remplacent.

## Règle générale

Ce comportement s'applique à **toute section de premier niveau qui est un conteneur** (tableau sans colonnes) **et qui contient au moins 2 sous-tableaux ou espaces libres**. J'appelle ce cas une « section à cartes ».

- Ajoute un champ optionnel **`t.cards`** sur le tableau de la section. Quand il est absent, on applique la règle ci-dessus. `t.cards === false` force l'affichage classique.
- Dans le menu ⋯ de la section, ajoute l'option cochable **« Afficher les sous-tableaux en cartes »**, qui modifie `t.cards`.
- Ne change rien d'autre au format des données. Les projets existants doivent s'ouvrir sans perte.

Dans mon projet, les sections « Introduction » et « Intuitions de recherche » sont aussi des conteneurs. Elles deviendront donc des sections à cartes, et c'est voulu. On pourra les remettre en affichage classique avec l'option du menu.

## 1. Vue d'ensemble d'une section à cartes

Crée une fonction `renderSectionCards(content, sec, idx)` qui **réutilise les mêmes classes CSS et la même structure que `renderOverview()`** : `ov-hero`, `ov-stats`, `ov-stat`, `ov-grid`, `ov-card`, `ov-resume` et `ov-add`. Les deux vues doivent être visuellement identiques.

### Carte d'en-tête

- **Surtitre** : « Section 14 » (le vrai numéro de la section), dans la couleur de la section.
- **Titre** : le titre de la section, modifiable comme le titre du projet. Entrée valide la saisie, et le titre de la barre latérale se met à jour.
- **Tuiles de statistiques** (même style que `ov-stats`) :
  - **% rédigé** : l'avancement de la section, avec une barre en dégradé ;
  - **Chapitres complets** : « x / 7 », c'est-à-dire les sous-tableaux dont l'avancement est à 100 % ;
  - **Références** : le nombre de lignes sans `kind` dans tous les sous-tableaux. Utilise le libellé « références » si les tableaux ont une colonne « Sources », sinon « lignes » ;
  - **Résumés rédigés** : le nombre de cases de la colonne « Résumé » remplies. S'il n'y a pas de colonne Résumé, utilise les cases remplies selon `answerColumns()`.

### Sous la carte d'en-tête

- **« Reprendre là où tu étais »** (même style que `ov-resume`) : rouvre le dernier chapitre consulté dans cette section.
- **La ligne des repères** (`renderTagsRow()`).

### Grille de cartes (`ov-grid`), une carte par sous-tableau ou espace libre

- **Numéro** en grand :
  - si le titre commence par « Chapitre N — », affiche **« N »** sur deux chiffres (« 01 ») et, comme titre de la carte, seulement ce qui suit le tiret, par exemple « Introduction générale » ;
  - sinon, affiche la position dans la section et le titre complet.
- **Anneau d'avancement** : `progressRing(tableProgress(child), 30)`.
- **Méta** : « 12 / 35 résumés rédigés », ou « x / n cases remplies ». Pour un espace libre, affiche le nombre d'éléments.
- **Pastilles de repères** : le décompte des repères posés dans le chapitre, par exemple « cœur 20 · appui 15 », avec leurs couleurs (`--tag-*`, `--tag-*-bg`).
- **Barre d'avancement** en bas de la carte.
- **Couleur de la carte** : si le sous-tableau a une `color`, la convertir avec `TAGCOLOR_TO_SECTION` ; sinon, utiliser une couleur stable dérivée de l'id, comme `sectionColor()`.
- **Carte d'ajout** en pointillés (`ov-add`), avec deux boutons :
  - **« + Nouveau chapitre »** crée un sous-tableau avec les **mêmes colonnes que le premier sous-tableau** (nouveaux ids de colonnes), une ligne vide, le même `rowLines` que les autres et le titre « Chapitre N — Nouveau chapitre », puis l'ouvre ;
  - **« + Espace libre »**.

## 2. Page d'un chapitre

- **Nouvel état** `activeChild`, l'id du sous-tableau ouvert dans la section active.
  - Mémorise-le sur l'appareil avec la clé `localStorage` `viewKey() + ":child:" + <idSection>`. Au rechargement, on revient sur le même chapitre.
  - Ajoute une fonction `setChild(id)`, sur le modèle de `setSection()`.
  - `setSection()` remet `activeChild` à `null`, sauf quand la navigation vise un chapitre.
- **Fil d'Ariane cliquable** en haut du contenu : « Vue d'ensemble › 14 · Références par chapitre › Chapitre 1 ».
- **En-tête** dans le style de `sec-head` :
  - la pastille affiche le numéro du chapitre, dans sa couleur ;
  - le surtitre indique « Section 14 · Chapitre » ;
  - la barre d'avancement du chapitre reprend le compteur de résumés.
- **Contenu** : la ligne des repères, puis **uniquement ce sous-tableau**, affiché comme une section de premier niveau avec `renderTable(child, {top:true})`. Ses propres sous-tableaux restent imbriqués comme aujourd'hui.
- **Pagination** en bas (style `sec-pager`) : « ← Chapitre précédent » et « Chapitre suivant → ». Sur le dernier chapitre, le bouton de droite devient **« Retour aux chapitres »**.
- **En-tête du haut** (`renderHeaderBar`) : afficher « Section 14 sur 14 › Chapitre 1 sur 7 ».
- **Mise à jour pendant la frappe** : quand j'écris un résumé, le compteur et la barre de l'en-tête du chapitre se mettent à jour **sans appeler `render()`**. Adapte `updateProgressIndicators()`, et retire-y le code lié à l'ancien tableau récapitulatif.

## 3. Barre latérale et navigation

- **Barre latérale** : sous une section à cartes ouverte, liste ses chapitres. Utilise le titre court « 1 · Introduction générale » avec une petite pastille de couleur.
  - Un clic ouvre la page du chapitre.
  - Le chapitre ouvert est surligné.
  - Un clic sur la section elle-même ramène à sa vue en cartes.
- **Liens entre cases** : `goTo(entityId)`, `goToBlock(kind, id)` et `ensureSectionFor()` doivent ouvrir la bonne section **et** le bon chapitre (le sous-tableau de premier niveau qui contient la cible), puis faire défiler jusqu'à la case et la faire clignoter. Ça doit aussi marcher depuis une autre section et en mode liaison (`armedEntity`).
- **Import de section** : après « Importer une section », on arrive sur la vue en cartes de la nouvelle section.
- **Suppression du récapitulatif** : retire l'appel à `renderSectionOverview()`. Supprime la fonction et ses styles `.section-overview*` s'ils ne servent plus nulle part.

## Contraintes

- **Ne touche pas** à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- Garde intacte l'API publique `Editor` utilisée par `app.js` : `open`, `close`, `flush`, `isDirty`, `currentId`, `setStatus`, `getState`, `currentSection`, `progressOf`.
- **N'appelle jamais `render()` pendant la frappe.** Avant chaque changement de page, enregistre la saisie en cours : fais perdre le focus au champ actif ou appelle `doSave()`.
- Pas de framework, pas de dépendance.
- **Accessibilité** :
  - les cartes sont des `<button>` ;
  - le focus est visible ;
  - le fil d'Ariane est un `<nav aria-label="Fil d'Ariane">` ;
  - les contrastes sont suffisants.
- **Mobile, 390 px de large** : grille de cartes sur 2 colonnes, comme la vue d'ensemble du projet, et aucun défilement horizontal.
- Si la refonte de `docs/PROMPT-refonte-visuelle.md` (tableaux en fichiers cliquables) est appliquée plus tard, elle devra **réutiliser** ce mécanisme `activeChild`, pas en créer un second. Ajoute un commentaire dans le code à cet endroit.

## Tester avant de publier

Lance `python3 -m http.server 8000` dans le dossier et ouvre `http://localhost:8000`. En local, l'app fonctionne en « mode local ». Ouvre le projet d'exemple, puis importe `docs/section-14-references.json` avec « Importer une section ». Vérifie ensuite :

- [ ] Dans la vue d'ensemble du projet, un clic sur la carte de la section 14 ouvre sa **vue en cartes**, avec **7 cartes de chapitre**, numérotées 01 à 07, et **sans tableau récapitulatif**.
- [ ] Les tuiles affichent 300 références. Les cartes indiquent 35, 88, 11, 61, 97, 6 et 2 références, avec les pastilles cœur et appui.
- [ ] Un clic sur « 01 Introduction générale » ouvre le chapitre 1 seul, avec le fil d'Ariane et le bouton « Chapitre suivant → ».
- [ ] Écrire un résumé met à jour le compteur du chapitre pendant la frappe. Au retour sur la vue en cartes, la carte et les tuiles sont à jour.
- [ ] Après rechargement de la page, on revient sur le même chapitre.
- [ ] La barre latérale liste les 7 chapitres sous la section 14 et surligne le chapitre ouvert.
- [ ] Un lien entre une case du chapitre 2 et une case d'une autre section fonctionne dans les deux sens.
- [ ] « + Nouveau chapitre » crée un « Chapitre 8 » avec les colonnes Sources, Résumé et Notes.
- [ ] Décocher « Afficher les sous-tableaux en cartes » dans le menu ⋯ rétablit l'affichage classique.
- [ ] Les autres sections, qui ont des colonnes, s'affichent exactement comme avant.
- [ ] À 390 px : cartes sur 2 colonnes et aucun défilement horizontal.
- [ ] Aucune erreur dans la console.

Quand tout est vert, publie :

```
git add -A && git commit -m "Section en cartes : vue d'ensemble par chapitre" && git push
```

Vercel redéploie tout seul. Dis-moi ensuite d'aller vérifier dans l'app en ligne.
