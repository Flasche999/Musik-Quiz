import { $, show, hide, renderProgress, renderScores } from './shared.js';
const socket = io();

const join = $('#join');
const room = $('#room');
const roomCodeEl = $('#roomCode');
const statusEl = $('#status');
const progressBox = $('#progressBox');
const scoreRows = $('#scoreRows');
const firstBanner = $('#firstBanner');
const resultBanner = $('#resultBanner');
const music = $('#music');
const btnVoteNext = $('#btnVoteNext');

let hasVoted = false;

$('#joinBtn').addEventListener('click', () => {
  const code = $('#code').value.trim();
  const name = $('#name').value.trim() || 'Spieler';
  socket.emit('player:join', {code, name});
});

socket.on('player:join-result', ({ok, error, code}) => {
  if (!ok){ alert(error||'Beitritt fehlgeschlagen.'); return; }
  roomCodeEl.textContent = code;
  hide(join); show(room);
  statusEl.textContent = 'Beigetreten. Warte auf Rundestart…';
});

socket.on('room:update', ({players, scores, progress}) => {
  if (progress) renderProgress(progressBox, progress);
  renderScores(scoreRows, players, scores);
});

$('#buzz').addEventListener('click', () => socket.emit('player:buzz'));
socket.on('buzz:first', ({name}) => {
  firstBanner.textContent = `🚨 Erster Buzz: ${name}`;
  firstBanner.classList.remove('hidden');
});
socket.on('buzz:unlock', () => {
  firstBanner.classList.add('hidden');
  resultBanner.classList.add('hidden');
});

socket.on('result:correct', ({name, points}) => {
  resultBanner.textContent = `✅ Richtig: ${name} (+${points})`;
  resultBanner.className = 'banner good';
});
socket.on('result:wrong', ({name}) => {
  resultBanner.textContent = `❌ Falsch: ${name} (alle anderen +1)`;
  resultBanner.className = 'banner bad';
});

socket.on('round:prepare', ({src}) => { 
  music.src = src || ''; 
  hasVoted = false;
  btnVoteNext.disabled = false;
  $('#nextInfo').textContent = '';
});
socket.on('audio:play', ()=> music.play().catch(()=>{}));
socket.on('audio:pause', ()=> music.pause());
socket.on('progress:update', (p) => renderProgress(progressBox, p));

btnVoteNext.addEventListener('click', () => {
  if (hasVoted) return;
  hasVoted = true;
  btnVoteNext.disabled = true;
  socket.emit('player:vote-next');
});
socket.on('next:update', ({count, total}) => {
  $('#nextInfo').textContent = `Weiter geklickt: ${count}/${total}`;
});
socket.on('next:all', () => {
  statusEl.textContent = 'Alle bereit. Warte auf die nächste Runde...';
});
