'use strict';
/* Shared presentation: no gameplay randomness is consumed by cosmetic effects. */
function v84LayoutBoard() {
  if (innerWidth < 1000 || !ui.st || profile.desktopLayout === 'legacy') return false;
  const shell = $('#gameShell'), stage = $('#stage'), wrap = $('#boardWrap'), panel = $('#sidePanel');
  if (!shell || !stage || !wrap) return false;
  const sr = shell.getBoundingClientRect(), center = innerWidth / 2 - sr.left;
  const info = $('#stratInfoPanel');
  const panelW = Math.min(340, Math.max(240, innerWidth * .22));
  const infoW = ui.strategy ? 210 : 0;
  const top = $('#barTop'), bottom = $('#barBottom');
  const extras = [top, bottom, ui.brawl && $('#brawlPanel'), ui.strategy && $('#strategyBar')].filter(Boolean);
  const bars = extras.reduce((n, el) => n + el.offsetHeight + 5, 8);
  const height = Math.max(160, sr.height - bars - 20);
  const idealW = Math.min(height * ui.st.W / ui.st.H, 2 * (Math.min(center, sr.width - center) - 14));
  // Keep the board at viewport center. Right/left auxiliaries move below it when necessary.
  const sideSpace = sr.width - center - idealW / 2 - 20;
  const below = sideSpace < panelW || (ui.strategy && center - idealW / 2 - 20 < infoW);
  shell.classList.toggle('v84-panel-below', below);
  shell.classList.add('v84-centered');
  shell.style.setProperty('--v84-center', center + 'px');
  shell.style.setProperty('--v84-panel-w', panelW + 'px');
   const reserve = below ? (ui.strategy ? 250 : 155) : 0;
  const sq = Math.max(16, Math.floor(Math.min(170, idealW / ui.st.W, (height - reserve) / ui.st.H)));
  const w = sq * ui.st.W, h = sq * ui.st.H;
  ui.sq = sq;
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px'; wrap.style.padding = '0';
  stage.style.flex = 'none'; stage.style.width = w + 'px';
  stage.style.left = center + 'px'; stage.style.height = (below ? sr.height - reserve - 12 : sr.height - 16) + 'px';
  if (top) top.style.width = w + 'px'; if (bottom) bottom.style.width = w + 'px';
  if (panel) { panel.style.height = below ? (reserve - 12) + 'px' : Math.min(sr.height - 24, h + bars) + 'px'; panel.style.width = below ? Math.min(sr.width - 24, w + (ui.strategy ? 210 : 0)) + 'px' : panelW + 'px'; }
  if (info) { info.style.marginTop = '0'; info.style.height = below ? (reserve - 12) + 'px' : h + 'px'; }
  shell.style.setProperty('--v84-board-w', w + 'px'); shell.style.setProperty('--v84-board-h', h + 'px');
  document.documentElement.style.setProperty('--sq', sq + 'px');
  ui.layoutKey = '';
  return true;
}

const V84_REACTIONS = ['👍', '😂', '😮', '😅', '🔥', '🤝'];
function showGameReaction(emoji, remote = false) {
  if (!V84_REACTIONS.includes(emoji)) return false;
  const now = Date.now();
  if (!remote && now - (ui.lastReactionAt || 0) < 1600) return false;
  if (!remote) ui.lastReactionAt = now;
  document.querySelectorAll('.v84-reaction').forEach(el => el.remove());
  const el = document.createElement('div'); el.className = 'v84-reaction';
  el.textContent = emoji; el.setAttribute('role', 'status'); el.setAttribute('aria-label', (remote ? 'Реакция соперника: ' : 'Ваша реакция: ') + emoji);
  ($('#screen-imbo.active') || $('#screen-game') || document.body).appendChild(el);
  setTimeout(() => el.remove(), 2300);
  if (!remote && ui.mode === 'online' && ui.online && ui.online.started) netPublish({ t: 'reaction', emoji });
  else if (!remote && ui.imboMode === 'online' && ui.online && ui.online.started) netPublish({ t: 'reaction', emoji });
  return true;
}
function v84ReactionBar(container) {
  if (!container || container.querySelector('.v84-reactions')) return;
  const bar = document.createElement('div'); bar.className = 'v84-reactions';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'v84-reaction-toggle';
  toggle.textContent = '☺'; toggle.title = 'Реакции'; toggle.setAttribute('aria-label', 'Открыть реакции'); toggle.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'v84-reaction-menu hidden'; menu.setAttribute('aria-label', 'Выберите реакцию');
  const close = () => { menu.classList.add('hidden'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.onclick = () => {
    if (!menu.classList.contains('hidden')) { close(); return; }
    document.querySelectorAll('.v84-reaction-menu').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.v84-reaction-toggle').forEach(el => el.setAttribute('aria-expanded', 'false'));
    const r = toggle.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 232, r.right - 224)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - 52, r.bottom + 6)) + 'px';
    menu.classList.remove('hidden'); toggle.setAttribute('aria-expanded', 'true');
  };
  for (const emoji of V84_REACTIONS) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = emoji; btn.title = 'Реакция ' + emoji;
    btn.onclick = () => { if (showGameReaction(emoji)) close(); }; menu.appendChild(btn);
  }
  document.addEventListener('click', e => { if (!bar.contains(e.target) && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', close);
  bar.appendChild(toggle); container.appendChild(bar); document.body.appendChild(menu);
}
function v84MateMood(sq) {
  if (sq < 0 || !ui.st) return;
  const p = ui.st.board[sq], node = p && ui.pieceNodes.get(p.id);
  if (!node) return;
  const angry = Math.random() < .15;
  ui.mateMood = { id: p.id, angry };
  node.classList.add(angry ? 'v84-king-angry' : 'v84-king-scared');
  node.dataset.mood = angry ? '💢' : '💧';
}
function v84RenderMood(el, piece) {
  if (ui.mateMood && piece.id === ui.mateMood.id && ui.st.status === 'over') {
    el.classList.add(ui.mateMood.angry ? 'v84-king-angry' : 'v84-king-scared');
    el.dataset.mood = ui.mateMood.angry ? '💢' : '💧';
  } else delete el.dataset.mood;
}
function v84FunnyCapture(list) {
  if (!ui.st || profile.calm || !(ui.st.flags.clashBrawl || ui.st.flags.strategy || profile.funnyFx)) return false;
  if (Math.random() >= .3) return false;
  const layer = $('#brawlLayer') || $('#hints'); if (!layer) return false;
  const style = Math.floor(Math.random() * 3);
  for (const item of list) {
    const {dx,dy} = disp(ui.st, item.square);
    for (let i = 0; i < (style === 2 ? 4 : 1); i++) {
      const ghost = document.createElement('span'); ghost.className = 'v84-comic-piece ' + (item.color || 'w') + ' comic-' + style;
      ghost.innerHTML = pieceSvg(item.type); ghost.style.left = dx * ui.sq + 'px'; ghost.style.top = dy * ui.sq + 'px'; ghost.style.width = ui.sq + 'px'; ghost.style.height = ui.sq + 'px';
      ghost.style.setProperty('--throw-x', ((i % 2 ? 1 : -1) * (80 + Math.random() * 100)) + 'px');
      ghost.style.setProperty('--throw-y', (-50 - Math.random() * 90) + 'px');
      if (style === 2) ghost.style.clipPath = ['inset(0 50% 50% 0)','inset(0 0 50% 50%)','inset(50% 50% 0 0)','inset(50% 0 0 50%)'][i];
      layer.appendChild(ghost); setTimeout(() => ghost.remove(), 1050);
    }
  }
  return true;
}
function setupV84() {
  const layoutSelect = $('#desktopLayoutSelect');
  if (layoutSelect) {
    layoutSelect.value = profile.desktopLayout === 'legacy' ? 'legacy' : 'centered';
    layoutSelect.onchange = () => {
      profile.desktopLayout = layoutSelect.value === 'legacy' ? 'legacy' : 'centered';
      saveProfile(true); ui.layoutKey = '';
      if (ui.st && ui.screen === 'game') renderBoard(false);
    };
  }
  v84ReactionBar($('#sidePanel .side-panel-header'));
  v84ReactionBar($('#imboPlay .imbo-modebar'));
  const opt = document.createElement('label'); opt.className = 'v84-funny-option';
  const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!profile.funnyFx; box.onchange = () => { profile.funnyFx = box.checked; saveProfile(true); };
  opt.append(box, ' Смешные взятия и в других режимах');
  const target = document.querySelector('#screen-settings .settings-grid'); if (target) target.appendChild(opt);
  ui.onStrategyAction = (result, opts) => specialActionCommitted('strategy', result, opts || {});
  ui.onBrawlAction = (result, opts) => specialActionCommitted('brawl', result, opts || {});
}
