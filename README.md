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

Une fois la sauvegarde en ligne configurée (voir plus bas), tes projets sont enregistrés **en ligne**, dans une base de données Upstash Redis branchée à Vercel. Tu les retrouves sur tous tes appareils avec le même mot de passe.

- **Enregistrement continu** : l'app enregistre pendant la frappe (après environ 1 seconde de pause) et envoie aussitôt en ligne. Le point vert « Enregistré en ligne » confirme que c'est fait.
- **Hors ligne** : tu peux continuer à écrire. Le texte est gardé sur l'appareil et envoyé automatiquement au retour du réseau (point orange).
- **Deux appareils en même temps** : un projet ouvert sans être modifié se met à jour tout seul. Si le même projet a été modifié des deux côtés, rien n'est perdu : la version en ligne est affichée et celle de l'appareil devient une copie, « … — version de cet appareil ».
- **Versions précédentes** : une copie est archivée au plus toutes les 10 minutes, et les 60 dernières sont conservées. Pour en restaurer une, ouvre **Exporter ▾ → Versions précédentes…**.
- **Suppression** : un projet supprimé est gardé 30 jours dans une corbeille côté serveur. Tu ne la vois pas dans l'app, mais on peut le récupérer au besoin.
- **Sauvegardes externes** : l'export **Tout sauvegarder (.json)** reste une bonne habitude, par exemple une fois par semaine.

Sans configuration en ligne, par exemple en test local, l'app fonctionne en **mode local** : les données restent dans le navigateur.

## Déployer sur GitHub + Vercel

### 1. Mettre le code sur GitHub

Sur ton dépôt GitHub, clique sur **Add file → Upload files** et glisse **tout le contenu** du dossier, y compris le dossier `api`. Termine avec **Commit changes**. Vercel redéploie automatiquement.

### 2. Ajouter la base de données (une seule fois)

1. Dans Vercel, ouvre ton projet, puis l'onglet **Storage**.
2. Clique sur **Create Database** (ou **Browse Marketplace**), choisis **Upstash**, puis **Upstash for Redis**, et **Continue**.
3. Plan **Free**. Région : la plus proche, par exemple *Washington, D.C. (iad1)*. Donne-lui un nom, puis **Create**.
4. Quand Vercel le propose, **connecte** la base à ton projet, sur tous les environnements. Laisse le préfixe par défaut.
   Vercel ajoute alors tout seul les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`.

### 3. Choisir ton mot de passe

1. Dans le projet Vercel, ouvre **Settings → Environment Variables**.
2. Clique sur **Add** :
   - Key : `APP_PASSWORD`
   - Value : ton mot de passe, long et que tu n'utilises nulle part ailleurs.
   - Environnements : tous.
3. Clique sur **Save**.

### 4. Redéployer

Les variables ne s'appliquent qu'au prochain déploiement :

1. Ouvre l'onglet **Deployments**.
2. Sur le déploiement le plus récent, clique sur **⋯** puis **Redeploy**.

### 5. Se connecter

Ouvre l'adresse de l'app et entre le mot de passe. Au premier démarrage :

- si le navigateur contenait déjà des projets (version locale), ils sont **envoyés en ligne** automatiquement ;
- sinon, l'app crée le gabarit UQTR et ta thèse.

Sur un autre appareil, il suffit d'ouvrir la même adresse et d'entrer le même mot de passe.

> Pour changer le mot de passe, modifie `APP_PASSWORD` dans Vercel, puis fais **Redeploy**. Tous les appareils devront se reconnecter ; les données ne sont pas touchées.

## Tester en local

```bash
cd atelier-recherche
python3 -m http.server 8000      # mode local, sans sauvegarde en ligne
# ou, pour tester les fonctions /api :  npx vercel dev
```

## Structure

```
index.html          page unique
css/editor.css      styles de l'éditeur (repris de l'outil d'origine)
css/app.css         bibliothèque, modales, impression, ajustements mobiles
js/seeds.js         données de départ (gabarit UQTR + thèse), chargées au 1er lancement
js/storage.js       copie locale : projets, gabarits, import/export
js/cloud.js         synchronisation en ligne (envoi, réception, conflits, hors ligne, historique)
api/login.js        connexion par mot de passe (APP_PASSWORD)
api/data.js         lecture/écriture des projets dans Upstash Redis, historique des versions
api/_lib/common.js  utilitaires partagés par les fonctions
js/editor.js        l'éditeur de cartographie (tableaux, repères, liens, espaces libres)
js/app.js           bibliothèque, routeur (#/ et #/p/<id>), exports .json/.md
data/*.json         copies lisibles du gabarit et de la thèse, réimportables via « Importer »
```

## Pistes pour la suite

- Comptes individuels, par exemple pour donner un accès en lecture à la direction de recherche.
- Export Word (.docx) du formulaire éthique.
- Historique des versions et annulation.
