# Versus Throw

Client statique déployable sur GitHub Pages. Le serveur WebSocket est déjà en ligne (`wss://twoplayer-1.onrender.com`).

## Déploiement GitHub Pages

1) Pousse ce repo sur GitHub et assure-toi que la branche principale est `main`.
2) Dans GitHub, va dans Settings > Pages, choisis Source = "GitHub Actions".
3) Le workflow `.github/workflows/pages.yml` s'exécute à chaque push sur `main` et publie le contenu du dossier `public`.
4) L'URL publique est `https://<user>.github.io/<repo>/` (pas `.../public/`, sinon GitHub renvoie 404).

### Ajouter des assets
Si tu ajoutes des icônes ou images, copie-les aussi dans le dossier `site` dans l'étape "Préparer les fichiers statiques" du workflow.
