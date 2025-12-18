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

### Si un autre PC n'arrive pas à accéder
- Utiliser l'IP LAN de la machine hôte (ex. `http://192.168.x.x:5000/`), pas `localhost`.
- Vérifier que l'hôte écoute partout (c'est le cas via `0.0.0.0` et le port 5000 exposé).
- Ouvrir le port 5000 dans le pare-feu Windows (profil privé) ou désactiver temporairement pour tester. Avec Docker Desktop, crée une règle entrante TCP 5000 vers « Docker Desktop Service ».
- Certains réseaux Wi‑Fi invités isolent les clients : il faut un réseau où les machines peuvent se voir.
