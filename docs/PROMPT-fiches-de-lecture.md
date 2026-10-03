# Prompt : section 15 « Fiches de lecture »

> **Mode d'emploi** : dans VS Code, ouvre le chat en mode **Agent** et colle tout ce qui suit la ligne ci-dessous. Le modèle de fiche est déjà dans le projet : `docs/modele-fiche-de-lecture.json`.

---

Tu travailles sur **Atelier de recherche**, une application Web en HTML, CSS et JavaScript « vanilla » (pas de framework, pas de compilation), déployée sur Vercel. Elle sert à rédiger une **thèse de doctorat**, et toute l'interface est en **français**.

- L'éditeur est dans `js/editor.js` (`window.Editor`), les styles dans `css/theme.css`.
- La bibliothèque, le routeur et les exports sont dans `js/app.js`.

Avant de commencer, **lis `js/editor.js`**, en particulier :

- les sections à cartes : `isCardSection`, `sectionChildren`, `renderSectionCards`, `addChildTable`, `renderChildView`, `childDisplay`, `setChild`, `activeChild` ;
- la navigation par sous-titres : `subtitleGroups`, `isSubtitleCardChapter`, `renderSubtitleCards` ;
- les référentiels et rattachements : `ANCHOR_TYPES`, `inheritedAnchorType`, `anchorById`, `shortCitation`, `buildLinkIndex`, `openAnchorPicker`, `openAnchorSheet` ;
- l'import (`importSection`, `mergeImportedSection`) et la sauvegarde (`attachRichText`, `scheduleSave`).

Propose-moi ensuite un plan court.

## Le besoin

Je veux un **modèle de fiche de lecture unique et réutilisable** pour les articles scientifiques et les livres ou ouvrages scientifiques. Toutes mes fiches doivent être rangées dans une **section 15, « Fiches de lecture »**, visible comme une carte dans la vue d'ensemble du projet. En entrant dans la section, je vois **une carte par fiche**. En cliquant sur une carte, j'ouvre la fiche, qui se lit et se remplit **comme un formulaire**.

## Le modèle : `docs/modele-fiche-de-lecture.json` (ne pas modifier le contenu)

Le modèle contient 2 colonnes, **Rubrique** et **Contenu**, et 32 rubriques réparties en 5 parties :

| Partie | Rubriques |
|---|---|
| **Identification** | Type de document · Référence complète (APA 7) · Auteur·e·s · Année · Titre · Revue ou maison d'édition · DOI, lien ou emplacement · Discipline et champ · Mots-clés |
| **Suivi de lecture** | Date de lecture · Statut · Pertinence pour ma thèse · Parties lues |
| **Contenu du texte** | Problématique et question de l'auteur·e · Objectifs ou hypothèses · Cadre théorique · Concepts clés et définitions · Méthodologie ou démarche · Structure du texte · Principaux résultats ou arguments · Conclusion et pistes proposées · Limites selon l'auteur·e |
| **Citations à retenir** | Citation 1 · Citation 2 · Citation 3 |
| **Mon analyse** | Résumé dans mes mots · Apports pour ma thèse · Critiques et désaccords · Liens avec mes concepts, objectifs et théories · Où l'utiliser dans ma thèse · Questions et idées à creuser · Références à lire ensuite |

Structure du fichier :

- Chaque partie est une ligne `kind: "header"`.
- Chaque rubrique est une ligne qui contient :
  - `key`, une clé stable (par exemple `"f1_02"`) ;
  - `hint`, une consigne qui guide la rédaction ;
  - la case **Rubrique** remplie et la case **Contenu** vide.

**Crée `js/fiche-template.js`**, qui définit `window.FICHE_LECTURE_TEMPLATE` avec **exactement** le contenu de ce JSON, et charge-le dans `index.html` avant `editor.js`.

## Nouveaux champs optionnels (tous additifs)

| Champ | Où | Rôle |
|---|---|---|
| `t.childKind = "fiche"` | section conteneur | Ses sous-tableaux sont des fiches de lecture. |
| `t.childTemplate = {columns, rows, rowLines}` | section conteneur | Copie du modèle propre au projet, que je pourrai personnaliser. |
| `t.kind = "fiche"` | chaque fiche | Marque le tableau comme une fiche. |
| `t.sourceRef = "r:<tableId>:<rowId>"` | fiche | Lien vers la référence correspondante de ma section 14, si elle existe. |
| `row.hint` et `row.key` | ligne | Consigne d'aide et clé stable de la rubrique. |

Un projet sans ces champs doit fonctionner **exactement** comme avant. Dans `mergeImportedSection` (copie des tableaux et des lignes), conserve aussi ces champs.

## 1. Créer la section « Fiches de lecture »

- **Bouton de création.** Ajoute **« + Fiches de lecture »** dans la carte d'ajout (`ov-add`) de la vue d'ensemble et dans les boutons du bas de la barre latérale. Le bouton est **visible seulement si aucune section n'a `childKind: "fiche"`**.
- **Ce que fait le clic.** Il crée une section conteneur intitulée « Fiches de lecture », sans colonnes, avec `childKind: "fiche"` et `childTemplate` (copie profonde du modèle). Elle s'ajoute **à la fin de `state.order`** : dans mon projet, ce sera la 15e. Le clic ouvre ensuite cette section.
- **Toujours en cartes.** Une section `childKind: "fiche"` s'affiche **toujours en cartes**, même avec 0 ou 1 fiche. Adapte `isCardSection`.
- **Pas de sous-titres.** Une fiche (`kind: "fiche"`) ne doit **jamais** passer par la navigation par sous-titres : `isSubtitleCardChapter` doit renvoyer `false` pour elle.

## 2. La section 15 : une carte par fiche

Variante de `renderSectionCards` pour `childKind: "fiche"`. Garde le même visuel (`ov-hero`, `ov-stats`, `ov-grid`, `ov-card`).

### En-tête

Quatre tuiles :

- **Fiches** : le nombre total de fiches.
- **Lues** : statut « Lue » ou « Relue ».
- **En cours**.
- **% des rubriques remplies** : sur l'ensemble des fiches, avec une barre.

### Barre de filtres

- **Recherche** sur le titre, les auteur·e·s et les mots-clés, insensible aux accents.
- **Pastilles de type** : Toutes · Articles · Livres · Chapitres · Autres.
- **Pastilles de statut** : À lire · En cours · Lue.
- Le choix est mémorisé dans `localStorage`.

### Carte d'une fiche

- Numéro (01, 02…) et anneau d'avancement : rubriques remplies, hors parties.
- **Titre de la carte** : le titre de la fiche, par exemple « Tordo (2021) ».
- **Sous-titre** : le contenu de la rubrique « Titre », coupé à 80 caractères.
- **Pastilles de type** (Article, Livre, Chapitre…), **de statut** et **de pertinence** (cœur ou appui, aux couleurs des repères existants).
- **Méta** : « 18 / 32 rubriques remplies ».
- **Lecture des valeurs** : par `row.key`, ou par le libellé de la rubrique si `key` est absent. Le type et le statut se déduisent du texte saisi, en cherchant des mots-clés comme « article », « livre », « ouvrage », « chapitre », « à lire », « en cours », « lue », « relue ».

### Carte d'ajout et état vide

- **Carte d'ajout** : « + Nouvelle fiche de lecture ».
- **État vide** (aucune fiche) : un message accueillant (« Ta première fiche de lecture ? Pars d'une référence de ta bibliographie ou d'une fiche vide. ») et le bouton.

## 3. Créer une fiche

La fenêtre de création propose deux choix.

### 1. « À partir d'une référence de ma bibliographie »

- **Recherche** dans toutes les ancres de type `reference` (ma section 14), avec la citation courte et la référence complète en dessous.
- **Si une fiche existe déjà** pour cette référence (même `sourceRef`) : propose « Ouvrir la fiche existante ».
- **Pré-remplissage**, au mieux à partir du texte APA de la case Sources :
  - **Référence complète** : le texte entier ;
  - **Auteur·e·s** : ce qui précède « (année) » ;
  - **Année** ;
  - **Titre** : ce qui suit « ). », jusqu'au point suivant ;
  - **Revue ou maison d'édition** : le reste ;
  - **Type de document** :
    - « Dans … » → Chapitre d'ouvrage collectif ;
    - présence de « volume(numéro) » ou du nom d'une revue → Article scientifique ;
    - nom d'éditeur (PUQ, PUF, Presses…, Éditions…, L'Harmattan, Routledge, Fayard, Policy Press…) → Livre / ouvrage ;
  - **Pertinence** : les repères cœur ou appui de la case Sources, recopiés en repères et en texte ;
  - **Statut** : « À lire ».
- Le titre de la fiche devient la **citation courte** (`shortCitation`).
- La fiche reçoit `sourceRef`. Crée aussi un **rattachement** (lien `rel: "reference"`) de la case Contenu de « Référence complète » vers l'ancre. La référence affiche ainsi « Utilisée dans N », et la pastille de la fiche ramène à la section 14.

### 2. « Fiche vide »

Un champ de titre (« Auteur·e (année) »).

### Dans les deux cas

- La nouvelle fiche est une **copie profonde de `childTemplate`** de la section : nouveaux ids de lignes et de colonnes, `key` et `hint` conservés, `kind: "fiche"`, `rowLines: "strong"`.
- La fiche s'ouvre aussitôt, le curseur dans la première rubrique vide.

## 4. La page d'une fiche (affichage formulaire)

### En-tête

- Fil d'Ariane : « Vue d'ensemble › 15 · Fiches de lecture › Tordo (2021) ».
- Surtitre « Fiche de lecture · Article », puis le titre modifiable (`t.title`).
- La référence complète en dessous, en petit.
- Les pastilles de statut et de pertinence.
- Si `sourceRef` existe : une pastille « Référence » qui mène à la ligne dans la section 14 (avec `goTo`).
- La barre d'avancement.

### Mini-sommaire

- **Ordinateur** : un mini-sommaire fixe à gauche, avec les 5 parties et leur avancement (« 4 / 9 »). Un clic y fait défiler la page.
- **Mobile** : le mini-sommaire devient une rangée de pastilles qui défile horizontalement.

### Corps de la fiche

- Chaque **partie** est une carte avec un grand titre.
- Chaque **rubrique** s'affiche comme un champ de formulaire :
  - le **libellé** en gras ;
  - la **consigne** (`hint`) en petit et en gris ;
  - une **grande zone d'écriture** (la case Contenu) : 72 px au minimum, elle grandit avec le texte. Quand elle est vide, la consigne y sert de texte indicatif.
- **Réutilise le rendu des cases existant** pour la zone d'écriture : enregistrement pendant la frappe (`attachRichText`), icônes Rattacher, Repères et Liens, pastilles de rattachement, liseré coloré et « Utilisée par ». Les rattachements doivent fonctionner comme partout ailleurs.
- En affichage formulaire, le libellé n'est pas modifiable. On le modifie dans le modèle ou en affichage tableau.

### Menu ⋯ de la fiche

- « Afficher en tableau / en formulaire » : `t.view = "table"` ou `"page"`. Le formulaire est l'affichage par défaut.
- « Exporter cette fiche (.md) ».
- « Supprimer la fiche » (avec confirmation, comme ailleurs).

### Navigation

En bas de page : « ← Fiche précédente / Fiche suivante → ».

## 5. Lien avec la section 14

Dans un référentiel de type `reference`, ajoute à côté de « Utilisée dans N » un petit bouton :

- **« Ouvrir la fiche »** si une fiche a `sourceRef` vers cette ligne ;
- sinon **« + Fiche de lecture »**, qui crée la fiche pré-remplie (point 3.1).

La fiche d'ancre (`openAnchorSheet`) d'une référence affiche aussi ce bouton.

## 6. Modifier le modèle

- Dans le menu ⋯ de la section 15, ajoute **« Modifier le modèle de fiche »**. Il ouvre une fenêtre qui liste les parties et les rubriques de `childTemplate`, avec les actions suivantes :
  - renommer une rubrique et modifier sa consigne ;
  - monter ou descendre une rubrique avec des flèches ;
  - ajouter une rubrique, avec une nouvelle `key` unique ;
  - ajouter une partie ;
  - supprimer une rubrique, avec confirmation.
- Les changements s'appliquent **aux nouvelles fiches**.
- **« Appliquer aux fiches existantes »** ajoute dans chaque fiche les rubriques manquantes (comparées par `key`), au bon endroit. Ce bouton **ne supprime jamais de contenu** et ne renomme une rubrique existante qu'après ma confirmation.
- **« Rétablir le modèle par défaut »** remet `window.FICHE_LECTURE_TEMPLATE`, avec confirmation.

## 7. Export

- Dans `toMarkdown` (`js/app.js`), une fiche s'exporte ainsi :
  - `## Titre`, puis la référence complète ;
  - `### Partie` pour chaque partie ;
  - `**Rubrique** : contenu` pour chaque rubrique remplie, sans tableau Markdown ;
  - les rattachements sur une ligne « → … », comme ailleurs.
- « Exporter cette fiche (.md) » télécharge uniquement cette fiche.

## Contraintes

- **Ne touche pas** à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- **Garde intacte l'API publique `Editor`** utilisée par `app.js` : `open`, `close`, `flush`, `isDirty`, `currentId`, `setStatus`, `getState`, `currentSection`, `progressOf`.
- **N'appelle jamais `render()` pendant la frappe.** Avant chaque changement de page, enregistre la saisie en cours.
- **Pas de framework, pas de dépendance.**
- **Accessibilité** :
  - chaque zone d'écriture est associée à son libellé (`aria-labelledby`) ;
  - les cartes et les pastilles sont utilisables au clavier ;
  - le focus est visible ;
  - le contraste est d'au moins 4,5:1.
- **Mobile, 390 px de large** : aucun défilement horizontal, et le formulaire tient sur une seule colonne.
- **Ne casse rien** dans les sections 1 à 14 (cartes, sous-titres, rattachements, import).

## Tests avant de publier

Lance `python3 -m http.server 8000` dans le dossier et ouvre `http://localhost:8000`. L'app est alors en mode local, avec le projet d'exemple. Importe d'abord `docs/section-14-references.json` avec « Importer une section », et désigne « Références par chapitre » comme référentiel de type Références.

- [ ] « + Fiches de lecture » crée la section « Fiches de lecture » en dernière position, avec l'état vide et le bouton. Le bouton de création disparaît ensuite.
- [ ] « Nouvelle fiche › À partir d'une référence », avec la recherche « tordo », crée la fiche « Tordo (2021) ». Ses rubriques sont pré-remplies :
  - Type : Article scientifique ;
  - Auteur·e·s : Tordo, F. ;
  - Année : 2021 ;
  - Titre : Soi-même comme un avatar ;
  - Revue : Imaginaire & Inconscient, 1(47), 77-88 ;
  - Statut : À lire ;
  - Pertinence : cœur.
- [ ] La fiche s'affiche en formulaire, avec 5 parties, 32 rubriques et le mini-sommaire. Écrire dans une rubrique enregistre le texte pendant la frappe et fait avancer la barre.
- [ ] La ligne Tordo de la section 14 affiche « Ouvrir la fiche » et « Utilisée dans 1 ». Un clic sur la pastille Référence de la fiche ramène à cette ligne.
- [ ] Recréer une fiche pour Tordo propose « Ouvrir la fiche existante ».
- [ ] Une fiche vide « Huizinga (1938) » avec le statut « Lue » apparaît dans le filtre « Lue », et la tuile « Lues » vaut 1.
- [ ] Ajouter une rubrique au modèle, puis cliquer « Appliquer aux fiches existantes », l'ajoute aux deux fiches sans rien effacer.
- [ ] Un rattachement depuis « Apports pour ma thèse » vers un concept fonctionne, et la pastille s'affiche.
- [ ] L'export `.md` de la fiche est lisible (parties, rubriques en gras).
- [ ] Les sections 1 à 14 s'affichent comme avant. La section 14 garde ses chapitres et ses sous-titres.
- [ ] À 390 px de large, aucun défilement horizontal.
- [ ] Aucune erreur dans la console.

Quand tout est vert, publie :

`git add -A && git commit -m "Section 15 : fiches de lecture" && git push`

Ensuite, dis-moi d'aller dans l'app en ligne et de cliquer « + Fiches de lecture » dans la vue d'ensemble de mon projet.
