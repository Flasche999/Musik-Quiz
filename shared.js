export function $(sel, root=document){ return root.querySelector(sel); }
export function show(el){ el.classList.remove('hidden'); }
export function hide(el){ el.classList.add('hidden'); }
export function escapeHtml(str=''){ return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
export function renderProgress(box, p){
  box.innerHTML = `
    <div>Playlist: <b>${p.playlistIndex}/${p.playlistTotal}</b> — <span class="badge">${escapeHtml(p.artist)}</span></div>
    <div>Song: <b>${p.trackIndex}/${p.trackTotal}</b></div>
  `;
}
export function renderScoresWithVotes(tbody, players, scores, voterNames){
  const voter = new Set(voterNames||[]);
  const rows = players.map(p => {
    const pts = scores[p.id] ?? 0;
    const voted = voter.has(p.name) ? '✓' : '';
    return `<tr><td>${escapeHtml(p.name)}</td><td><b>${pts}</b></td><td>${voted}</td></tr>`;
  }).join('');
  tbody.innerHTML = rows || '<tr><td colspan="3">Noch keine Spieler</td></tr>';
}
export function renderScores(tbody, players, scores){
  const rows = players.map(p => {
    const pts = scores[p.id] ?? 0;
    return `<tr><td>${escapeHtml(p.name)}</td><td><b>${pts}</b></td></tr>`;
  }).join('');
  tbody.innerHTML = rows || '<tr><td colspan="2">Noch keine Spieler</td></tr>';
}
