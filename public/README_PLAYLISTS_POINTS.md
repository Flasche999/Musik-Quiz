# Musik‑Quiz — Playlisten, Fortschritt & Punkte

Neu:
- **Bis zu 10 Playlisten**, je **bis zu 10 Lieder**
- Jede Playlist hat einen **Künstlernamen**
- Fortschritt wird überall angezeigt: **Playlist X/10 — Song Y/10 — Artist**
- **Punktesystem**
  - Richtige Antwort beim Song **N** ⇒ **+N Punkte** für den Buzzer
  - Falsche Antwort ⇒ **alle anderen +1 Punkt**
- **Scoreboard** live für Moderator & Spieler

## playlist.json
Beispiel:
```json
[
  {
    "artist": "Artist 1",
    "tracks": [
      "sounds/artist1_song1.mp3",
      "sounds/artist1_song2.mp3"
    ]
  },
  {
    "artist": "Artist 2",
    "tracks": [
      "sounds/artist2_song1.mp3"
    ]
  }
]
```
- Reihenfolge der Tracks bestimmt den Rundenzähler (Song 1 = 1 Punkt, …, Song 10 = 10 Punkte).
- Lege deine MP3s unter `public/sounds/` ab (Unterordner sind ok).

## Start
```bash
npm install
npm start
```
- Moderator: `http://localhost:3000/moderator.html`
- Spieler: `http://localhost:3000/player.html`
