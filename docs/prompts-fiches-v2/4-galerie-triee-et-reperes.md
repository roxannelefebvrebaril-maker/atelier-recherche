# Fiches de lecture v2 · Prompt 4 sur 4 : la galerie (tri par auteur et repères)

> Colle tout ce qui suit la ligne dans le chat de VS Code, en mode **Agent**. À lancer **après** le prompt 3.

---

> **Important :** une partie de ce travail a peut-être déjà été faite (des changements non publiés existent dans `js/editor.js`, `js/app.js`, `css/theme.css` et `js/fiche-template.js`). **Vérifie d'abord ce qui existe déjà**, complète seulement ce qui manque, ne refais rien en double et corrige ce qui ne respecte pas ce prompt.

Tu travailles sur **Atelier de recherche** (`js/editor.js`, `css/theme.css`, JavaScript vanilla). La section 15 est une **galerie de fiches de lecture**. Chaque fiche est un tableau `kind: "fiche"` dont le titre est la référence APA.

Lis `renderFicheSectionCards`, `renderFichePage`, `renderTagsRow`, `renderTagbar`, `dimTag` et `shortCitation`. Propose-moi ensuite un plan court.

## 1. Tri automatique par auteur·e (très important)

- Dans la galerie, les fiches sont **toujours** classées en ordre alphabétique selon le **nom de famille du premier auteur ou de la première autrice**.
- **Clé de tri** : le texte du titre avant la première virgule ou la première parenthèse :
  - « Tordo, F. (2021)… » → Tordo ;
  - « Le Corre, V. (2012)… » → Le Corre.
- **Comparaison** : `localeCompare("fr", {sensitivity: "base"})`. En cas d'égalité, trie par année, puis par titre.
- **Fiches sans référence** (« Nouvelle fiche ») : à la fin.
- **Mise à jour** : une nouvelle fiche, ou une fiche dont on modifie la référence, se place automatiquement au bon endroit.
- **Pagination** : « Fiche précédente / suivante » suit le même ordre.
- **Ne change rien au menu de gauche** : l'ordre des sections reste exactement le même.

## 2. Repères à la place des étiquettes

- **Retire** les pastilles Toutes / Articles / Livres / Chapitres / Autres et Tous / À lire / En cours / Lue. **Garde** la recherche.
- **Remplace-les par les repères du projet** (`state.tags`, la ligne « Repères » de `renderTagsRow`). Ils servent de catégories.
  - Nouveau champ optionnel : `fiche.tags = [tagId, …]`.
  - Dans l'en-tête de chaque fiche : les pastilles de ses repères et un bouton « + Repère ». Ce bouton coche ou décoche les repères existants et permet d'en créer un nouveau (nom et couleur).
  - **Dans la galerie**, un clic sur un repère n'affiche que les fiches qui l'ont. Un deuxième clic montre à nouveau toutes les fiches.
  - Ce filtre se combine avec la recherche, qui cherche aussi dans les mots-clés et dans le nom des repères.

## 3. Carte d'une fiche

- **Titre** : `shortCitation(titre)`, par exemple « Tordo (2021) ».
- **Sous le titre** : la référence complète, sur 2 lignes au maximum.
- **Pastilles** : les repères de la fiche.
- **Avancement** : l'anneau d'avancement et « x / n rubriques ».
- **Carte rose « + Nouvelle fiche de lecture »** : toujours en premier.

## Contraintes

- Ne touche pas à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- Le seul tri alphabétique autorisé est celui des fiches de la galerie.
- **Recherche** : n'appelle pas `render()` à chaque frappe, pour ne pas perdre le focus.
- **Mobile, 390 px** : une colonne, sans défilement horizontal.

## Tests

- [ ] Crée les fiches Tordo (2021), Boutet (2012), Le Corre (2012) et Bonenfant et al. (2024), dans cet ordre. La galerie affiche **Bonenfant, Boutet, Le Corre, Tordo**.
- [ ] Une fiche « Allison, A. (2008)… » se place en premier.
- [ ] Sur Boutet, « Fiche suivante » mène à Le Corre.
- [ ] Les anciennes pastilles ont disparu. La recherche fonctionne et garde le focus.
- [ ] Ajoute le repère « Article » à une fiche. Dans la galerie, un clic sur « Article » ne montre qu'elle, et un nouveau clic montre tout.
- [ ] L'ordre du menu de gauche est inchangé.
- [ ] Aucune erreur dans la console.

Publie :

```
git add -A && git commit -m "Fiches : galerie triée par auteur, repères" && git push
```
