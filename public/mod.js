import { $, show, hide, renderProgress, renderScoresWithVotes } from './shared.js';
const socket = io();

const setup = $('#setup');
const room = $('#room');
const roomCodeEl = $('#roomCode');
const statusEl = $('#status');
const progressBox = $('#progressBox');
const scoreRows = $('#scoreRows');
const nextSummary = $('#nextSummary');
const allNextBanner = $('#allNextBanner');
const firstBanner = $('#firstBanner');
const resultBanner = $('#resultBanner');
const music = $('#music');

$('#createRoom').addEventListener('click', () => socket.emit('mod:create-room'));

socket.on('mod:room-created', ({code, state, progress}) => {
  roomCodeEl.textContent = code;
  hide(setup); show(room);
  statusEl.textContent = 'Warte auf Spieler…';
  renderProgress(progressBox, progress);
});

let lastPlayers = [];
let lastScores = {};

socket.on('room:update', ({players, scores, progress}) => {
  lastPlayers = players;
  lastScores = scores;
  if (progress) renderProgress(progressBox, progress);
  renderScoresWithVotes(scoreRows, players, scores, []);
});

$('#btnStartRound').addEventListener('click', () => { allNextBanner.classList.add('hidden'); socket.emit('mod:start-round'); });
$('#btnPlay').addEventListener('click', () => socket.emit('mod:play'));
$('#btnPause').addEventListener('click', () => socket.emit('mod:pause'));
$('#btnUnlock').addEventListener('click', () => socket.emit('mod:unlock'));
$('#btnNext').addEventListener('click', () => { allNextBanner.classList.add('hidden'); socket.emit('mod:next'); });
$('#btnCorrect').addEventListener('click', () => socket.emit('mod:result', {type:'correct'}));
$('#btnWrong').addEventListener('click', () => socket.emit('mod:result', {type:'wrong'}));

socket.on('round:prepare', ({src}) => { music.src = src || ''; });
socket.on('audio:play', ()=> music.play().catch(()=>{}));
socket.on('audio:pause', ()=> music.pause());
socket.on('progress:update', (p) => renderProgress(progressBox, p));

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

socket.on('next:update', ({count, total, names}) => {
  nextSummary.textContent = `Weiter geklickt: ${count}/${total} — ${names.join(', ')}`;
  renderScoresWithVotes(scoreRows, lastPlayers, lastScores, names);
});
socket.on('next:all', () => {
  allNextBanner.classList.remove('hidden');
  statusEl.textContent = 'Alle bereit. Starte den nächsten Song.';
});
