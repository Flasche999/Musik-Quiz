# Online Musik‑Quiz (Echtzeit)

Features
- Räume mit 5‑stelligen Codes
- Bis zu 6 Spieler pro Raum
- Lobby mit Namenseingabe
- Moderator steuert: Runde starten, Play, Pause, Buzzer freigeben, Nächste Runde
- Buzz‑Lock: erster Buzz pausiert Musik für alle
- Rundenstart‑Overlay
- Einfache Playlist (Dateien unter /public/sounds)

## Lokal starten
1. Node.js LTS installieren.
2. Im Ordner `online-musik-quiz`:
   ```bash
   npm install
   npm start
   ```
3. Moderator öffnen: `http://localhost:3000/moderator.html`
4. Spieler öffnen: `http://localhost:3000/player.html` (auch auf anderen Geräten im selben Netz, IP statt localhost)

> Autoplay-Hinweis: Jeder Client muss einmal interagieren (z. B. Button klicken), damit Audio abgespielt werden darf.

## Playlist
- Lege MP3s in `public/sounds/` (z. B. `song1.mp3`, `song2.mp3` …).
- Beim Raumerstellen kann der Moderator eine Komma‑Liste eintragen, sonst Standard‑Playlist wird verwendet.

## Online deployen (schnell, kostenlos)
### Render.com
1. Repo (oder ZIP-Inhalt) in ein GitHub‑Repository pushen.
2. Render → New → Web Service.
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Deploy. Die URL z. B. `https://dein-service.onrender.com`:
   - Moderator: `/moderator.html`
   - Spieler: `/player.html`

### Railway.app (ähnlich)
- Neues Projekt → Deploy from GitHub → Start: `node server.js`

## Port / Firewall
- Nutzt Port `3000` lokal (änderbar via `PORT` env). WebSockets via Socket.IO.

Viel Spaß! 🎵
