# Prompt 2 sur 3 : gabarit « Maîtrise (APA 7) »

Vérifie d'abord ce qui existe déjà. Le prompt 1 a créé `ensureBuiltinTemplates()` dans `js/storage.js` : réutilise-le, ne crée pas un deuxième mécanisme.

Le fichier de contenu existe déjà, **ne modifie pas son contenu** : `js/gabarits/apa-maitrise.js` (version lisible : `data/gabarit-apa-maitrise.json`).

Ce que je veux :
1. Dans `index.html`, charge `js/gabarits/apa-maitrise.js` juste après `js/gabarits/apa-baccalaureat.js`.
2. Vérifie qu'il s'ajoute tout seul à ma bibliothèque existante, sans recréer le gabarit du baccalauréat si je l'ai supprimé.

Tests (`python3 -m http.server 8000`) :
- [ ] « Travail de session — Maîtrise (APA 7) » apparaît une seule fois dans Gabarits.
- [ ] Ses sections : Repères du travail, Page de titre, Introduction, Problématique, Recension des écrits, Cadre conceptuel, Démarche méthodologique, Analyse, Discussion, Conclusion, Références, Annexe A.
- [ ] Problématique contient « Mise en contexte » et « Question de recherche et objectifs » ; Recension des écrits contient « Thème ou courant 1 », « Thème ou courant 2 » et « Synthèse critique ».
- [ ] « Utiliser » crée un projet complet. Aucune erreur dans la console.

Quand tout est vert :
`git add -A && git commit -m "Gabarit APA 7 : maîtrise" && git push`
