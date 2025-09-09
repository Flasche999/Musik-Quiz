// server.js – ESM, fertig zum Kopieren

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
  const ids = new Set(room.nextVotes || []);
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
      players:     [],
      locked:      false,
      lastBuzz:    null,
      playlists:   loadPlaylists(),
      plIndex:     0,
      trIndex:     0,
      scores:      {},
      nextVotes:   [],
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
    io.in(c).emit('round:prepare', { src: tr.src, title: tr.title });
    io.in(c).emit('buzz:unlock'); // Sicherheit: nach Rundenset Buzzer frei
  });

  // Spieler joint (Doppelbeitritt verhindern)
  socket.on('player:join', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) {
      return io.to(socket.id).emit('player:join-result', { ok: false, error: 'Raum nicht gefunden.' });
    }

    const room = rooms[code];

    // Schon drin? -> nicht doppelt hinzufügen
    const existing = room.players.find(p => p.id === socket.id);
    if (existing) {
      return io.to(socket.id).emit('player:join-result', { ok: true, code, name: existing.name });
    }

    if (room.players.length >= 6) {
      return io.to(socket.id).emit('player:join-result', { ok:false, error:'Raum ist voll (max. 6).' });
    }

    const player = { id: socket.id, name: String(name || 'Spieler').slice(0, 24) };
    room.players.push(player);
    if (!(socket.id in room.scores)) room.scores[socket.id] = 0;

    socket.join(code);
    socket.data.role = 'player';
    socket.data.room = code;

    io.to(socket.id).emit('player:join-result', { ok: true, code, name: player.name });
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
    io.in(c).emit('round:prepare', { src: tr.src, title: tr.title });
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

    if (!prevTrack(room)) {
      io.in(c).emit('status', '🎉 Alle Playlists fertig!');
      return;
    }
    room.locked = false; room.lastBuzz = null; room.nextVotes = [];
    const tr = currentTrack(room);
    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('next:update', { count: 0, total: room.players.length, names: [] });
    io.in(c).emit('round:prepare', { src: tr.src, title: tr.title });
    io.in(c).emit('buzz:unlock'); // NEU: Buzzer wieder freigeben
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
    const player = room.players.find(p => p.id === socket.id);
    room.locked   = true;
    room.lastBuzz = player ? { id: player.id, name: player.name } : null;
    io.in(c).emit('audio:pause');
    io.in(c).emit('buzz:first', { name: room.lastBuzz?.name || 'Unbekannt' });
  });

  // Ergebnis (Punkte = aktuelle Songnummer)
  socket.on('mod:result', ({ type }) => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; const last = room.lastBuzz;
    const points = pointsForCurrent(room);

    if (type === 'correct' && last) {
      room.scores[last.id] = (room.scores[last.id] || 0) + points;
      io.in(c).emit('result:correct', { name: last.name, points });
      // Playlist als gelöst markieren (Anzeige beim Moderator ersetzen)
      io.in(c).emit('round:solved', {
        playlistName: room.playlists[room.plIndex]?.name,
        solution: room.playlists[room.plIndex]?.solution || ''
      });
    } else if (type === 'wrong' && last) {
      room.players.forEach(p => { if (p.id !== last.id) room.scores[p.id] = (room.scores[p.id] || 0) + 1; });
      io.in(c).emit('result:wrong', { name: last.name });
    }
    io.in(c).emit('scores:update', room.scores);
  });} else if (type === 'wrong' && last) {
      room.players.forEach(p => { if (p.id !== last.id) room.scores[p.id] = (room.scores[p.id] || 0) + 1; });
      io.in(c).emit('result:wrong', { name: last.name });
    }
    io.in(c).emit('scores:update', room.scores);
  });

  // Skip-Vote
  socket.on('player:vote-next', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    if (!room.nextVotes.includes(socket.id)) {
      room.nextVotes.push(socket.id);
      broadcastVotes(c);
      const total = room.players.length;
      if (room.nextVotes.length >= total && total > 0) {
        io.in(c).emit('audio:pause');
        io.in(c).emit('next:all');
      }
    }
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
      room.players   = room.players.filter(p => p.id !== socket.id);
      room.nextVotes = room.nextVotes.filter(id => id !== socket.id);
      io.in(c).emit('room:update', { players: room.players, scores: room.scores, progress: getProgress(room) });
      broadcastVotes(c);
      if (room.nextVotes.length === room.players.length && room.players.length > 0) {
        io.in(c).emit('audio:pause');
        io.in(c).emit('next:all');
      }
      if (room.lastBuzz && room.lastBuzz.id === socket.id) room.lastBuzz = null;
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server listening on :' + PORT));
