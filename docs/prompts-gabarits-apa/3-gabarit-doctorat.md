# Prompt 3 sur 3 : gabarit « Doctorat (APA 7) »

Vérifie d'abord ce qui existe déjà. Réutilise `ensureBuiltinTemplates()` (`js/storage.js`), ne crée pas un deuxième mécanisme.

Le fichier de contenu existe déjà, **ne modifie pas son contenu** : `js/gabarits/apa-doctorat.js` (version lisible : `data/gabarit-apa-doctorat.json`).

Ce que je veux :
1. Dans `index.html`, charge `js/gabarits/apa-doctorat.js` juste après `js/gabarits/apa-maitrise.js`.
2. Dans la bibliothèque, classe les gabarits dans cet ordre : Projet de recherche (UQTR), Baccalauréat, Maîtrise, Doctorat, puis mes propres gabarits. Si la bibliothèque a déjà un ordre que je peux changer moi-même, ne le force pas : place seulement les nouveaux à la suite.

Tests (`python3 -m http.server 8000`) :
- [ ] « Texte de séminaire — Doctorat (APA 7) » apparaît une seule fois dans Gabarits.
- [ ] Ses sections : Repères du travail, Page de titre, Résumé et mots-clés, Introduction, État de la question, Cadre théorique et posture épistémologique, Méthodologie, Résultats ou argumentation, Discussion, Conclusion, Références, Annexe A.
- [ ] Repères du travail contient le tableau « Lien avec le projet de thèse » ; Résumé et mots-clés contient « Éléments du résumé », « Résumé (150 à 250 mots) » et « Mots-clés » (5 lignes).
- [ ] Sur un 2e navigateur connecté au même compte (ou une fenêtre privée), aucun gabarit n'est en double après la synchronisation.
- [ ] À 390 px de large, la bibliothèque s'affiche bien. Aucune erreur dans la console.

Quand tout est vert :
`git add -A && git commit -m "Gabarit APA 7 : doctorat" && git push`
