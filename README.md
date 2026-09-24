# Atelier de recherche

Application Web pour cartographier et rédiger des projets de recherche : question, objectifs, concepts, cadre théorique, problématique, méthodologie, enjeux éthiques (formulaire UQTR), analyse, discussion et conclusion.

Elle reprend l'outil « Cartographie de thèse » (tableaux imbriqués, repères de couleur, liens entre cases, espaces libres, glisser-déposer) et ajoute :

- **une bibliothèque de projets** : plusieurs recherches en parallèle ;
- **des gabarits duplicables** : « Utiliser » crée un nouveau projet à partir d'un gabarit ; n'importe quel projet peut devenir un gabarit (structure seule ou structure + contenu) ;
- **dupliquer, renommer, supprimer** un projet ou un gabarit ;
- **exports** : sauvegarde `.json` (un projet ou toute la bibliothèque), texte structuré `.md` (à coller dans Word/Google Docs), impression / PDF ;
- **import** d'une sauvegarde `.json`. L'import ajoute toujours de nouveaux éléments et n'écrase jamais l'existant.

Au premier lancement, l'app contient :

- le gabarit **Projet de recherche (UQTR)** : la structure complète avec les consignes et les questions réflexives, sans réponses ;
- le projet **Quand le skin de jeu vidéo déborde l'écran…** : la thèse telle qu'elle était dans l'artefact.

## Où sont les données ?

Tout est enregistré automatiquement dans le **navigateur** (localStorage), sur l'appareil utilisé. Il n'y a ni serveur ni compte.

- Les données ne se synchronisent **pas** entre ordinateurs ou navigateurs.
- Vider les données du site dans le navigateur les efface.
- Clique régulièrement sur **Tout sauvegarder (.json)** pour garder une copie. Pour passer d'un appareil à l'autre, fais **Importer** sur l'autre appareil.

## Déployer sur GitHub + Vercel

C'est un site statique : pas de `npm install` ni d'étape de compilation.

### 1. Mettre le code sur GitHub

**Option A, par le site GitHub (sans terminal)**

1. Sur github.com : **New repository**, nomme-le par exemple `atelier-recherche`, puis **Create repository**.
2. Clique sur **uploading an existing file** et glisse *le contenu* du dossier : `index.html`, `vercel.json`, `README.md` et les dossiers `css/`, `js/` et `data/`.
3. Clique sur **Commit changes**.

**Option B, avec le terminal**

```bash
cd atelier-recherche
git init
git add .
git commit -m "Atelier de recherche : première version"
git branch -M main
git remote add origin https://github.com/<ton-compte>/atelier-recherche.git
git push -u origin main
```

### 2. Brancher Vercel

1. Sur vercel.com : **Add New… → Project**, puis **Import** le dépôt `atelier-recherche`.
2. Framework Preset : **Other**. Laisse *Build Command* et *Output Directory* vides, et *Root Directory* à `./`.
3. Clique sur **Deploy**. Chaque `git push` (ou chaque fichier modifié sur GitHub) redéploie automatiquement.

> Chaque adresse a son propre stockage. Les données saisies sur `xxx.vercel.app` ne sont pas visibles sur `localhost` ni sur un autre domaine, et inversement.

## Tester en local

```bash
cd atelier-recherche
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

(Ouvrir `index.html` directement fonctionne aussi dans la plupart des navigateurs.)

## Structure

```
index.html          page unique
css/editor.css      styles de l'éditeur (repris de l'outil d'origine)
css/app.css         bibliothèque, modales, impression, ajustements mobiles
js/seeds.js         données de départ (gabarit UQTR + thèse), chargées au 1er lancement
js/storage.js       stockage local : projets, gabarits, import/export
js/editor.js        l'éditeur de cartographie (tableaux, repères, liens, espaces libres)
js/app.js           bibliothèque, routeur (#/ et #/p/<id>), exports .json/.md
data/*.json         copies lisibles du gabarit et de la thèse, réimportables via « Importer »
```

## Pistes pour la suite

- Synchronisation entre appareils et partage avec la direction de recherche (par exemple avec Supabase ou Firebase, et une connexion par courriel).
- Export Word (.docx) du formulaire éthique.
- Historique des versions et annulation.
