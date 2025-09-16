// server.js – ESM, fertig zum Kopieren (mit SFX-Broadcasts + Debug-Logs)

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ─────────────────────────────────────────────────────────────
// Logging & Static
// ─────────────────────────────────────────────────────────────
app.use((req, _res, next) => { console.log('[REQ]', req.method, req.url); next(); });
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck (für Render)
app.get('/healthz', (_req, res) => res.status(200).type('text').send('OK'));

// Root → Moderator (mit Fallback-Text, falls Datei fehlt)
app.get('/', (_req, res) => {
  const file = path.join(__dirname, 'public', 'moderator.html');
  fs.access(file, fs.constants.F_OK, (err) => {
    if (err) return res
      .status(200)
      .type('text')
      .send('App läuft. Lege public/moderator.html an oder rufe /player.html auf.');
    res.sendFile(file);
  });
});

// Direkte Routen (freundliche 404)
const safeSend = (relPath, res, missingMsg) => {
  const file = path.join(__dirname, 'public', relPath);
  fs.access(file, fs.constants.F_OK, (err) => {
    if (err) return res.status(404).type('text').send(missingMsg);
    res.sendFile(file);
  });
};
app.get('/moderator.html', (_req, res) => safeSend('moderator.html', res, 'Fehler: public/moderator.html fehlt.'));
app.get('/player.html',    (_req, res) => safeSend('player.html',    res, 'Fehler: public/player.html fehlt.'));

// ─────────────────────────────────────────────────────────────
// Playlists laden (Strings oder {src,title} unterstützt)
// ─────────────────────────────────────────────────────────────
function normalizeTrack(t) {
  if (typeof t === 'string') {
    const name = t.split('/').pop().replace(/\.[^/.]+$/, '');
    return { src: t, title: name };
  }
  if (t && typeof t === 'object') {
    const src   = String(t.src || '');
    const title = String(t.title || '').trim() || src.split('/').pop().replace(/\.[^/.]+$/, '');
    return { src, title };
  }
  return { src: '', title: '' };
}

function loadPlaylists() {
  const p = path.join(__dirname, 'public', 'playlist.json');
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) {
      return arr
        .map((pl, idx) => ({
          name: String(pl.name || pl.artist || `Playlist ${idx + 1}`),
          solution: String(pl.solution || ''),
          tracks: Array.isArray(pl.tracks) ? pl.tracks.map(normalizeTrack).filter(t => t.src) : []
        }))
        .filter(pl => pl.tracks.length > 0);
    }
  } catch (e) {
    console.error('playlist.json laden fehlgeschlagen:', e.message);
  }
  // Fallback-Demo
  return [{
    name: 'Playlist 1',
    solution: '',
    tracks: [
      { src: 'sounds/song1.mp3', title: 'Song 1' },
      { src: 'sounds/song2.mp3', title: 'Song 2' }
    ]
  }];
}

app.get('/api/playlists', (_req, res) => res.json({ playlists: loadPlaylists() }));

// ─────────────────────────────────────────────────────────────
// Game State & Helpers
// ─────────────────────────────────────────────────────────────
const rooms = {};
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 Zeichen (ohne I/O/1/0)
const genCode = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

// persistente Player-IDs (pid) – unabhängig von Socket-ID (sid)
const pidChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genPid = () => Array.from({ length: 8 }, () => pidChars[Math.floor(Math.random() * pidChars.length)]).join('');

function getProgress(room) {
  const totalPL = room.playlists.length;
  const curPL   = room.playlists[room.plIndex] || { tracks: [] };
  const totalTR = curPL.tracks.length;
  return {
    roundIndex: room.plIndex + 1,
    roundTotal: totalPL,
    songIndex:  room.trIndex + 1, // 1..N
    songTotal:  totalTR,
    roundName:  room.playlists[room.plIndex]?.name || `Playlist ${room.plIndex + 1}`
  };
}

function setRound(room, plIdx) {
  room.plIndex = Math.max(0, Math.min(plIdx, room.playlists.length - 1));
  const len    = room.playlists[room.plIndex].tracks.length;
  room.trIndex = Math.max(0, len - 1); // Start bei letztem Track → Song N zuerst
}

function prevTrack(room) {
  // Reihenfolge: N → 1, dann nächste Playlist wieder N → 1
  if (room.trIndex - 1 >= 0) { room.trIndex -= 1; return true; }
  if (room.plIndex + 1 < room.playlists.length) {
    room.plIndex += 1;
    const len = room.playlists[room.plIndex].tracks.length;
    room.trIndex = Math.max(0, len - 1);
    return true;
  }
  return false; // alles durch
}

const currentTrack     = (room) => room.playlists[room.plIndex]?.tracks[room.trIndex] || { src: '', title: '' };
const pointsForCurrent = (room) => room.trIndex + 1; // Punkte = Songnummer (N..1)

function voterNames(room) {
  const ids = new Set(room.nextVotes || []); // enthält jetzt pids
  return room.players.filter(p => ids.has(p.id)).map(p => p.name);
}
function broadcastVotes(code) {
  const room  = rooms[code];
  const count = (room.nextVotes || []).length;
  const total = room.players.length;
  io.in(code).emit('next:update', { count, total, names: voterNames(room) });
}

// ─────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Raum erstellen (Moderator)
  socket.on('mod:create-room', () => {
    let code; do { code = genCode(); } while (rooms[code]);

    rooms[code] = {
      moderatorId: socket.id,
      players:     [],          // { id: pid, sid: socket.id|null, name }
      locked:      false,
      lastBuzz:    null,        // { id, name } (pid)
      playlists:   loadPlaylists(),
      plIndex:     0,
      trIndex:     0,
      scores:      {},          // key = pid
      nextVotes:   [],          // pids
      refreshing:  false        // während Refresh niemand entfernen
    };
    setRound(rooms[code], 0); // Runde 1, Song N

    socket.join(code);
    socket.data.role = 'moderator';
    socket.data.room = code;

    const room = rooms[code];
    io.to(socket.id).emit('mod:room-created', {
      code,
      state:    room,
      progress: getProgress(room),
      playlists: room.playlists
    });
    io.in(code).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: currentTrack(room).title
    });
  });

  // Runde (Playlist) setzen
  socket.on('mod:set-round', ({ index }) => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    if (typeof index !== 'number') return;

    setRound(room, index);
    room.locked = false; room.lastBuzz = null; room.nextVotes = [];

    const tr = currentTrack(room);
    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: tr.title
    });
    io.in(c).emit('round:prepare', { 
      src: tr.src, 
      title: tr.title,
      playlistName: room.playlists[room.plIndex]?.name,
      solution: room.playlists[room.plIndex]?.solution || ''
    });
    io.in(c).emit('buzz:unlock'); // Sicherheit: nach Rundenset Buzzer frei
  });

  // Spieler joint (Doppelbeitritt verhindern) – vergibt PID
  socket.on('player:join', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) {
      return io.to(socket.id).emit('player:join-result', { ok: false, error: 'Raum nicht gefunden.' });
    }

    const room = rooms[code];

    // Schon drin mit gleicher SID? -> nur bestätigen
    const existsBySid = room.players.find(p => p.sid === socket.id);
    if (existsBySid) {
      return io.to(socket.id).emit('player:join-result', { ok: true, code, name: existsBySid.name, id: existsBySid.id });
    }

    if (room.players.length >= 6) {
      return io.to(socket.id).emit('player:join-result', { ok:false, error:'Raum ist voll (max. 6).' });
    }

    const player = { id: genPid(), sid: socket.id, name: String(name || 'Spieler').slice(0, 24) };
    room.players.push(player);
    if (!(player.id in room.scores)) room.scores[player.id] = 0;

    socket.join(code);
    socket.data.role = 'player';
    socket.data.room = code;

    io.to(socket.id).emit('player:join-result', { ok: true, code, name: player.name, id: player.id });
    io.in(code).emit('room:update', { players: room.players, scores: room.scores, progress: getProgress(room) });
    io.in(code).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: currentTrack(room).title
    });
    broadcastVotes(code);
  });

  // Rundensteuerung
  socket.on('mod:start-round', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    room.locked = false; room.lastBuzz = null; room.nextVotes = [];
    const tr = currentTrack(room);
    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('next:update', { count: 0, total: room.players.length, names: [] });
    io.in(c).emit('round:prepare', { 
      src: tr.src, 
      title: tr.title,
      playlistName: room.playlists[room.plIndex]?.name,
      solution: room.playlists[room.plIndex]?.solution || ''
    });
    io.in(c).emit('buzz:unlock'); // NEU: Buzzer für alle freigeben
    setTimeout(() => io.in(c).emit('audio:play'), 200);
  });

  socket.on('mod:play',  () => { const c = socket.data.room; if (c && rooms[c]) io.in(c).emit('audio:play');  });
  socket.on('mod:pause', () => { const c = socket.data.room; if (c && rooms[c]) io.in(c).emit('audio:pause'); });

  socket.on('mod:unlock', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; room.locked = false; room.lastBuzz = null;
    io.in(c).emit('buzz:unlock');
  });

  // Nächster Song (N→1)
  socket.on('mod:next', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];

    const prevPL = room.plIndex; 
    const prevTR = room.trIndex;

    if (!prevTrack(room)) {
      io.in(c).emit('status', '🎉 Alle Playlists fertig!');
      return;
    }

    // Von Track 1 zur nächsten Playlist → vorherige Playlist auf Lösung umbenennen
    if (prevTR === 0 && room.plIndex !== prevPL) {
      const prev = room.playlists[prevPL];
      if (prev && prev.solution) prev.name = prev.solution;
    }

    room.locked = false; room.lastBuzz = null; room.nextVotes = [];
    const tr = currentTrack(room);

    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('next:update', { count: 0, total: room.players.length, names: [] });
    io.in(c).emit('round:prepare', { 
      src: tr.src, 
      title: tr.title,
      playlistName: room.playlists[room.plIndex]?.name,
      solution: room.playlists[room.plIndex]?.solution || ''
    });
    io.in(c).emit('buzz:unlock');
    io.in(c).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: tr.title
    });
  });

  // Buzz vom Spieler
  socket.on('player:buzz', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; if (room.locked) return;
    const player = room.players.find(p => p.sid === socket.id);
    room.locked   = true;
    room.lastBuzz = player ? { id: player.id, name: player.name } : null;
    io.in(c).emit('audio:pause');
    // SFX: Buzzer für alle
    console.log('[SFX] buzzer send →', c);
    io.in(c).emit('sfx:play', { type: 'buzzer' });
    // id + name senden, damit Clients exakt markieren können
    if (room.lastBuzz) {
      io.in(c).emit('buzz:first', { id: room.lastBuzz.id, name: room.lastBuzz.name });
    } else {
      io.in(c).emit('buzz:first', { name: 'Unbekannt' });
    }
  });

  // Ergebnis (Punkte = aktuelle Songnummer)
  socket.on('mod:result', ({ type }) => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; const last = room.lastBuzz;
    const points = pointsForCurrent(room);

    if (type === 'correct' && last) {
      room.scores[last.id] = (room.scores[last.id] || 0) + points;
      io.in(c).emit('result:correct', { name: last.name, points });
      // SFX: Correct für alle
      console.log('[SFX] correct send →', c);
      io.in(c).emit('sfx:play', { type: 'correct' });

      // Sidebar-Update: Playlist als gelöst melden
      io.in(c).emit('round:solved', {
        playlistName: room.playlists[room.plIndex]?.name,
        solution: room.playlists[room.plIndex]?.solution || ''
      });

      // Namen dauerhaft auf Lösung setzen + UI refresh
      try {
        if (room.playlists[room.plIndex]?.solution) {
          room.playlists[room.plIndex].name = room.playlists[room.plIndex].solution;
          io.in(c).emit('ui:round-update', {
            progress:    getProgress(room),
            playlists:   room.playlists,
            activeRound: room.plIndex,
            activeSong:  room.trIndex,
            currentTitle: currentTrack(room).title
          });
        }
      } catch (e) {}

    } else if (type === 'wrong' && last) {
      room.players.forEach(p => {
        if (p.id !== last.id) room.scores[p.id] = (room.scores[p.id] || 0) + 1;
      });
      io.in(c).emit('result:wrong', { name: last.name });
      // SFX: Wrong für alle
      console.log('[SFX] wrong send →', c);
      io.in(c).emit('sfx:play', { type: 'wrong' });
    }

    io.in(c).emit('scores:update', room.scores);
  });

  // Manuelles Punkte ± im Moderator-Panel
  socket.on('mod:score-delta', ({ playerId, delta }) => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];

    // nur Moderator des Raums
    if (room.moderatorId !== socket.id) return;

    const pExists = room.players.some(p => p.id === playerId);
    if (!pExists) return;

    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return;

    room.scores[playerId] = (room.scores[playerId] || 0) + d;
    io.in(c).emit('scores:update', room.scores);
  });

  // Skip-Vote (jetzt mit pid)
  socket.on('player:vote-next', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    const p = room.players.find(x => x.sid === socket.id);
    if (!p) return;
    if (!room.nextVotes.includes(p.id)) {
      room.nextVotes.push(p.id);
      broadcastVotes(c);
      const total = room.players.length;
      if (room.nextVotes.length >= total && total > 0) {
        io.in(c).emit('audio:pause');
        io.in(c).emit('next:all');
      }
    }
  });

  // *** Refresh: Moderator kann alle Seiten neu laden lassen ***
  socket.on('mod:refresh', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    room.refreshing = true;
    io.in(c).emit('ui:refresh');          // Clients machen location.reload()
    setTimeout(() => { if (rooms[c]) rooms[c].refreshing = false; }, 15000); // Schutzzeit
  });

  // *** Resume: Clients melden sich nach Reload automatisch ***
  socket.on('player:hello', ({ code, id, name }) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) return;
    const room = rooms[code];

    let p = id && room.players.find(x => x.id === id);
    if (!p) {
      // Notfalls anlegen (z. B. wenn LocalStorage nur Name/Code hatte)
      p = { id: id || genPid(), sid: socket.id, name: String(name || 'Spieler').slice(0,24) };
      room.players.push(p);
      if (!(p.id in room.scores)) room.scores[p.id] = 0;
    } else {
      p.sid = socket.id;
      if (name && p.name !== name) p.name = name;
    }

    socket.join(code);
    socket.data.role = 'player';
    socket.data.room = code;

    io.to(socket.id).emit('player:join-result', { ok: true, code, name: p.name, id: p.id });

    // aktuellen Stand nur an diesen Client
    io.to(socket.id).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: (room.playlists[room.plIndex]?.tracks[room.trIndex]?.title) || ''
    });
    io.to(socket.id).emit('room:update', { players: room.players, scores: room.scores, progress: getProgress(room) });
    io.to(socket.id).emit('scores:update', room.scores);
  });

  socket.on('mod:hello', ({ code }) => {
    if (!rooms[code]) return;
    const room = rooms[code];

    socket.join(code);
    socket.data.role = 'moderator';
    socket.data.room = code;
    room.moderatorId = socket.id;

    io.to(socket.id).emit('mod:room-created', {
      code,
      state:    room,
      progress: getProgress(room),
      playlists: room.playlists
    });
    io.to(socket.id).emit('ui:round-update', {
      progress:    getProgress(room),
      playlists:   room.playlists,
      activeRound: room.plIndex,
      activeSong:  room.trIndex,
      currentTitle: (room.playlists[room.plIndex]?.tracks[room.trIndex]?.title) || ''
    });
    io.to(socket.id).emit('scores:update', room.scores);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const c = socket.data.room; const role = socket.data.role;
    if (!c || !rooms[c]) return;
    const room = rooms[c];

    if (role === 'moderator') {
      io.in(c).emit('status', 'Moderator hat den Raum verlassen. Spiel beendet.');
      io.in(c).socketsLeave(c);
      delete rooms[c];
    } else {
      // Spieler
      const p = room.players.find(x => x.sid === socket.id);
      if (room.refreshing) {
        // während Refresh: nicht entfernen, nur SID lösen
        if (p) p.sid = null;
      } else {
        // normal: Spieler entfernen
        room.players   = room.players.filter(pl => pl.sid !== socket.id);
        room.nextVotes = room.nextVotes.filter(id => id !== (p?.id));
        io.in(c).emit('room:update', { players: room.players, scores: room.scores, progress: getProgress(room) });
        broadcastVotes(c);
        if (room.nextVotes.length === room.players.length && room.players.length > 0) {
          io.in(c).emit('audio:pause');
          io.in(c).emit('next:all');
        }
        if (room.lastBuzz && p && room.lastBuzz.id === p.id) room.lastBuzz = null;
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server listening on :' + PORT));
