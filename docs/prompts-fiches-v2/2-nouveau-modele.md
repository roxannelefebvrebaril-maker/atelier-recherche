# Fiches de lecture v2 · Prompt 2 sur 4 : le nouveau modèle de fiche

> Colle tout ce qui suit la ligne dans le chat de VS Code, en mode **Agent**. À lancer **après** le prompt 1.

---

> **Important :** une partie de ce travail a peut-être déjà été faite (des changements non publiés existent dans `js/editor.js`, `js/app.js`, `css/theme.css` et `js/fiche-template.js`). **Vérifie d'abord ce qui existe déjà**, complète seulement ce qui manque, ne refais rien en double et corrige ce qui ne respecte pas ce prompt.

Tu travailles sur **Atelier de recherche**, une application en HTML, CSS et JavaScript vanilla, dans `js/editor.js` et `css/theme.css`. Les fiches de lecture sont des tableaux `kind: "fiche"`, enfants de la section 15.

**Ouvre la maquette validée `docs/maquettes/fiche-de-lecture-v2.html` dans un navigateur** : c'est exactement le rendu attendu. Lis aussi `renderFichePage`, `cloneFicheFromTemplate`, `createBlankFiche`, `createFicheFromReference`, `js/fiche-template.js`, `attachRichText` et `renderTable`. Propose-moi ensuite un plan court.

## Structure d'une nouvelle fiche (dans cet ordre)

| Élément | Type | Consigne affichée en gris |
|---|---|---|
| **Titre** (en haut) | Référence APA 7 (`fiche.title`), modifiable | — |
| **Mots-clés** | texte | « Mots-clés de l'auteur·e et les miens, séparés par des virgules » |
| **Résumé** | texte long | « L'essentiel du texte, dans mes mots » |
| **Hypothèse** | texte long | « Ce que l'auteur·e cherche à démontrer ou à vérifier » |
| **Définitions** | tableau intégré, colonnes **Mot** et **Définition** | « Un mot par ligne et sa définition (avec la page) » |
| **Concepts et théories** | tableau intégré, colonnes **Concept ou théorie** et **Définition** | « Un concept ou une théorie par ligne et ce qu'il ou elle veut dire » |
| **Notes** | texte long | « Mes notes libres sur ce texte » |

## Disposition et comportement (voir la maquette)

- **Deux colonnes** : la rubrique à gauche (environ 28 %), avec sa consigne en petit et en gris, et le contenu à droite. Une ligne visible sépare chaque rubrique.
- **Tableaux intégrés** :
  - ils sont affichés dans la colonne de droite ;
  - le bouton « + Ajouter une ligne » ajoute une ligne ;
  - un × apparaît au survol pour supprimer une ligne.
- **« + Insérer un tableau »** ajoute **à la fin** un « Tableau N » à deux colonnes, **Terme** et **Définition**.
  - Le titre et les noms des colonnes se modifient.
  - Un × supprime le tableau, avec une confirmation s'il contient du texte.
  - Badge bleu « Tableau ajouté ».
- **« + Ajouter une zone de rédaction »** ajoute **à la fin** une zone de texte long, « Zone de rédaction N ».
  - Son nom se modifie.
  - Un × la supprime, avec une confirmation si elle contient du texte.
  - Fond vert pâle et badge.
- **Rubriques de base** : les 6 rubriques ne se suppriment pas et ne se renomment pas.
- **Barre d'avancement** « x / n rubriques remplies ».
  - Un tableau compte comme rempli si au moins une de ses lignes contient du texte.
  - Les éléments ajoutés comptent dans le total.

## Stockage, compatible avec le reste de l'app

- Chaque fiche porte `ficheVersion: 2` et deux colonnes, Rubrique et Contenu.
- **Rubriques texte** : ce sont des lignes de la fiche. Chacune a une `key` (`kw`, `resume`, `hypothese`, `notes` ou `zone_<uid>`) et une consigne `hint`. Les zones ajoutées ont aussi `custom: true`.
- **Tableaux intégrés** : ce sont des **sous-tableaux ordinaires** (leur `parentId` est la fiche).
  - Chacun a une `key` : `definitions`, `concepts` ou `table_<uid>`. Les tableaux ajoutés ont aussi `custom: true`.
  - Grâce à ça, la recherche, les rattachements et l'export fonctionnent déjà.
  - Ces sous-tableaux **ne doivent pas** apparaître comme des cartes dans la galerie ni comme des éléments dans le menu de gauche.
- **Ordre d'affichage** : `fiche.ficheItems = [{type:"row", id}, {type:"table", id}, …]`.
- **Modèle** : mets à jour `js/fiche-template.js` pour le modèle v2. Garde l'ancien sous le nom `FICHE_LECTURE_TEMPLATE_V1`.
- **Anciennes fiches** (sans `ficheVersion`) : ne les modifie pas. Elles s'ouvrent comme avant.
- **Création** : toutes les nouvelles fiches utilisent le modèle v2, y compris celles créées à partir d'une référence. Dans ce cas, le titre est la référence complète.
- **Export Markdown d'une fiche v2** :
  - `## Référence` comme titre ;
  - `**Rubrique** : texte` pour chaque rubrique texte ;
  - un tableau Markdown pour chaque tableau intégré.

## Contraintes

- Ne touche pas à `js/storage.js`, `js/cloud.js`, `api/`, `js/seeds.js`, `data/` ni `docs/*.json`.
- Ne change pas le menu de gauche.
- N'appelle jamais `render()` pendant la frappe : utilise `attachRichText`.
- **Accessibilité** : chaque zone d'écriture est liée à son libellé avec `aria-labelledby`, et chaque bouton a un `aria-label` en français.
- **Mobile, 390 px** : une seule colonne (la rubrique au-dessus de son contenu), sans défilement horizontal.

## Tests

Lance `python3 -m http.server 8000`.

- [ ] Une nouvelle fiche affiche les 7 éléments dans l'ordre, comme dans la maquette.
- [ ] « + Ajouter une ligne » fonctionne dans les deux tableaux, et le × supprime une ligne.
- [ ] « + Insérer un tableau » ajoute « Tableau 1 », qu'on peut renommer (par exemple « Méthodes »), dont on peut renommer les colonnes, et qu'on peut supprimer.
- [ ] « + Ajouter une zone de rédaction » ajoute une zone verte, qu'on peut renommer et supprimer.
- [ ] Le texte reste après un rechargement, et la barre d'avancement progresse.
- [ ] Une ancienne fiche s'ouvre comme avant.
- [ ] Les tableaux intégrés n'apparaissent ni dans la galerie ni dans le menu.
- [ ] À 390 px, l'affichage est correct. Aucune erreur dans la console.

Publie :

```
git add -A && git commit -m "Fiches : nouveau modèle v2" && git push
```
