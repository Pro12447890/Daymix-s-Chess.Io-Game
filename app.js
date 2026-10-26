'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Daymix's Chess — интерфейс, профиль, статистика, часы и сеть.
   Движок лежит в engine.js и ничего не знает про DOM.
   ══════════════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ───────────────────────────── 1. ПРОФИЛЬ ─────────────────────────────── */

const STORE_KEY = 'daymix-chess-v2';
const AVATARS = ['n', 'q', 'r', 'b', 'k', 'p', 'j', 'g'];

const DEFAULT_PROFILE = {
  name: 'Игрок',
  avatar: 'n',
  theme: 'brown',
  pieces: '1',
  flip: true,
  autoQueen: true,
  sound: true,
  side: 'w',
  modeId: 'classic',
  square: false,
  timeMs: 5 * 60 * 1000,
  timeLabel: '5 минут',
  points: 0,
  stats: { games: 0, wins: 0, losses: 0, draws: 0, mates: 0, timeWins: 0, streak: 0, best: 0 },
  history: [],
};

function loadProfile() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (error) { saved = {}; }
  const merged = { ...DEFAULT_PROFILE, ...saved };
  merged.stats = { ...DEFAULT_PROFILE.stats, ...(saved.stats || {}) };
  merged.history = Array.isArray(saved.history) ? saved.history : [];
  if (!merged.modeId || !modeById(merged.modeId)) merged.modeId = 'classic';
  if (!AVATARS.includes(merged.avatar)) merged.avatar = 'n';
  return merged;
}

let profile = loadProfile();

let saveTimer = 0;
function saveProfile(immediate) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(profile));
      const hint = $('#saveHint');
      if (hint) { hint.textContent = 'сохранено'; setTimeout(() => { hint.textContent = 'сохраняется автоматически'; }, 900); }
    } catch (error) { /* приватный режим — просто не сохраняем */ }
  };
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}


/* ───────────────────────── 1б. ЗВУК И ВИБРАЦИЯ ───────────────────────── */

const sound = {
  ctx: null,
  get on() { return profile.sound !== false; },
  ensure() {
    if (!this.on) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try { this.ctx = new Ctor(); } catch (error) { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  tone(freq, dur, type = 'sine', gain = 0.05, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  },
  move() { if (this.on) this.tone(320, 0.06, 'triangle', 0.045); },
  capture() { if (!this.on) return; this.tone(150, 0.1, 'square', 0.04); this.tone(95, 0.16, 'triangle', 0.05, 0.02); },
  check() { if (!this.on) return; this.tone(680, 0.09, 'sine', 0.05); this.tone(900, 0.12, 'sine', 0.045, 0.09); },
  win() { if (!this.on) return; [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.055, i * 0.12)); },
  lose() { if (!this.on) return; [392, 330, 262].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.05, i * 0.14)); },
  click() { if (this.on) this.tone(220, 0.03, 'sine', 0.028); },
};

function buzz(pattern) {
  if (profile.sound === false) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (error) { /* без вибрации */ }
}

function updateSoundIcon() {
  const icon = $('#soundIcon');
  if (!icon) return;
  const on = profile.sound !== false;
  icon.textContent = on ? '🔊' : '🔇';
  const btn = $('#btnSound');
  if (btn) btn.classList.toggle('off', !on);
}

/* ──────────────────── 1в. ПОДСКАЗКА, ОЦЕНКА, КОНФЕТТИ ────────────────── */

function showHint() {
  const st = ui.st;
  if (!st || st.status !== 'play') return;
  if (ui.viewPly !== ui.frames.length - 1) { toast('Вернитесь в конец партии'); return; }
  if (ui.mode === 'online' && st.turn !== myColor()) { toast('Сейчас ход соперника'); return; }
  sound.click();
  const found = bestMove(st, 2);
  if (!found || !found.move) return;
  const m = found.move;
  ui.hint = { from: m.from, to: m.to };
  renderSquares();
  const p = st.board[m.from];
  toast(`Совет: ${p ? PIECE_NAMES[p.t] : 'фигура'} ${sqName(st, m.from)}→${sqName(st, m.to)}`);
  clearTimeout(showHint.timer);
  showHint.timer = setTimeout(() => { ui.hint = null; renderSquares(); }, 2600);
}

function updateEval() {
  const st = ui.st;
  const fill = $('#evalFill');
  if (!st || !fill) return;
  let score = 0;
  try { score = evaluateWhite(st); } catch (error) { score = 0; }
  const shown = ui.orientation === 'w' ? score : -score;
  const pct = Math.max(5, Math.min(95, 50 + shown * 4));
  fill.style.width = pct + '%';
  const label = (shown > 0 ? '+' : '') + shown.toFixed(1);
  $('#evalText').textContent = label;
  const mini = $('#evalMini');
  if (mini) {
    mini.textContent = label;
    mini.style.color = shown > 0 ? '#ffe3b8' : shown < 0 ? '#c9a0a0' : '#c9b39a';
  }
}

function celebrate() {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#f2c14e', '#e2705a', '#96c985', '#6fb3e0', '#f7f785', '#d9a566', '#f4f0e7'];
  for (let i = 0; i < 40; i++) {
    const bit = document.createElement('i');
    bit.style.left = Math.random() * 100 + '%';
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
    bit.style.animationDuration = (1.6 + Math.random() * 1.3).toFixed(2) + 's';
    bit.style.transform = `rotate(${Math.round(Math.random() * 360)}deg)`;
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}
/* ─────────────────────────── 2. КОНТРОЛИ ВРЕМЕНИ ──────────────────────── */

const TIME_GROUPS = [
  {
    id: 'blitz', title: 'Блиц', hint: 'до трёх минут',
    items: [{ label: '30 секунд', ms: 30e3 }, { label: '1 минута', ms: 60e3 }, { label: '3 минуты', ms: 180e3 }],
  },
  {
    id: 'rapid', title: 'Рапид', hint: 'от пяти до тридцати',
    items: [{ label: '5 минут', ms: 300e3 }, { label: '10 минут', ms: 600e3 }, { label: '20 минут', ms: 1200e3 }, { label: '30 минут', ms: 1800e3 }],
  },
  {
    id: 'long', title: 'Долгие', hint: '45 и 60 минут',
    items: [{ label: '45 минут', ms: 2700e3 }, { label: '60 минут', ms: 3600e3 }],
  },
  {
    id: 'free', title: 'Без ограничений', hint: 'шесть часов на партию',
    items: [{ label: '6 часов', ms: 21600e3 }],
  },
];

/* Названия дебютов: ищем самое длинное совпадение по началу партии. */
const OPENINGS = [
  { moves: ['e4'], name: 'Королевская пешка' },
  { moves: ['e4', 'e5'], name: 'Открытая игра' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'Испанская партия' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Итальянская партия' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], name: 'Шотландская партия' },
  { moves: ['e4', 'e5', 'Nf3', 'Nf6'], name: 'Русская партия' },
  { moves: ['e4', 'e5', 'Nf3', 'd6'], name: 'Защита Филидора' },
  { moves: ['e4', 'e5', 'Bc4'], name: 'Дебют слона' },
  { moves: ['e4', 'e5', 'f4'], name: 'Королевский гамбит' },
  { moves: ['e4', 'e5', 'Nc3'], name: 'Венская партия' },
  { moves: ['e4', 'c5'], name: 'Сицилианская защита' },
  { moves: ['e4', 'c5', 'Nf3', 'd6'], name: 'Сицилианская, вариант Найдорфа' },
  { moves: ['e4', 'e6'], name: 'Французская защита' },
  { moves: ['e4', 'c6'], name: 'Защита Каро-Канн' },
  { moves: ['e4', 'd5'], name: 'Скандинавская защита' },
  { moves: ['e4', 'd6'], name: 'Защита Пирца' },
  { moves: ['e4', 'g6'], name: 'Современная защита' },
  { moves: ['e4', 'Nf6'], name: 'Защита Алехина' },
  { moves: ['d4'], name: 'Ферзевая пешка' },
  { moves: ['d4', 'd5'], name: 'Закрытая игра' },
  { moves: ['d4', 'd5', 'c4'], name: 'Ферзевый гамбит' },
  { moves: ['d4', 'd5', 'c4', 'e6'], name: 'Отказанный ферзевый гамбит' },
  { moves: ['d4', 'd5', 'c4', 'dxc4'], name: 'Принятый ферзевый гамбит' },
  { moves: ['d4', 'Nf6'], name: 'Индийская защита' },
  { moves: ['d4', 'Nf6', 'c4', 'g6'], name: 'Староиндийская защита' },
  { moves: ['d4', 'Nf6', 'c4', 'e6'], name: 'Новоиндийская защита' },
  { moves: ['d4', 'f5'], name: 'Голландская защита' },
  { moves: ['d4', 'd5', 'Nf3'], name: 'Дебют ферзевой пешки' },
  { moves: ['c4'], name: 'Английское начало' },
  { moves: ['Nf3'], name: 'Дебют Рети' },
  { moves: ['g3'], name: 'Дебют Бенко' },
  { moves: ['b3'], name: 'Дебют Ларсена' },
  { moves: ['f4'], name: 'Дебют Берда' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], name: 'Испанская, вариант Морфи' },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], name: 'Итальянская, вариант Грек' },
];

function openingName() {
  const sans = ui.moves.map((m) => String(m.san || '').replace(/[+#]$/, ''));
  let best = null;
  for (const o of OPENINGS) {
    if (o.moves.length > sans.length) continue;
    if (o.moves.every((m, i) => sans[i] === m)) {
      if (!best || o.moves.length > best.moves.length) best = o;
    }
  }
  return best ? best.name : null;
}
const THEMES = [
  { id: 'brown', name: 'Коричневая', light: '#f0d9b5', dark: '#9a6a47' },
  { id: 'green', name: 'Зелёная', light: '#eeeed2', dark: '#769656' },
  { id: 'mono', name: 'Чёрно-белая', light: '#ffffff', dark: '#3d4146' },
  { id: 'blue', name: 'Бело-синяя', light: '#eef4fb', dark: '#4a7fb5' },
  { id: 'metal', name: 'Металл', light: '#dde2e8', dark: '#8b959f' },
];

const PIECE_SETS = [
  { id: '1', name: 'Классика' },
  { id: '2', name: 'Жирные' },
  { id: '3', name: 'Контур' },
  { id: '4', name: 'Металл' },
  { id: '5', name: 'Нео' },
];

/* ──────────────────────────── 3. СОСТОЯНИЕ UI ─────────────────────────── */

const ui = {
  screen: 'home',
  mode: null,            // 'local' | 'online'
  role: null,            // 'host' | 'guest'
  st: null,
  frames: [],
  moves: [],
  viewPly: 0,
  selected: -1,
  orientation: 'w',
  sq: 64,
  clocks: { w: 0, b: 0 },
  timeMs: 0,
  running: false,
  turnStart: 0,
  timer: 0,
  lastMove: null,
  chat: [],
  hint: null,
  tab: 'moves',
  scored: false,
  promo: null,
  blockFlash: -1,
  phase: '',
  replaying: false,
  online: null,
  pieceNodes: new Map(),
  squareEls: [],
};

/* ───────────────────────────── 4. ОТРИСОВКА ───────────────────────────── */

function renderProfile() {
  $('#nickInput').value = profile.name;
  $('#profName').textContent = profile.name;
  $('#profPoints').textContent = `${profile.points} очков`;
  $('#profAvatar').innerHTML = pieceSvg(profile.avatar, 'av-pc');
  if ($('#homeAvatar')) $('#homeAvatar').innerHTML = pieceSvg(profile.avatar, 'av-pc');
  if ($('#homeName')) $('#homeName').textContent = profile.name;
  if ($('#homePoints')) $('#homePoints').textContent = `${profile.points} очков`;
  document.documentElement.dataset.theme = profile.theme;
  document.documentElement.dataset.pieces = profile.pieces;
  $('#optFlip').checked = profile.flip;
  $('#optAutoQueen').checked = profile.autoQueen;
  $('#gFlip').checked = profile.flip;
  $('#gAutoQueen').checked = profile.autoQueen;
  if ($('#optSound')) $('#optSound').checked = profile.sound !== false;
  if ($('#gSound')) $('#gSound').checked = profile.sound !== false;
  updateSoundIcon();
  $$('#sideSeg button').forEach((b) => b.classList.toggle('active', b.dataset.side === profile.side));
  $('#optSquare').checked = profile.square;
  const m = modeById(profile.modeId);
  $('#optSquareWrap').style.display = m.square ? '' : 'none';
}

/** Мини-доска на главной: тема и набор фигур видны сразу. */
function renderPreview() {
  const box = $('#previewBoard');
  if (!box) return;
  const st = createState(profile.modeId, { square: profile.square });
  const size = Math.max(13, Math.floor(132 / Math.max(st.W, st.H)));
  box.style.width = size * st.W + 'px';
  box.style.height = size * st.H + 'px';
  box.innerHTML = '';
  for (let y = st.H - 1; y >= 0; y--) {
    for (let x = 0; x < st.W; x++) {
      const i = y * st.W + x;
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((x + y) % 2 === 0 ? 'dark' : 'light');
      sq.style.transform = `translate(${x * size}px, ${(st.H - 1 - y) * size}px)`;
      sq.style.width = size + 'px';
      sq.style.height = size + 'px';
      box.appendChild(sq);
      const p = st.board[i];
      if (!p) continue;
      const el = document.createElement('div');
      el.className = `piece ${p.c === 'w' ? 'w' : 'b'}`;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.transform = `translate(${x * size}px, ${(st.H - 1 - y) * size}px)`;
      el.innerHTML = pieceSvg(p.t);
      box.appendChild(el);
    }
  }
  const note = box.parentElement.querySelector('.preview-note');
  if (note) {
    note.innerHTML = `<b>${escapeHtml(st.mode.name)}</b>${st.W}×${st.H} · ${escapeHtml(THEMES.find((t) => t.id === profile.theme)?.name || '')}<br>${escapeHtml(PIECE_SETS.find((s) => s.id === profile.pieces)?.name || '')}`;
  }
}

function renderThemeRows() {
  for (const box of [$('#settingsThemeRow'), $('#drawerThemeRow')]) {
    if (!box) continue;
    box.innerHTML = '';
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (profile.theme === t.id ? ' active' : '');
      b.title = t.name;
      b.dataset.theme = t.id;
      b.innerHTML = `<span class="sw-light" style="background:${t.light}"></span><span class="sw-dark" style="background:${t.dark}"></span><span class="sw-name">${t.name}</span>`;
      b.addEventListener('click', () => setTheme(t.id));
      box.appendChild(b);
    }
  }
}

function renderPieceRows() {
  for (const box of [$('#settingsPiecesRow'), $('#drawerPiecesRow')]) {
    if (!box) continue;
    box.innerHTML = '';
    for (const s of PIECE_SETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pset' + (profile.pieces === s.id ? ' active' : '');
      b.dataset.pieces = s.id;
      b.title = s.name;
      b.innerHTML = `<span class="pset-glyph">${pieceSvg('n')}</span><span class="pset-name">${s.name}</span>`;
      b.addEventListener('click', () => setPieces(s.id));
      box.appendChild(b);
    }
  }
}

function renderAvatarRow() {
  const box = $('#avatarRow');
  box.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-btn' + (profile.avatar === a ? ' active' : '');
    b.innerHTML = pieceSvg(a, 'av-pc');
    b.addEventListener('click', () => {
      profile.avatar = a;
      renderProfile();
      renderAvatarRow();
      saveProfile();
    });
    box.appendChild(b);
  }
}

function setTheme(id) {
  profile.theme = id;
  document.documentElement.dataset.theme = id;
  $$('.swatch').forEach((b) => b.classList.toggle('active', b.dataset.theme === id));
  renderPreview();
  saveProfile();
}

function setPieces(id) {
  profile.pieces = id;
  document.documentElement.dataset.pieces = id;
  $$('.pset').forEach((b) => b.classList.toggle('active', b.dataset.pieces === id));
  renderPreview();
  saveProfile();
}

function renderTimeGroups() {
  const box = $('#timeGroups');
  box.innerHTML = '';
  for (const group of TIME_GROUPS) {
    const wrap = document.createElement('details');
    wrap.className = 'time-group';
    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="tg-title">${group.title}</span><span class="tg-hint">${group.hint}</span>`;
    wrap.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'tg-list';
    for (const item of group.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'time-item' + (profile.timeMs === item.ms ? ' active' : '');
      b.textContent = item.label;
      b.addEventListener('click', () => {
        profile.timeMs = item.ms;
        profile.timeLabel = item.label;
        saveProfile();
        renderTimeGroups();
        renderTimeSummary();
      });
      list.appendChild(b);
    }
    wrap.appendChild(list);
    box.appendChild(wrap);
  }
  renderTimeSummary();
}

function renderTimeSummary() {
  $('#timeSummary').textContent = profile.timeLabel;
}

function renderModeCard() {
  const m = modeById(profile.modeId);
  $('#modeIcon').textContent = m.icon;
  $('#modeName').textContent = m.name;
  $('#modeDesc').textContent = m.desc;
  $('#modesCurrent').textContent = m.name;
  $('#optSquareWrap').style.display = m.square ? '' : 'none';
  renderPreview();
}

function renderModesGrid() {
  const box = $('#modesGrid');
  box.innerHTML = '';
  for (const m of MODES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mode-tile' + (profile.modeId === m.id ? ' active' : '');
    const size = m.square && profile.square ? `${m.W}×${m.W}` : `${m.W}×${m.H}`;
    card.innerHTML = `
      <span class="mt-icon">${m.icon}</span>
      <span class="mt-body">
        <span class="mt-name">${m.name}</span>
        <span class="mt-desc">${m.desc}</span>
        <span class="mt-meta">${size}${m.n ? ' · режим ' + m.n : ' · обычные шахматы'}</span>
      </span>`;
    card.addEventListener('click', () => {
      profile.modeId = m.id;
      saveProfile();
      renderModeCard();
      renderModesGrid();
      toast(`Режим: ${m.name}`);
      showScreen('home');
    });
    box.appendChild(card);
  }
}


function renderStats() {
  const s = profile.stats;
  const total = s.games || 0;
  const rate = total ? Math.round((s.wins / total) * 100) : 0;
  $('#statsHero').innerHTML = `
    <div class="sh-points">${profile.points}<span>очков</span></div>
    <div class="sh-name">${escapeHtml(profile.name)} <span class="sh-avatar">${profile.avatar}</span></div>
    <div class="sh-rule">+5 мат · +4 мат по времени · +1 пат · −4 поражение · −5 поражение в первые 10 ходов</div>`;
  $('#statsGrid').innerHTML = [
    ['Партий', total], ['Побед', s.wins], ['Ничьих', s.draws], ['Поражений', s.losses],
    ['Процент побед', rate + '%'], ['Мат', s.mates], ['По времени', s.timeWins], ['Лучшая серия', s.best],
  ].map(([k, v]) => `<div class="stat-cell"><b>${v}</b><span>${k}</span></div>`).join('');

  const box = $('#historyList');
  if (!profile.history.length) {
    box.innerHTML = '<div class="empty-line">Партий пока нет — сыграйте первую.</div>';
    return;
  }
  box.innerHTML = '';
  for (const g of profile.history.slice(0, 40)) {
    const row = document.createElement('div');
    row.className = 'history-row ' + (g.result || 'draw');
    const delta = g.points > 0 ? `+${g.points}` : String(g.points);
    row.innerHTML = `
      <span class="hr-res">${g.result === 'win' ? 'победа' : g.result === 'loss' ? 'поражение' : 'ничья'}</span>
      <span class="hr-mode">${escapeHtml(g.mode || '')}</span>
      <span class="hr-why">${escapeHtml(g.reasonText || '')}</span>
      <span class="hr-moves">${g.plies} ход.</span>
      <span class="hr-date">${g.date || ''}</span>
      <span class="hr-points ${g.points >= 0 ? 'up' : 'down'}">${delta}</span>`;
    box.appendChild(row);
  }
}

/* ────────────────────────── 5. ЭКРАНЫ И ТОСТЫ ─────────────────────────── */

function openScreen(name) {
  ui.prevScreen = ui.screen === 'game' ? 'game' : (ui.screen === 'settings' || ui.screen === 'modes' || ui.screen === 'stats' ? ui.prevScreen || 'home' : 'home');
  showScreen(name);
}

function backFromScreen() {
  showScreen(ui.prevScreen === 'game' && ui.st ? 'game' : 'home');
}

function closeDrawer() {
  const d = $('#drawer');
  if (d) d.classList.remove('open');
  updateScrim();
}

function toggleDrawer() {
  const d = $('#drawer');
  if (!d) return;
  d.classList.toggle('open');
  updateScrim();
}

function closePanel() {
  const panel = $('#sidePanel');
  if (panel) panel.classList.remove('open');
  updateScrim();
}

function togglePanel() {
  const panel = $('#sidePanel');
  if (!panel) return;
  panel.classList.toggle('open');
  updateScrim();
}

function updateScrim() {
  const drawerOpen = $('#drawer') && $('#drawer').classList.contains('open');
  const panelOpen = $('#sidePanel') && $('#sidePanel').classList.contains('open') && window.innerWidth < 1000;
  const scrim = $('#scrim');
  if (scrim) scrim.classList.toggle('show', !!(drawerOpen || panelOpen));
}

function renderSettings() {
  renderProfile();
  renderThemeRows();
  renderPieceRows();
  renderAvatarRow();
}

function showScreen(name) {
  if (name !== 'game') { closeDrawer(); closePanel(); }
  ui.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
  if (name === 'home') { renderProfile(); }
  if (name === 'modes') renderModesGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let toastTimer = 0;
function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ──────────────────────────── 6. ДОСКА ────────────────────────────────── */

function myColor() {
  if (ui.mode === 'online') return ui.role === 'host' ? 'w' : 'b';
  return profile.side;
}

function viewState() {
  if (!ui.st) return null;
  const last = ui.frames.length - 1;
  if (ui.viewPly >= last) return ui.st;
  const f = ui.frames[ui.viewPly];
  return {
    ...ui.st,
    board: f.board,
    turn: f.turn,
    ep: f.ep,
    castling: f.castling,
    blocked: f.blocked,
    capturedKing: f.capturedKing,
    check: f.check,
  };
}

function disp(st, i) {
  const x = i % st.W;
  const y = Math.floor(i / st.W);
  return ui.orientation === 'w'
    ? { dx: x, dy: st.H - 1 - y }
    : { dx: st.W - 1 - x, dy: y };
}

function layoutBoard() {
  const st = ui.st;
  if (!st) return;
  const stage = $('#stage');
  const wrap = $('#boardWrap');
  if (!stage || !wrap) return;
  const pad = window.innerWidth < 560 ? 16 : 20;
  const barH = ($('#barTop') ? $('#barTop').offsetHeight : 0) + ($('#barBottom') ? $('#barBottom').offsetHeight : 0);
  const act = $('.stage-actions');
  const actionsH = act ? act.offsetHeight : 0;
  const gaps = 18;
  const availW = Math.max(160, stage.clientWidth - 4);
  const availH = Math.max(160, stage.clientHeight - barH - actionsH - gaps);
  const sq = Math.max(12, Math.min(110,
    Math.floor((availW - pad * 2) / st.W),
    Math.floor((availH - pad * 2) / st.H)));
  ui.sq = sq;
  const widthPx = sq * st.W + pad * 2;
  wrap.style.width = widthPx + 'px';
  wrap.style.height = sq * st.H + pad * 2 + 'px';
  wrap.style.padding = pad + 'px';
  const topBar = $('#barTop');
  const bottomBar = $('#barBottom');
  if (topBar) topBar.style.width = widthPx + 'px';
  if (bottomBar) bottomBar.style.width = widthPx + 'px';
  document.documentElement.style.setProperty('--sq', sq + 'px');
}

function buildSquares() {
  const st = ui.st;
  const layer = $('#squares');
  layer.innerHTML = '';
  ui.squareEls = new Array(st.board.length);
  for (let y = 0; y < st.H; y++) {
    for (let x = 0; x < st.W; x++) {
      const i = y * st.W + x;
      const el = document.createElement('div');
      el.className = 'sq ' + ((x + y) % 2 === 0 ? 'dark' : 'light');
      el.dataset.sq = i;
      layer.appendChild(el);
      ui.squareEls[i] = el;
    }
  }
  buildCoords();
  positionSquares();
}

function positionSquares() {
  const st = ui.st;
  const sq = ui.sq;
  for (let i = 0; i < st.board.length; i++) {
    const { dx, dy } = disp(st, i);
    const el = ui.squareEls[i];
    el.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    el.style.width = sq + 'px';
    el.style.height = sq + 'px';
  }
}

function buildCoords() {
  const st = ui.st;
  const files = [];
  const ranks = [];
  for (let x = 0; x < st.W; x++) files.push(FILES[ui.orientation === 'w' ? x : st.W - 1 - x]);
  for (let y = 0; y < st.H; y++) ranks.push(String(ui.orientation === 'w' ? st.H - y : y + 1));
  const pad = 20;
  const sq = ui.sq;
  for (const [id, list, cls] of [['#coordFiles', files, 'files'], ['#coordFilesTop', files, 'files'], ['#coordRanks', ranks, 'ranks'], ['#coordRanksRight', ranks, 'ranks']]) {
    const box = $(id);
    if (!box) continue;
    box.innerHTML = list.map((l) => `<span style="width:${sq}px">${l}</span>`).join('');
    if (box.classList.contains('files')) {
      box.style.left = pad + 'px';
      box.style.width = sq * st.W + 'px';
    } else {
      box.style.top = pad + 'px';
      box.style.height = sq * st.H + 'px';
      box.style.lineHeight = sq + 'px';
    }
  }
}

function renderSquares() {
  const st = viewState();
  const sq = ui.sq;
  const last = ui.lastMove;
  const checkSq = st.check ? findKing(st, st.turn) : -1;
  const centerCellsList = st.flags.centerWin ? centerCells(st) : null;
  for (let i = 0; i < st.board.length; i++) {
    const el = ui.squareEls[i];
    if (!el) continue;
    const cls = ['sq', (i % st.W + Math.floor(i / st.W)) % 2 === 0 ? 'dark' : 'light'];
    if (last && (i === last.from || i === last.to)) cls.push('last');
    if (i === ui.selected) cls.push('sel');
    if (i === checkSq) cls.push('check');
    if (st.blocked.includes(i)) cls.push('blocked');
    if (centerCellsList && centerCellsList.includes(i)) cls.push('center-mark');
    if (ui.hint && i === ui.hint.from) cls.push('hint-from');
    if (ui.hint && i === ui.hint.to) cls.push('hint-to');
    el.className = cls.join(' ');
    el.style.width = sq + 'px';
    el.style.height = sq + 'px';
    const { dx, dy } = disp(st, i);
    el.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
  }
}

function renderPieces(animate) {
  const st = viewState();
  const layer = $('#pieces');
  const sq = ui.sq;
  const seen = new Set();
  const fog = st.flags.fog && ui.viewPly === ui.frames.length - 1;
  const vis = fog ? visSet(ui.st, myColor()) : null;
  const me = myColor();

  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p) continue;
    if (vis && p.c !== me && !vis.has(i)) continue;
    seen.add(p.id);
    let el = ui.pieceNodes.get(p.id);
    if (!el) {
      el = document.createElement('div');
      layer.appendChild(el);
      ui.pieceNodes.set(p.id, el);
    }
    el.className = `piece ${p.c === 'w' ? 'w' : 'b'} t-${p.t}`;
    el.innerHTML = pieceSvg(p.t);
    const { dx, dy } = disp(st, i);
    el.style.width = sq + 'px';
    el.style.height = sq + 'px';
    el.style.fontSize = Math.round(sq * 0.9) + 'px';
    el.style.transition = animate ? '' : 'none';
    el.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    el.style.zIndex = String(10 + dy);
  }
  for (const [id, el] of Array.from(ui.pieceNodes.entries())) {
    if (!seen.has(id)) {
      el.remove();
      ui.pieceNodes.delete(id);
    }
  }
}

function renderHints() {
  const st = viewState();
  const layer = $('#hints');
  layer.innerHTML = '';
  if (!ui.st || ui.viewPly !== ui.frames.length - 1) return;
  if (ui.selected < 0) return;
  const moves = legalMoves(ui.st, ui.st.turn).filter((m) => m.from === ui.selected);
  const sq = ui.sq;
  for (const m of moves) {
    const { dx, dy } = disp(st, m.to);
    const dot = document.createElement('div');
    const capture = m.capture != null || m.ep || (m.caps && m.caps.length);
    dot.className = 'hint ' + (capture ? 'capture' : 'quiet');
    dot.style.width = sq + 'px';
    dot.style.height = sq + 'px';
    dot.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    layer.appendChild(dot);
  }
}

function renderBoard(animate) {
  if (!ui.st) return;
  const boardEl = document.getElementById('board');
  if (boardEl) boardEl.classList.toggle('fog-on', !!ui.st.flags.fog);
  layoutBoard();
  positionSquares();
  renderSquares();
  buildCoords();
  renderPieces(animate);
  renderHints();
}

/* ───────────────────────── 7. ЧАСЫ И СТАТУС ──────────────────────────── */

function fmtClock(ms) {
  if (!ui.timeMs) return '∞';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (m) return `${m}:${String(s).padStart(2, '0')}`;
  return `0:${String(s).padStart(2, '0')}`;
}

function updateClockEls(override) {
  if (!ui.st) return;
  const turn = ui.st.turn;
  const running = ui.running && ui.st.status === 'play' && ui.viewPly === ui.frames.length - 1;
  for (const color of ['w', 'b']) {
    const el = color === 'w' ? $('#bottomClock') : $('#topClock');
    let ms = ui.clocks[color];
    if (override && override.color === color) ms = override.ms;
    else if (running && color === turn) ms = Math.max(0, ui.clocks[color] - (performance.now() - ui.turnStart));
    el.textContent = fmtClock(ms);
    el.classList.toggle('low', ui.timeMs > 0 && ms <= 20000);
  }
  $('#barBottom').classList.toggle('active', turn === 'w' && ui.st.status === 'play');
  $('#barTop').classList.toggle('active', turn === 'b' && ui.st.status === 'play');
}

function tickClocks() {
  if (!ui.st || !ui.timeMs || !ui.running) return;
  if (ui.st.status !== 'play') return;
  if (ui.viewPly !== ui.frames.length - 1) return;
  const color = ui.st.turn;
  const left = ui.clocks[color] - (performance.now() - ui.turnStart);
  updateClockEls({ color, ms: Math.max(0, left) });
  if (left <= 0) flagFall(color);
}

function startClocks() {
  ui.running = false;
  ui.turnStart = performance.now();
  updateClockEls();
  clearInterval(ui.timer);
  ui.timer = setInterval(tickClocks, 120);
}

function flagFall(color) {
  if (!ui.st || ui.st.status !== 'play') return;
  ui.clocks[color] = 0;
  const result = { winner: other(color), reason: 'time' };
  ui.st.status = 'over';
  ui.st.result = result;
  renderAll(false);
  finishGame(result);
  if (ui.mode === 'online') netPublish({ t: 'end', winner: result.winner, reason: 'time' });
}

/* ─────────────────────────── 8. ПАРТИЯ ────────────────────────────────── */

function snap(st) {
  return {
    board: st.board.slice(),
    turn: st.turn,
    ep: st.ep,
    castling: { w: { ...st.castling.w }, b: { ...st.castling.b } },
    blocked: st.blocked.slice(),
    capturedKing: st.capturedKing,
    check: st.check,
  };
}

function newGame(opts = {}) {
  const mode = modeById(opts.modeId || profile.modeId);
  ui.st = createState(mode.id, { square: opts.square != null ? opts.square : profile.square, seed: opts.seed });
  ui.frames = [snap(ui.st)];
  ui.moves = [];
  ui.viewPly = 0;
  ui.selected = -1;
  ui.hint = null;
  ui.lastMove = null;
  ui.chat = [];
  ui.scored = false;
  ui.promo = null;
  ui.phase = '';
  ui.blockFlash = -1;
  ui.pieceNodes.clear();
  $('#pieces').innerHTML = '';
  $('#promo').classList.add('hidden');
  ui.timeMs = opts.timeMs != null ? opts.timeMs : profile.timeMs;
  ui.clocks = { w: ui.timeMs, b: ui.timeMs };
  ui.orientation = opts.orientation || (profile.side === 'b' && !opts.orientation ? 'b' : 'w');
  ui.mode = opts.mode || 'local';
  ui.role = opts.role || null;

  closePanel();
  closeDrawer();
  showScreen('game');        // сначала показываем экран: иначе замеры панелей нулевые
  buildSquares();
  renderAll(false);
  renderMoves();
  renderChat();
  renderMeta();
  renderPlayers();
  startClocks();
  switchTab('moves');
  requestAnimationFrame(() => { if (ui.st) renderBoard(false); });

  $('#result').classList.add('hidden');
  $('#gameStatus').textContent = 'Ход белых';
  $('#gameSub').textContent = mode.name + ' · ' + (ui.timeMs ? profile.timeLabel : 'без ограничений');

  if (opts.splash !== false) {
    ui.phase = 'opening';
    setTimeout(() => showPhase('opening'), 350);
  }
  updateNav();
}

function renderMeta() {
  const st = ui.st;
  if (!st) return;
  const bits = [];
  bits.push(`поле ${st.W}×${st.H}`);
  bits.push(ui.timeMs ? profile.timeLabel : 'без ограничений');
  if (st.flags.fog) bits.push('туман войны');
  if (st.flags.explode) bits.push('взрывы');
  if (st.flags.checksToWin) bits.push('победа по трём шахам');
  if (st.flags.crossCastle) bits.push('обмены короля: 3');
  if (st.flags.blocks) bits.push('случайные блоки');
  if (st.flags.race) bits.push('гонка к верхнему ряду');
  if (st.flags.centerWin) bits.push('победа королём в центре');
  if (st.flags.jester) bits.push('Шуты: 5 ходов');
  if (st.flags.boy) bits.push('Пацанчики берут две');
  if (st.flags.kingFree) bits.push('короля можно съесть');
  if (st.flags.kingOnlyLose) bits.push('один король — поражение');
  $('#gameMeta').innerHTML = `<b>${escapeHtml(st.mode.name)}</b><br>${escapeHtml(bits.join(' · '))}`;
}

function renderPlayers() {  const st = ui.st;
  if (!st) return;
  const me = myColor();
  const bottomColor = ui.orientation === 'w' ? 'w' : 'b';
  const topColor = other(bottomColor);
  const mySide = ui.mode === 'online' ? (ui.role === 'host' ? 'w' : 'b') : me;

  const names = ui.online && ui.online.names ? ui.online.names : null;
  const nameFor = (color) => {
    if (ui.mode !== 'online' || !names) return color === mySide ? profile.name : 'Соперник';
    return color === mySide ? profile.name : (names[other(mySide)] || 'Соперник');
  };
  const avatarFor = (color) => {
    if (ui.mode !== 'online' || !names) return color === mySide ? profile.avatar : 'k';
    return color === mySide ? profile.avatar : (ui.online.avatars?.[other(mySide)] || 'k');
  };

  const setBar = (bar, color) => {
    const nameEl = bar === 'top' ? $('#topName') : $('#bottomName');
    const roleEl = bar === 'top' ? $('#topRole') : $('#bottomRole');
    const avEl = bar === 'top' ? $('#topAvatar') : $('#bottomAvatar');
    nameEl.textContent = nameFor(color);
    roleEl.textContent = color === 'w' ? 'белые' : 'чёрные';
    avEl.innerHTML = pieceSvg(avatarFor(color), 'av-pc');
  };
  setBar('top', topColor);
  setBar('bottom', bottomColor);
  $('#topLink').style.display = ui.mode === 'online' ? '' : 'none';
  $('#bottomLink').style.display = ui.mode === 'online' ? '' : 'none';
  updateLinkDots();
  renderCaptured();
  updateClockEls();
}

function updateLinkDots() {
  const ok = ui.mode === 'online' && ui.online && ui.online.connected;
  for (const id of ['#topLink', '#bottomLink']) {
    const el = $(id);
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('bad', !ok);
    el.title = ok ? 'связь есть' : 'связи нет';
  }
}

function renderCaptured() {
  const st = ui.st;
  if (!st || !ui.frames.length) return;
  const start = ui.frames[0].board;
  const count = (board) => {
    const map = {};
    for (const p of board) if (p) map[p.c + p.t] = (map[p.c + p.t] || 0) + 1;
    return map;
  };
  const a = count(start);
  const b = count(st.board);
  const lost = { w: [], b: [] };
  for (const key of Object.keys(a)) {
    const diff = (a[key] || 0) - (b[key] || 0);
    for (let i = 0; i < diff; i++) lost[key[0]].push(key[1]);
  }
  const mark = (types) => types.map((t) => pieceSvg(t, 'cap-pc')).join('');
  $('#bottomCaptured').innerHTML = mark(lost[other(ui.orientation === 'w' ? 'w' : 'b')]);
  $('#topCaptured').innerHTML = mark(lost[ui.orientation === 'w' ? 'w' : 'b']);
}

function renderAll(animate) {
  if (!ui.st) return;
  renderBoard(animate);
  updateClockEls();
  updateEval();
  renderStatus();
  updateNav();
  renderCaptured();
}

function renderStatus() {
  const st = ui.st;
  const el = $('#gameStatus');
  const sub = $('#gameSub');
  if (!st) return;
  if (ui.viewPly !== ui.frames.length - 1) {
    el.textContent = 'Просмотр партии';
    sub.textContent = `позиция после ${ui.viewPly}-го полухода · вернитесь в конец, чтобы играть`;
    return;
  }
  if (st.status === 'over' && st.result) {
    el.textContent = resultTitle(st.result);
    sub.textContent = resultReason(st.result);
    return;
  }
  el.textContent = st.turn === 'w' ? 'Ход белых' : 'Ход чёрных';
  const bits = [st.mode.name];
  if (st.check) bits.push('шах!');
  if (st.flags.checksToWin) bits.push(`шахи ${st.mv.w.checks}:${st.mv.b.checks}`);
  if (st.flags.crossCastle) bits.push(`обмены ${st.mv.w.cross}/${st.flags.crossCastle}`);
  if (st.flags.race) bits.push('цель: верхний ряд');
  if (st.flags.centerWin) bits.push('цель: d4, e4, d5, e5');
  const open = openingName();
  if (open) bits.push(open);
  sub.textContent = bits.join(' · ');
}

function resultTitle(res) {
  const my = myColor();
  if (!res || !res.winner) return 'Ничья';
  return res.winner === my ? 'Победа' : 'Поражение';
}

function resultReason(res) {
  if (!res) return '';
  const map = {
    mate: 'мат', time: 'время истекло', resign: 'сдался', stalemate: 'пат',
    fifty: 'правило 50 ходов', material: 'недостаточно материала',
    repetition: 'троекратное повторение', draw: 'ничья по согласию',
    king: 'король съеден', race: 'король дошёл до верхнего ряда', center: 'король в центре',
    checks: 'три шаха', kingOnly: 'у соперника остался один король',
    abort: 'партия прервана',
  };
  return map[res.reason] || res.reason;
}

/* ───────────────────────────── 9. ХОДЫ ────────────────────────────────── */

function onSquareClick(sq) {
  if (!ui.st || ui.st.status !== 'play') return;
  if (ui.viewPly !== ui.frames.length - 1) return;
  const st = ui.st;
  if (ui.mode === 'online' && st.turn !== myColor()) return;
  if (st.turn !== myColor() && ui.mode !== 'local') return;

  const legal = legalMoves(st, st.turn);
  if (ui.selected >= 0) {
    const candidates = legal.filter((m) => m.from === ui.selected && m.to === sq);
    if (candidates.length) {
      if (candidates.length > 1 && candidates[0].promo) {
        if (profile.autoQueen) {
          commitMove(candidates.find((m) => m.promo === 'q') || candidates[0]);
        } else {
          showPromo(candidates, sq);
        }
      } else {
        commitMove(candidates[0]);
      }
      ui.selected = -1;
      return;
    }
  }
  const p = st.board[sq];
  if (p && p.c === st.turn) {
    ui.selected = sq;
    renderSquares();
    renderHints();
  } else {
    ui.selected = -1;
    renderSquares();
    renderHints();
  }
}

function showPromo(candidates, to) {
  ui.promo = { candidates, to };
  const box = $('#promoRow');
  box.innerHTML = '';
  for (const type of ['q', 'r', 'b', 'n']) {
    const m = candidates.find((x) => x.promo === type);
    if (!m) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'promo-btn';
    b.innerHTML = `<span class="promo-glyph">${pieceSvg(type)}</span><span>${PIECE_NAMES[type]}</span>`;
    b.addEventListener('click', () => {
      $('#promo').classList.add('hidden');
      ui.promo = null;
      commitMove(m);
    });
    box.appendChild(b);
  }
  $('#promo').classList.remove('hidden');
}

function commitMove(m, opts = {}) {
  const st = ui.st;
  if (!st || st.status !== 'play') return false;
  const legal = legalMoves(st, st.turn);
  const match = legal.find((x) => x.from === m.from && x.to === m.to
    && (x.promo || null) === (m.promo || null)
    && !!x.castle === !!m.castle
    && !!x.swap === !!m.swap);
  if (!match) return false;

  const mover = st.turn;
  const now = performance.now();
  let spent = 0;
  if (ui.running && ui.timeMs) {
    spent = Math.max(0, now - ui.turnStart);
    ui.clocks[mover] = Math.max(0, ui.clocks[mover] - spent);
  }
  ui.turnStart = now;
  if (!opts.remote) ui.running = true;

  const san = moveToSan(st, match, legal);
  applyMove(st, match);
  if (st.flags.blocks) {
    const blockedSq = maybeBlock(st);
    if (blockedSq >= 0) {
      ui.blockFlash = blockedSq;
      setTimeout(() => { ui.blockFlash = -1; renderSquares(); }, 1200);
      if (!opts.silent) toast(`Клетка ${sqName(st, blockedSq)} заперта`);
    }
  }
  ui.frames.push(snap(st));
  ui.viewPly = ui.frames.length - 1;
  const captured = !!match.capture || (match.caps && match.caps.length) || match.ep;
  ui.moves.push({ san, from: match.from, to: match.to, color: mover, spent, clock: ui.clocks[mover], captured });
  ui.lastMove = { from: match.from, to: match.to };
  ui.selected = -1;
  ui.hint = null;

  if (st.flags.checksToWin && inCheck(st, st.turn)) st.mv[mover].checks += 1;

  let res = updateStatus(st);
  if (!res && st.flags.checksToWin && st.mv[mover].checks >= st.flags.checksToWin) {
    res = { winner: mover, reason: 'checks' };
    st.status = 'over';
    st.result = res;
  }

  if (!opts.silent && !opts.remote) {
    if (captured) { sound.capture(); buzz([12, 24, 12]); } else { sound.move(); buzz(8); }
    if (inCheck(st, st.turn)) sound.check();
  }

  if (st.flags.explode && st.exploded) {
    const board = $('#board');
    board.classList.remove('shake');
    void board.offsetWidth;
    board.classList.add('shake');
    setTimeout(() => board.classList.remove('shake'), 450);
  }

  if (ui.mode === 'local' && profile.flip && !opts.remote && !opts.silent) {
    ui.orientation = st.turn;
  }
  if (!opts.silent) {
    renderAll(!opts.noAnim);
    renderMoves();
  }

  if (ui.mode === 'online' && !opts.remote && !opts.silent) {
    netPublish({ t: 'move', from: match.from, to: match.to, promo: match.promo || null, cw: ui.clocks.w, cb: ui.clocks.b });
  }

  if (res) {
    renderAll(false);
    finishGame(res);
  } else if (!opts.silent) {
    maybePhase();
  }
  return true;
}

/* ─────────────────────────── 10. РЕЗУЛЬТАТ ────────────────────────────── */

const REASON_TEXT = {
  mate: 'мат', time: 'время истекло', resign: 'сдача', stalemate: 'пат',
  fifty: 'правило 50 ходов', material: 'недостаточно материала',
  repetition: 'троекратное повторение', draw: 'ничья по согласию',
  king: 'король съеден', race: 'король на вершине', center: 'король в центре',
  checks: 'три шаха', kingOnly: 'остался один король',
  abort: 'партия прервана',
};

function scoreGame(res, st) {
  if (!res || res.reason === 'abort') return 0;
  const side = myColor();
  if (!res.winner) {
    if (res.reason !== 'stalemate') return 0;
    if (onlyKing(st, 'w') || onlyKing(st, 'b')) return 0;
    return 1;
  }
  if (res.winner === side) return res.reason === 'time' ? 4 : 5;
  return st.full <= 10 ? -5 : -4;
}

function finishGame(res) {
  ui.running = false;
  clearInterval(ui.timer);
  if (!ui.st) return;
  if (ui.scored) return;
  ui.scored = true;

  const st = ui.st;
  const points = scoreGame(res, st);
  const side = myColor();
  const win = res.winner === side;
  const draw = !res.winner;
  const lost = !!res.winner && !win;

  if (res.reason !== 'abort' && ui.mode !== 'online' || (res.reason !== 'abort' && ui.mode === 'online')) {
    profile.points += points;
    profile.stats.games += 1;
    if (win) {
      profile.stats.wins += 1;
      profile.stats.streak += 1;
      profile.stats.best = Math.max(profile.stats.best, profile.stats.streak);
      if (res.reason === 'time') profile.stats.timeWins += 1;
      else profile.stats.mates += 1;
    } else if (lost) {
      profile.stats.losses += 1;
      profile.stats.streak = 0;
    } else {
      profile.stats.draws += 1;
    }
    profile.history.unshift({
      ts: Date.now(),
      date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      mode: st.mode.name,
      result: win ? 'win' : lost ? 'loss' : 'draw',
      reason: res.reason,
      reasonText: REASON_TEXT[res.reason] || res.reason,
      points,
      plies: ui.moves.length,
      moves: ui.moves.map((m) => m.san).join(' ').slice(0, 4000),
    });
    profile.history = profile.history.slice(0, 60);
    saveProfile(true);
  }

  renderProfile();

  if (res.reason !== 'abort') {
    if (win) { sound.win(); buzz([20, 40, 20, 40, 40]); celebrate(); }
    else if (lost) { sound.lose(); buzz([40, 60, 80]); }
    else { sound.click(); }
  }

  $('#resultTitle').textContent = res.reason === 'abort' ? 'Партия прервана'
    : !res.winner ? 'Ничья' : (res.winner === side ? 'Победа' : 'Поражение');
  $('#resultTitle').className = 'result-title ' + (!res.winner ? 'draw' : res.winner === side ? 'win' : 'lose');
  const reasonText = REASON_TEXT[res.reason] || res.reason;
  $('#resultSub').textContent = res.winner
    ? `${res.winner === 'w' ? 'Белые' : 'Чёрные'} · ${reasonText}`
    : reasonText;
  const sign = points > 0 ? `+${points}` : String(points);
  $('#resultPoints').innerHTML = res.reason === 'abort' ? ''
    : `<span class="${points > 0 ? 'up' : points < 0 ? 'down' : ''}">${sign} очков</span> <em>всего ${profile.points}</em>`;
  ['#resultAgain', '#resultMenu', '#resultClose'].forEach((id) => $(id).classList.remove('hidden'));
  $('#result').classList.remove('hidden');
  renderStatsIfOpen();
}

function renderStatsIfOpen() {
  if (ui.screen === 'stats') renderStats();
}

function maybePhase() {
  const st = ui.st;
  if (!st || ui.replaying) return;
  const phase = phaseFor(st);
  if (phase !== ui.phase) {
    ui.phase = phase;
    showPhase(phase);
  }
}

function phaseFor(st) {
  const ply = ui.moves.length;
  const mat = materialOf(st, 'w') + materialOf(st, 'b');
  if (mat <= 20 || ply >= 60) return 'endgame';
  if (ply >= 20) return 'middle';
  return 'opening';
}

const PHASES = {
  opening: { title: 'Дебют', sub: 'первые десять ходов' },
  middle: { title: 'Миттельшпиль', sub: 'середина партии' },
  endgame: { title: 'Эндшпиль', sub: 'развязка близко' },
};

function showPhase(phase) {
  const info = PHASES[phase] || PHASES.opening;
  const el = $('#phaseSplash');
  $('#phaseBadge').textContent = info.title;
  $('#phaseSub').textContent = info.sub;
  el.dataset.phase = phase;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(showPhase.timer);
  showPhase.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ───────────────────────── 11. СПИСОК ХОДОВ ───────────────────────────── */

function renderMoves() {
  const box = $('#moves');
  if (!ui.moves.length) {
    box.innerHTML = '<div class="moves-empty">Пока пусто — сделайте первый ход</div>';
    return;
  }
  const rows = [];
  const cur = ui.viewPly;
  for (let i = 0; i < ui.moves.length; i += 2) {
    const num = i / 2 + 1;
    const one = ui.moves[i];
    const two = ui.moves[i + 1];
    const cell = (m, ply) => {
      if (!m) return '<span class="mv-empty"></span>';
      const time = ui.timeMs && m.spent > 0 ? `<em>${(m.spent / 1000).toFixed(1)}с</em>` : '';
      return `<button type="button" class="mv ${ply === cur ? 'active' : ''}" data-ply="${ply}">${escapeHtml(m.san)}${time}</button>`;
    };
    rows.push(`<div class="move-row"><span class="mv-num">${num}.</span>${cell(one, i + 1)}${cell(two, i + 2)}</div>`);
  }
  box.innerHTML = rows.join('');
  box.querySelectorAll('.mv').forEach((b) => {
    b.addEventListener('click', () => gotoPly(Number(b.dataset.ply)));
  });
  const active = box.querySelector('.mv.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function updateNav() {
  const max = ui.frames.length - 1;
  $('#navStart').disabled = ui.viewPly <= 0;
  $('#navPrev').disabled = ui.viewPly <= 0;
  $('#navNext').disabled = ui.viewPly >= max;
  $('#navEnd').disabled = ui.viewPly >= max;
  const info = $('#infoLine');
  if (info) info.textContent = `${ui.moves.length} полуходов · ${ui.st ? ui.st.mode.name : ''}`;
}

function gotoPly(ply) {
  const max = ui.frames.length - 1;
  ui.viewPly = Math.max(0, Math.min(max, ply));
  ui.selected = -1;
  renderAll(false);
  renderMoves();
  updateNav();
  renderPgnBox();
}

function renderPgnBox() {
  const st = ui.st;
  if (!st) return;
  const side = myColor();
  const white = side === 'w' ? profile.name : (ui.online ? 'Соперник' : 'Соперник');
  const black = side === 'b' ? profile.name : (ui.online ? 'Соперник' : 'Соперник');
  const result = st.result ? (st.result.winner ? (st.result.winner === 'w' ? '1-0' : '0-1') : '1/2-1/2') : '*';
  const lines = [
    `[Event "Daymix's Chess"]`,
    `[Site "${ui.mode === 'online' ? 'по сети' : 'на одном устройстве'}"]`,
    `[Date "${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    `[Variant "${st.mode.name}"]`,
    `[TimeControl "${ui.timeMs ? Math.round(ui.timeMs / 1000) : '-'}"]`,
    `[Opening "${openingName() || ''}"]`,
    '',
  ];
  const body = [];
  for (let i = 0; i < ui.moves.length; i += 2) {
    const num = i / 2 + 1;
    body.push(`${num}. ${ui.moves[i].san}${ui.moves[i + 1] ? ' ' + ui.moves[i + 1].san : ''}`);
  }
  $('#pgnBox').value = lines.join('\n') + body.join(' ') + (body.length ? ' ' + result : '');
}

/* ────────────────────────────── 12. ВКЛАДКИ ───────────────────────────── */

function switchTab(name) {
  ui.tab = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tabMoves').classList.toggle('hidden', name !== 'moves');
  $('#tabChat').classList.toggle('hidden', name !== 'chat');
  $('#tabInfo').classList.toggle('hidden', name !== 'info');
  if (name === 'info') renderPgnBox();
}

function renderChat() {
  const box = $('#chat');
  if (!ui.chat.length) {
    box.innerHTML = `<div class="chat-empty">${ui.mode === 'online' ? 'Напишите сопернику' : 'Чат доступен в партии по сети'}</div>`;
    return;
  }
  box.innerHTML = ui.chat.map((m) => `<div class="chat-msg ${m.me ? 'me' : ''}"><b>${escapeHtml(m.name)}</b><span>${escapeHtml(m.text)}</span></div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function sendChat(text) {
  if (!text) return;
  ui.chat.push({ name: profile.name, text, me: true });
  renderChat();
  if (ui.mode === 'online') netPublish({ t: 'chat', text });
}

/* ─────────────────────────── 13. СЕТЬ (ntfy) ──────────────────────────── */

const RELAY_HTTP = 'https://ntfy.sh/';
const RELAY_WS = 'wss://ntfy.sh/';
const TOPIC_PREFIX = 'daymixchess-v2-';

const topicFor = (code) => TOPIC_PREFIX + code;

class Relay {
  constructor() {
    this.ws = null;
    this.topic = '';
    this.onMessage = null;
    this.onClose = null;
    this.onOpen = null;
    this.closed = false;
  }

  connect(code) {
    this.topic = topicFor(code);
    this.closed = false;
    /* Локальный канал между вкладками: работает даже без интернета
       и не зависит от лимитов публичной службы. */
    try {
      this.bc = new BroadcastChannel('daymix-chess-' + this.topic);
      this.bc.onmessage = (event) => {
        if (this.onMessage && typeof event.data === 'string') this.onMessage(event.data);
      };
    } catch (error) { this.bc = null; }
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(`${RELAY_WS}${this.topic}/ws`);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (error) { /* уже закрыт */ }
        reject(new Error('служба связи не отвечает'));
      }, 12000);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        if (this.onOpen) this.onOpen();
        resolve();
      };
      ws.onmessage = (event) => {
        let packet;
        try { packet = JSON.parse(event.data); } catch (error) { return; }
        if (packet && packet.event === 'message' && typeof packet.message === 'string' && this.onMessage) {
          this.onMessage(packet.message);
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        this.ws = null;
        if (!settled) { settled = true; reject(new Error('соединение закрыто')); return; }
        if (this.onClose) this.onClose();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('ошибка соединения'));
      };
    });
  }

  publish(payload) {
    if (!this.topic) return Promise.resolve();
    const body = JSON.stringify(payload);
    try { if (this.bc) this.bc.postMessage(body); } catch (error) { /* канал закрыт */ }
    return fetch(RELAY_HTTP + this.topic, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
    }).catch(() => { /* сеть моргнула */ });
  }

  close() {
    this.closed = true;
    try { if (this.ws) this.ws.close(); } catch (error) { /* уже закрыт */ }
    try { if (this.bc) this.bc.close(); } catch (error) { /* уже закрыт */ }
    this.ws = null;
    this.bc = null;
  }
}

function netPublish(payload) {
  if (!ui.online || !ui.online.relay) return;
  payload.app = 'daymix-chess';
  payload.v = 2;
  payload.sender = ui.online.role;
  payload.sid = ui.online.sid || null;
  payload.mid = Math.random().toString(36).slice(2, 10);
  payload.ts = Date.now();
  ui.online.relay.publish(payload);
}

function randomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function setLobby(text) { $('#lobbyLine').textContent = text || ''; }

async function createRoom() {
  if (!ui.online) {
    ui.online = { code: '', role: 'host', sid: Math.random().toString(36).slice(2, 10) };
  }
  const code = randomCode();
  ui.online.code = code;
  ui.online.role = 'host';
  ui.online.connected = false;
  ui.online.names = { w: profile.name, b: null };
  ui.online.avatars = { w: profile.avatar, b: 'k' };
  $('#roomCode').textContent = code;
  $('#roomRow').classList.remove('hidden');
  setLobby('Код готов. Передайте его другу — он введёт код и присоединится.');
  ui.online.relay = new Relay();
  ui.online.relay.onMessage = (text) => handleNet(text);
  ui.online.relay.onClose = () => {
    ui.online.connected = false;
    updateLinkDots();
    if (ui.online.sid) scheduleReconnect();
  };
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    setLobby('Не удалось связаться со службой. Проверьте интернет и попробуйте снова.');
    ui.online = null;
    return;
  }
  ui.online.connected = true;
  updateLinkDots();
  $('#roomCode').textContent = code;
  $('#roomRow').classList.remove('hidden');
  setLobby('Код готов. Передайте его другу — он введёт код и присоединится.');
  newGame({ mode: 'online', role: 'host', modeId: profile.modeId, timeMs: profile.timeMs, orientation: 'w', splash: true });
  ui.online.waiting = true;
  announceRoom();
  clearInterval(ui.online.announce);
  ui.online.announce = setInterval(announceRoom, 4000);   // реже: у ntfy есть лимит на публикации
}

function announceRoom() {
  if (!ui.online || ui.online.role !== 'host') return;
  netPublish({
    t: 'room',
    modeId: ui.st ? ui.st.modeId : profile.modeId,
    square: !!profile.square,
    timeMs: ui.timeMs,
    timeLabel: profile.timeLabel,
    seed: ui.st ? ui.st.seed : null,
    name: profile.name,
    avatar: profile.avatar,
  });
}

async function joinRoom(code) {
  if (!/^\d{5}$/.test(code)) { setLobby('Код состоит из пяти цифр.'); return; }
  if (ui.online) leaveOnline(true);
  ui.online = {
    code, role: 'guest', sid: Math.random().toString(36).slice(2, 10),
    connected: false, names: { w: null, b: profile.name }, avatars: { w: 'k', b: profile.avatar },
  };
  ui.online.relay = new Relay();
  ui.online.relay.onMessage = (text) => handleNet(text);
  ui.online.relay.onClose = () => {
    ui.online.connected = false;
    updateLinkDots();
    if (ui.st) scheduleReconnect();
  };
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    setLobby('Комната не отвечает. Проверьте код и интернет.');
    ui.online = null;
    return;
  }
  ui.online.connected = true;
  setLobby('Подключаемся к комнате ' + code + '…');
  netPublish({ t: 'join', name: profile.name, avatar: profile.avatar });
  clearInterval(ui.online.joinTimer);
  let tries = 0;
  ui.online.joinTimer = setInterval(() => {
    tries += 1;
    if (!ui.online || ui.online.started) { clearInterval(ui.online.joinTimer); return; }
    if (tries > 24) {
      clearInterval(ui.online.joinTimer);
      setLobby('Комната не отвечает: служба связи перегружена. Нажмите «Присоединиться» ещё раз через минуту.');
      return;
    }
    if (tries % 5 === 0) setLobby('Ждём ответа комнаты ' + code + '… попытка ' + (tries + 1));
    netPublish({ t: 'join', name: profile.name, avatar: profile.avatar });
  }, 4000);
}

function scheduleReconnect() {
  if (!ui.online || ui.online.reconnecting) return;
  ui.online.reconnecting = true;
  let delay = 1500;
  const attempt = async () => {
    if (!ui.online) return;
    const relay = new Relay();
    relay.onMessage = (text) => handleNet(text);
    relay.onClose = () => {
      ui.online.connected = false;
      updateLinkDots();
      delay = Math.min(delay * 1.6, 12000);
      setTimeout(attempt, delay);
    };
    relay.onOpen = () => {
      ui.online.connected = true;
      updateLinkDots();
      netPublish({ t: 'hello' });
    };
    try {
      await relay.connect(ui.online.code);
      ui.online.relay = relay;
    } catch (error) {
      setTimeout(attempt, delay);
    }
  };
  setTimeout(attempt, delay);
}

function handleNet(text) {
  let msg;
  try { msg = JSON.parse(text); } catch (error) { return; }
  if (!msg || msg.app !== 'daymix-chess') return;
  /* Одно и то же сообщение может прийти и по BroadcastChannel, и по WebSocket. */
  if (msg.mid) {
    if (!ui.online.seen) ui.online.seen = new Set();
    if (ui.online.seen.has(msg.mid)) return;
    ui.online.seen.add(msg.mid);
    if (ui.online.seen.size > 500) ui.online.seen.delete(ui.online.seen.values().next().value);
  }
  if (msg.sender === ui.online.role) return;
  /* Идентификатор партии не фильтруем: у гостя он свой до старта, а после
     старта совпадает с хозяйским. Комната и так уникальна по коду. */

  if (msg.t === 'room' && ui.online.role === 'guest') {
    if (!ui.online.started) setLobby(`Комната ${ui.online.code}: ${msg.name || 'соперник'} ждёт. Подключаемся…`);
    netPublish({ t: 'join', name: profile.name, avatar: profile.avatar });
    return;
  }

  if (msg.t === 'join' && ui.online.role === 'host') {
    if (ui.online.guestName === msg.name) return;
    ui.online.guestName = msg.name;
    ui.online.names.b = msg.name || 'Соперник';
    ui.online.avatars.b = msg.avatar || 'k';
    ui.online.sid = ui.online.sid || Math.random().toString(36).slice(2, 10);
    ui.online.waiting = false;
    clearInterval(ui.online.announce);
    setLobby(`Соперник: ${ui.online.names.b}. Игра началась!`);
    ui.chat.push({ name: 'Система', text: `${ui.online.names.b} присоединился к партии` });
    renderChat();
    renderPlayers();
    netPublish({
      t: 'start',
      modeId: ui.st.modeId,
      square: !!ui.st.square,
      timeMs: ui.timeMs,
      timeLabel: profile.timeLabel,
      seed: ui.st.seed,
      moves: ui.moves.map((m) => ({ from: m.from, to: m.to })),
      cw: ui.clocks.w, cb: ui.clocks.b,
      name: profile.name, avatar: profile.avatar,
    });
    return;
  }

  if (msg.t === 'start' && ui.online.role === 'guest') {
    clearInterval(ui.online.joinTimer);
    ui.online.started = true;
    ui.online.sid = msg.sid || ui.online.sid;
    ui.online.names = { w: msg.name || 'Соперник', b: profile.name };
    ui.online.avatars = { w: msg.avatar || 'k', b: profile.avatar };
    ui.replaying = true;
    newGame({ mode: 'online', role: 'guest', modeId: msg.modeId, square: !!msg.square, timeMs: msg.timeMs, seed: msg.seed, orientation: 'b', splash: false });
    for (const mv of (msg.moves || [])) commitMove(mv, { remote: true, silent: true });
    ui.replaying = false;
    if (msg.cw != null) ui.clocks = { w: msg.cw, b: msg.cb };
    ui.turnStart = performance.now();
    if (ui.moves.length) ui.running = true;
    renderAll(false);
    renderMoves();
    renderPlayers();
    setLobby('');
    toast('Вы подключились к партии');
    showPhase('opening');
    return;
  }

  if (msg.t === 'move' && ui.st) {
    if (ui.clocks) {
      if (msg.cw != null) ui.clocks.w = msg.cw;
      if (msg.cb != null) ui.clocks.b = msg.cb;
    }
    ui.turnStart = performance.now();
    ui.running = true;
    commitMove({ from: msg.from, to: msg.to, promo: msg.promo || null }, { remote: true });
    return;
  }

  if (msg.t === 'chat') {
    ui.chat.push({ name: ui.online.names?.[msg.sender === 'host' ? 'w' : 'b'] || 'Соперник', text: String(msg.text || '').slice(0, 200) });
    renderChat();
    return;
  }

  if (msg.t === 'end' && ui.st) {
    const result = { winner: msg.winner, reason: msg.reason || 'resign' };
    ui.st.status = 'over';
    ui.st.result = result;
    renderAll(false);
    finishGame(result);
    return;
  }

  if (msg.t === 'draw-offer') {
    showOffer('Соперник предлагает ничью', () => {
      netPublish({ t: 'end', winner: null, reason: 'draw' });
      const result = { winner: null, reason: 'draw' };
      if (ui.st) { ui.st.status = 'over'; ui.st.result = result; }
      renderAll(false);
      finishGame(result);
    });
    return;
  }

  if (msg.t === 'hello' && ui.online.role === 'host' && ui.st) {
    netPublish({
      t: 'start',
      modeId: ui.st.modeId,
      square: !!ui.st.square,
      timeMs: ui.timeMs,
      timeLabel: profile.timeLabel,
      seed: ui.st.seed,
      moves: ui.moves.map((m) => ({ from: m.from, to: m.to })),
      cw: ui.clocks.w, cb: ui.clocks.b,
      name: profile.name, avatar: profile.avatar,
    });
  }
}

let offerEl = null;
function showOffer(text, onAccept) {
  if (offerEl) offerEl.remove();
  offerEl = document.createElement('div');
  offerEl.className = 'offer-bar';
  offerEl.innerHTML = `<span>${escapeHtml(text)}</span><button class="btn btn-sm btn-primary" type="button">Принять</button><button class="btn btn-sm btn-ghost" type="button">Отклонить</button>`;
  const [accept, decline] = offerEl.querySelectorAll('button');
  accept.addEventListener('click', () => { offerEl.remove(); offerEl = null; onAccept(); });
  decline.addEventListener('click', () => { offerEl.remove(); offerEl = null; });
  document.body.appendChild(offerEl);
}

function leaveOnline(silent) {
  if (ui.online) {
    clearInterval(ui.online.announce);
    clearInterval(ui.online.joinTimer);
    if (!silent) netPublish({ t: 'bye' });
    if (ui.online.relay) ui.online.relay.close();
    ui.online = null;
  }
}

/* ───────────────────────── 14. УПРАВЛЕНИЕ ПАРТИЕЙ ─────────────────────── */

function resign() {
  if (!ui.st || ui.st.status !== 'play') return;
  const side = ui.st.turn;
  const result = { winner: other(side), reason: 'resign' };
  ui.st.status = 'over';
  ui.st.result = result;
  renderAll(false);
  finishGame(result);
  if (ui.mode === 'online') netPublish({ t: 'end', winner: result.winner, reason: 'resign' });
}

function offerDraw() {
  if (!ui.st || ui.st.status !== 'play') return;
  if (ui.mode === 'online') {
    netPublish({ t: 'draw-offer' });
    toast('Предложение ничьей отправлено');
    return;
  }
  const result = { winner: null, reason: 'draw' };
  ui.st.status = 'over';
  ui.st.result = result;
  renderAll(false);
  finishGame(result);
}

function abortGame() {
  if (!ui.st) return;
  if (ui.moves.length > 2) { toast('Прервать можно только в самом начале'); return; }
  const result = { winner: null, reason: 'abort' };
  ui.st.status = 'over';
  ui.st.result = result;
  renderAll(false);
  finishGame(result);
  if (ui.mode === 'online') netPublish({ t: 'end', winner: null, reason: 'abort' });
}

function leaveGame() {
  leaveOnline();
  ui.st = null;
  ui.running = false;
  clearInterval(ui.timer);
  $('#result').classList.add('hidden');
  showScreen('home');
}

/* ───────────────────────────── 15. СОБЫТИЯ ────────────────────────────── */

function setSound(on) {
  profile.sound = !!on;
  if ($('#optSound')) $('#optSound').checked = profile.sound;
  if ($('#gSound')) $('#gSound').checked = profile.sound;
  updateSoundIcon();
  saveProfile();
  if (profile.sound) sound.click();
  toast(profile.sound ? 'Звук включён' : 'Звук выключен');
}

function bindEvents() {
  $('#brandHome').addEventListener('click', () => { if (ui.st) leaveGame(); else showScreen('home'); });
  $('#profChip').addEventListener('click', () => openScreen('settings'));
  $('#btnSettings').addEventListener('click', () => openScreen('settings'));
  $('#homeSettings').addEventListener('click', () => openScreen('settings'));
  $('#btnHomeModes').addEventListener('click', () => openScreen('modes'));
  $('#btnHomeStats').addEventListener('click', () => openScreen('stats'));
  $('#settingsBack').addEventListener('click', backFromScreen);
  $('#modesBack').addEventListener('click', backFromScreen);
  $('#statsBack').addEventListener('click', backFromScreen);
  $('#btnPickMode').addEventListener('click', () => openScreen('modes'));
  $('#gameModes').addEventListener('click', () => { closeDrawer(); openScreen('modes'); });
  $('#gameSettings').addEventListener('click', () => { closeDrawer(); openScreen('settings'); });
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', () => { closeDrawer(); closePanel(); });
  $('#panelClose').addEventListener('click', closePanel);

  $('#nickInput').addEventListener('input', (e) => {
    profile.name = e.target.value.trim().slice(0, 18) || 'Игрок';
    $('#profName').textContent = profile.name;
    if ($('#homeName')) $('#homeName').textContent = profile.name;
    saveProfile();
  });

  $('#optFlip').addEventListener('change', (e) => {
    profile.flip = e.target.checked;
    $('#gFlip').checked = profile.flip;
    saveProfile();
  });
  $('#optAutoQueen').addEventListener('change', (e) => {
    profile.autoQueen = e.target.checked;
    $('#gAutoQueen').checked = profile.autoQueen;
    saveProfile();
  });
  $('#optSquare').addEventListener('change', (e) => {
    profile.square = e.target.checked;
    saveProfile();
  });
  $('#gFlip').addEventListener('change', (e) => {
    profile.flip = e.target.checked;
    $('#optFlip').checked = profile.flip;
    saveProfile();
  });
  $('#gAutoQueen').addEventListener('change', (e) => {
    profile.autoQueen = e.target.checked;
    $('#optAutoQueen').checked = profile.autoQueen;
    saveProfile();
  });

  $$('#sideSeg button').forEach((b) => b.addEventListener('click', () => {
    profile.side = b.dataset.side;
    $$('#sideSeg button').forEach((x) => x.classList.toggle('active', x === b));
    saveProfile();
  }));

  $('#btnPlayLocal').addEventListener('click', () => {
    ui.online = null;
    newGame({ mode: 'local', modeId: profile.modeId, timeMs: profile.timeMs, splash: true });
  });

  $('#btnCreate').addEventListener('click', () => createRoom());
  $('#btnCopyCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#roomCode').textContent); toast('Код скопирован'); }
    catch (error) { toast('Код: ' + $('#roomCode').textContent); }
  });
  $('#btnCancelRoom').addEventListener('click', () => {
    leaveOnline(true);
    $('#roomRow').classList.add('hidden');
    setLobby('Создание отменено');
    if (ui.st) leaveGame();
  });

  $('#btnJoin').addEventListener('click', () => joinRoom($('#joinCode').value.trim()));
  $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value.trim()); });

  $('#railHint').addEventListener('click', showHint);
  $('#railSettings').addEventListener('click', () => { closePanel(); toggleDrawer(); });
  $('#railInfo').addEventListener('click', () => { closeDrawer(); togglePanel(); });
  $('#railHome').addEventListener('click', leaveGame);
  $('#railSound').addEventListener('click', () => setSound(profile.sound === false));
  $('#railFlip').addEventListener('click', () => {
    ui.orientation = other(ui.orientation);
    renderAll(false);
    renderPlayers();
  });
  $('#optSound').addEventListener('change', (e) => setSound(e.target.checked));
  $('#gSound').addEventListener('change', (e) => setSound(e.target.checked));

  $('#navStart').addEventListener('click', () => gotoPly(0));
  $('#navPrev').addEventListener('click', () => gotoPly(ui.viewPly - 1));
  $('#navNext').addEventListener('click', () => gotoPly(ui.viewPly + 1));
  $('#navEnd').addEventListener('click', () => gotoPly(ui.frames.length - 1));

  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    sendChat(input.value.trim().slice(0, 200));
    input.value = '';
  });

  $('#btnCopyPgn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#pgnBox').value); toast('PGN скопирован'); }
    catch (error) { toast('Не удалось скопировать'); }
  });

  $('#btnResign').addEventListener('click', resign);
  $('#btnDraw').addEventListener('click', offerDraw);
  $('#btnAbort').addEventListener('click', abortGame);
  $('#btnNew').addEventListener('click', () => newGame({ mode: ui.mode || 'local', modeId: ui.st ? ui.st.modeId : profile.modeId, timeMs: ui.timeMs, splash: true }));
  $('#btnLeave').addEventListener('click', leaveGame);

  $('#resultAgain').addEventListener('click', () => {
    $('#result').classList.add('hidden');
    newGame({ mode: ui.mode || 'local', modeId: ui.st ? ui.st.modeId : profile.modeId, timeMs: ui.timeMs, splash: true });
  });
  $('#resultMenu').addEventListener('click', leaveGame);
  $('#resultClose').addEventListener('click', () => $('#result').classList.add('hidden'));

  $('#btnResetStats').addEventListener('click', () => {
    if (!window.confirm('Сбросить очки, статистику и историю партий?')) return;
    profile.points = 0;
    profile.stats = { ...DEFAULT_PROFILE.stats };
    profile.history = [];
    saveProfile(true);
    renderProfile();
    renderStats();
    toast('Статистика сброшена');
  });

  $('#squares').addEventListener('click', (e) => {
    const sq = e.target.closest('.sq');
    if (!sq) return;
    onSquareClick(Number(sq.dataset.sq));
  });

  document.addEventListener('keydown', (e) => {
    if (ui.screen !== 'game' || !ui.st) return;
    if (e.key === 'ArrowLeft') { gotoPly(ui.viewPly - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { gotoPly(ui.viewPly + 1); e.preventDefault(); }
    if (e.key === 'Home') { gotoPly(0); e.preventDefault(); }
    if (e.key === 'End') { gotoPly(ui.frames.length - 1); e.preventDefault(); }
    if (e.key === 'Escape') { ui.selected = -1; renderSquares(); renderHints(); }
  });

  window.addEventListener('resize', () => {
    updateScrim();
    if (!ui.st) return;
    renderBoard(false);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => { if (ui.st) renderBoard(false); }, 250));
}

/* ─────────────────────────────── 16. СТАРТ ────────────────────────────── */

function boot() {
  bindEvents();
  renderProfile();
  renderThemeRows();
  renderPieceRows();
  renderAvatarRow();
  renderTimeGroups();
  renderModeCard();
  $('#joinCode').value = '';
  showScreen('home');
  window.ChessApp = {
    engine: { createState, legalMoves, genPseudo, applyMove, undoMove, moveToSan, updateStatus, perft, toFen: null, findKing, sqName, positionKey, inCheck, attacked, materialOf, visSet, maybeBlock, centerCells, evaluateWhite, bestMove, MODES, modeById },
    ui, profile,
    newGame, commitMove, gotoPly, showScreen, myColor, scoreGame,
    setProfile: (patch) => { Object.assign(profile, patch); renderProfile(); renderThemeRows(); renderPieceRows(); renderPreview(); saveProfile(true); },
  };
}

document.addEventListener('DOMContentLoaded', boot);
