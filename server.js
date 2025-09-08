// server.js (ESM, fertig zum Kopieren)

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { setImmediate as asap } from 'timers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ─────────────────────────────────────────────────────────────
// Static Files & Routes
// ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Startseite → Moderator (änderbar auf player.html, wenn du willst)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moderator.html'));
});

// Fallbacks, damit direkte Aufrufe sicher funktionieren
app.get('/moderator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'moderator.html'));
});

app.get('/player.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ─────────────────────────────────────────────────────────────
// Playlists laden (aus public/playlist.json, mit Fallback)
// ─────────────────────────────────────────────────────────────
function loadPlaylists() {
  const p = path.join(__dirname, 'public', 'playlist.json');
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) {
      return arr
        .map(pl => ({
          artist: String(pl.artist || 'Unbekannt'),
          tracks: Array.isArray(pl.tracks)
            ? pl.tracks.filter(t => typeof t === 'string' && t.trim())
            : []
        }))
        .filter(pl => pl.tracks.length > 0);
    }
  } catch (e) {
    console.error('playlist.json laden fehlgeschlagen:', e.message);
  }
  return [{ artist: 'Default', tracks: ['sounds/song1.mp3', 'sounds/song2.mp3'] }];
}

app.get('/api/playlists', (req, res) => res.json({ playlists: loadPlaylists() }));

// ─────────────────────────────────────────────────────────────
// Game-State
// ─────────────────────────────────────────────────────────────
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getProgress(room) {
  const totalPL = room.playlists.length;
  const totalTR = room.playlists[room.plIndex]?.tracks.length || 0;
  return {
    playlistIndex: room.plIndex + 1,
    playlistTotal: totalPL,
    trackIndex: room.trIndex + 1,
    trackTotal: totalTR,
    artist: room.playlists[room.plIndex]?.artist || 'Unbekannt'
  };
}

function nextTrack(room) {
  const curPL = room.playlists[room.plIndex];
  if (!curPL) return false;
  if (room.trIndex + 1 < curPL.tracks.length) {
    room.trIndex += 1;
    return true;
  } else if (room.plIndex + 1 < room.playlists.length) {
    room.plIndex += 1;
    room.trIndex = 0;
    return true;
  }
  return false;
}

function voterNames(room) {
  const ids = new Set(room.nextVotes || []);
  return room.players.filter(p => ids.has(p.id)).map(p => p.name);
}

function broadcastVotes(code) {
  const room = rooms[code];
  const count = (room.nextVotes || []).length;
  const total = room.players.length;
  io.in(code).emit('next:update', { count, total, names: voterNames(room) });
}

// ─────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Moderator erstellt Raum
  socket.on('mod:create-room', () => {
    let code;
    do { code = genCode(); } while (rooms[code]);

    rooms[code] = {
      moderatorId: socket.id,
      players: [],
      locked: false,
      lastBuzz: null,
      playlists: loadPlaylists(),
      plIndex: 0,
      trIndex: 0,
      scores: {},
      nextVotes: [],
    };

    socket.join(code);
    socket.data.role = 'moderator';
    socket.data.room = code;

    const room = rooms[code];
    io.to(socket.id).emit('mod:room-created', { code, state: room, progress: getProgress(room) });
  });

  // Spieler joint
  socket.on('player:join', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    if (!rooms[code]) return io.to(socket.id).emit('player:join-result', { ok: false, error: 'Raum nicht gefunden.' });

    const room = rooms[code];
    if (room.players.length >= 6) return io.to(socket.id).emit('player:join-result', { ok: false, error: 'Raum ist voll (max. 6).' });

    const player = { id: socket.id, name: String(name || 'Spieler').slice(0, 24) };
    room.players.push(player);
    if (!(socket.id in room.scores)) room.scores[socket.id] = 0;

    socket.join(code);
    socket.data.role = 'player';
    socket.data.room = code;

    io.to(socket.id).emit('player:join-result', { ok: true, code, name: player.name });
    io.in(code).emit('room:update', { players: room.players, scores: room.scores, progress: getProgress(room) });
    broadcastVotes(code);
  });

  // Runde starten
  socket.on('mod:start-round', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    room.locked = false;
    room.lastBuzz = null;
    room.nextVotes = [];
    const src = room.playlists[room.plIndex]?.tracks[room.trIndex] || '';
    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('next:update', { count: 0, total: room.players.length, names: [] });
    io.in(c).emit('round:prepare', { src });
    setTimeout(() => io.in(c).emit('audio:play'), 200);
  });

  // Play/Pause
  socket.on('mod:play', () => { const c = socket.data.room; if (c && rooms[c]) io.in(c).emit('audio:play'); });
  socket.on('mod:pause', () => { const c = socket.data.room; if (c && rooms[c]) io.in(c).emit('audio:pause'); });

  // Buzzer freigeben
  socket.on('mod:unlock', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; room.locked = false; room.lastBuzz = null;
    io.in(c).emit('buzz:unlock');
  });

  // Nächster Track
  socket.on('mod:next', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c];
    if (!nextTrack(room)) {
      io.in(c).emit('status', '🎉 Alle Playlisten fertig!');
      return;
    }
    room.locked = false; room.lastBuzz = null; room.nextVotes = [];
    const src = room.playlists[room.plIndex].tracks[room.trIndex];
    io.in(c).emit('progress:update', getProgress(room));
    io.in(c).emit('next:update', { count: 0, total: room.players.length, names: [] });
    io.in(c).emit('round:prepare', { src });
  });

  // Buzz vom Spieler
  socket.on('player:buzz', () => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; if (room.locked) return;
    const player = room.players.find(p => p.id === socket.id);
    room.locked = true; room.lastBuzz = player ? { id: player.id, name: player.name } : null;
    io.in(c).emit('audio:pause');
    io.in(c).emit('buzz:first', { name: room.lastBuzz?.name || 'Unbekannt' });
  });

  // Ergebnis vom Moderator
  socket.on('mod:result', ({ type }) => {
    const c = socket.data.room; if (!c || !rooms[c]) return;
    const room = rooms[c]; const last = room.lastBuzz;
    const points = room.trIndex + 1;

    if (type === 'correct' && last) {
      room.scores[last.id] = (room.scores[last.id] || 0) + points;
      io.in(c).emit('result:correct', { name: last.name, points });
    } else if (type === 'wrong' && last) {
      room.players.forEach(p => { if (p.id !== last.id) room.scores[p.id] = (room.scores[p.id] || 0) + 1; });
      io.in(c).emit('result:wrong', { name: last.name });
    }
    io.in(c).emit('scores:update', room.scores);
  });

  // Vote Next
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
      room.players = room.players.filter(p => p.id !== socket.id);
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
// Server Start
// Render setzt PORT als Env-Var (z. B. 10000). Fallback nur lokal.
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server listening on :' + PORT));
