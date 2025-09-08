# Online Musik‑Quiz mit Playlist-Datei

## Was ist neu?
- **Separate Playlist-Datei:** `public/playlist.json`
  - Trage dort deine MP3‑Dateien als Array ein, z. B.:
    ```json
    [
      "sounds/song1.mp3",
      "sounds/song2.mp3",
      "sounds/song3.mp3"
    ]
    ```
  - Beim Raumerstellen wird automatisch **playlist.json** geladen, falls im Moderator‑Feld nichts eingetragen wurde.

## Start (lokal)
```bash
npm install
npm start
```
- Moderator: `http://localhost:3000/moderator.html`
- Spieler: `http://localhost:3000/player.html`

## Playlist anpassen
- Lege deine MP3s nach `public/sounds/`.
- Editiere `public/playlist.json` (Reihenfolge = Rundenreihenfolge).
- Optional: Im Moderator‑Screen kannst du eine **eigene Liste eintippen**, die **playlist.json** überschreibt.

## Deploy (z. B. Render, Railway)
- Start Command: `node server.js`
- Statische Dateien liegen unter `public/`.
