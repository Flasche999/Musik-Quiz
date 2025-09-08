// server.js – ESM-Version mit Runden/Playlist-Panel, Song 10→1, Punkte = Songnummer
});
});


// Buzz
socket.on('player:buzz', ()=>{
const c=socket.data.room; if (!c || !rooms[c]) return;
const room = rooms[c]; if (room.locked) return;
const player = room.players.find(p=>p.id===socket.id);
room.locked = true; room.lastBuzz = player ? {id: player.id, name: player.name} : null;
io.in(c).emit('audio:pause');
io.in(c).emit('buzz:first', {name: room.lastBuzz?.name || 'Unbekannt'});
});


// Ergebnis
socket.on('mod:result', ({type}) => {
const c=socket.data.room; if (!c || !rooms[c]) return;
const room = rooms[c]; const last = room.lastBuzz;
const points = pointsForCurrent(room); // Punkte = Songnummer (N..1)
if (type === 'correct' && last){
room.scores[last.id] = (room.scores[last.id]||0) + points;
io.in(c).emit('result:correct', {name:last.name, points});
} else if (type === 'wrong' && last){
room.players.forEach(p => { if (p.id !== last.id) room.scores[p.id] = (room.scores[p.id]||0) + 1; });
io.in(c).emit('result:wrong', {name:last.name});
}
io.in(c).emit('scores:update', room.scores);
});


// Vote Next
socket.on('player:vote-next', ()=>{
const c=socket.data.room; if (!c || !rooms[c]) return;
const room = rooms[c];
if (!room.nextVotes.includes(socket.id)){
room.nextVotes.push(socket.id);
broadcastVotes(c);
const total = room.players.length;
if (room.nextVotes.length >= total && total > 0){
io.in(c).emit('audio:pause');
io.in(c).emit('next:all');
}
}
});


// Disconnect
socket.on('disconnect', ()=>{
const c=socket.data.room; const role=socket.data.role;
if (!c || !rooms[c]) return;
const room = rooms[c];
if (role === 'moderator'){
io.in(c).emit('status','Moderator hat den Raum verlassen. Spiel beendet.');
io.in(c).socketsLeave(c);
delete rooms[c];
} else {
room.players = room.players.filter(p=>p.id!==socket.id);
room.nextVotes = room.nextVotes.filter(id => id !== socket.id);
io.in(c).emit('room:update', {players: room.players, scores: room.scores, progress: getProgress(room)});
broadcastVotes(c);
if (room.nextVotes.length === room.players.length && room.players.length > 0){
io.in(c).emit('audio:pause');
io.in(c).emit('next:all');
}
if (room.lastBuzz && room.lastBuzz.id === socket.id) room.lastBuzz = null;
}
});
});


const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('Server listening on :' + PORT));
