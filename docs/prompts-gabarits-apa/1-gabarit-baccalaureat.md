# Prompt 1 sur 3 : gabarit « Baccalauréat (APA 7) » et ajout automatique dans la bibliothèque

Vérifie d'abord ce qui existe déjà avant de modifier quoi que ce soit.

Contexte : Atelier de recherche (HTML, CSS, JS vanilla, sans compilation, déployé sur Vercel, interface en français). La bibliothèque contient des projets et des gabarits (`kind: "template"`). Le gabarit « Projet de recherche (UQTR) » est créé par `Store.seedIfEmpty` (`js/storage.js`), seulement quand un compte est vide.

Les fichiers de contenu existent déjà, **ne modifie pas leur contenu** :
- `js/gabarits/apa-baccalaureat.js` : ajoute `{key, title, state}` au tableau `window.SEEDS_GABARITS`.
- `data/gabarit-apa-baccalaureat.json` : la même chose en version lisible.

Ce que je veux :

1. Dans `index.html`, charge `js/gabarits/apa-baccalaureat.js` juste après `js/seeds.js`.
2. Dans `js/storage.js`, crée `ensureBuiltinTemplates()` :
   - pour chaque élément de `window.SEEDS_GABARITS`, crée un gabarit (`Store.create("template", clone(state))`) avec le titre `title` ;
   - **jamais de doublon** : ne le crée pas si un gabarit portant ce `key` existe déjà dans la bibliothèque (y compris un gabarit arrivé d'un autre appareil par la synchronisation). Marque le gabarit avec son `key` d'une façon qui survit à la synchronisation et qui n'est **pas** recopiée dans un projet créé avec « Utiliser » ;
   - si je supprime un de ces gabarits, il ne doit pas revenir : retiens les `key` déjà installés (par compte).
3. Appelle `ensureBuiltinTemplates()` :
   - en mode local, après `Store.seedIfEmpty()` ;
   - en mode en ligne, **après** la première synchronisation terminée (sinon un 2e appareil créerait un doublon avant d'avoir reçu ce qui existe déjà) ;
   - pour les comptes neufs comme pour les comptes existants (le mien en a déjà).
4. N'appelle `render`/`route` à nouveau que si un gabarit vient d'être ajouté.

Contraintes : ne touche pas à `api/`, ni au format des données existantes, ni au gabarit « Projet de recherche (UQTR) », ni aux fiches de lecture.

Tests (`python3 -m http.server 8000`, mode local) :
- [ ] La bibliothèque montre « Travail de session — Baccalauréat (APA 7) » dans Gabarits, une seule fois, même après plusieurs rechargements.
- [ ] Ses sections : Repères du travail, Page de titre, Introduction, Définition des concepts clés, Première, Deuxième et Troisième partie, Conclusion, Références. Chacune ouvre ses tableaux (Consignes en bleu, Rédaction en mauve).
- [ ] « Utiliser » crée un projet complet ; supprimer ce projet ne touche pas au gabarit.
- [ ] Supprimer le gabarit puis recharger : il ne revient pas.
- [ ] Aucune erreur dans la console.

Montre-moi un plan court, puis fais les changements. Quand tout est vert :
`git add -A && git commit -m "Gabarit APA 7 : baccalauréat" && git push`
