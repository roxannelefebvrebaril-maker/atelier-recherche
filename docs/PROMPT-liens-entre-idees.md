# Prompt — Relier mes idées : rattachements visibles d'un coup d'œil

> **Mode d'emploi** : dans VS Code, ouvre le chat en mode **Agent** et colle tout ce qui suit la ligne ci-dessous. Lance ce prompt **après** que le travail précédent (« sections à cartes ») a été publié.

---

Tu travailles sur **Atelier de recherche**, une application Web en HTML/CSS/JavaScript « vanilla » (sans framework ni compilation, déployée sur Vercel), qui sert à rédiger une **thèse de doctorat**. Toute l'interface est en **français**.

- L'éditeur est dans `js/editor.js` (`window.Editor`), les styles dans `css/theme.css`.
- La bibliothèque, le routeur et les exports sont dans `js/app.js`.

**Lis `js/editor.js` en entier avant de commencer**, en particulier :

- le modèle `state`, et les fonctions `linksFor`, `entityLabel`, `handleLinkClick`, `openLinksPopover`, `goTo`, `goToBlock` et `ensureSectionFor` ;
- `renderTable`, `renderIcons`, `renderCellTags`, `attachRichText` et `updateProgressIndicators` ;
- `activeSection` / `activeChild` (sections à cartes), `deleteTableCascade`, `moveRowAcrossTables`, `importSection` et `applyDim`.

Propose-moi ensuite un plan court.

## Le besoin

Quand j'arrive sur une case où j'ai rédigé quelque chose, je veux voir **au premier coup d'œil** à quoi elle se rattache :

- à quel **objet ou question de recherche** ;
- à quel **objectif** ;
- à quel **axe de recherche** ;
- à quel **concept** ;
- à quelle **théorie** ;
- de quelles **références** vient cette réflexion (« cette réflexion vient de la lecture de Tordo (2021) et de Mauco (2020) ») ;
- à quelles **autres réflexions** elle est liée.

Je veux aussi faire le chemin inverse : partir d'un concept ou d'une référence et voir tout ce qui s'y rattache. Et je veux que ces liens restent visibles pendant que je me promène d'un tableau à l'autre et d'une ligne de rédaction à l'autre.

Aujourd'hui, l'app n'a que des liens génériques entre cases (`state.links = [{id, a, b}]`, où `a` et `b` valent `"t:<tableId>:<rowId>:<colId>"` ou un id de nœud de schéma). Ils ne sont visibles qu'en petit chiffre sur une icône. On construit une structure plus riche **par-dessus**, sans rien casser.

## 1. Le modèle : des référentiels, des ancres et des liens

### Référentiels et ancres

- Un **référentiel** est un tableau dont **chaque ligne** représente un point d'ancrage de même type.
- Nouveau **champ optionnel `t.anchorType`**, dont les valeurs possibles sont :

  | Valeur | Type d'ancre | Couleur (jetons existants) |
  |---|---|---|
  | `question` | Question / objet de recherche | rose |
  | `objectif` | Objectif | ambre |
  | `axe` | Axe de recherche | sarcelle (teal) |
  | `concept` | Concept | violet |
  | `theorie` | Théorie / auteur·e | indigo |
  | `reference` | Référence | bleu |

  Les références sont les tableaux-chapitres de ma section 14.
- **Héritage** : le type se lit en remontant les `parentId`. Si la section conteneur « Références par chapitre » a `anchorType: "reference"`, ses 7 chapitres en héritent.
- Une **ancre** est une **ligne** d'un référentiel, sauf les lignes d'intertitre ou de note (`row.kind`). Son identifiant d'entité est **`"r:<tableId>:<rowId>"`**.

### Libellé d'une ancre

- Le libellé est le texte brut de la **première colonne**, coupé à 70 caractères.
- **Pour une référence**, calcule une **citation courte** à partir de la case Sources :
  - « Tordo (2021) » ;
  - « Nachez et Schmoll (2022) » s'il y a deux auteurs ;
  - « Bonenfant et al. (2024) » s'il y en a trois ou plus, ou si le texte contient déjà « et al. ».

  Écris une fonction `shortCitation(text)` robuste, capable de lire par exemple « Deseilligny, O., & Beau, F. (2009). … » ou « Huizinga, J. (1973 [1938]). … ». Si l'analyse échoue, utilise les 40 premiers caractères. La référence complète reste disponible en infobulle.

### Liens

On garde **`state.links`** et on y ajoute **un champ optionnel `rel`** :

| Lien | Valeur de `rel` | Verbe affiché |
|---|---|---|
| **Rattachement** d'une case ou d'un nœud (`a`) à une ancre (`b = "r:…"`) | le type de l'ancre | question et objectif : « répond à » · axe : « s'inscrit dans » · concept : « mobilise » · théorie : « s'appuie sur » · référence : « vient de la lecture de » |
| **Lien entre deux réflexions** (case ↔ case), inchangé | absent ou `"lie"` ; options `"approfondit"`, `"nuance"`, `"mene"` | « lié à » (par défaut), « approfondit », « nuance / contredit », « mène à » |

- **Liens existants** : un lien case ↔ case dont l'autre bout est une case **située dans un référentiel** s'affiche comme un rattachement à la ligne de cette case. On l'interprète à l'affichage, sans migration des données.

### Ce qui ne change pas dans les données

`t.anchorType` et `link.rel` sont les seuls ajouts, et ils sont optionnels. Aucun autre changement au format des données : tout projet existant doit s'ouvrir sans perte.

### Performance

Construis **un index** (une `Map` : entité → liens, et ancre → rattachements) au début de chaque `render()`, et utilise-le partout. N'appelle **jamais** `state.links.filter` dans une boucle de cases : ma section 14 compte déjà 300 lignes.

## 2. Définir mes référentiels

- Dans le **menu ⋯** de chaque tableau, ajoute l'entrée **« Référentiel : … »**. Elle ouvre un sous-menu : Aucun, Question / objet, Objectifs, Axes, Concepts, Théories, Références. Le type courant est coché.
- **Assistant au premier usage** : si aucun tableau du projet n'a d'`anchorType`, affiche **une fois par projet** un bandeau discret « Organise tes liens : indique quels tableaux contiennent tes objectifs, concepts, théories… ». Il ouvre une fenêtre qui **propose** des types selon les titres des tableaux, sans jamais rien appliquer sans confirmation :
  - `question de recherche|objet` → question ;
  - `objectif` → objectif ;
  - `axe` → axe ;
  - `concept` → concept ;
  - `th[ée]orie` → théorie ;
  - `r[ée]f[ée]rence|bibliograph` → référence.

  Chaque suggestion a une case à cocher et une liste déroulante pour la corriger. Dans mon projet, on devrait retrouver par exemple « Question de recherche », « Objectifs », « Axes de recherche », « Liste des concepts », « Théories de la socialisation » et « Références par chapitre ».
- **Dans un référentiel**, chaque ligne-ancre montre dans sa première case une petite **pastille « Utilisée dans N »** (le nombre de rattachements qui pointent vers elle). Un clic sur la pastille ouvre la **fiche de l'ancre** (section 5).
- Le titre d'un référentiel porte une petite étiquette de son type, en couleur.

## 3. Rattacher une case : le sélecteur

- Dans les icônes de chaque case (`renderIcons`), ajoute une icône **« Rattacher »**, une ancre SVG. Elle ouvre un **sélecteur** en fenêtre flottante :
  - un **champ de recherche** avec focus automatique, insensible aux accents et à la casse ;
  - des **filtres par type** en pastilles colorées avec leur nombre : Tous · Objectifs · Axes · Concepts · Théories · Références · Réflexions ;
  - une section **« Récents »** qui reprend les 8 dernières ancres utilisées, mémorisées dans `localStorage` pour ce projet ;
  - des **résultats** montrant pour chacun : l'icône et la couleur du type, le libellé (ou la citation courte), puis le chemin en gris (« Section 14 › Chapitre 1 »). Un résultat déjà rattaché est coché. Un clic ou **Entrée** ajoute le rattachement ou le retire ;
  - le sélecteur **reste ouvert** pour en ajouter plusieurs à la suite, et **Échap** le ferme ;
  - le filtre **Réflexions** cherche dans le texte de toutes les cases rédigées qui ne sont pas dans un référentiel, et en montre un extrait de 80 caractères. Choisir une réflexion crée un lien case ↔ case, avec la relation « lié à » par défaut.
- **Raccourci** : **Cmd + K** (Ctrl + K sous Windows) dans une case ouvre le sélecteur pour cette case. Garde la position du curseur, n'écris rien dans la case et ne relance pas `render()` pendant la frappe.
- L'ancien mode « cliquer deux icônes de lien » continue de fonctionner.
- **Les ancres restent reliables entre elles** (par exemple une référence reliée à un concept) : les rattacher fonctionne pareil, d'ancre à ancre.

## 4. Voir d'un coup d'œil

### Pastilles de rattachement

Sous le texte de chaque case qui a des liens, au-dessus des repères, affiche une ligne de **pastilles colorées par type** :

- **icône du type + libellé court**, par exemple :
  - [◎ Objectif 2]
  - [◇ Représentations sociales]
  - [📖 Tordo (2021)]
  - [↔ 2 réflexions]

  Utilise des icônes SVG cohérentes avec `ICONS`, pas des émojis.
- **Nombre** : au plus **4 pastilles** visibles ; au-delà, une pastille « +3 » ouvre le panneau de contexte.
- **Infobulle** au survol ou au focus : le verbe et le texte complet de l'ancre, par exemple « vient de la lecture de : Tordo, F. (2021). Soi-même comme un avatar… ».
- **Clic** : `goTo` vers l'ancre. Il doit ouvrir la bonne section **et** le bon chapitre (`activeChild`), puis faire défiler et clignoter la ligne.
- **Retirer** : un petit × apparaît au survol pour retirer le rattachement, avec un message d'annulation (`showToast` avec « Annuler »).

### Liseré latéral

Sur le bord gauche de la case, affiche un fin **liseré vertical** de 4 px, découpé en segments aux couleurs des types rattachés. En faisant défiler, on voit tout de suite quelles cases sont reliées à des concepts, des références, etc.

### Mêmes indicateurs ailleurs

- **Affichage mobile en fiches** : mêmes pastilles et même liseré.
- **Nœuds d'espace libre** : mêmes pastilles, en plus compact.

### Zéro encombrement

Une case sans lien n'affiche rien de plus. L'icône « Rattacher » n'apparaît qu'au survol, comme les autres icônes.

## 5. Panneau de contexte et fiche d'ancre

### Panneau de contexte « Liens »

- **Où** : un panneau latéral droit, de 340 px, sur les écrans de plus de 1200 px. En dessous de cette largeur, un panneau qui monte du bas de l'écran.
- **Ouverture** : un bouton **« Liens »** dans l'en-tête l'ouvre ou le ferme, et ce choix est mémorisé.
- **Contenu** : quand je clique ou place le curseur dans une case, le panneau montre, **sans redessiner la page principale** :
  - l'extrait de la case et son chemin (« Section 6 › Objectifs › Réponses ») ;
  - **« Rattachée à »** : les rattachements groupés par type, avec leur verbe. On peut retirer chacun avec ×, et changer la relation d'un lien entre réflexions (lié à / approfondit / nuance / mène à) ;
  - **« Réflexions liées »** ;
  - **« Utilisée par »** : les liens qui pointent **vers** cette case, ou vers sa ligne si c'est une ancre ;
  - des boutons **« + Rattacher »** et **« + Relier à une réflexion »**.
- **Mise à jour** : le panneau se met à jour au changement de case (focus), **jamais pendant la frappe**.

### Fiche d'ancre

Elle s'ouvre par un clic sur la pastille « Utilisée dans N », par « Ouvrir la fiche » dans le panneau, ou par un clic long sur une pastille de rattachement. C'est une grande fenêtre, ou une page avec un fil d'Ariane, qui contient :

- le type, le libellé et **tout le contenu de la ligne**, par exemple la référence complète, son résumé et ses notes ;
- **« Tout ce qui s'y rattache »** : chaque case rattachée, groupée par section et par chapitre, avec un extrait, le verbe et un bouton pour y aller ;
- **« Souvent associée à »** : les autres ancres qui apparaissent sur les mêmes cases, triées par fréquence (par exemple, pour le concept « Représentations sociales » : Moscovici (2004), Objectif 1, Jodelet (2002)).

### Filtre « Voir les cases liées à… »

Dans l'en-tête, un champ de recherche d'ancre **atténue toutes les cases** qui ne sont pas rattachées à l'ancre choisie, dans toutes les sections, en réutilisant le mécanisme de `applyDim`. Chaque carte de section ou de chapitre (sections à cartes) affiche aussi le nombre de cases correspondantes. Un bouton × enlève le filtre.

## 6. (Étape facultative, à la fin) Tableau croisé

Ajoute une entrée **« Tableau croisé des liens »** à la vue d'ensemble du projet :

- je choisis un type en lignes (par ex. Objectifs) et un type en colonnes (par ex. Concepts) ;
- chaque case du tableau affiche **le nombre de réflexions rattachées aux deux**, avec une intensité de couleur proportionnelle ;
- un clic sur une case liste ces réflexions, avec un lien pour y aller ;
- les cases vides sont bien visibles : elles montrent ce qui n'est pas encore travaillé.

## Intégrité des données (à vérifier absolument)

- **Suppression** : supprimer une ligne, une colonne, un tableau (`deleteTableCascade`) ou un nœud supprime aussi les liens `"r:<tableId>:<rowId>"` concernés. Aujourd'hui, le code ne filtre que les préfixes `"t:"`.
- **Déplacement** : déplacer une ligne vers un autre tableau (`moveRowAcrossTables`) **met à jour** les identifiants d'entités `t:` et `r:` dans les liens au lieu de les casser.
- **Import** : `importSection` réassocie aussi les liens `r:` avec les nouveaux ids.
- **Export Markdown** (`toMarkdown`, dans `app.js`) : sous chaque case qui a des rattachements, ajoute une ligne en italique « → répond à : Objectif 2 · mobilise : Représentations sociales · vient de : Tordo (2021) ».
- **Stockage** : ne modifie pas `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`, et garde l'API publique `Editor` (`open`, `close`, `flush`, `isDirty`, `currentId`, `setStatus`, `getState`, `currentSection`, `progressOf`).
- **Frappe** : n'appelle jamais `render()` pendant la frappe. Chaque ajout ou retrait de lien appelle `scheduleSave(true)`.

## Accessibilité et style

- Les pastilles, les boutons et les résultats du sélecteur sont accessibles au clavier, avec un `aria-label` en français.
- Chaque type se distingue par **son icône et sa couleur** : la couleur ne doit jamais être le seul indice.
- Contraste du texte : au moins 4,5:1, avec du texte foncé sur un fond pâle.
- Respecte `prefers-reduced-motion`.
- À 390 px de large : aucun défilement horizontal, et les pastilles passent à la ligne.

## Façon de travailler

Procède par étapes : **(1)** référentiels, **(2)** sélecteur et rattachements, **(3)** pastilles et liseré, **(4)** panneau de contexte, **(5)** fiche d'ancre et filtre, **(6)** tableau croisé.

Après **chaque** étape, teste avec `python3 -m http.server 8000` (mode local, projet d'exemple ; importe `docs/section-14-references.json` pour avoir des références), puis publie :

`git add -A && git commit -m "<message en français>" && git push`

## Tests

- [ ] L'assistant propose les bons référentiels et n'applique rien sans confirmation. La section « Références par chapitre » en « Références » fait hériter ses 7 chapitres.
- [ ] Dans une case de « Notes de rédaction » : Cmd + K, taper « tordo », Entrée, puis taper « représ » et choisir le concept. Deux pastilles apparaissent (📖 Tordo (2021) et ◇ Représentations sociales), avec un liseré bleu et violet.
- [ ] Un clic sur la pastille Tordo ouvre la section 14, chapitre 1, et fait clignoter la bonne ligne. Cette ligne affiche « Utilisée dans 1 ».
- [ ] La fiche de Tordo (2021) liste la case de départ, et « Souvent associée à » montre Représentations sociales.
- [ ] Le filtre « Voir les cases liées à… Représentations sociales » atténue tout le reste, et les cartes affichent des nombres.
- [ ] Le panneau « Liens » se met à jour en passant d'une case à l'autre, sans rien perdre de ce qui est tapé.
- [ ] Supprimer la ligne Tordo retire la pastille partout. Déplacer une ligne rattachée vers un autre tableau garde ses liens.
- [ ] Un ancien lien case ↔ case continue de s'afficher.
- [ ] Un projet sans aucun référentiel s'affiche exactement comme avant.
- [ ] L'export `.md` contient les lignes « → … ».
- [ ] Aucune erreur dans la console, et pas de lenteur visible dans la section 14 (300 lignes).
- [ ] À 390 px : tout fonctionne, sans défilement horizontal.

À la fin, résume ce qui a changé et dis-moi quoi vérifier dans l'app en ligne.
