# Prompt — Refonte visuelle « bonbons pastel » et tableaux en fichiers cliquables

> **Mode d'emploi** : dans VS Code, ouvre le chat (Copilot Chat ou autre assistant), passe en mode **Agent**, puis colle tout ce qui suit la ligne ci-dessous. Glisse aussi les 4 images du dossier `docs/inspiration/` dans le chat pour que l'assistant les voie.

---

Tu travailles sur **Atelier de recherche**, une application Web (HTML/CSS/JavaScript « vanilla », sans framework ni étape de compilation) déployée sur Vercel. Elle sert à cartographier et rédiger des projets de recherche universitaires : sections (Question, Objectifs, Concepts, Méthodologie, Éthique…), chacune composée de tableaux, de sous-tableaux et d'« espaces libres » (schémas). Toute l'interface est en **français**.

Je veux deux choses :

1. une **refonte visuelle** inspirée des images de `docs/inspiration/` ;
2. que **les tableaux deviennent des « fichiers » cliquables** qui ouvrent chacun sa propre page, soit un tableau à remplir, soit une fiche de rédaction.

Lis d'abord le code (en particulier `js/editor.js` et `css/theme.css`) et propose-moi un plan court avant de modifier quoi que ce soit.

## 1. Le code existant

| Fichier | Rôle | Consigne |
|---|---|---|
| `index.html` | Page unique. Ordre de chargement : `seeds.js`, `storage.js`, `cloud.js`, `editor.js`, `app.js`. CSS : `editor.css`, `app.css`, `theme.css` | Peut changer (polices, feuilles de style) |
| `css/editor.css` | Styles d'origine de l'éditeur | Laisser tel quel ; surcharger dans `theme.css` |
| `css/app.css` | Bibliothèque, modales, impression | Peut être ajusté |
| `css/theme.css` | Thème actuel (jetons `:root`, barre latérale, cartes) | **À refaire** : c'est le cœur de la refonte |
| `js/editor.js` | L'éditeur (`window.Editor`) | À modifier (navigation, nouvelles vues) |
| `js/app.js` | Bibliothèque de projets, routeur `#/` et `#/p/<id>`, modales, exports | Ajustements visuels seulement |
| `js/storage.js`, `js/cloud.js`, `api/*` | Stockage local et synchronisation en ligne (Vercel + Upstash Redis) | **Ne pas toucher** |
| `js/seeds.js`, `data/*.json` | Contenu de départ | Ne pas toucher |

### Modèle de données (dans `editor.js`, variable `state`)

```js
state = {
  title, sub, showIntro,
  order: [ids des sections de premier niveau],
  tags:  [{ id, label, color }],   // color ∈ blue|mauve|green|yellow|orange|pink
  tables: [{ id, parentId?, title, color?, columns: [{ id, label }],
             rows: [{ id, cells: { [colId]: { text /* HTML */, tags: [tagId] } } }] }],
  diagrams: [{ id, parentId?, title, nodes: [...], arrows: [...], notes: [...] }],
  links: [{ id, a, b }]            // a et b = "t:<tableId>:<rowId>:<colId>" ou un id de nœud
}
```

- Une section est un tableau ou un espace libre **sans `parentId`**, rangé dans `state.order`.
- Un tableau **sans colonnes** est un simple conteneur de sous-tableaux.

### Fonctions clés de `editor.js`

- `render()` reconstruit toute l'interface.
- `renderSidebar()`, `renderHeaderBar()`, `renderOverview()` et `renderSectionView()` construisent la barre latérale, l'en-tête, la vue d'ensemble et la vue d'une section.
- `renderTable(t, {nested})` et `renderDiagram(d, {nested})` affichent un tableau et un espace libre.
- `activeSection` et `setSection(id)` gèrent la section ouverte (mémorisée dans `localStorage`, clé `atelier-recherche:view:<projetId>`).
- `sectionColor()`, `tableProgress()`, `diagramProgress()`, `answerColumns()`, `progressBar()` et `progressRing()` servent aux couleurs et à l'avancement.
- `icon(name)`, `iconBtn()`, `btn()` et l'objet `ICONS` produisent les icônes SVG. `openMenu(anchor, title, items)` ouvre le menu ⋯.
- `goTo(entityId)` et `goToBlock(kind, id)` naviguent vers une case ou un bloc (utilisés par les liens entre cases et par la barre latérale).
- `attachRichText()` enregistre pendant la frappe. `scheduleSave()` et `doSave()` gèrent l'enregistrement.

`app.js` utilise l'API publique `Editor` : `open`, `close`, `flush`, `isDirty`, `currentId`, `setStatus`, `getState`, `currentSection`, `progressOf`. **Garde-la intacte.**

## 2. Direction visuelle (voir `docs/inspiration/`)

Inspire-toi de l'**ambiance**. Ne reproduis ni les illustrations, ni les logos, ni les textes de ces images.

- **`1-palette-sugar-rush.jpg`**, palette pastel « bonbon ». Utilise ces valeurs comme base de jetons CSS :

  | Jeton | Couleur |
  |---|---|
  | `--candy-pink` | `#ff89bf` |
  | `--candy-blush` | `#fec3df` |
  | `--candy-lemon` | `#ffeea8` |
  | `--candy-mint` | `#a0f3ed` |
  | `--candy-aqua` | `#72f0ec` |
  | `--candy-lilac` | `#bdc0f7` |
  | `--candy-periwinkle` | `#9fa3e3` |

  Crée pour chacune une variante **foncée** (texte, icônes, bordures) et une variante **très pâle** (fonds).
- **`2-app-cartes-degradees.jpg`**, application mobile de gestion de fichiers :
  - grande carte « hero » en dégradé (lilas/pervenche vers rose) ;
  - cartes blanches très arrondies (20 à 28 px) avec ombres douces et diffuses ;
  - tuiles d'icônes carrées aux coins arrondis, en dégradé coloré ;
  - listes « icône colorée + titre + méta grise + chevron » ;
  - interrupteur segmenté en pilule (« Storage | Cloudes ») ;
  - barre de progression en dégradé rose → aqua ;
  - bouton rond flottant.
- **`3-app-cartes-dossiers.jpg`**, grille de **cartes en forme de dossier** (languette en haut à gauche), chacune d'une couleur pastel différente, avec une pastille flèche en haut à droite et une **barre de navigation inférieure** en pilule sur mobile.
- **`4-prototype-editorial-rose.jpg`**, mise en page éditoriale monochrome rose :
  - **grands titres en capitales condensées très grasses** ;
  - filets fins roses ;
  - formulaires sobres (libellé en petites capitales au-dessus du champ) ;
  - beaucoup d'air.

### Système proposé

- **Typographie** (Google Fonts) :
  - une police **condensée grasse** pour les grands titres de page et de section, en capitales (par exemple *Anton* ou *Oswald*, avec les accents français) ;
  - une police **arrondie et lisible** pour l'interface et le texte (par exemple *Poppins* ou *Nunito*) ;
  - les zones d'écriture longue restent très lisibles : 15 à 16 px, interligne 1,6.
- **Fond** : blanc cassé légèrement lilas. Cartes blanches. Couleurs pastel pour les sections, les dossiers et les tuiles.
- **Contraste** : texte foncé (`#2b2140` ou proche) **sur** les pastels, jamais de texte blanc sur un pastel clair. Visé : au moins 4,5:1 pour le texte et 3:1 pour les icônes et bordures utiles.
- **Couleurs des sections** : chaque section garde une couleur stable (actuellement tirée de son id par `sectionColor()`), à remapper sur la nouvelle palette.
- **Repères (tags)** : garde les noms existants (`blue`, `mauve`, `green`, `yellow`, `orange`, `pink`), car ils sont enregistrés dans les données. Change seulement les couleurs affichées (variables `--tag-*` et `--tag-*-bg`).

## 3. Les tableaux deviennent des fichiers cliquables

### Navigation voulue : Projet → Section → Fichier

1. **Vue d'ensemble** (déjà là) : grille de **cartes-dossiers** pastel, une par section, avec numéro, titre, anneau d'avancement et pastille flèche.
2. **Page de section** : en-tête de section (grand titre condensé, couleur de la section, avancement). En dessous :
   - si la section a elle-même des colonnes, son tableau principal s'affiche en haut ;
   - ses **sous-tableaux et espaces libres** apparaissent en **grille de fichiers** : une carte par élément, avec une tuile d'icône colorée (tableau, fiche ou schéma), le titre, une méta grise (« 3 / 5 cases remplies » ou « 4 éléments »), une mini-barre d'avancement et un chevron ;
   - sur mobile, cette grille devient une liste « icône + titre + méta + chevron » comme dans l'image 2 ;
   - un bouton « + Nouveau fichier » propose tableau, fiche ou espace libre.
3. **Page d'un fichier** (un sous-tableau ou un espace libre ouvert en plein écran) :
   - **fil d'Ariane** cliquable (« Projet › Section › Fichier ») et bouton retour ;
   - titre modifiable, avancement, menu ⋯ ;
   - **interrupteur segmenté en pilule « Fiche | Tableau »** qui choisit l'affichage du même contenu ;
   - s'il contient lui-même des sous-tableaux, ils apparaissent **à nouveau en fichiers** en bas de page (dossiers imbriqués, à n'importe quelle profondeur) ;
   - boutons « ← Fichier précédent » et « Fichier suivant → » entre fichiers frères.

### Les deux affichages d'un tableau

- **Tableau** : la grille actuelle (`renderTable`), restylée.
- **Fiche**, pour rédiger :
  - chaque ligne devient un bloc ;
  - la **première colonne** sert d'intitulé ou de consigne, en gras ;
  - chaque autre colonne devient une **grande zone d'écriture étiquetée** (libellé en petites capitales au-dessus, zone de 120 px minimum qui s'agrandit avec le texte, style « formulaire éditorial » de l'image 4) ;
  - les colonnes vides d'une ligne restent visibles, avec un texte d'invite ;
  - les icônes lien et repère de chaque case restent disponibles ;
  - « + Ajouter une ligne » en bas.
- Le choix est mémorisé dans le tableau par un **nouveau champ optionnel `t.view`** (`"page"` ou `"table"`). C'est le **seul ajout au format des données** : il est additif, et un tableau sans ce champ doit continuer de fonctionner.
- Valeur par défaut quand `t.view` est absent :
  - `"page"` si le tableau a 3 colonnes ou moins et qu'une colonne s'appelle Rédaction, Réponses, Notes ou Réflexion(s) ;
  - `"table"` sinon.

### Ce qui doit continuer de fonctionner

- **Mémorisation** : le fichier ouvert est retenu comme la section (même clé `localStorage`, en y ajoutant l'id du fichier). Au rechargement, on revient au même endroit.
- **Liens entre cases** : `goTo(entityId)` doit ouvrir la bonne section **et** la bonne page de fichier, puis faire défiler jusqu'à la case et la faire clignoter (classe `flash`). Même chose pour `goToBlock` et les sous-éléments de la barre latérale.
- **Mode liaison** : pendant qu'une case attend d'être reliée (`armedEntity`), on doit pouvoir naviguer vers une autre page et cliquer la case cible.
- **Glisser-déposer entre tableaux** : il n'est plus possible quand un seul tableau est affiché. Remplace-le par une entrée **« Déplacer vers… »** dans le menu ⋯ d'une ligne, d'une colonne et d'un sous-tableau. Elle ouvre une liste des tableaux de destination, en réutilisant `moveRowAcrossTables`, `moveColumnAcrossTables` et `moveToNewParent`. Le réordonnancement à l'intérieur d'un même tableau reste en glisser-déposer.
- **Menu ⋯** d'un fichier : ajouter une colonne, une ligne, un sous-tableau ou un espace libre ; changer la couleur ; « Déplacer vers… » ; supprimer (avec confirmation, comme aujourd'hui).
- **Barre latérale** : elle garde la liste des sections avec les anneaux d'avancement. Sous la section ouverte, elle liste ses fichiers (sur plusieurs niveaux) avec une petite tuile de couleur, et le fichier ouvert est surligné.
- **Mobile (390 px)** : tiroir pour la barre latérale et **barre de navigation inférieure en pilule** (Vue d'ensemble · Sections · Repères · Exporter), sans aucun défilement horizontal.

## 4. Contraintes à respecter absolument

1. **Ne modifie pas** `storage.js`, `cloud.js`, `api/`, `seeds.js` ni `data/`, et ne change pas le format des données, à part l'ajout optionnel de `t.view`. Les projets existants, déjà enregistrés en ligne, doivent s'ouvrir sans aucune perte.
2. **Enregistrement pendant la frappe** : ne jamais appeler `render()` pendant qu'on tape. Les changements de texte passent par `attachRichText()`, et `render()` est réservé aux changements de structure (ajout, suppression, navigation). Aucune saisie ne doit être perdue en changeant de page : appelle `doSave()` ou fais perdre le focus au champ avant de naviguer.
3. **Pas de framework, pas de compilation, pas de dépendance npm.** Seules Google Fonts sont autorisées comme ressource externe.
4. **Accessibilité** :
   - tous les boutons-icônes ont un `aria-label` et un `title` en français ;
   - le focus clavier est visible ;
   - les cartes-fichiers sont des `<button>` ou des liens accessibles au clavier (Entrée) ;
   - respecte `prefers-reduced-motion` ;
   - contrastes conformes à la section 2.
5. **Impression / PDF** : la règle `@media print` doit toujours produire un document lisible (en-têtes, barres et boutons masqués).
6. **Textes de l'interface en français**, tutoiement, ton simple.

## 5. Façon de travailler

Procède **par étapes**. À la fin de chaque étape, **une fois les tests ci-dessous réussis** :

1. publie-la toi-même dans le terminal de VS Code :
   `git add -A && git commit -m "<message clair en français>" && git push` ;
2. Vercel redéploie alors automatiquement l'app en ligne (environ 1 minute) ;
3. montre-moi ce qui a changé et rappelle-moi d'aller vérifier l'app en ligne.

Ne publie jamais une étape qui a des erreurs dans la console ou qui fait échouer un test. Dans ce cas, corrige d'abord.

1. **Jetons et typographie** : nouvelle palette, polices, fond, cartes, boutons, dans `theme.css` et `index.html`. Aucun changement de comportement.
2. **Vue d'ensemble et bibliothèque** : carte « hero » en dégradé, tuiles de statistiques, cartes-dossiers pour les sections et pour les projets de la bibliothèque (`app.js`).
3. **Fichiers cliquables** : grille ou liste de fichiers dans la page de section, page de fichier avec fil d'Ariane et navigation précédent/suivant, mémorisation, barre latérale à plusieurs niveaux.
4. **Affichage Fiche** et interrupteur « Fiche | Tableau » (`t.view`).
5. **« Déplacer vers… »**, puis vérification des liens (`goTo`) à travers les pages.
6. **Mobile** : barre inférieure, liste de fichiers, dernières retouches.

### Tester

Lance `python3 -m http.server 8000` dans le dossier, puis ouvre `http://localhost:8000`. En local, l'app tourne en « mode local » : les données restent dans le navigateur, et c'est normal. Vérifie à chaque étape :

- [ ] Le projet d'exemple (la thèse sur les skins) s'ouvre, et toutes ses sections et tous ses sous-tableaux sont accessibles.
- [ ] Taper dans une case, changer de page puis revenir : le texte est toujours là.
- [ ] Recharger la page ramène au même fichier.
- [ ] Un lien entre deux cases de sections différentes ouvre la bonne page et fait clignoter la bonne case.
- [ ] L'interrupteur « Fiche | Tableau » change l'affichage et reste mémorisé après rechargement.
- [ ] « Déplacer vers… » déplace une ligne vers un autre tableau sans perdre son contenu.
- [ ] À 390 px de large : aucun défilement horizontal, tiroir et barre inférieure fonctionnels.
- [ ] Aucune erreur dans la console du navigateur.
- [ ] Aperçu avant impression lisible.

À la fin, résume ce qui a changé, fichier par fichier, et liste ce que je devrais vérifier moi-même.
