# Versus Throw

## Lancer en local (pour le prof)
1. Installer Node.js 18+.
2. Dans ce dossier : `npm ci` pour installer les dépendances.
3. Démarrer : `npm start` (alias de `node server.js`). Variable `PORT` optionnelle (défaut 5000).
4. Ouvrir le navigateur sur `http://localhost:5000/` (les fichiers statiques sont servis depuis `public/` et le WebSocket tourne sur le même port).

## Lancer en local via Docker (même Wi‑Fi)
1. Installer Docker Desktop.
2. Dans ce dossier : `docker compose up --build`.
3. Depuis les machines du même réseau Wi‑Fi, accéder via `http://<ip-de-la-machine-hôte>:5000/`.
