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
  language: null,
  onboarded: false,
  calm: false,
  theme: 'green',
  pieces: '1',
  flip: true,
  flipAll: false,
  tableFlip: true,
  epicFx: false,
  autoQueen: true,
  sound: true,
  side: 'w',
  modeId: 'classic',
  square: false,
  timeMs: 5 * 60 * 1000,
  timeLabel: '5 минут',
  publicRoom: false,
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
  // переход на оформление Chess.com: старым профилям ставим зелёную доску
  if ((merged.uiVersion || 1) < 2) {
    merged.theme = 'green';
    merged.uiVersion = 2;
  }
  // локальная игра на одном устройстве по умолчанию переворачивает доску
  if ((merged.uiVersion || 1) < 3) {
    merged.flip = true;
    merged.uiVersion = 3;
  }
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


/* ─────────────────────────── БОТ ────────────────────────────────────── */

const BOT_LABELS = { easy: 'Изи', medium: 'средний', hard: 'сложный', gm: 'Гроссмейстер', engine: 'Непростой для движка' };
const BOT_DELAY = { easy: 420, medium: 600, hard: 780, gm: 900, engine: 1100 };
const BOT_DEPTH = { medium: 2, hard: 4, gm: 4, engine: 5 };
const BOT_POINTS = {
  easy: { win: 1, loss: 0, draw: 0 },
  medium: { win: 4, loss: -3, draw: 0 },
  hard: { win: 5, loss: -3, draw: 0 },
  gm: { win: 8, loss: -2, draw: 0 },
  engine: { win: 12, loss: -1, draw: 0 },
};

const FAKE_NAMES = ['Alex_777', 'MashaChess', 'IvanPetrov', 'Nika_99', 'Danya', 'SashaGM',
  'Kostya', 'Lena_2009', 'MaxPower', 'Vlad_2010', 'Sonya', 'Timur', 'Egor', 'Poly'];

function renderFakeBots() {
  const box = $('#fakeBots');
  if (!box) return;
  const names = [...FAKE_NAMES].sort(() => Math.random() - 0.5).slice(0, 2);
  box.innerHTML = '<span class="fake-label">Или сыграйте с:</span>';
  for (const name of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fake-bot';
    b.textContent = name;
    b.title = 'Обычный игрок';
    b.addEventListener('click', () => startFakeGame(name));
    box.appendChild(b);
  }
}

function startFakeGame(name) {
  const simple = ['classic', 'chess960', 'threeChecks', 'center', 'radiusCheck', 'fischer'];
  const modeId = Math.random() < 0.3 ? simple[Math.floor(Math.random() * simple.length)] : 'classic';
  const levels = ['medium', 'hard', 'gm'];
  const level = levels[Math.floor(Math.random() * levels.length)];
  ui.online = null;
  sound.click();
  newGame({
    mode: 'local',
    modeId,
    timeMs: profile.timeMs,
    splash: true,
    bot: { level, color: other(profile.side), fake: true, name },
  });
}

function openBotModal() {
  const modal = $('#botModal');
  if (modal) modal.classList.remove('hidden');
}

function closeBotModal() {
  const modal = $('#botModal');
  if (modal) modal.classList.add('hidden');
}

function startBotGame(level) {
  if (!BOT_LABELS[level]) level = 'medium';
  closeBotModal();
  ui.online = null;
  sound.click();
  startGameWithMode({
    mode: 'local',
    timeMs: profile.timeMs,
    splash: true,
    bot: { level, color: other(profile.side) },
  });
}

function chooseBotMove(st, level) {
  const moves = legalMoves(st, st.turn);
  if (!moves.length) return null;
  if (level === 'easy') {
    if (Math.random() < 0.55) return moves[Math.floor(Math.random() * moves.length)];
    const caps = moves.filter((m) => m.capture != null || m.ep || (m.caps && m.caps.length));
    if (caps.length) return caps[Math.floor(Math.random() * caps.length)];
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const big = st.W * st.H > 64;
  const depth = big ? 2 : (BOT_DEPTH[level] || 2);
  let ranked = [];
  try { ranked = rankMoves(st, depth); } catch (error) { ranked = []; }
  if (!ranked.length) return moves[Math.floor(Math.random() * moves.length)];
  if (level === 'hard') return ranked[0].move;
  const top = ranked.slice(0, Math.min(3, ranked.length));
  return top[Math.floor(Math.random() * top.length)].move;
}

function maybeBotTurn() {
  if (ui.paused || ui.away) return;
  if (ui.brawl && ui.brawl.draft) return;
  if (!ui.bot || !ui.st || ui.st.status !== 'play' || ui.mode !== 'local') return;
  if (ui.st.turn !== ui.bot.color || ui.bot.busy) return;
  ui.bot.busy = true;
  ui.botThinking = true;
  renderStatus();
  const level = ui.bot.level;
  setTimeout(() => {
    ui.bot.busy = false;
    ui.botThinking = false;
    if (ui.paused || ui.away || !ui.st || ui.st.status !== 'play' || !ui.bot || ui.st.turn !== ui.bot.color) { renderStatus(); return; }
    const move = chooseBotMove(ui.st, level);
    if (move) commitMove(move, { bot: true });
    renderStatus();
  }, ui.bot.fake ? 3000 + Math.random() * 12000 : (BOT_DELAY[level] || 600));
}

/* ─────────────────────── ЭКСПОРТ И ИМПОРТ ───────────────────────────── */

function buildGameJson() {
  const st = ui.st;
  if (!st) return null;
  const names = ui.names || {};
  return {
    app: 'daymix-chess',
    version: 2,
    exportedAt: new Date().toISOString(),
    mode: { id: st.modeId, name: st.mode.name, W: st.W, H: st.H, square: !!st.square },
    time: { ms: ui.timeMs, label: ui.timeMs ? profile.timeLabel : 'без ограничений' },
    players: {
      w: names.w || { name: 'Белые', avatar: 'k' },
      b: names.b || { name: 'Чёрные', avatar: 'k' },
    },
    startedAt: ui.startedAt ? new Date(ui.startedAt).toISOString() : null,
    endedAt: st.status === 'over' ? new Date().toISOString() : null,
    result: st.result || null,
    bot: ui.bot ? { level: ui.bot.level } : null,
    moves: ui.moves.map((m, i) => ({
      n: i + 1,
      side: m.color,
      san: m.san,
      from: sqName(st, m.from),
      to: sqName(st, m.to),
      promo: m.promo || null,
      at: m.at ? new Date(m.at).toISOString() : null,
      ms: Math.round(m.spent || 0),
      clockSec: m.clock != null ? Math.round(m.clock / 1000) : null,
    })),
    pgn: buildPgnText(),
  };
}

function gameJsonText() {
  const data = buildGameJson();
  return data ? JSON.stringify(data, null, 2) : '';
}

function exportGameFile() {
  const text = gameJsonText();
  if (!text) { toast('Партия ещё не начата'); return; }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `daymix-chess-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('JSON сохранён');
}

async function copyGameJson() {
  const text = gameJsonText();
  if (!text) { toast('Партия ещё не начата'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('JSON партии в буфере');
  } catch (error) {
    toast('Не удалось скопировать');
  }
}

function openImport() {
  const modal = $('#importModal');
  if (!modal) return;
  $('#importText').value = '';
  modal.classList.remove('hidden');
  setTimeout(() => { const el = $('#importText'); if (el) el.focus(); }, 60);
}

function closeImport() {
  const modal = $('#importModal');
  if (modal) modal.classList.add('hidden');
}

function parseSquare(st, text) {
  if (!text || text.length < 2) return -1;
  const file = 'abcdefghijklmn'.indexOf(String(text)[0].toLowerCase());
  const rank = parseInt(String(text).slice(1), 10) - 1;
  if (file < 0 || !Number.isFinite(rank)) return -1;
  if (file >= st.W || rank < 0 || rank >= st.H) return -1;
  return rank * st.W + file;
}

function importGameText(raw) {
  let data = null;
  try { data = JSON.parse(String(raw)); } catch (error) { toast('Это не JSON'); return false; }
  if (!data || data.app !== 'daymix-chess') { toast('Это не партия Daymix’s Chess'); return false; }
  const mode = modeById(data.mode && data.mode.id);
  ui.online = null;
  ui.bot = null;
  ui.imported = true;
  ui.scored = true;
  ui.timeMs = Number(data.time && data.time.ms) || 0;
  ui.clocks = { w: ui.timeMs, b: ui.timeMs };
  ui.st = createState(mode.id, { square: !!(data.mode && data.mode.square) });
  ui.frames = [snap(ui.st)];
  ui.moves = [];
  ui.viewPly = 0;
  ui.lastMove = null;
  ui.chat = [];
  ui.selected = -1;
  ui.hint = null;
  ui.names = {
    w: (data.players && data.players.w) || { name: 'Белые', avatar: 'k' },
    b: (data.players && data.players.b) || { name: 'Чёрные', avatar: 'k' },
  };
  ui.startedAt = data.startedAt ? Date.parse(data.startedAt) : Date.now();
  const list = Array.isArray(data.moves) ? data.moves : [];
  for (const rec of list) {
    const legal = legalMoves(ui.st, ui.st.turn);
    const from = parseSquare(ui.st, rec.from);
    const to = parseSquare(ui.st, rec.to);
    const found = legal.find((x) => x.from === from && x.to === to && (x.promo || null) === (rec.promo || null));
    if (!found) break;
    const mover = ui.st.turn;
    const san = rec.san || moveToSan(ui.st, found, legal);
    applyMove(ui.st, found);
    ui.frames.push(snap(ui.st));
    ui.moves.push({
      san, from, to, color: mover,
      spent: Number(rec.ms) || 0,
      clock: rec.clockSec != null ? Number(rec.clockSec) * 1000 : null,
      at: rec.at ? Date.parse(rec.at) : 0,
      promo: found.promo || null,
    });
    ui.lastMove = { from, to };
  }
  ui.viewPly = ui.frames.length - 1;
  updateStatus(ui.st);
  if (data.result) {
    ui.st.result = data.result;
    ui.st.status = 'over';
  }
  closeImport();
  buildSquares();
  renderAll(false);
  renderMoves();
  renderPlayers();
  renderMeta();
  switchTab('moves');
  showScreen('game');
  updateNav();
  toast(`Партия импортирована: ${ui.moves.length} ходов`);
  return true;
}

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

const CAP_TIER = { p: 0, n: 2, b: 1, r: 3, q: 4, k: 5 };

const CURRENT_KEY = 'daymix-chess-current';
const INFERNAL_LINES = [
  'Инопланетный кипяточек!', 'Откисай!', 'Это халява! Это халява? Или нет?', 'Окей, халява!',
  'Ой, нет халявной пешечки...', 'Разминка гей!', 'Сдерживаем его!', 'Ну ладно, давай это съедим!',
  'Ешь, ешь! Главное чтобы переедание не случилось.', 'Давай-ка размен!', 'Ну нет, какой обмен? Пролетай!',
  'По теореме на сумме Гамбита!', 'Моя секретная ингушенция.', 'Теорема супер гамбита, давай, иди.',
  'Я не спешу, давай, ты понял как — разменяем!', 'Кого хочешь потерять? Правого или левого?',
  'Это было гениально!', 'Гамбит! Халявный гамбит!', 'Забери свою ферзюшку!', 'Теория инопланетного бычка!',
  'Спасибо, Лавр, очень интеллектуально!', 'Оооо, он догадался!', 'Заметит ли он?',
  'Подожди, это халява?', 'Меня не остановить?', 'Тактика кипяточка!', 'Халявная пешечка!',
  'А я просто вдавливаю вперёд!', 'Секретная тактика!', 'Отлетай!', 'Очень смело!',
];

const GRAY_STEPS = [0, 0.16, 0.32, 0.48, 0.62, 0.75];

function updateSameStreak(id, mover) {
  if (!id) return false;
  if (!ui.pieceStreak) ui.pieceStreak = { w: { id: null, n: 0 }, b: { id: null, n: 0 } };
  const slot = ui.pieceStreak[mover] || { id: null, n: 0 };
  if (slot.id === id) slot.n += 1;
  else { slot.id = id; slot.n = 1; }
  ui.pieceStreak[mover] = slot;
  const n = slot.n;
  const endgame = phaseFor(ui.st) === 'endgame';
  const online = ui.mode === 'online';
  const mine = online && mover === myColor();
  const shell = $('#gameShell');
  if (shell) {
    const level = mine && n >= 5 ? Math.min(5, n - 4) : 0;
    shell.style.setProperty('--gray', String(GRAY_STEPS[level]));
  }
  const ring = $('#repRing');
  if (ring) {
    const show = endgame && n >= 5 && (!online || mine);
    ring.classList.toggle('hidden', !show);
    ring.style.setProperty('--p', `${Math.min(360, ((n - 4) / 4) * 360)}deg`);
    const label = ring.querySelector('span');
    if (label) label.textContent = n >= 8 ? '8×' : `${Math.min(4, n - 4)}/4`;
  }
  return online && mine && endgame && n >= 8;
}

function fastRookWave(st, sq) {
  const board = $('#board');
  if (board) {
    board.classList.remove('shake-2');
    void board.offsetWidth;
    board.classList.add('shake-2');
    setTimeout(() => board.classList.remove('shake-2'), 420);
  }
  const layer = $('#hints');
  if (!layer) return;
  const { dx, dy } = disp(st, sq);
  const px = (dx + .5) * ui.sq;
  const py = (dy + .5) * ui.sq;
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('span');
    ring.className = 'wave-ring';
    ring.style.left = px + 'px';
    ring.style.top = py + 'px';
    ring.style.animationDelay = (i * 0.07).toFixed(2) + 's';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 750);
  }
}

function showExtremeDiff(sq) {
  const stage = $('#stage');
  const wrap = $('#boardWrap');
  if (!stage || !wrap || !ui.st) return;
  const br = wrap.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const badge = document.createElement('div');
  badge.className = 'extreme-diff';
  badge.textContent = 'EXTREME DIFF';
  badge.style.left = (br.left - sr.left + br.width / 2) + 'px';
  badge.style.top = (br.top - sr.top + br.height * 0.16) + 'px';
  stage.appendChild(badge);
  setTimeout(() => badge.remove(), 1700);

  /* Король лидера втягивает ауру частиц */
  let leader = 'w';
  try { leader = evaluateWhite(ui.st) >= 0 ? 'w' : 'b'; } catch (error) { leader = ui.st.turn; }
  const kSq = findKing(ui.st, leader);
  if (kSq < 0) return;
  const king = ui.pieceNodes.get(ui.st.board[kSq] && ui.st.board[kSq].id);
  if (king) {
    king.classList.add('king-absorbing');
    setTimeout(() => king.classList.remove('king-absorbing'), 1900);
  }
  const layer = $('#brawlLayer');
  const target = disp(ui.st, kSq);
  for (let i = 0; i < 18; i++) {
    const el = document.createElement('span');
    el.className = 'absorb-particle';
    const rx = Math.floor(Math.random() * ui.st.W);
    const ry = Math.floor(Math.random() * ui.st.H);
    const from = disp(ui.st, sqAt(ui.st, rx, ry));
    el.style.left = ((from.dx + .5) * ui.sq) + 'px';
    el.style.top = ((from.dy + .5) * ui.sq) + 'px';
    el.style.setProperty('--target-x', ((target.dx + .5) * ui.sq) + 'px');
    el.style.setProperty('--target-y', ((target.dy + .5) * ui.sq) + 'px');
    el.style.animationDelay = (Math.random() * .5) + 's';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}

function infernalJoke() {
  if (ui.moves.length - ui.lastJokeMove < 2) return;
  ui.lastJokeMove = ui.moves.length;
  const line = INFERNAL_LINES[Math.floor(Math.random() * INFERNAL_LINES.length)];
  toast(line, 2800);
  sound.check();
}

function saveCurrentGame() {
  try {
    if (!ui.st || ui.imported || ui.mode === 'online' || ui.st.status === 'over' || ui.anim || ui.st.flags.clashBrawl) {
      localStorage.removeItem(CURRENT_KEY);
      return;
    }
    const data = buildGameJson();
    data.timeMs = ui.timeMs;
    data.clocks = { w: ui.clocks.w, b: ui.clocks.b };
    data.orientation = ui.orientation;
    data.savedAt = Date.now();
    localStorage.setItem(CURRENT_KEY, JSON.stringify(data));
  } catch (error) { /* приватный режим */ }
}

function loadCurrentGame() {
  try {
    const data = JSON.parse(localStorage.getItem(CURRENT_KEY) || 'null');
    if (!data || !data.moves) return null;
    return data;
  } catch (error) { return null; }
}

function resumeSavedGame() {
  const data = loadCurrentGame();
  if (!data) { toast('Сохранённой партии нет'); return; }
  if (!importGameText(JSON.stringify(data))) return;
  ui.imported = false;
  ui.mode = 'local';
  ui.bot = null;
  ui.timeMs = data.timeMs || 0;
  if (data.clocks) ui.clocks = { w: data.clocks.w, b: data.clocks.b };
  if (data.orientation) ui.orientation = data.orientation;
  ui.st.status = 'play';
  ui.st.result = null;
  ui.scored = false;
  ui.pieceStreak = null;
  const grayShell = $('#gameShell');
  if (grayShell) grayShell.style.setProperty('--gray', '0');
  const ring = $('#repRing');
  if (ring) { ring.classList.add('hidden'); ring.style.setProperty('--p', '0deg'); }
  ui.viewPly = ui.frames.length - 1;
  ui.turnStart = performance.now();
  ui.running = !!ui.timeMs && ui.moves.length > 0;
  const shell = $('#gameShell');
  if (shell) shell.classList.remove('gray-1', 'gray-2', 'gray-3', 'flip-all');
  renderAll(false);
  renderPlayers();
  renderMoves();
  updateNav();
  showScreen('game');
  if (ui.moves.length) toast('Партия восстановлена');
  scheduleFirstMoveTimer();
}

function pickRaceMs(base) {
  let min = 60;
  let max = 90;
  if (base > 180000) { min = 90; max = 120; }
  if (base > 600000) { min = 120; max = 180; }
  const sec = Math.round((min + Math.random() * (max - min)) / 5) * 5;
  return sec * 1000;
}

function stopRaceClock() {
  if (ui.race && ui.race.timer) clearInterval(ui.race.timer);
}

function updateRaceDisplay() {
  if (!ui.race) return;
  const total = Math.max(0, Math.ceil(ui.race.remaining / 1000));
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  const text = `⏱ ${mm}:${ss}`;
  const top = $('#topClock');
  const bottom = $('#bottomClock');
  if (top) top.textContent = text;
  if (bottom) bottom.textContent = text;
}

function endRace() {
  const st = ui.st;
  if (!st || st.status !== 'play') return;
  const w = st.caps ? st.caps.w : 0;
  const b = st.caps ? st.caps.b : 0;
  const result = { winner: w === b ? null : (w > b ? 'w' : 'b'), reason: 'race' };
  st.status = 'over';
  st.result = result;
  renderAll(false);
  finishGame(result);
  if (ui.mode === 'online' && ui.role === 'host') {
    netPublish({ t: 'end', winner: result.winner, reason: 'race' });
  }
  toast(`Время вышло: ${w} : ${b}`);
}

function startRaceClock() {
  if (ui.spectator) return;
  if (!ui.race || !ui.st || ui.st.status !== 'play') return;
  stopRaceClock();
  ui.race.last = performance.now();
  ui.race.timer = setInterval(() => {
    if (!ui.race || !ui.st || ui.st.status !== 'play') return;
    const now = performance.now();
    if (ui.paused || ui.away || ui.gameLocked) { ui.race.last = now; return; }
    ui.race.remaining = Math.max(0, ui.race.remaining - (now - ui.race.last));
    ui.race.last = now;
    updateRaceDisplay();
    if (ui.race.remaining <= 0) {
      stopRaceClock();
      endRace();
    }
  }, 200);
  updateRaceDisplay();
  renderStatus();
}

function scheduleFirstMoveTimer() {
  clearTimeout(ui.firstMoveTimer);
  ui.firstMoveTimer = 0;
  if (!ui.st || ui.st.status !== 'play' || ui.moves.length || ui.st.turn !== 'w') return;
  if (ui.mode !== 'local') return;
  if (ui.st.flags.captureRace || ui.st.flags.clashBrawl) return;
  if (ui.bot && ui.bot.color === 'w') return;
  ui.firstMoveTimer = setTimeout(() => {
    if (!ui.st || ui.st.status !== 'play' || ui.moves.length || ui.st.turn !== 'w') return;
    const res = { winner: null, reason: 'idle' };
    ui.st.status = 'over';
    ui.st.result = res;
    renderAll(false);
    finishGame(res);
    toast('Белые не сделали первый ход — ничья без очков');
  }, 15000);
}

function radiusDist(st, i) {
  if (!st.flags.radiusCheck) return 99;
  const x = fileOf(st, i);
  const y = rankOf(st, i);
  let best = 99;
  for (const color of ['w', 'b']) {
    const k = findKing(st, color);
    if (k < 0) continue;
    const d = Math.max(Math.abs(fileOf(st, k) - x), Math.abs(rankOf(st, k) - y));
    best = Math.min(best, d);
  }
  return best;
}

function radiusEdge(st, i) {
  const x = fileOf(st, i);
  const y = rankOf(st, i);
  for (const [dx, dy] of KING_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inside(st, nx, ny)) return true;
    if (radiusDist(st, sqAt(st, nx, ny)) > 3) return true;
  }
  return false;
}

function queenDrama(item) {
  if (profile.calm) return;
  const box = $('#queenDrama');
  if (!box) return;
  box.classList.remove('hidden');
  box.classList.remove('run');
  const bolts = $('#dramaBolts');
  const halves = $('#dramaHalves');
  bolts.innerHTML = '';
  halves.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 300');
    svg.setAttribute('class', 'drama-bolt');
    const x = 8 + Math.random() * 70;
    const pts = [];
    let cx = x;
    for (let y = -20; y <= 300; y += 40) {
      cx += (Math.random() - .5) * 26;
      pts.push(`${cx.toFixed(0)},${y}`);
    }
    svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#c78bff" stroke-width="${2 + Math.random() * 3}" stroke-linecap="round"/>`;
    svg.style.left = (Math.random() * 92) + 'vw';
    svg.style.top = (Math.random() * 30 - 20) + 'vh';
    svg.style.animationDelay = (0.32 + Math.random() * 0.5).toFixed(2) + 's';
    bolts.appendChild(svg);
  }
  const color = item && item.color === 'w' ? 'w' : 'b';
  for (const part of ['top', 'bottom']) {
    const half = document.createElement('div');
    half.className = 'drama-half ' + part + ' ' + color;
    half.innerHTML = pieceSvg('q', 'drama-piece');
    half.style.setProperty('--dx', (part === 'top' ? -70 : 70) + 'px');
    half.style.setProperty('--dy', (part === 'top' ? -90 : 120) + 'px');
    half.style.setProperty('--rot', (part === 'top' ? -28 : 34) + 'deg');
    halves.appendChild(half);
  }
  void box.offsetWidth;
  box.classList.add('run');
  ui.gameLocked = true;
  const wrap = $('#boardWrap');
  clearTimeout(queenDrama.timer);
  queenDrama.timer = setTimeout(() => {
    box.classList.add('hidden');
    box.classList.remove('run');
    bolts.innerHTML = '';
    halves.innerHTML = '';
    if (wrap) wrap.classList.remove('drama-zoom');
    if (ui.st && ui.st.status === 'play' && !ui.paused) ui.gameLocked = false;
  }, 1500);
}

function explosionFx(st, center) {
  const layer = $('#hints');
  if (!layer || !st) return;
  const sq = ui.sq;
  const { dx, dy } = disp(st, center);
  const cx = (dx + .5) * sq;
  const cy = (dy + .5) * sq;
  const boom = document.createElement('div');
  boom.className = 'boom';
  boom.style.left = cx + 'px';
  boom.style.top = cy + 'px';
  const ring = document.createElement('span');
  ring.className = 'boom-ring';
  ring.style.width = sq * .8 + 'px';
  ring.style.height = sq * .8 + 'px';
  boom.appendChild(ring);
  const sparkCount = profile.epicFx ? 26 : 14;
  for (let i = 0; i < sparkCount; i++) {
    const spark = document.createElement('i');
    spark.className = 'boom-spark';
    const a = Math.random() * Math.PI * 2;
    const dist = sq * (0.4 + Math.random() * 1.1);
    spark.style.setProperty('--dx', (Math.cos(a) * dist).toFixed(0) + 'px');
    spark.style.setProperty('--dy', (Math.sin(a) * dist).toFixed(0) + 'px');
    spark.style.background = Math.random() < .5 ? '#ffd27a' : '#ff7a3a';
    boom.appendChild(spark);
  }
  layer.appendChild(boom);
  setTimeout(() => boom.remove(), 900);
}

function softBurst(st, sq) {
  const layer = $('#hints');
  if (!layer || !st) return;
  const { dx, dy } = disp(st, sq);
  const size = ui.sq;
  const cx = (dx + .5) * size;
  const cy = (dy + .5) * size;
  const box = document.createElement('div');
  box.className = 'boom soft';
  box.style.left = cx + 'px';
  box.style.top = cy + 'px';
  for (let i = 0; i < 6; i++) {
    const spark = document.createElement('i');
    spark.className = 'boom-spark';
    spark.style.setProperty('--ang', (i * 60 + Math.random() * 20) + 'deg');
    spark.style.setProperty('--dist', (size * (0.35 + Math.random() * 0.3)) + 'px');
    box.appendChild(spark);
  }
  layer.appendChild(box);
  setTimeout(() => box.remove(), 520);
}

function captureFx(list) {
  if (profile.calm) return;
  if (!list || !list.length || !ui.st) return;
  const st = ui.st;
  const sq = ui.sq;
  const layer = $('#hints');
  let topTier = 0;
  for (const item of list) {
    const tier = CAP_TIER[item.type] || 0;
    topTier = Math.max(topTier, tier);
    if (!layer || tier === 4 || tier === 0) continue;
    const { dx, dy } = disp(st, item.square);
    const ghost = document.createElement('div');
    ghost.className = 'cap-ghost ' + (item.color === 'w' ? 'w' : 'b');
    ghost.style.width = sq + 'px';
    ghost.style.height = sq + 'px';
    ghost.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    ghost.style.setProperty('--fall', Math.round(18 + tier * 22) + '%');
    ghost.style.setProperty('--rot', Math.round((Math.random() < .5 ? -1 : 1) * (40 + tier * 55)) + 'deg');
    ghost.style.setProperty('--dur', (0.3 + tier * 0.11).toFixed(2) + 's');
    ghost.innerHTML = pieceSvg(item.type, 'cap-ghost-pc');
    layer.appendChild(ghost);
    setTimeout(() => ghost.remove(), 1400);
  }

  if (topTier === 4) {
    const queen = list.find((x) => x.type === 'q') || list[0];
    queenDrama(queen);
  }

  const board = $('#board');
  const shell = $('#gameShell');
  const flash = $('#fxFlash');
  if (topTier <= 1) {
    for (const el of document.querySelectorAll('.cap-ghost')) el.classList.add('soft');
    return;
  }
  if (board) {
    for (let i = 1; i <= 5; i++) board.classList.remove('shake-' + i);
    void board.offsetWidth;
    board.classList.add('shake-' + topTier);
    clearTimeout(captureFx.shakeTimer);
    captureFx.shakeTimer = setTimeout(() => {
      for (let i = 1; i <= 5; i++) board.classList.remove('shake-' + i);
    }, 900);
  }
  if (topTier >= 4 && shell) {
    shell.classList.remove('quake-4');
    void shell.offsetWidth;
    shell.classList.add('quake-4');
    clearTimeout(captureFx.quakeTimer);
    captureFx.quakeTimer = setTimeout(() => shell.classList.remove('quake-4'), 700);
  }
  if (flash) {
    if (topTier < 2 || topTier >= 4) {
      flash.className = 'fx-flash';
    } else {
      flash.className = 'fx-flash';
      void flash.offsetWidth;
      flash.classList.add('flash-' + topTier);
      clearTimeout(captureFx.flashTimer);
      captureFx.flashTimer = setTimeout(() => { flash.className = 'fx-flash'; }, topTier === 4 ? 1100 : 600);
    }
  }
}

function playResultFx(kind) {
  const result = $('#result');
  const box = $('#resultSprites');
  if (!result || !box) return;
  result.classList.remove('win', 'lose', 'draw');
  result.classList.add(kind);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.innerHTML = '';
  if (reduced) return;
  const types = ['q', 'r', 'b', 'n', 'p', 'k'];
  const count = kind === 'win' ? 18 : kind === 'lose' ? 13 : 10;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'res-flier ' + kind;
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 48;
    el.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'vmin');
    el.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'vmin');
    el.style.setProperty('--rot', Math.round(-540 + Math.random() * 1080) + 'deg');
    el.style.setProperty('--s', Math.round(20 + Math.random() * 44) + 'px');
    el.style.setProperty('--dur', (1.2 + Math.random() * 0.9).toFixed(2) + 's');
    el.style.setProperty('--delay', (Math.random() * 0.3).toFixed(2) + 's');
    el.innerHTML = pieceSvg(types[i % types.length], 'res-flier-pc');
    box.appendChild(el);
  }
  clearTimeout(playResultFx.timer);
  playResultFx.timer = setTimeout(() => { box.innerHTML = ''; }, 3200);
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

const TIME_EN = {
  30000: '30 seconds', 60000: '1 minute', 180000: '3 minutes',
  300000: '5 minutes', 600000: '10 minutes', 1200000: '20 minutes',
  1800000: '30 minutes', 2700000: '45 minutes', 3600000: '60 minutes', 21600000: '6 hours',
};
const TIME_GROUPS_EN = {
  blitz: ['Blitz', 'up to 3 minutes'],
  rapid: ['Rapid', '5 to 30 minutes'],
  long: ['Long', '45 and 60 minutes'],
  free: ['Unlimited', 'six hours per game'],
};

function timeText(ms, fallback) {
  if (profile.language === 'en') return TIME_EN[ms] || 'no limit';
  return fallback || 'без ограничений';
}

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
const MODE_SHORT = {
  classic: 'Классика', threeChecks: 'Три шаха', kingCapture: 'Съедение', kingOnly: 'Король',
  pawnRows: '2 ряда', kqp: 'K, Q, пешки', explode: 'Взрывы', queenPierce: 'Ферзь ✳',
  bishopKing: 'Слон-К', race: 'Гонка', wide10: '10×8', tall10: '8×10',
  jester: 'Шут', boy: 'Пацаны', crossCastle: 'Обмены', fog: 'Туман',
  fischer: '960', blocks: 'Блоки', queens: 'Ферзи', bishops: 'Слоны',
  knights: 'Кони', rooks: 'Ладьи', pawnField: 'Пешки', pawnFieldQ: 'Пешки+Q',
  noPawns: 'Без пешек', center: 'Центр',
  touchMove: 'Взялся', openIntent: 'Намерения',
  random: 'Рандом', chess960: '960', swapReplace: 'Замена', vanishEdge: 'Бездна',
  pawnRush: 'Ракеты', backCapture: 'Хищник', convert20: 'Перебежчик',
  radiusCheck: 'Радиус', horde: 'Орда', antichess: 'Антишахматы',
  noQueen7: 'Семёрка', swapRows: 'Пешки', blackFirst: 'Чёрные', inverted: 'Вверх',
  losAlamos: '6×6', berolina: 'Беролина', checkless: 'Без шахов', raceKings: 'Гонки', andernach: 'Андернах',
  pawnBack: 'Назад', kingKnight: 'Король-конь', queenLose: 'Ферзь', weakKnights: 'Кони',
  castleReturn: 'Рокировка', square10: '10×10', square12: '12×12', infernal: 'Инферно', clashBrawl: 'Brawl', royalBattle: 'Битва', zombie: 'Зомби', strategy: 'Стратегия',
};

const MODE_EN = {
  classic: ['Classic', "Standard 8×8 chess: castling, en passant, promotion, mate, stalemate and the 50-move rule."],
  threeChecks: ['Three-check', "No mate needed: give three checks to win."],
  kingCapture: ['King capture', "The king may move into danger. Lose your king and you lose."],
  kingOnly: ['Lone king', "As soon as you have only your king left, you lose."],
  pawnRows: ['Double pawn rows', "Two full rows of pawns for each side."],
  kqp: ['King, queen & pawns', "Only kings, queens and eight pawns each."],
  explode: ['Explosions', "Every capture explodes the four orthogonal neighbours. Kings survive."],
  queenPierce: ['Piercing queen', "The queen sweeps enemy pieces along her line, through friends and foes."],
  bishopKing: ['Bishop-king', "A bishop may step like a king up to four times per game."],
  race: ['King race', "Kings in the corners, pawns on both sides. First king to the far rank wins."],
  wide10: ['Wide 10×8', "Ten files, eight ranks and extra rooks."],
  tall10: ['Tall 8×10', "Eight files and ten ranks for more vertical play."],
  jester: ['Jester 12×10', "A 12×10 board with the Jester: jumps two or three squares forward, five times per game."],
  boy: ['Boys 14×10', "A huge 14×10 board with Jesters and Boys that slide and break through."],
  crossCastle: ['Cross castling', "Swap the king with any friendly piece up to three times."],
  fog: ['Fog of war', "Enemy pieces are visible only next to yours."],
  fischer: ['Fischer', "Random back rank with bishops on opposite colours and the king between rooks."],
  blocks: ['Random blocks', "Every third move may lock a random empty square."],
  queens: ['Queens only', "Three queens and a king each. Every line is deadly."],
  bishops: ['Bishops only', "Four bishops on opposite colours each."],
  knights: ['Knights only', "Four knights and a king each — pure jumping."],
  rooks: ['Rooks only', "Four rooks and a king each; castling opens once lines clear."],
  pawnField: ['Pawn field', "The board is packed with four full rows of pawns per side."],
  pawnFieldQ: ['Pawn field + queen', "The same pawn sea, plus one queen each."],
  noPawns: ['No pawns', "Full armies without a single pawn — open lines from move one."],
  center: ['Center', "Get your king to d4, e4, d5 or e5 to win. Mate also wins."],
  touchMove: ['Touch-move', "Touch a piece with moves and you must move it — no take-backs."],
  openIntent: ['Open intentions', "Your opponent sees the square you press before moving. Bluff or read them."],
  random: ['Random', "A random mode from all the others every time."],
  chess960: ['Chess960', "True Fischer Random: 960 positions with proper castling."],
  swapReplace: ['Swap pieces', "Before the game 1–3 non-king pieces per side are replaced."],
  vanishEdge: ['Edge of the void', "A pawn reaching the last rank vanishes instead of promoting."],
  pawnRush: ['Pawn rockets', "Pawns may always advance 1, 2 or 3 squares when the path is clear."],
  backCapture: ['Pawn hunter', "Pawns capture backwards diagonally but still cannot move backwards."],
  convert20: ['Defector', "A captured piece has a 20% chance to join your side on a random empty square."],
  radiusCheck: ['Storm radius', "Any enemy within three squares of your king gives check. The zone is outlined."],
  horde: ['Horde', "White has a king and three pawn rows against a full black army."],
  antichess: ['Antichess', "Lose all your pieces to win. Captures are forced and the king can be taken."],
  noQueen7: ['Seven', "A 7×8 board without queens; kings in the centre."],
  swapRows: ['Pawns first', "Ranks are swapped: pieces on the second rank, pawns on the first."],
  blackFirst: ['Black first', "Black moves first. Everything else is classic."],
  inverted: ['Upside down', "You play normally, but White starts at the top and Black at the bottom."],
  pawnBack: ['Pawns back', "Pawns may always move backwards too, but not onto the last rank."],
  kingKnight: ['King-knight', "The king moves like a knight plus one square forward."],
  queenLose: ['Queen under guard', "Lose your queen and you lose the game."],
  weakKnights: ['Weak knights', "Knights only use the long part of the L — half their jumps are gone."],
  castleReturn: ['Castling returns', "If the king returns home, castling rights are restored."],
  square10: ['Square 10×10', "A big 10×10 square board with room to manoeuvre."],
  square12: ['Square 12×12', "A huge 12×12 board for true strategists."],
  devourAll: ['Devour all', "The king may be eaten — that is not a win. Eat every enemy piece to win."],
  captureRace: ['Capture race', "Kings may be eaten; the winner is whoever captures more in 60–180 seconds."],
  losAlamos: ['Los Alamos', "A 6×6 board without bishops — fast chess invented at Los Alamos."],
  berolina: ['Berolina', "Pawns move diagonally forward and capture straight ahead."],
  checkless: ['Checkless', "Giving check is illegal. Only quiet moves, defences and captures."],
  raceKings: ['Racing kings', "No pawns and no checks: race your king to the far rank."],
  andernach: ['Andernach', "A capturing piece changes colour. Every capture is a small betrayal."],
  clashBrawl: ['Clash Brawl', "A mobile-game parody: 50 HP kings, purple elixir, a 4-card deck, shields and knockback."],
  infernal: ['Infernal', "Everything is red, and big moves trigger gambit theorems and meme lines."],
};

const THEMES = [
  { id: 'brown', name: 'Коричневая', light: '#f0d9b5', dark: '#9a6a47' },
  { id: 'green', name: 'Зелёная', light: '#eeeed2', dark: '#769656' },
  { id: 'mono', name: 'Чёрно-белая', light: '#ffffff', dark: '#3d4146' },
  { id: 'blue', name: 'Бело-синяя', light: '#eef4fb', dark: '#4a7fb5' },
  { id: 'x01', name: 'Океан', light: '#dde5ee', dark: '#4d7fa3' },
  { id: 'x02', name: 'Лазурь', light: '#dde2ee', dark: '#4d71a3' },
  { id: 'x03', name: 'Мятная', light: '#ddeeec', dark: '#4da38d' },
  { id: 'x04', name: 'Изумруд', light: '#ddeee9', dark: '#4da37f' },
  { id: 'x05', name: 'Лайм', light: '#e5eedd', dark: '#7fa34d' },
  { id: 'x06', name: 'Олива', light: '#e7eedd', dark: '#8da34d' },
  { id: 'x07', name: 'Песок', light: '#eeecdd', dark: '#a38d4d' },
  { id: 'x08', name: 'Карамель', light: '#eee9dd', dark: '#a37f4d' },
  { id: 'x09', name: 'Терракота', light: '#eee4dd', dark: '#a3624d' },
  { id: 'x10', name: 'Ржавчина', light: '#eee2dd', dark: '#a35b4d' },
  { id: 'x11', name: 'Вишня', light: '#eeddde', dark: '#a34d5b' },
  { id: 'x12', name: 'Малина', light: '#eedde1', dark: '#a34d69' },
  { id: 'x13', name: 'Роза', light: '#eedde5', dark: '#a34d7f' },
  { id: 'x14', name: 'Сирень', light: '#ecddee', dark: '#8d4da3' },
  { id: 'x15', name: 'Лаванда', light: '#e8ddee', dark: '#784da3' },
  { id: 'x16', name: 'Фиалка', light: '#e4ddee', dark: '#624da3' },
  { id: 'x17', name: 'Индиго', light: '#e0ddee', dark: '#4d4da3' },
  { id: 'x18', name: 'Сапфир', light: '#dde1ee', dark: '#4d69a3' },
  { id: 'x19', name: 'Сталь', light: '#dde6ee', dark: '#4d86a3' },
  { id: 'x20', name: 'Туман', light: '#ddebee', dark: '#4da3a3' },
  { id: 'x21', name: 'Графит', light: '#eee0dd', dark: '#a34d4d' },
  { id: 'x22', name: 'Уголь', light: '#eee0dd', dark: '#a34d4d' },
  { id: 'x23', name: 'Ночная', light: '#dddeee', dark: '#4d5ba3' },
  { id: 'x24', name: 'Космос', light: '#e5ddee', dark: '#694da3' },
  { id: 'x25', name: 'Марс', light: '#eee5dd', dark: '#a3694d' },
  { id: 'x26', name: 'Медь', light: '#eee6dd', dark: '#a3714d' },
  { id: 'x27', name: 'Золото', light: '#eeebdd', dark: '#a3894d' },
  { id: 'x28', name: 'Мёд', light: '#eeeddd', dark: '#a3954d' },
  { id: 'x29', name: 'Крем', light: '#eeeadd', dark: '#a3834d' },
  { id: 'x30', name: 'Бумага', light: '#eeecdd', dark: '#a38d4d' },
  { id: 'x31', name: 'Неон', light: '#eeddeb', dark: '#a34da3' },
  { id: 'x32', name: 'Кибер', light: '#dde9ee', dark: '#4d95a3' },
  { id: 'x33', name: 'Матрица', light: '#ddeee0', dark: '#4da34d' },
  { id: 'x34', name: 'Арктика', light: '#dde7ee', dark: '#4d8da3' },
  { id: 'x35', name: 'Лёд', light: '#ddeaee', dark: '#4d9ca3' },
  { id: 'x36', name: 'Море', light: '#dde3ee', dark: '#4d78a3' },
  { id: 'x37', name: 'Бирюза', light: '#ddedee', dark: '#4da39c' },
  { id: 'x38', name: 'Хвоя', light: '#ddeee5', dark: '#4da369' },
  { id: 'x39', name: 'Мох', light: '#e2eedd', dark: '#71a34d' },
  { id: 'x40', name: 'Какао', light: '#eee8dd', dark: '#a3784d' },
  { id: 'metal', name: 'Металл', light: '#dde2e8', dark: '#8b959f' },
];

const PIECE_SKINS = [
  { id: '1', name: 'Классика', w: '#ffffff', we: '#1f1f1f', wd: '#404040', b: '#312e2b', be: '#0d0d0d', bd: '#5a5652', sw: 2.2 },
  { id: '2', name: 'Жирные', w: '#fdfbf6', we: '#b9ab90', wd: '#a89a80', b: '#23262c', be: '#0d0f12', bd: '#343a43', sw: 4.2 },
  { id: '3', name: 'Контур', w: '#2a241d', we: '#2a241d', wd: '#2a241d', b: '#1d2026', be: '#1d2026', bd: '#1d2026', sw: 1.9, hollow: true },
  { id: '4', name: 'Металл', w: '#e8edf2', we: '#4a4640', wd: '#7d786f', b: '#3a4048', be: '#e9edf2', bd: '#d7dbe0', sw: 1.9, metal: true },
  { id: '5', name: 'Нео', w: '#fffdf7', we: '#b9a88c', wd: '#a29073', b: '#23262c', be: '#22262c', bd: '#454c56', sw: 3.4, glow: '#d9a56666' },
];

/* Палитры для сорока дополнительных наборов: тело/контур/детали белых и чёрных. */
const SKIN_PALETTES = [
  ['Слоновая кость', '#fdfaf0', '#d9cdb6', '#c4b79e', '#2a2d33', '#101216', '#3a4049'],
  ['Мрамор', '#f7f7f4', '#cfd2d4', '#b9bdc0', '#2c3036', '#14171b', '#3e444c'],
  ['Янтарь', '#ffe7b0', '#c9973f', '#a87a2c', '#3a2a12', '#241708', '#5a4322'],
  ['Изумруд', '#eafbf1', '#b7dcc4', '#9bc7aa', '#1e3a2a', '#0e2016', '#2f5a41'],
  ['Сапфир', '#eef5ff', '#b9cbe8', '#9db3d6', '#1d2b44', '#0d1728', '#31456a'],
  ['Рубин', '#fff0f0', '#e8b9b9', '#d69d9d', '#3a1d22', '#220f12', '#5c3038'],
  ['Аметист', '#f7f0ff', '#d3bfe8', '#bda4d9', '#2c1f3a', '#190f22', '#4a3660'],
  ['Джейд', '#effaf6', '#bde3d6', '#a0cfbf', '#1e3a34', '#0e201c', '#315a50'],
  ['Медь', '#ffe9d6', '#d9a06b', '#bd8350', '#3a2418', '#22140c', '#5c3c28'],
  ['Бронза', '#f4e3c8', '#c19a5f', '#a37f47', '#332716', '#1d150b', '#53432a'],
  ['Золото', '#fff3c9', '#e0b64a', '#c29a32', '#3a2c0e', '#221a06', '#5c4a1e'],
  ['Серебро', '#f7f9fb', '#c8ced6', '#aeb6c0', '#2c3138', '#151a20', '#3e4652'],
  ['Неон', '#f2ffff', '#7fe8ff', '#5cc9e6', '#26103a', '#12061f', '#4a2a6a', { sw: 2.6, glow: '#54e6ff88' }],
  ['Лёд', '#eef9ff', '#a9d6ef', '#8cc2e0', '#1d3346', '#0c1a26', '#2f5069'],
  ['Лава', '#fff0e0', '#f0a35e', '#d4803a', '#3a1a10', '#220d05', '#5c3220', { sw: 3, glow: '#ff7a3a55' }],
  ['Лес', '#eef7e6', '#b6d19a', '#9bbb7c', '#22331a', '#111d0c', '#3a5230'],
  ['Закат', '#fff0e6', '#e8b48f', '#d29a6f', '#3a2418', '#22130a', '#5c3a28'],
  ['Небо', '#eef6ff', '#b3d1ee', '#97bce0', '#20364a', '#0f1e2a', '#33526b'],
  ['Пергамент', '#f8efd9', '#d6c49c', '#c0ab7f', '#3a3020', '#221b0e', '#5c4c30'],
  ['Графит', '#eceef1', '#b9bec6', '#9ea4ad', '#23262b', '#0c0e11', '#3a3f47'],
  ['Молоко', '#fffdf9', '#e6ded0', '#d6cbb9', '#3a3630', '#221f1a', '#5c574e'],
  ['Карамель', '#fff2dd', '#e0b07a', '#c89456', '#3a2814', '#22160a', '#5c4326'],
  ['Хаки', '#f2efdd', '#c9c39a', '#b0a97e', '#33301f', '#1d1b0e', '#53502f'],
  ['Вишня', '#ffeef0', '#e8b0b8', '#d6959f', '#3a1a20', '#220c10', '#5c3038'],
  ['Океан', '#e9f7fb', '#a9d4e0', '#8cbccb', '#1a3340', '#0b1a22', '#2a4f5f'],
  ['Пепел', '#f2f2f0', '#c9c9c4', '#b0b0aa', '#2c2c2a', '#141414', '#444440'],
  ['Роза', '#fff0f5', '#e8b9cc', '#d69db4', '#3a1f2a', '#220f18', '#5c3644'],
  ['Лайм', '#f5ffe9', '#c9e89e', '#b0d17f', '#2a3318', '#161d0a', '#46522a'],
  ['Кобальт', '#eaf0ff', '#a9bff0', '#8ca5db', '#1a2a4a', '#0b1428', '#2f4470'],
  ['Терракота', '#fbeee6', '#dba98c', '#c29070', '#3a2418', '#22120a', '#5c3c28'],
];

/* Десять наборов-эффектов. */
const SKIN_EFFECTS = [
  ['Тонкий контур', '#fbf9f4', '#b7ab93', '#a2927a', '#26292f', '#0f1115', '#353b44', { sw: 1.2 }],
  ['Жирный контур', '#fdfbf6', '#a99a7e', '#97866a', '#202329', '#08090b', '#2e343c', { sw: 5.2 }],
  ['Свечение', '#fffdf5', '#d9b273', '#c39a58', '#2a2d33', '#0f1115', '#4a4433', { sw: 2.6, glow: '#f2c14e99' }],
  ['Тень', '#f6f4ef', '#b8afa0', '#a39784', '#24272c', '#0b0d10', '#343a43', { sw: 2.6, shadow: true }],
  ['Бумажный', '#fdf9ef', '#3a352c', '#3a352c', '#3a352c', '#3a352c', '#3a352c', { hollow: true, sw: 1.6 }],
  ['Чертёж', '#eef4ff', '#2b4a7a', '#2b4a7a', '#2b4a7a', '#2b4a7a', '#2b4a7a', { hollow: true, sw: 1.4 }],
  ['Призрак', '#ffffff', '#b9b3a8', '#a49c8e', '#2a2d33', '#101216', '#3a4049', { sw: 2.2, opacity: 0.62 }],
  ['Контраст', '#ffffff', '#000000', '#000000', '#000000', '#ffffff', '#ffffff', { sw: 3 }],
  ['Матовый', '#efece4', '#b3ad9f', '#9f9888', '#2b2d31', '#121417', '#3c4148', { sw: 3 }],
  ['Глянец', '#fffdfa', '#cbbfa6', '#b5a789', '#22252a', '#0d0f13', '#3d434c', { sw: 2.4, glow: '#ffffff55' }],
];

for (const [name, w, we, wd, b, be, bd, extra] of SKIN_PALETTES) {
  PIECE_SKINS.push({ id: String(PIECE_SKINS.length + 1), name, w, we, wd, b, be, bd, sw: 2.2, ...(extra || {}) });
}
for (const [name, w, we, wd, b, be, bd, extra] of SKIN_EFFECTS) {
  PIECE_SKINS.push({ id: String(PIECE_SKINS.length + 1), name, w, we, wd, b, be, bd, ...extra });
}

const PIECE_SETS = PIECE_SKINS;
const QUICK_SKINS = 5;
const skinById = (id) => PIECE_SKINS.find((s) => s.id === String(id)) || PIECE_SKINS[0];

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
  bot: null,
  botThinking: false,
  paused: false,
  movedId: null,
  gameLocked: false,
  remoteSelected: -1,
  rotated: false,
  tableRotated: false,
  themesExpanded: false,
  suppressClick: false,
  away: false,
  confirmAction: null,
  sameStreak: 0,
  lastPieceId: null,
  firstMoveTimer: 0,
  lastJokeMove: -10,
  imported: false,
  names: null,
  startedAt: 0,
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
  if ($('#nickInput')) $('#nickInput').value = profile.name;
  if ($('#sbName')) $('#sbName').textContent = profile.name;
  if ($('#sbPoints')) $('#sbPoints').textContent = `${profile.points} очков`;
  if ($('#sbAvatar')) $('#sbAvatar').innerHTML = pieceSvg(profile.avatar, 'av-pc');
  if ($('#homeAvatar')) $('#homeAvatar').innerHTML = pieceSvg(profile.avatar, 'av-pc');
  if ($('#homeName')) $('#homeName').textContent = profile.name;
  if ($('#homeNickInput') && document.activeElement !== $('#homeNickInput')) $('#homeNickInput').value = profile.name;
  if ($('#homePoints')) $('#homePoints').textContent = `${profile.points} очков`;
  if ($('#resumeBtn')) $('#resumeBtn').classList.toggle('hidden', !loadCurrentGame());
  renderFakeBots();
  renderQuickSide();
  renderProfilePop();
  updateOnlineModeLine();
  const rejoin = $('#rejoinRow');
  if (rejoin) {
    const last = profile.lastRoom;
    const fresh = last && Date.now() - last.ts < 15 * 1000 && !ui.online;
    rejoin.classList.toggle('hidden', !fresh);
    if (fresh && $('#rejoinBtn')) $('#rejoinBtn').textContent = `↩ Вернуться в комнату ${last.code}`;
  }
  document.documentElement.dataset.theme = profile.theme;
  document.documentElement.dataset.pieces = profile.pieces;
  applySkin();
  $('#optFlip').checked = profile.flip;
  if ($('#optFlipAll')) $('#optFlipAll').checked = !!profile.flipAll;
  if ($('#optEpicFx')) $('#optEpicFx').checked = !!profile.epicFx;
  if ($('#quickEpicFx')) $('#quickEpicFx').checked = !!profile.epicFx;
  document.documentElement.classList.toggle('epic-fx', !!profile.epicFx && !profile.calm);
  if ($('#optCalm')) $('#optCalm').checked = !!profile.calm;
  document.documentElement.classList.toggle('calm', !!profile.calm);
  if ($('#langSelect')) $('#langSelect').value = profile.language || 'ru';
  document.documentElement.lang = profile.language || 'ru';
  $('#optAutoQueen').checked = profile.autoQueen;
  if ($('#gFlip')) {
    const botGame = !!(ui.bot && ui.st);
    $('#gFlip').disabled = botGame;
    $('#gFlip').checked = botGame ? false : profile.flip;
    $('#gFlip').title = botGame ? 'С ботом доска не переворачивается' : '';
  }
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
    const shown = ui.themesExpanded ? THEMES : THEMES.slice(0, 5);
    for (const t of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (profile.theme === t.id ? ' active' : '');
      b.title = t.name;
      b.dataset.theme = t.id;
      b.innerHTML = `<span class="sw-light" style="background:${t.light}"></span><span class="sw-dark" style="background:${t.dark}"></span><span class="sw-name">${t.name}</span>`;
      b.addEventListener('click', () => setTheme(t.id));
      box.appendChild(b);
    }
    if (!ui.themesExpanded && THEMES.length > 5) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'swatch swatch-more';
      more.innerHTML = `<span class="sw-plus">+</span><span class="sw-name">ещё ${THEMES.length - 5}</span>`;
      more.title = 'Показать все доски';
      more.addEventListener('click', () => { ui.themesExpanded = true; renderThemeRows(); });
      box.appendChild(more);
    } else if (ui.themesExpanded) {
      const less = document.createElement('button');
      less.type = 'button';
      less.className = 'swatch swatch-more';
      less.innerHTML = `<span class="sw-plus">−</span><span class="sw-name">свернуть</span>`;
      less.addEventListener('click', () => { ui.themesExpanded = false; renderThemeRows(); });
      box.appendChild(less);
    }
  }
  renderThemePreview();
}

function renderPieceRows() {
  for (const box of [$('#settingsPiecesRow'), $('#drawerPiecesRow')]) {
    if (!box) continue;
    box.innerHTML = '';
    for (const s of PIECE_SKINS.slice(0, QUICK_SKINS)) {
      box.appendChild(skinTile(s));
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'pset pset-more';
    more.title = 'Ещё ' + (PIECE_SKINS.length - QUICK_SKINS) + ' наборов';
    more.innerHTML = `<span class="pset-plus">+</span><span class="pset-name">ещё ${PIECE_SKINS.length - QUICK_SKINS}</span>`;
    more.addEventListener('click', openSkinModal);
    box.appendChild(more);
  }
}

function skinTile(s) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pset' + (profile.pieces === s.id ? ' active' : '');
  b.dataset.pieces = s.id;
  b.title = s.name;
  const glyph = document.createElement('span');
  glyph.className = 'pset-glyph' + (s.hollow ? ' hollow' : '') + (s.metal ? ' metal' : '');
  glyph.style.setProperty('--skin-w', s.w);
  glyph.style.setProperty('--skin-we', s.we);
  glyph.style.setProperty('--skin-wd', s.wd);
  glyph.style.setProperty('--skin-sw', String(s.sw));
  glyph.innerHTML = pieceSvg('n');
  const name = document.createElement('span');
  name.className = 'pset-name';
  name.textContent = s.name;
  b.append(glyph, name);
  b.addEventListener('click', () => setPieces(s.id));
  return b;
}

function openSkinModal() {
  const modal = $('#skinModal');
  const grid = $('#skinGrid');
  grid.innerHTML = '';
  for (const s of PIECE_SKINS) grid.appendChild(skinTile(s));
  $('#skinCount').textContent = PIECE_SKINS.length + ' наборов';
  modal.classList.remove('hidden');
}

function closeSkinModal() {
  const modal = $('#skinModal');
  if (modal) modal.classList.add('hidden');
}

function applySkin() {
  const s = skinById(profile.pieces);
  const root = document.documentElement;
  root.style.setProperty('--skin-w', s.w);
  root.style.setProperty('--skin-we', s.we);
  root.style.setProperty('--skin-wd', s.wd);
  root.style.setProperty('--skin-b', s.b);
  root.style.setProperty('--skin-be', s.be);
  root.style.setProperty('--skin-bd', s.bd);
  root.style.setProperty('--skin-sw', String(s.sw || 2.2));
  root.style.setProperty('--skin-glow', s.glow || 'transparent');
  root.style.setProperty('--skin-opacity', String(s.opacity || 1));
  root.dataset.hollow = s.hollow ? '1' : '0';
  root.dataset.metal = s.metal ? '1' : '0';
  root.dataset.skinGlow = s.glow ? '1' : '0';
  root.dataset.skinShadow = s.shadow ? '1' : '0';
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
  renderThemePreview();
  saveProfile();
}

function renderThemePreview() {
  const box = $('#themePreview');
  if (!box) return;
  const theme = THEMES.find((t) => t.id === profile.theme) || THEMES[0];
  const st = ui.st || createState('classic', {});
  const W = st.W;
  const H = st.H;
  const slot = $('#themePreviewSlot');
  const boxW = Math.max(140, box.clientWidth || 320);
  const boxH = Math.max(180, slot ? slot.clientHeight - 8 : window.innerHeight * 0.3);
  const maxCols = Math.max(4, Math.min(8, Math.floor(boxW / 34)));
  const maxRows = Math.max(4, Math.min(8, Math.floor(boxH / 34)));
  const cw = Math.min(W, maxCols);
  const ch = Math.min(H, maxRows);
  let focus = findKing(st, st.turn);
  if (focus < 0) focus = st.board.findIndex((p) => p);
  const fx = focus >= 0 ? focus % W : Math.floor(W / 2);
  const fy = focus >= 0 ? Math.floor(focus / W) : Math.floor(H / 2);
  const x0 = Math.max(0, Math.min(W - cw, fx - Math.floor(cw / 2)));
  const y0 = Math.max(0, Math.min(H - ch, fy - Math.floor(ch / 2)));
  let cells = '';
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const gx = x0 + x, gy = y0 + y;
      const light = (gx + gy) % 2 === 0;
      cells += `<span class="tp-sq" style="background:${light ? theme.light : theme.dark}"></span>`;
    }
  }
  let pieces = '';
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const gx = x0 + x, gy = y0 + y;
      const p = st.board[gy * W + gx];
      if (!p) continue;
      pieces += `<span class="tp-piece piece ${p.c === 'w' ? 'w' : 'b'}" style="left:${((x + 0.5) / cw) * 100}%;top:${((y + 0.5) / ch) * 100}%;width:${100 / cw}%;height:${100 / ch}%">${pieceSvg(p.t)}</span>`;
    }
  }
  const cropped = cw < W || ch < H;
  box.innerHTML = `<div class="tp-board" style="grid-template-columns:repeat(${cw},1fr);aspect-ratio:${cw}/${ch}">${cells}${pieces}</div>
  <div class="tp-caption">${theme.name} · ${PIECE_SKINS.find((s) => s.id === profile.pieces)?.name || 'Классика'} · ${cw}×${ch}${cropped ? ' фрагмент' : ''}</div>`;
}

function setPieces(id) {
  document.querySelectorAll('.piece').forEach((el) => { el.dataset.tk = ''; });
  profile.pieces = String(id);
  document.documentElement.dataset.pieces = profile.pieces;
  applySkin();
  $$('.pset').forEach((b) => b.classList.toggle('active', b.dataset.pieces === profile.pieces));
  renderThemePreview();
  saveProfile();
  closeSkinModal();
}

function closeTimeGroup(d) {
  if (!d || !d.open || d.classList.contains('closing')) return;
  const list = d.querySelector('.tg-list');
  if (!list) { d.open = false; return; }
  if (list._anim) list._anim.cancel();
  const h = list.offsetHeight;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  d.classList.add('closing');
  if (reduce) {
    d.open = false;
    d.classList.remove('closing');
    return;
  }
  list.style.height = h + 'px';
  list.style.paddingTop = '8px';
  list.style.paddingBottom = '8px';
  list._anim = list.animate([
    { height: h + 'px', opacity: 1, paddingTop: '8px', paddingBottom: '8px' },
    { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
  ], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  list._anim.onfinish = () => {
    d.open = false;
    d.classList.remove('closing');
    list.style.height = '';
    list.style.paddingTop = '';
    list.style.paddingBottom = '';
    list._anim = null;
  };
}

function openTimeGroup(d) {
  const list = d.querySelector('.tg-list');
  if (!list) { d.open = true; return; }
  if (list._anim) list._anim.cancel();
  d.classList.remove('closing');
  d.open = true;
  const target = list.scrollHeight;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  list.style.height = '0px';
  list.style.paddingTop = '0px';
  list.style.paddingBottom = '0px';
  list._anim = list.animate([
    { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
    { height: target + 'px', opacity: 1, paddingTop: '8px', paddingBottom: '8px' },
  ], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  list._anim.onfinish = () => {
    list.style.height = '';
    list.style.paddingTop = '';
    list.style.paddingBottom = '';
    list._anim = null;
  };
}

function renderTimeGroups() {
  const box = $('#timeGroups');
  box.innerHTML = '';
  for (const group of TIME_GROUPS) {
    const wrap = document.createElement('details');
    wrap.className = 'time-group';
    const sum = document.createElement('summary');
    const tg = profile.language === 'en' ? (TIME_GROUPS_EN[group.id] || [group.title, group.hint]) : [group.title, group.hint];
    sum.innerHTML = `<span class="tg-title">${tg[0]}</span><span class="tg-hint">${tg[1]}</span>`;
    wrap.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'tg-list';
    for (const item of group.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'time-item' + (profile.timeMs === item.ms ? ' active' : '');
      b.textContent = timeText(item.ms, item.label);
      b.addEventListener('click', () => {
        profile.timeMs = item.ms;
        profile.timeLabel = item.label;
        saveProfile();
        box.querySelectorAll('.time-item').forEach((el) => el.classList.toggle('active', el === b));
        box.querySelectorAll('details.time-group').forEach((d) => closeTimeGroup(d));
        renderTimeSummary();
      });
      list.appendChild(b);
    }
    wrap.appendChild(list);
    sum.addEventListener('click', (e) => {
      e.preventDefault();
      if (wrap.open) {
        closeTimeGroup(wrap);
      } else {
        box.querySelectorAll('details.time-group').forEach((d) => { if (d !== wrap) closeTimeGroup(d); });
        openTimeGroup(wrap);
      }
    });
    box.appendChild(wrap);
  }
  renderTimeSummary();
}

function renderTimeSummary() {
  $('#timeSummary').textContent = timeText(profile.timeMs, profile.timeLabel);
}

function renderModeCard() {
  const m = modeById(profile.modeId);
  $('#modeIcon').textContent = m.icon;
  $('#modeName').textContent = modeName(m);
  $('#modeDesc').textContent = modeDesc(m);
  $('#modesCurrent').textContent = m.name;
  $('#optSquareWrap').style.display = m.square ? '' : 'none';
  renderPreview();
}

const REAL_MODES = () => MODES.filter((m) => !m.flags.randomPick);

function randomRealMode() {
  const list = REAL_MODES();
  return list[Math.floor(Math.random() * list.length)];
}

function rollRandomMode(done) {
  const overlay = $('#randomRoulette');
  const icon = $('#rouletteIcon');
  const name = $('#rouletteName');
  const sub = $('#rouletteSub');
  if (!overlay) { done(randomRealMode().id); return; }
  const list = REAL_MODES();
  const final = list[Math.floor(Math.random() * list.length)];
  overlay.classList.remove('hidden', 'win');
  sub.textContent = 'крутим барабан';
  let tick = 0;
  const step = () => {
    const m = list[Math.floor(Math.random() * list.length)];
    icon.textContent = m.icon;
    name.textContent = m.name;
    icon.classList.remove('tick');
    void icon.offsetWidth;
    icon.classList.add('tick');
    tick += 1;
    if (tick < 18) {
      setTimeout(step, 38 + tick * 7);
    } else {
      icon.textContent = final.icon;
      name.textContent = modeName(final);
      sub.textContent = profile.language === 'en' ? 'mode selected' : 'режим выбран';
      if ($('#rouletteDesc')) $('#rouletteDesc').textContent = modeDesc(final);
      overlay.classList.add('win');
      sound.click();
      setTimeout(() => {
        overlay.classList.add('hidden');
        if ($('#rouletteDesc')) $('#rouletteDesc').textContent = '';
        done(final.id);
      }, 1600);
    }
  };
  step();
}


/* ═══════════════════ 12.10. ИМБОВИНКИ ═══════════════════ */

function openImboHub() {
  stopImboGame();
  const hub = $('#imboHub');
  const play = $('#imboPlay');
  if (hub) hub.classList.remove('hidden');
  if (play) play.classList.add('hidden');
  ui.imbo = null;
}

function imboStart(kind, variant) {
  if (kind === 'checkers') imboCheckersStart(variant || 'ru');
  else if (kind === 'backgammon') imboBackgammonStart();
  else if (kind === 'dodgeball') imboDodgeballStart(variant || '2');
  else if (kind === 'corners') imboCornersStart();
  else toast('Этот имбовин ещё в разработке');
}

function imboResetView(title) {
  const hub = $('#imboHub');
  const play = $('#imboPlay');
  if (hub) hub.classList.add('hidden');
  if (play) play.classList.remove('hidden');
  const t = $('#imboGameTitle');
  if (t) t.textContent = title;
}

function imboCheckersStart(variant) {
  const intl = variant === 'intl';
  const W = intl ? 10 : 8;
  const H = W;
  const rows = intl ? 4 : 3;
  const board = new Array(W * H).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((x + y) % 2 !== 1) continue;
      if (y < rows) board[y * W + x] = { c: 'b', king: false };
      else if (y >= H - rows) board[y * W + x] = { c: 'w', king: false };
    }
  }
  ui.imbo = {
    kind: 'checkers', variant: intl ? 'intl' : 'ru', W, H, board,
    turn: 'w', selected: null, legal: [], over: false, params: [variant],
  };
  imboResetView(intl ? 'Международные шашки 10×10' : 'Русские шашки 8×8');
  imboCheckersRender();
}

function imboCheckersPieceName(p) {
  return p.king ? 'дамка' : 'шашка';
}

function imboCheckersMovesFrom(g, from, captureOnly = false) {
  const { W, H, board, variant } = g;
  const p = board[from];
  if (!p) return [];
  const x = from % W;
  const y = Math.floor(from / W);
  const out = [];
  const dirs = [];
  if (p.king) dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
  else {
    const f = p.c === 'w' ? -1 : 1;
    dirs.push([-1, f], [1, f]);
    if (variant === 'intl') dirs.push([-1, -f], [1, -f]);
  }
  const isEnemy = (q) => q && q.c !== p.c;
  const step = (dx, dy) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && nx < W && ny >= 0 && ny < H ? ny * W + nx : -1;
  };
  if (p.king) {
    for (const [dx, dy] of dirs) {
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        const s = ny * W + nx;
        if (!board[s]) {
          if (!captureOnly) out.push({ from, to: s, cap: -1 });
        } else {
          if (isEnemy(board[s])) {
            let lx = nx + dx, ly = ny + dy;
            while (lx >= 0 && lx < W && ly >= 0 && ly < H) {
              const l = ly * W + lx;
              if (board[l]) break;
              out.push({ from, to: l, cap: s });
              lx += dx; ly += dy;
            }
          }
          break;
        }
        nx += dx; ny += dy;
      }
    }
    return out;
  }
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const s = ny * W + nx;
    if (!board[s] && !captureOnly) out.push({ from, to: s, cap: -1 });
  }
  const capDirs = p.king ? dirs : (variant === 'intl'
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : [[-1, p.c === 'w' ? -1 : 1], [1, p.c === 'w' ? -1 : 1]]);
  for (const [dx, dy] of capDirs) {
    const ex = x + dx, ey = y + dy;
    if (ex < 0 || ex >= W || ey < 0 || ey >= H) continue;
    const es = ey * W + ex;
    if (!isEnemy(board[es])) continue;
    const lx = ex + dx, ly = ey + dy;
    if (lx < 0 || lx >= W || ly < 0 || ly >= H) continue;
    const ls = ly * W + lx;
    if (!board[ls]) out.push({ from, to: ls, cap: es });
  }
  return out;
}

function imboCheckersAllMoves(g, color) {
  const caps = [];
  const simple = [];
  for (let i = 0; i < g.board.length; i++) {
    const p = g.board[i];
    if (!p || p.c !== color) continue;
    for (const m of imboCheckersMovesFrom(g, i)) {
      (m.cap >= 0 ? caps : simple).push(m);
    }
  }
  return caps.length ? caps : simple;
}

function imboCheckersRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'checkers') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  const all = imboCheckersAllMoves(g, g.turn);
  const mustCapture = all.some((m) => m.cap >= 0);
  const movable = new Set(all.map((m) => m.from));
  const targets = new Set(g.legal.map((m) => m.to));
  wrap.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'imbo-checkers';
  board.style.gridTemplateColumns = `repeat(${g.W}, minmax(0, 1fr))`;
  board.style.width = `min(${g.W * 62}px, 92vw)`;
  for (let i = 0; i < g.board.length; i++) {
    const x = i % g.W;
    const y = Math.floor(i / g.W);
    const sq = document.createElement('button');
    sq.type = 'button';
    sq.className = 'imbo-sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
    sq.dataset.sq = String(i);
    if (i === g.selected) sq.classList.add('sel');
    if (targets.has(i)) {
      sq.classList.add('target');
      const m = g.legal.find((x) => x.to === i);
      const dot = document.createElement('span');
      dot.className = 'hint ' + (m && m.cap >= 0 ? 'capture' : 'quiet');
      sq.appendChild(dot);
    }
    const p = g.board[i];
    if (p) {
      const d = document.createElement('span');
      d.className = 'checker ' + p.c + (p.king ? ' king' : '');
      d.title = (p.c === 'w' ? 'Белые' : 'Чёрные') + ' · ' + imboCheckersPieceName(p);
      sq.appendChild(d);
    }
    sq.addEventListener('click', () => imboCheckersClick(i));
    board.appendChild(sq);
  }
  wrap.appendChild(board);
  const st = $('#imboStatus');
  if (st) {
    if (g.over) st.textContent = g.over;
    else st.textContent = `${g.turn === 'w' ? 'Ход белых' : 'Ход чёрных'}${mustCapture ? ' · взятие обязательно' : ''} · ${g.variant === 'intl' ? 'международные' : 'русские'}`;
  }
}

function imboCheckersClick(sq) {
  const g = ui.imbo;
  if (!g || g.kind !== 'checkers' || g.over) return;
  const p = g.board[sq];
  if (p && p.c === g.turn) {
    const all = imboCheckersAllMoves(g, g.turn);
    const mustCapture = all.some((m) => m.cap >= 0);
    const moves = all.filter((m) => m.from === sq);
    if (mustCapture && !moves.some((m) => m.cap >= 0)) {
      toast('Есть обязательное взятие — выбери другую шашку');
      return;
    }
    if (!moves.length) return;
    g.selected = sq;
    g.legal = moves;
    imboCheckersRender();
    return;
  }
  const move = g.legal.find((m) => m.to === sq);
  if (!move) return;
  const piece = g.board[g.selected];
  g.board[g.selected] = null;
  if (move.cap >= 0) g.board[move.cap] = null;
  g.board[move.to] = piece;
  if (!piece.king) {
    const last = piece.c === 'w' ? 0 : g.H - 1;
    if (Math.floor(move.to / g.W) === last) piece.king = true;
  }
  const further = imboCheckersMovesFrom(g, move.to).filter((m) => m.cap >= 0);
  g.selected = further.length ? move.to : null;
  g.legal = further;
  if (further.length) {
    toast('Продолжайте взятие');
    imboCheckersRender();
    return;
  }
  g.turn = other(g.turn);
  const enemy = g.turn;
  const enemyPieces = g.board.some((q) => q && q.c === enemy);
  const enemyMoves = imboCheckersAllMoves(g, enemy);
  if (!enemyPieces) {
    g.over = `${enemy === 'w' ? 'Белые' : 'Чёрные'} потеряли все шашки — победа ${g.turn === 'w' ? 'чёрных' : 'белых'}`;
  } else if (!enemyMoves.length) {
    g.over = `${enemy === 'w' ? 'Белые' : 'Чёрные'} без ходов — победа ${g.turn === 'w' ? 'чёрных' : 'белых'}`;
  }
  imboCheckersRender();
}


/* ── нарды ── */
function imboBackgammonStart() {
  const points = new Array(24).fill(0);
  points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5;
  points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5;
  ui.imbo = {
    kind: 'backgammon', points, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 },
    turn: 'w', dice: [], selected: null, legal: [], over: false, params: [],
  };
  imboResetView('Нарды · 24 пункта');
  imboBgRoll();
}

function imboBgRoll() {
  const g = ui.imbo;
  if (!g || g.kind !== 'backgammon' || g.over) return;
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  g.dice = [a, b];
  g.moves = a === b ? [a, a, a, a] : [a, b];
  g.selected = null;
  g.legal = [];
  imboBgRender();
}

function imboBgCount(g, i) { return Math.abs(g.points[i]); }

function imboBgColor(g, i) { return g.points[i] > 0 ? 'w' : g.points[i] < 0 ? 'b' : null; }

function imboBgHome(g, color) {
  if (color === 'w') { for (let i = 6; i < 24; i++) if (g.points[i] > 0) return false; return true; }
  for (let i = 0; i < 18; i++) if (g.points[i] < 0) return false;
  return true;
}

function imboBgTargets(g, from) {
  const color = g.turn;
  const target = [];
  const dir = color === 'w' ? -1 : 1;
  for (const die of (g.moves || [])) {
    if (from === -1) {
      const to = color === 'w' ? 24 - die : die - 1;
      if (to >= 0 && to < 24 && (g.points[to] === 0 || imboBgColor(g, to) === color || imboBgCount(g, to) === 1)) target.push({ to, die });
      continue;
    }
    const to = from + dir * die;
    if (to >= 0 && to < 24) {
      const v = g.points[to];
      if (v === 0 || Math.sign(v) === (color === 'w' ? 1 : -1) || Math.abs(v) === 1) target.push({ to, die });
    } else if (imboBgHome(g, color)) {
      const exact = color === 'w' ? from - die : from + die;
      if ((color === 'w' && exact < 0) || (color === 'b' && exact > 23)) target.push({ to: -99, die });
    }
  }
  return target;
}

function imboBgRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'backgammon') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  if (g.over) { $('#imboStatus').textContent = g.over; }
  else $('#imboStatus').textContent = `${g.turn === 'w' ? 'Ход белых' : 'Ход чёрных'} · зары: ${g.dice.length ? g.dice.join(' · ') : '—'} · сбито: ${g.bar.w}/${g.bar.b} · вынесено: ${g.off.w}/${g.off.b}`;
  const board = document.createElement('div');
  board.className = 'bg-board';
  const makePoint = (i, top) => {
    const p = document.createElement('button');
    p.type = 'button';
    p.className = 'bg-point' + (top ? ' top' : '');
    p.dataset.point = String(i);
    const n = imboBgCount(g, i);
    const color = imboBgColor(g, i);
    const shown = Math.min(6, n);
    for (let k = 0; k < shown; k++) {
      const c = document.createElement('span');
      c.className = 'bg-checker ' + color;
      p.appendChild(c);
    }
    if (n > 6) p.insertAdjacentHTML('beforeend', `<small style="color:#ffe7c2;font-size:9px">+${n - 6}</small>`);
    if (g.selected === i) p.classList.add('sel');
    if (g.legal.some((m) => m.to === i)) p.classList.add('hit');
    p.title = `Пункт ${i + 1}: ${n ? n + ' ' + (color === 'w' ? 'белых' : 'чёрных') : 'пусто'}`;
    p.addEventListener('click', () => imboBgClick(i));
    return p;
  };
  const topRow = document.createElement('div');
  topRow.className = 'bg-row';
  topRow.style.display = 'contents';
  for (let i = 12; i < 24; i++) board.appendChild(makePoint(i, true));
  for (let i = 11; i >= 0; i--) board.appendChild(makePoint(i, false));
  wrap.innerHTML = '';
  wrap.appendChild(board);
  const bar = document.createElement('div');
  bar.className = 'bg-msg';
  bar.textContent = `Бар: белые ${g.bar.w} · чёрные ${g.bar.b} | Дом: ${imboBgHome(g, g.turn) ? 'можно выносить' : 'сначала соберите все в дом'}`;
  if (g.bar[g.turn] > 0) {
    const enter = document.createElement('button');
    enter.type = 'button'; enter.className = 'btn btn-sm'; enter.textContent = `Ввести с бара (${g.bar[g.turn]})`;
    enter.addEventListener('click', () => {
      g.selected = -1;
      g.legal = imboBgTargets(g, -1);
      imboBgRender();
    });
    bar.appendChild(enter);
  }
  if (g.legal.some((m) => m.to === -99)) {
    const offBtn = document.createElement('button');
    offBtn.type = 'button'; offBtn.className = 'btn btn-sm'; offBtn.textContent = 'Вынести шашку';
    offBtn.addEventListener('click', () => imboBgClick(-99));
    bar.appendChild(offBtn);
  }
  const roll = document.createElement('button');
  roll.type = 'button'; roll.className = 'btn btn-sm'; roll.textContent = '🎲 Бросить зары';
  roll.disabled = g.dice.length > 0 || g.over;
  roll.addEventListener('click', imboBgRoll);
  bar.appendChild(roll);
  wrap.appendChild(bar);
}

function imboBgClick(i) {
  const g = ui.imbo;
  if (!g || g.kind !== 'backgammon' || g.over) return;
  const color = g.turn;
  const move = g.legal.find((m) => m.to === i);
  if (move) {
    if (move.to === -99) {
      const from = g.selected;
      if (from === -1) return;
      g.points[from] -= color === 'w' ? 1 : -1;
      g.off[color] += 1;
    } else {
      let from = g.selected;
      if (from === -1) g.bar[color] -= 1;
      else g.points[from] -= color === 'w' ? 1 : -1;
      if (g.points[move.to] && Math.sign(g.points[move.to]) !== (color === 'w' ? 1 : -1)) {
        g.points[move.to] = 0;
        g.bar[other(color)] += 1;
      }
      g.points[move.to] += color === 'w' ? 1 : -1;
    }
    const idx = g.moves.indexOf(move.die);
    if (idx >= 0) g.moves.splice(idx, 1);
    g.selected = null;
    g.legal = [];
    if (g.off[color] >= 15) {
      g.over = `${color === 'w' ? 'Белые' : 'Чёрные'} вынесли все шашки — победа!`;
    } else if (!g.moves.length) {
      g.turn = other(color);
      g.dice = [];
    }
    imboBgRender();
    return;
  }
  if (i < 0) return;
  const v = g.points[i];
  if (!v || Math.sign(v) !== (color === 'w' ? 1 : -1)) return;
  if (g.bar[color] > 0) { toast('Сначала введите шашку с бара'); return; }
  const targets = imboBgTargets(g, i);
  if (!targets.length) return;
  g.selected = i;
  g.legal = targets;
  imboBgRender();
}



/* ── вышибалы: простая физика на canvas ── */
function stopImboGame() {
  if (ui.imbo && ui.imbo.raf) cancelAnimationFrame(ui.imbo.raf);
  if (ui.imbo) ui.imbo.raf = 0;
}

function imboDodgeballStart(variant) {
  stopImboGame();
  const big = variant === '10';
  const W = big ? 760 : 620;
  const H = big ? 760 : 620;
  const count = variant === 'rand' ? 4 + Math.floor(Math.random() * 9) : 16;
  const cols = variant === 'row' ? count : variant === '1' ? Math.min(8, count) : Math.min(4, count);
  const rows = Math.ceil(count / cols);
  const r = big ? 15 : 13;
  const discs = [];
  const addTeam = (team, top) => {
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const row = Math.floor(i / cols);
      const x = W / 2 + (c - (cols - 1) / 2) * (r * 2.6);
      const y = top ? 70 + row * (r * 2.5) : H - 70 - row * (r * 2.5);
      discs.push({ x, y, vx: 0, vy: 0, r, m: r * r, team, alive: true });
    }
  };
  addTeam('b', true);
  addTeam('w', false);
  ui.imbo = {
    kind: 'dodgeball', variant, W, H, r, discs, turn: 'w', phase: 'aim',
    selected: null, drag: null, deadline: performance.now() + 10000,
    settleUntil: 0, moves: 0, over: '', params: [variant], raf: 0,
  };
  imboResetView(variant === '10' ? 'Вышибалы 10×10' : variant === 'row' ? 'Вышибалы · 1 ряд' : variant === 'rand' ? `Вышибалы · ${count} на ${count}` : 'Вышибалы · 2 слоя');
  imboDodgeRender();
  imboDodgeLoop();
}

function imboDodgeRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  if (!g.canvas) {
    wrap.innerHTML = '';
    const c = document.createElement('canvas');
    c.className = 'imbo-canvas';
    c.width = g.W; c.height = g.H;
    c.style.width = `min(${g.W}px, 94vw)`;
    c.style.maxHeight = '68vh';
    c.style.touchAction = 'none';
    c.style.borderRadius = '16px';
    c.style.boxShadow = '0 14px 40px #0008';
    wrap.appendChild(c);
    g.canvas = c;
    c.addEventListener('pointerdown', imboDodgeDown);
    c.addEventListener('pointermove', imboDodgeMove);
    c.addEventListener('pointerup', imboDodgeUp);
    c.addEventListener('pointercancel', imboDodgeUp);
  }
  imboDodgeDraw();
  const st = $('#imboStatus');
  if (st) {
    if (g.over) st.textContent = g.over;
    else if (g.phase === 'aim') st.textContent = `${g.turn === 'w' ? 'Ход белых' : 'Ход чёрных'} · тяни вниз и отпусти · ${Math.max(0, Math.ceil((g.deadline - performance.now()) / 1000))} с`;
    else st.textContent = 'Шашки летят… 3 секунды';
  }
}

function imboDodgeDraw() {
  const g = ui.imbo;
  if (!g || !g.canvas) return;
  const c = g.canvas;
  const ctx = c.getContext('2d');
  const W = g.W, H = g.H;
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.55);
  grad.addColorStop(0, '#ffe14d');
  grad.addColorStop(0.32, '#ff9d2e');
  grad.addColorStop(0.72, '#c83232');
  grad.addColorStop(1, '#2c1717');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath(); ctx.arc(W / 2, H / 2, i * W * 0.1, 0, Math.PI * 2); ctx.stroke();
  }
  for (const d of g.discs) {
    if (!d.alive) continue;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = d.team === 'w' ? '#f4f4ee' : '#22262b';
    ctx.strokeStyle = d.team === 'w' ? '#777' : '#ddd';
    ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(d.x - d.r * .28, d.y - d.r * .28, d.r * .22, 0, Math.PI * 2); ctx.fillStyle = '#ffffff88'; ctx.fill();
  }
  if (g.drag) {
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(g.drag.x0, g.drag.y0); ctx.lineTo(g.drag.x1, g.drag.y1); ctx.stroke();
    const power = Math.min(1, Math.hypot(g.drag.x1 - g.drag.x0, g.drag.y1 - g.drag.y0) / (W * .35));
    ctx.fillStyle = '#0008'; ctx.fillRect(16, H - 30, W * .4, 14);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(16, H - 30, W * .4 * power, 14);
  }
}

function imboDodgeLocal(e) {
  const g = ui.imbo;
  const rect = g.canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * g.W / rect.width, y: (e.clientY - rect.top) * g.H / rect.height };
}

function imboDodgeDown(e) {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball' || g.over || g.phase !== 'aim') return;
  const p = imboDodgeLocal(e);
  let best = null, bestD = Infinity;
  for (const d of g.discs) {
    if (!d.alive || d.team !== g.turn) continue;
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < d.r * 1.8 && dist < bestD) { best = d; bestD = dist; }
  }
  if (!best) return;
  g.drag = { piece: best, x0: best.x, y0: best.y, x1: p.x, y1: p.y };
  g.selected = best;
  imboDodgeDraw();
}

function imboDodgeMove(e) {
  const g = ui.imbo;
  if (!g || !g.drag) return;
  const p = imboDodgeLocal(e);
  g.drag.x1 = p.x; g.drag.y1 = p.y;
  imboDodgeDraw();
}

function imboDodgeUp(e) {
  const g = ui.imbo;
  if (!g || !g.drag) return;
  const d = g.drag;
  g.drag = null;
  const dx = d.x0 - d.x1;
  const dy = d.y0 - d.y1;
  if (Math.hypot(dx, dy) < 12) { imboDodgeDraw(); return; }
  const mul = 0.22;
  d.piece.vx = Math.max(-18, Math.min(18, dx * mul));
  d.piece.vy = Math.max(-18, Math.min(18, dy * mul));
  g.phase = 'settle';
  g.settleUntil = performance.now() + 3000;
  g.moves += 1;
  imboDodgeDraw();
}

function imboDodgeStep(dt) {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball') return;
  const W = g.W, H = g.H;
  for (const d of g.discs) {
    if (!d.alive) continue;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= 0.988;
    d.vy *= 0.988;
    if (d.x < d.r) { d.x = d.r; d.vx = Math.abs(d.vx) * .72; }
    if (d.x > W - d.r) { d.x = W - d.r; d.vx = -Math.abs(d.vx) * .72; }
    if (d.x < -d.r || d.x > W + d.r || d.y < -d.r || d.y > H + d.r) d.alive = false;
    if (d.y < -d.r * 0.5 || d.y > H + d.r * 0.5) d.alive = false;
  }
  for (let i = 0; i < g.discs.length; i++) {
    const a = g.discs[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < g.discs.length; j++) {
      const b = g.discs[j];
      if (!b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (dist < .001 || dist >= min) continue;
      const nx = dx / dist, ny = dy / dist;
      const overlap = min - dist;
      const total = a.m + b.m;
      a.x -= nx * overlap * (b.m / total);
      a.y -= ny * overlap * (b.m / total);
      b.x += nx * overlap * (a.m / total);
      b.y += ny * overlap * (a.m / total);
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel >= 0) continue;
      const imp = -(1.25) * rel / (1 / a.m + 1 / b.m);
      a.vx -= imp * nx / a.m; a.vy -= imp * ny / a.m;
      b.vx += imp * nx / b.m; b.vy += imp * ny / b.m;
    }
  }
}

function imboDodgeLoop() {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball') return;
  const now = performance.now();
  imboDodgeStep(0.016);
  imboDodgeDraw();
  if (g.phase === 'aim' && !g.over) {
    if (now > g.deadline) {
      if (g.moves < 4) {
        g.over = 'Время вышло на первых ходах — партия прервана';
      } else {
        g.turn = other(g.turn);
        g.deadline = now + 10000;
        g.phase = 'aim';
      }
    }
  } else if (g.phase === 'settle' && now > g.settleUntil) {
    const w = g.discs.filter((d) => d.alive && d.team === 'w').length;
    const b = g.discs.filter((d) => d.alive && d.team === 'b').length;
    if (!w && !b) g.over = 'Все шашки улетели — ПАТ';
    else if (!w) g.over = 'Белые потеряли все шашки — победа чёрных';
    else if (!b) g.over = 'Чёрные потеряли все шашки — победа белых';
    else {
      g.turn = other(g.turn);
      g.phase = 'aim';
      g.deadline = now + 10000;
    }
  }
  imboDodgeRender();
  if (!g.over) g.raf = requestAnimationFrame(imboDodgeLoop);
}



/* ── уголки 3×3 ── */
function imboCornersStart() {
  const W = 8, H = 8;
  const board = new Array(W * H).fill(null);
  for (let y = 5; y < 8; y++) for (let x = 0; x < 3; x++) board[y * W + x] = { c: 'w' };
  for (let y = 0; y < 3; y++) for (let x = 5; x < 8; x++) board[y * W + x] = { c: 'b' };
  ui.imbo = { kind: 'corners', W, H, board, turn: 'w', selected: null, legal: [], over: false, params: [] };
  imboResetView('Уголки 3×3');
  imboCornersRender();
}

function imboCornersTarget(color) {
  if (color === 'w') return { x0: 5, x1: 7, y0: 0, y1: 2 };
  return { x0: 0, x1: 2, y0: 5, y1: 7 };
}

function imboCornersMoves(g, from) {
  const { W, H, board } = g;
  const p = board[from];
  if (!p) return [];
  const x = from % W, y = Math.floor(from / W);
  const out = [];
  for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const s = ny * W + nx;
    if (!board[s]) out.push({ from, to: s, jump: false });
    else {
      const jx = x + dx * 2, jy = y + dy * 2;
      if (jx < 0 || jx >= W || jy < 0 || jy >= H) continue;
      const js = jy * W + jx;
      if (!board[js]) out.push({ from, to: js, jump: true });
    }
  }
  return out;
}

function imboCornersRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'corners') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'imbo-checkers';
  board.style.gridTemplateColumns = `repeat(${g.W}, minmax(0, 1fr))`;
  board.style.width = `min(${g.W * 62}px, 92vw)`;
  const targets = new Set(g.legal.map((m) => m.to));
  const goalW = imboCornersTarget('w'), goalB = imboCornersTarget('b');
  for (let i = 0; i < g.board.length; i++) {
    const x = i % g.W, y = Math.floor(i / g.W);
    const sq = document.createElement('button');
    sq.type = 'button';
    sq.className = 'imbo-sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
    if (x >= goalW.x0 && x <= goalW.x1 && y >= goalW.y0 && y <= goalW.y1) sq.classList.add('corner-w');
    if (x >= goalB.x0 && x <= goalB.x1 && y >= goalB.y0 && y <= goalB.y1) sq.classList.add('corner-b');
    sq.dataset.sq = String(i);
    if (i === g.selected) sq.classList.add('sel');
    if (targets.has(i)) sq.classList.add('target');
    const p = g.board[i];
    if (p) {
      const d = document.createElement('span');
      d.className = 'checker ' + p.c;
      sq.appendChild(d);
    }
    sq.addEventListener('click', () => imboCornersClick(i));
    board.appendChild(sq);
  }
  wrap.appendChild(board);
  const st = $('#imboStatus');
  if (st) st.textContent = g.over ? g.over : `${g.turn === 'w' ? 'Ход белых' : 'Ход чёрных'} · занять чужой угол 3×3`;
}

function imboCornersClick(sq) {
  const g = ui.imbo;
  if (!g || g.kind !== 'corners' || g.over) return;
  const p = g.board[sq];
  if (p && p.c === g.turn) {
    const moves = imboCornersMoves(g, sq);
    if (!moves.length) return;
    g.selected = sq;
    g.legal = moves;
    imboCornersRender();
    return;
  }
  const move = g.legal.find((m) => m.to === sq);
  if (!move) return;
  const mover = g.turn;
  g.board[move.to] = g.board[g.selected];
  g.board[g.selected] = null;
  g.selected = null;
  g.legal = [];
  const target = imboCornersTarget(mover);
  let win = true;
  for (let y = target.y0; y <= target.y1; y++) for (let x = target.x0; x <= target.x1; x++) {
    const q = g.board[y * g.W + x];
    if (!q || q.c !== mover) win = false;
  }
  if (win) g.over = `${mover === 'w' ? 'Белые' : 'Чёрные'} заняли чужой угол — победа!`;
  else g.turn = other(mover);
  imboCornersRender();
}


function startGameWithMode(opts = {}) {
  if (profile.modeId === 'openIntent' && opts.mode !== 'online') {
    toast('Режим «Открытые намерения» работает только в онлайн-игре с живым соперником!');
    showScreen('online');
    return;
  }
  if (profile.modeId !== 'random') {
    newGame({ ...opts, modeId: profile.modeId });
    return;
  }
  closeBotModal();
  rollRandomMode((modeId) => {
    renderModeCard();
    newGame({ ...opts, modeId });
  });
}

const MODE_CATS = {
  popular: ['classic', 'fischer', 'threeChecks', 'kingCapture'],
  pieces: ['jester', 'boy', 'queens', 'pawnField', 'pawnFieldQ', 'knights', 'rooks', 'bishops'],
  chaos: ['explode', 'fog', 'blocks', 'race', 'queenPierce', 'noPawns', 'center'],
  mini: ['strategy', 'zombie', 'royalBattle', 'clashBrawl', 'infernal', 'devourAll', 'captureRace', 'antichess'],
  imbo: [],
};

function modesByFilter(filter) {
  if (filter === 'all') return MODES.slice();
  const ids = MODE_CATS[filter] || [];
  return MODES.filter((m) => ids.includes(m.id));
}

const MODE_GROUP = {
  random: 1, classic: 1, threeChecks: 1, kingCapture: 1, center: 1, fischer: 1, chess960: 1,
  pawnRush: 1, backCapture: 1, radiusCheck: 1, vanishEdge: 1,
  pawnRows: 2, kqp: 2, wide10: 2, tall10: 2, jester: 2, boy: 2, queens: 2, bishops: 2,
  knights: 2, rooks: 2, pawnField: 2, pawnFieldQ: 2, noPawns: 2, blocks: 2, swapReplace: 2, convert20: 2,
  explode: 3, fog: 3, race: 3, kingOnly: 3, queenPierce: 3, bishopKing: 3, crossCastle: 3,
  touchMove: 3, openIntent: 3, horde: 3, antichess: 3,
  noQueen7: 1, swapRows: 2, blackFirst: 1, inverted: 2, pawnBack: 2, kingKnight: 1,
  queenLose: 2, weakKnights: 1, castleReturn: 2, square10: 2, square12: 3, infernal: 3, clashBrawl: 3, royalBattle: 3, zombie: 3, strategy: 3,
  losAlamos: 2, berolina: 2, checkless: 2, raceKings: 2, andernach: 3,
};
const GROUP_TITLES = {
  1: 'Классика и лёгкие изменения',
  2: 'Средние изменения',
  3: 'Сильные изменения и хаос',
};
const GROUP_TITLES_EN = {
  1: 'Classic & light changes',
  2: 'Medium changes',
  3: 'Heavy changes & chaos',
};

function modeName(m) { return profile.language === 'en' && MODE_EN[m.id] ? MODE_EN[m.id][0] : m.name; }
function modeDesc(m) { return profile.language === 'en' && MODE_EN[m.id] ? MODE_EN[m.id][1] : m.desc; }

function makeModeCard(m, mode) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mode-tile big' + (profile.modeId === m.id ? ' active' : '') + (m.flags.randomPick ? ' random-tile' : '');
  const onlineNote = m.id === 'openIntent' ? `<span class="mt-online">${profile.language === 'en' ? 'online only' : 'только онлайн'}</span>` : '';
  const size = m.square && profile.square ? `${m.W}×${m.W}` : `${m.W}×${m.H}`;
  const group = MODE_GROUP[m.id] || 1;
  card.innerHTML = `
    <span class="mt-icon">${m.icon}</span>
    <span class="mt-body">
      <span class="mt-name full">${modeName(m)}</span>
      <span class="mt-name short">${profile.language === 'en' ? modeName(m) : (MODE_SHORT[m.id] || m.name)}</span>
      <span class="mt-desc">${modeDesc(m)}</span>
      <span class="mt-meta"><i class="mt-badge g${group}">${group === 1 ? (profile.language === 'en' ? 'easy' : 'лёгкий') : group === 2 ? (profile.language === 'en' ? 'medium' : 'средний') : (profile.language === 'en' ? 'hard' : 'сильный')}</i> ${size}${m.n ? (profile.language === 'en' ? ' · mode ' + m.n : ' · режим ' + m.n) : ''} ${onlineNote}</span>
    </span>`;
  card.addEventListener('click', () => {
    profile.modeId = m.id;
    saveProfile();
    renderModeCard();
    renderModesGrid(mode);
    toast(m.flags.randomPick ? 'Рандомный: каждый раз новый режим' : `Режим: ${m.name}`);
    showScreen('home');
  });
  return card;
}

function renderModesGrid(filter) {
  const mode = filter || ui.modesFilter || 'all';
  ui.modesFilter = mode;
  const box = $('#modesGrid');
  box.innerHTML = '';
  box.className = 'modes-groups';
  const list = modesByFilter(mode);
  for (const [label, count] of [['all', MODES.length], ['popular', MODE_CATS.popular.length], ['pieces', MODE_CATS.pieces.length], ['chaos', MODE_CATS.chaos.length], ['mini', MODE_CATS.mini.length], ['imbo', 9]]) {
    const b = $(`.mode-filter[data-filter="${label}"]`);
    if (b) {
      const em = b.querySelector('em') || document.createElement('em');
      em.textContent = String(count);
      b.appendChild(em);
      b.classList.toggle('active', label === mode);
    }
  }
  if (mode === 'imbo') {
    const grid = document.createElement('div');
    grid.className = 'imbo-hub modes-grid';
    const cards = [
      ['checkers', 'ru', '⚫', 'Шашки', 'Русские · 8×8 · дамки'],
      ['checkers', 'intl', '⚫', 'Шашки мировые', 'Международные · 10×10'],
      ['backgammon', '', '🎲', 'Нарды', '24 пункта · зары · вынос'],
      ['dodgeball', '2', '🎯', 'Вышибалы · 2 слоя', '16 на 16 · физика'],
      ['dodgeball', '1', '🎯', 'Вышибалы · 1 слой', 'Один слой'],
      ['dodgeball', '10', '🎯', 'Вышибалы 10×10', 'Большое поле'],
      ['dodgeball', 'row', '🎯', 'Вышибалы · 1 ряд', '16 в линию'],
      ['dodgeball', 'rand', '🎯', 'Вышибалы · рандом', '4–12 шашек'],
      ['corners', '', '↗', 'Уголки 3×3', 'Перевести угол'],
    ];
    for (const [kind, variant, icon, name, desc] of cards) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'imbo-card';
      b.dataset.imbo = kind;
      if (variant) b.dataset.var = variant;
      b.innerHTML = `<b>${name}</b><span>${desc}</span><em>Играть</em>`;
      b.addEventListener('click', () => {
        showScreen('imbo');
        imboStart(kind, variant);
      });
      grid.appendChild(b);
    }
    box.appendChild(grid);
    return;
  }
  const appendGrid = (parent, items) => {
    const grid = document.createElement('div');
    grid.className = 'modes-grid grouped';
    items.forEach((m, i) => {
    const card = makeModeCard(m, mode);
    card.style.setProperty('--i', String(Math.min(i, 10)));
    grid.appendChild(card);
  });
    parent.appendChild(grid);
  };
  if (mode === 'all') {
    for (const g of [1, 2, 3]) {
      const items = list.filter((m) => (MODE_GROUP[m.id] || 1) === g);
      if (!items.length) continue;
      const section = document.createElement('section');
      section.className = 'modes-group';
      const title = document.createElement('h3');
      title.className = 'modes-group-title g' + g;
      title.innerHTML = `<b>${profile.language === 'en' ? GROUP_TITLES_EN[g] : GROUP_TITLES[g]}</b><span class="chip">${items.length}</span>`;
      section.appendChild(title);
      appendGrid(section, items);
      box.appendChild(section);
    }
  } else {
    appendGrid(box, list);
  }
}


function renderStats() {
  const s = profile.stats;
  const total = s.games || 0;
  const rate = total ? Math.round((s.wins / total) * 100) : 0;
  $('#statsHero').innerHTML = `
    <div class="sh-points">${profile.points}<span>очков</span></div>
    <div class="sh-name"><span class="sh-avatar">${pieceSvg(profile.avatar, 'av-pc')}</span> ${escapeHtml(profile.name)}</div>
    <div class="sh-rule">+5 мат · +4 мат по времени · +1 пат · −4 поражение · −5 поражение в первые 10 ходов</div>`;
  $('#statsGrid').innerHTML = [
    ['Партий', total], ['Побед', s.wins], ['Ничьих', s.draws], ['Поражений', s.losses],
    ['Процент побед', rate + '%'], ['Мат', s.mates], ['По времени', s.timeWins], ['Лучшая серия', s.best],
  ].map(([k, v], i) => `<div class="stat-cell" style="--i:${Math.min(i, 10)}"><b>${v}</b><span>${k}</span></div>`).join('');

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

function renderQuickSide() {
  document.querySelectorAll('.side-pick').forEach((b) => {
    b.classList.toggle('active', b.dataset.side === profile.side);
  });
}

function renderProfilePop() {
  const pop = $('#profilePop');
  if (!pop) return;
  if ($('#ppName')) $('#ppName').value = profile.name;
  const box = $('#ppAvatars');
  if (box) {
    box.innerHTML = '';
    for (const a of AVATARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'avatar-btn' + (profile.avatar === a ? ' active' : '');
      b.innerHTML = pieceSvg(a, 'av-pc');
      b.addEventListener('click', () => {
        profile.avatar = a;
        saveProfile(true);
        renderProfile();
        renderProfilePop();
      });
      box.appendChild(b);
    }
  }
  if ($('#ppStats')) {
    const games = profile.stats.games || 0;
    const wins = profile.stats.wins || 0;
    $('#ppStats').innerHTML = `<span><b>${games}</b> партий</span><span><b>${wins}</b> побед</span><span><b>${profile.points}</b> очков</span>`;
  }
}

function saveHomeNick() {
  const input = $('#homeNickInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 18) || (profile.language === 'en' ? 'Player' : 'Игрок');
  profile.name = name;
  input.value = name;
  input.blur();
  saveProfile(true);
  renderProfile();
  toast(profile.language === 'en' ? 'Name saved' : 'Имя сохранено');
}

function saveProfileName() {
  const input = $('#ppName');
  if (!input) return;
  const name = input.value.trim().slice(0, 18) || 'Игрок';
  profile.name = name;
  saveProfile(true);
  renderProfile();
  toast('Имя сохранено');
}

function updateOnlineModeLine() {
  const el = $('#onlineModeLine');
  if (!el) return;
  const m = modeById(profile.modeId);
  el.innerHTML = `${profile.language === 'en' ? 'Mode' : 'Режим'}: <b>${escapeHtml(modeName(m))}</b> · ${m.W}×${m.H} · ${escapeHtml(profile.timeLabel || (profile.language === 'en' ? 'no limit' : 'без ограничений'))}`;
}

const SKIP_WELCOME = location.search.includes('skipwelcome=1') || (!!navigator.webdriver && !location.search.includes('welcome=1'));

const EN_STATIC = {
  'Играть': 'Play', 'С ботом': 'Vs Bot', 'Онлайн': 'Online', 'Режимы': 'Modes',
  'Статистика': 'Stats', 'Настройки': 'Settings', 'Игрок': 'Player', '0 очков': '0 points',
  'Сыграйте партию за десять секунд': 'Play a game in ten seconds',
  'Выберите режим и время — остальное уже настроено.': 'Pick a mode and time — the rest is ready.',
  'Сменить': 'Change', 'Контроль времени': 'Time control', 'Твой цвет:': 'Your color:',
  'Белые': 'White', 'Чёрные': 'Black', 'Играть здесь': 'Play here', 'С ботом:': 'Vs bot:',
  'лёгкий': 'easy', 'средний': 'medium', 'сложный': 'hard', 'гроссмейстер': 'grandmaster', 'движок': 'engine',
  'Или сыграйте с:': 'Or play with:', 'Мини-профиль': 'Mini profile', 'Доски': 'Boards',
  'Фигуры': 'Pieces', 'Мои итоги': 'My stats', '▶ Продолжить партию': '▶ Resume game',
  '⚙ Настройки': '⚙ Settings', '← Назад': '← Back',
  'Игра по сети с другом': 'Play online with a friend',
  'Без регистрации и VPN. Отправьте ссылку другу или введите 5-значный код.': 'No signup or VPN. Send the link to a friend or enter the 5-digit code.',
  'С другом': 'With a friend', 'Интернет': 'Internet', 'Создать комнату': 'Create room',
  'Будет сгенерирована ссылка. Друг просто перейдёт по ней — и партия начнётся, когда он присоединится.': 'A link will be generated. Your friend opens it and the game starts when they join.',
  'Присоединиться': 'Join', 'Если друг прислал 5 цифр кода:': 'If your friend sent a 5-digit code:',
  'Войти': 'Enter', '↩ Вернуться в последнюю комнату': '↩ Return to last room',
  'Копировать ссылку': 'Copy link', 'Отменить': 'Cancel', 'Публичные партии': 'Public games',
  'Все →': 'All →', 'Пока нет открытых партий — создайте комнату, и она появится здесь.': 'No open games yet — create a room and it will appear here.',
  'Ожидают партии': 'Waiting games', '+ Выставить ожидание': '+ List a game',
  'Подключаемся к публичному списку…': 'Connecting to the public list…',
  'Наблюдение за партиями': 'Spectate games', 'Пока никто не играет': 'No games yet',
  'Имя, аватар, вид доски и фигур, помощники. Сохраняется автоматически.': 'Name, avatar, board and pieces, helpers. Saved automatically.',
  '↻ Обновить': '↻ Refresh', 'Сбросить прогресс': 'Reset progress', 'Имя пользователя': 'Nickname',
  'Аватар': 'Avatar', 'Тема доски': 'Board theme', 'Набор фигур': 'Piece set',
  '🎲 Случайная доска': '🎲 Random board',
  'Переворачивать доску после хода': 'Flip board after move',
  'Авто-ферзь при превращении': 'Auto-queen on promotion', 'Звуки и вибрация': 'Sounds and vibration',
  'Переворачивать весь интерфейс, а не только доску': 'Flip the whole interface, not just the board',
  'Физически переворачивать доску (как на столе)': 'Physically rotate the board (like a real table)',
  '✨ Эпичные эффекты (как в мобильной версии)': '✨ Epic effects (mobile style)',
  '🌿 Спокойный режим (без лишних эффектов)': '🌿 Calm mode (no extra effects)',
  'Язык / Language': 'Language', 'В локальной игре я играю за': 'In local games I play as',
  'белых': 'white', 'чёрных': 'black',
  'Партии, очки и статистика хранятся в этом браузере. История — последние 60 партий.': 'Games, points and stats are stored in this browser. History keeps the last 60 games.',
  'Все': 'All', 'Популярные': 'Popular', 'Хаос': 'Chaos', 'Мини-игры': 'Mini-games',
  '🎲 Случайно': '🎲 Random', '✨ Эпично': '✨ Epic', '🎲 Случайная доска': '🎲 Random board', 'Фигуры ': 'Pieces ',
  'Очки, счёт партий и последние игры.': 'Points, game count and recent games.',
  'История партий': 'Game history', 'Соперник': 'Opponent', 'чёрные': 'black', 'Вы': 'You',
  'Превращение': 'Promotion', '≡ Ходы': '≡ Moves', '⚑ Сдаться': '⚑ Resign', 'Выйти': 'Leave',
  'ПАУЗА': 'PAUSED', 'Часы остановлены': 'Clocks stopped', 'Продолжить': 'Resume',
  'Ход белых': 'White to move', 'Ходы': 'Moves', 'Чат': 'Chat', 'Инфо': 'Info',
  'Пока пусто — сделайте первый ход': 'Empty — make the first move',
  'Чат доступен в партии по сети': 'Chat is available in online games',
  'В буфер': 'To clipboard', 'Импорт': 'Import', '½ Ничья': '½ Draw', 'Настройки партии': 'Game settings',
  'Переворот после хода': 'Flip after move', 'Авто-ферзь': 'Auto-queen', 'Звуки': 'Sounds',
  'Партия': 'Game', 'Сменить режим': 'Change mode', 'Все настройки': 'All settings',
  'Прервать': 'Abort', 'Новая партия': 'New game', 'В меню': 'To menu',
  'Ещё партию': 'Another game', 'Посмотреть доску': 'View board',
  'Судьба выбирает режим': 'Fate picks a mode', 'крутим барабан': 'spinning the wheel',
  'Игра с ботом': 'Play with bot', 'Бот играет за противоположный цвет и умеет все режимы.': 'The bot plays the other side and knows all modes.',
  'Отмена': 'Cancel', 'Остаться': 'Stay', 'Импорт партии': 'Import game',
  'Наборы фигур': 'Piece sets', 'Выйти в меню': 'Exit to menu', 'Ничья': 'Draw',
  'Победа': 'Victory', 'Поражение': 'Defeat', 'Мат': 'Checkmate',
};

function translateStaticDom() {
  if (profile.language !== 'en') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (!key || !EN_STATIC[key]) continue;
    node.nodeValue = raw.replace(key, EN_STATIC[key]);
  }
  document.querySelectorAll('[placeholder]').forEach((el) => {
    const key = el.placeholder.trim();
    if (EN_STATIC[key]) el.placeholder = EN_STATIC[key];
  });
}

const WELCOME_TEXT = {
  ru: {
    title: 'Настройка профиля',
    sub: 'Как тебя зовут и как всё будет выглядеть?',
    name: 'Ник', avatar: 'Аватар', pieces: 'Фигуры', theme: 'Доска',
    settings: 'Настройки', start: 'Начать', placeholder: 'Игрок',
  },
  en: {
    title: 'Profile setup',
    sub: 'What is your name and how should everything look?',
    name: 'Nickname', avatar: 'Avatar', pieces: 'Pieces', theme: 'Board',
    settings: 'Settings', start: 'Start', placeholder: 'Player',
  },
};

function showWelcome() {
  const box = $('#welcome');
  if (!box) return;
  box.classList.remove('hidden');
  $('#welcomeLang').classList.remove('hidden');
  $('#welcomeSetup').classList.add('hidden');
}

function chooseWelcomeLanguage(lang) {
  profile.language = lang === 'en' ? 'en' : 'ru';
  saveProfile();
  const text = WELCOME_TEXT[profile.language];
  $('#welcomeLang').classList.add('hidden');
  $('#welcomeSetup').classList.remove('hidden');
  $('#welcomeTitle').textContent = text.title;
  $('#welcomeSub').textContent = text.sub;
  $('#welcomeNameLabel').textContent = text.name;
  $('#welcomeAvatarLabel').textContent = text.avatar;
  $('#welcomePiecesLabel').textContent = text.pieces;
  $('#welcomeThemesLabel').textContent = text.theme;
  $('#welcomeSettings').textContent = text.settings;
  $('#welcomeStart').textContent = text.start;
  const nameInput = $('#welcomeName');
  nameInput.placeholder = text.placeholder;
  if (!nameInput.value || nameInput.value === 'Игрок' || nameInput.value === 'Player') {
    nameInput.value = profile.language === 'en' ? 'Player' : 'Игрок';
  }
  fillWelcomeSetup();
}

function fillWelcomeSetup() {
  const avatars = $('#welcomeAvatars');
  if (avatars) {
    avatars.innerHTML = '';
    for (const a of AVATARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'avatar-btn' + (profile.avatar === a ? ' active' : '');
      b.innerHTML = pieceSvg(a, 'av-pc');
      b.addEventListener('click', () => {
        profile.avatar = a;
        avatars.querySelectorAll('.avatar-btn').forEach((x) => x.classList.toggle('active', x === b));
        saveProfile();
      });
      avatars.appendChild(b);
    }
  }
  const pieces = $('#welcomePieces');
  if (pieces) {
    pieces.innerHTML = '';
    for (const s of PIECE_SKINS.slice(0, 8)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pset' + (profile.pieces === s.id ? ' active' : '');
      b.title = s.name;
      const glyph = document.createElement('span');
      glyph.className = 'pset-glyph' + (s.hollow ? ' hollow' : '') + (s.metal ? ' metal' : '');
      glyph.style.setProperty('--skin-w', s.w);
      glyph.style.setProperty('--skin-we', s.we);
      glyph.style.setProperty('--skin-wd', s.wd);
      glyph.style.setProperty('--skin-b', s.b);
      glyph.style.setProperty('--skin-be', s.be);
      glyph.style.setProperty('--skin-bd', s.bd);
      glyph.innerHTML = pieceSvg('n', 'pset-pc');
      b.appendChild(glyph);
      b.addEventListener('click', () => {
        setPieces(s.id);
        pieces.querySelectorAll('.pset').forEach((x) => x.classList.toggle('active', x === b));
      });
      pieces.appendChild(b);
    }
  }
  const themes = $('#welcomeThemes');
  if (themes) {
    themes.innerHTML = '';
    for (const th of THEMES.slice(0, 10)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (profile.theme === th.id ? ' active' : '');
      b.title = th.name;
      b.innerHTML = `<span class="sw-light" style="background:${th.light}"></span><span class="sw-dark" style="background:${th.dark}"></span><span class="sw-name">${th.name}</span>`;
      b.addEventListener('click', () => {
        setTheme(th.id);
        themes.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === b));
      });
      themes.appendChild(b);
    }
  }
}

function finishWelcome(goSettings) {
  const name = $('#welcomeName') ? $('#welcomeName').value.trim().slice(0, 18) : '';
  if (name) profile.name = name;
  profile.onboarded = true;
  saveProfile(true);
  $('#welcome').classList.add('hidden');
  renderProfile();
  renderThemeRows();
  renderPieceRows();
  renderAvatarRow();
  if (profile.language === 'en') { location.reload(); return; }
  showScreen(goSettings ? 'settings' : 'home');
}

function setCalm(on) {
  profile.calm = !!on;
  document.documentElement.classList.toggle('calm', !!on);
  if (on) {
    document.documentElement.classList.remove('epic-fx');
    profile.epicFx = false;
  }
  if ($('#optCalm')) $('#optCalm').checked = !!on;
  saveProfile();
  toast(on ? 'Спокойный режим включён' : 'Спокойный режим выключен');
}

function refreshActiveGame() {
  if (ui.st && ui.st.status === 'play') {
    showScreen('game');
    if (ui.away) resumeGame();
    toast('Вернулись в текущую партию');
    return;
  }
  if (loadCurrentGame()) {
    resumeSavedGame();
    return;
  }
  if (profile.lastRoom && profile.lastRoom.code) {
    joinRoom(profile.lastRoom.code);
    return;
  }
  toast('Активной партии нет');
}

function showScreen(name) {
  if (name === 'game') stopConnectHud();
  if (name !== 'game') { closeDrawer(); closePanel(); }
  const wasGame = ui.screen === 'game';
  const activeGame = ui.st && ui.st.status === 'play' && !ui.scored;
  if (wasGame && name !== 'game') {
    const splash = $('#phaseSplash');
    if (splash) splash.classList.remove('show');
    if (ui.st && ui.st.flags.clashBrawl) document.documentElement.dataset.brawl = '0';
    if (ui.st && ui.st.flags.infernal) document.documentElement.dataset.infernal = '0';
    if (ui.st && ui.st.flags.royalBattle) document.documentElement.dataset.royal = '0';
    if (ui.st && ui.st.flags.zombie) document.documentElement.dataset.zombie = '0';
    if (ui.st && ui.st.flags.strategy) document.documentElement.dataset.strategy = '0';
    if (activeGame && ui.bot) hardStopBotGame();
    else if (activeGame && !ui.away) suspendGame();
    document.body.classList.remove('flip-all');
  }
  if (name === 'game') {
    if (ui.st && ui.st.flags.clashBrawl) document.documentElement.dataset.brawl = '1';
    if (ui.st && ui.st.flags.infernal) document.documentElement.dataset.infernal = '1';
    if (ui.st && ui.st.flags.royalBattle) document.documentElement.dataset.royal = '1';
    if (ui.st && ui.st.flags.zombie) document.documentElement.dataset.zombie = '1';
    if (ui.st && ui.st.flags.strategy) document.documentElement.dataset.strategy = '1';
    if (ui.rotated) document.body.classList.add('flip-all');
    if (ui.away) resumeGame();
  }
  ui.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.sb-btn').forEach((b) => b.classList.remove('active'));
  const nav = name === 'home' || name === 'game' ? $('#sbNavPlay') : $(`.sb-btn[data-screen="${name}"]`);
  if (nav) nav.classList.add('active');
  if (name === 'online') { updateOnlineModeLine(); ensureLobby(); renderLobby(); }
  if (name === 'stats') renderStats();
  updateResumeFloat();
  translateStaticDom();
  if (name === 'settings') renderSettings();
  if (name === 'home') { renderProfile(); }
  if (name === 'modes') renderModesGrid();
  if (name === 'settings') requestAnimationFrame(() => renderThemePreview());
  if (name === 'imbo') openImboHub();
  else if (ui.imbo) stopImboGame();
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
    lastMove: f.lastMove || null,
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
  const topBar = $('#barTop');
  const bottomBar = $('#barBottom');
  const cinema = window.matchMedia && window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches;
  const phone = window.innerWidth < 1000;
  const brawlH = ui.st && ui.st.flags.clashBrawl ? (cinema ? 112 : 150) : 0;
  const barH = (phone
    ? (cinema ? 24 + 24 : 76 + 22 + 38)
    : 96) + brawlH + (ui.strategy ? 46 : 0);   // фиксировано: доска не дёргается при взятии
  const gaps = 8;
  const shell = $('#gameShell');
  const panel = $('#sidePanel');
  const desk = window.innerWidth >= 1000;
  const panelW = desk && panel ? panel.offsetWidth : 0;
  const padX = desk ? 32 : 0;
  const shellW = shell ? shell.clientWidth : stage.clientWidth;
  const infoPanel = $('#stratInfoPanel');
  const infoW = ui.strategy && desk && infoPanel ? infoPanel.offsetWidth + 16 : 0;
  const availW = Math.max(160, (desk ? shellW - padX - panelW - infoW - 22 : stage.clientWidth));
  const availH = Math.max(160, stage.clientHeight - barH - gaps);
  const layoutKey = `${availW}x${availH}x${st.W}x${st.H}`;
  if (ui.layoutKey === layoutKey && wrap.style.width) { layoutStrategyPanel(); return; }
  ui.layoutKey = layoutKey;
  const sq = Math.max(16, Math.min(170,
    Math.floor(availW / st.W),
    Math.floor(availH / st.H)));
  ui.sq = sq;
  const widthPx = sq * st.W;
  const heightPx = sq * st.H;
  wrap.style.width = widthPx + 'px';
  wrap.style.height = heightPx + 'px';
  wrap.style.padding = '0';
  if (topBar) topBar.style.width = widthPx + 'px';
  if (bottomBar) bottomBar.style.width = widthPx + 'px';
  if (desk) {
    stage.style.flex = '0 0 auto';
    stage.style.width = widthPx + 'px';
  } else {
    stage.style.flex = '';
    stage.style.width = '';
  }
  if (panel && desk) {
    const need = barH + heightPx + 10;
    panel.style.height = Math.min(need, stage.clientHeight) + 'px';
  } else if (panel) {
    panel.style.height = '';
  }
  document.documentElement.style.setProperty('--sq', sq + 'px');
  layoutStrategyPanel();
}

function layoutStrategyPanel() {
  const panel = $('#stratInfoPanel');
  const board = $('#boardWrap');
  const shell = $('#gameShell');
  if (!panel) return;
  if (!ui.strategy || window.innerWidth < 1000 || !board || !shell) {
    panel.style.marginTop = '';
    panel.style.height = '';
    return;
  }
  const sr = shell.getBoundingClientRect();
  const br = board.getBoundingClientRect();
  const padTop = parseFloat(getComputedStyle(shell).paddingTop) || 0;
  panel.style.marginTop = Math.max(0, br.top - sr.top - padTop) + 'px';
  panel.style.height = br.height + 'px';
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
      const blk = document.createElement('span');
      blk.className = 'blk';
      blk.textContent = '▩';
      const cm = document.createElement('span');
      cm.className = 'cm';
      el.append(blk, cm);
      layer.appendChild(el);
      ui.squareEls[i] = el;
    }
  }
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

    const x = i % st.W;
    const y = Math.floor(i / st.W);
    const showFile = ui.orientation === 'w' ? y === 0 : y === st.H - 1;
    const showRank = ui.orientation === 'w' ? x === 0 : x === st.W - 1;
    if (showFile) el.dataset.fileLabel = FILES[x];
    else delete el.dataset.fileLabel;
    if (showRank) el.dataset.rankLabel = String(y + 1);
    else delete el.dataset.rankLabel;
  }
}


function renderSquares() {
  const st = viewState();
  const sq = ui.sq;
  const last = st.lastMove || ui.lastMove;
  const checkSq = st.check ? findKing(st, st.turn) : -1;
  const centerCellsList = st.flags.centerWin ? centerCells(st) : null;
  for (let i = 0; i < st.board.length; i++) {
    const el = ui.squareEls[i];
    if (!el) continue;
    const cls = ['sq', (i % st.W + Math.floor(i / st.W)) % 2 === 0 ? 'dark' : 'light'];
    if (last && (i === last.from || i === last.to)) cls.push('last');
    if (i === ui.selected) cls.push('sel');
    if (i === checkSq) cls.push('check');
    if (ui.endSquare === i) cls.push('king-mated');
    if (st.blocked.includes(i)) cls.push('blocked');
    if (ui.brawl && brawlCanDeploy(i, st.turn)) cls.push('brawl-deploy');
    if (ui.zombie && ui.zombie.infect[i]) cls.push('zombie-threat');
    if (ui.strategy) {
      const terr = ui.strategy.territory || {};
      if (terr[i] === 'w') cls.push('strat-w');
      else if (terr[i] === 'b') cls.push('strat-b');
      if (ui.strategy.aim && ui.strategy.aim.has(i)) cls.push('strat-aim');
      if (ui.strategy.targets && ui.strategy.targets.has(i)) cls.push('strat-target');
      if ((ui.strategy.mines || []).some((m) => m.sq === i)) cls.push('strat-mine');
      if ((ui.strategy.rad || []).some((z) => {
        const zx = z.sq % st.W, zy = Math.floor(z.sq / st.W);
        const nx = i % st.W, ny = Math.floor(i / st.W);
        return Math.max(Math.abs(nx - zx), Math.abs(ny - zy)) <= 1 && performance.now() < z.until;
      })) cls.push('strat-rad');
    }
    if (ui.royal) {
      const rx = i % st.W;
      const ry = Math.floor(i / st.W);
      const z = ui.royal;
      const outside = rx < z.x0 || rx > z.x1 || ry < z.y0 || ry > z.y1;
      if (outside) cls.push('royal-out');
      else if (rx === z.x0 || rx === z.x1 || ry === z.y0 || ry === z.y1) cls.push('royal-edge');
    }
    if (centerCellsList && centerCellsList.includes(i)) cls.push('center-mark');
    if (st.flags.radiusCheck) {
      const dist = radiusDist(st, i);
      if (dist <= 3) {
        cls.push('radius-zone');
        if (radiusEdge(st, i)) cls.push('radius-edge');
      }
    }
    if (st.converted === i) cls.push('converted');
    if (st.flags.openIntent && ui.remoteSelected === i && ui.selected !== i) cls.push('intent-enemy');
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
    el.className = `piece ${p.c === 'w' ? 'w' : 'b'} t-${p.t}${p.gold ? ' gold' : ''}${p.special ? ' ' + p.special : ''}`;
    if (st.flags.strategy) {
      const hp = strategyHp(p);
      const max = strategyMaxHp(p);
      el.dataset.hp = `${hp}${st.strategy.shield[p.id] ? ' 🛡' : ''}`;
      el.classList.toggle('hp-low', hp <= max * 0.35);
    } else {
      delete el.dataset.hp;
      el.classList.remove('hp-low');
    }
    const typeKey = p.t + '|' + p.c + '|' + (p.used || 0);
    if (el.dataset.tk !== typeKey) {
      el.innerHTML = pieceSvg(p.t);
      el.dataset.tk = typeKey;
    }
    const { dx, dy } = disp(st, i);
    el.style.width = sq + 'px';
    el.style.height = sq + 'px';
    el.style.fontSize = Math.round(sq * 0.9) + 'px';
    el.style.transition = animate ? '' : 'none';
    el.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    el.style.zIndex = String(10 + dy);
    if (animate && ui.movedId && p.id === ui.movedId) {
      el.classList.add('lift');
      clearTimeout(renderPieces.liftTimer);
      renderPieces.liftTimer = setTimeout(() => el.classList.remove('lift'), 300);
    }
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
  moves.forEach((m, index) => {
    const { dx, dy } = disp(st, m.to);
    const dot = document.createElement('div');
    const capture = m.capture != null || m.ep || (m.caps && m.caps.length);
    dot.className = 'hint ' + (capture ? 'capture' : 'quiet');
    dot.style.setProperty('--d', (index * 0.012).toFixed(3) + 's');
    dot.style.width = sq + 'px';
    dot.style.height = sq + 'px';
    dot.style.transform = `translate(${dx * sq}px, ${dy * sq}px)`;
    layer.appendChild(dot);
  });
}

function renderBoard(animate) {
  if (!ui.st) return;
  const boardEl = document.getElementById('board');
  if (boardEl) boardEl.classList.toggle('fog-on', !!ui.st.flags.fog);
  layoutBoard();
  positionSquares();
  renderSquares();
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

function barOrientation() {
  return ui.tableRotated ? other(ui.orientation) : ui.orientation;
}

function updateClockEls(override) {
  if (!ui.st) return;
  if (ui.race) { updateRaceDisplay(); return; }
  const turn = ui.st.turn;
  const bottomColor = barOrientation() === 'w' ? 'w' : 'b';
  const topColor = other(bottomColor);
  const running = ui.running && ui.st.status === 'play' && ui.viewPly === ui.frames.length - 1;
  for (const color of ['w', 'b']) {
    const el = color === bottomColor ? $('#bottomClock') : $('#topClock');
    let ms = ui.clocks[color];
    if (override && override.color === color) ms = override.ms;
    else if (running && color === turn) ms = Math.max(0, ui.clocks[color] - (performance.now() - ui.turnStart));
    el.textContent = fmtClock(ms);
    el.classList.toggle('low', ui.timeMs > 0 && ms <= 20000);
  }
  $('#barBottom').classList.toggle('active', turn === bottomColor && ui.st.status === 'play');
  $('#barTop').classList.toggle('active', turn === topColor && ui.st.status === 'play');
}

function tickClocks() {
  if (ui.gameLocked) return;
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

function snap(st, lastMove = null) {
  return {
    board: st.board.slice(),
    lastMove: lastMove ? { ...lastMove } : null,
    turn: st.turn,
    ep: st.ep,
    castling: { w: { ...st.castling.w }, b: { ...st.castling.b } },
    blocked: st.blocked.slice(),
    capturedKing: st.capturedKing,
    check: st.check,
  };
}


/* ═══════════════════════ 12.5. CLASH BRAWL ═══════════════════════════ */

const BRAWL_COST = { p: 1, b: 3, n: 3, r: 4, q: 6 };
const BRAWL_NAME = { p: 'Пешка', b: 'Слон', n: 'Конь', r: 'Ладья', q: 'Ферзь' };
const BRAWL_POINTS = { p: 1, b: 3, n: 3, r: 5, q: 9, k: 10 };

function brawlDeck() {
  const keep = ['n', 'r', 'q'][Math.floor(Math.random() * 3)];
  return ['p', 'p', 'b', keep]
    .map((type) => ({ t: type, cost: BRAWL_COST[type] }))
    .sort((a, b) => a.cost - b.cost || a.t.localeCompare(b.t));
}



/* ═══════════════════ 12.9. СТРАТЕГИЯ ═══════════════════ */

const STRAT = {
  p: { hp: 10, move: 5, atk: 10, dmg: 6, range: 2 },
  b: { hp: 25, move: 7, atk: 15, dmg: 8, range: 3 },
  n: { hp: 28, move: 10, atk: 15, dmg: 12, range: 2 },
  r: { hp: 52, move: 16, atk: 24, dmg: 30, range: 5 },
  q: { hp: 75, move: 35, atk: 57, dmg: 45, range: 3 },
  k: { hp: 205, move: 35, atk: 120, dmg: 150, range: 1 },
};
const STRAT_NAMES = {
  p: 'Пешка', b: 'Слон', n: 'Конь', r: 'Ладья', q: 'Ферзь', k: 'Король',
};

function strategyInit(st) {
  stopStrategy();
  const factions = {
    w: Math.random() < 0.5 ? 'WhiteTown' : 'LightTech',
    b: Math.random() < 0.5 ? 'BlackTown' : 'DarkTech',
  };
  st.strategy = {
    hp: {}, shield: {}, moved: {}, gold: { w: 30, b: 30 }, cap: 50,
    factions, phase: 'move', hand: [], hands: {}, selected: 1, attacker: null,
    targets: new Set(), aim: new Set(), x2: false, territory: {},
    moveDone: { w: false, b: false }, attackDone: { w: false, b: false }, lastMoved: {},
    special: null, mines: [], rad: [], radTimer: 0,
  };
  for (const p of st.board) if (p) st.strategy.hp[p.id] = STRAT[p.t].hp;
  ui.strategy = st.strategy;
  st.strategy.gold = { w: 30, b: 30 };
  st.strategy.cap = 50;
  document.documentElement.dataset.strategy = '1';
  $('#strategyBar').classList.remove('hidden');
  $('#stratInfoPanel').classList.remove('hidden');
  strategyDrawHand(st.turn);
  strategyUpdateInfo(st.board.find((p) => p && p.c === 'w' && p.t === 'q') || st.board.find((p) => p && p.c === 'w'));
  st.strategy.radTimer = setInterval(strategyRadiationTick, 250);
  strategyRender();
}

function stopStrategy() {
  if (ui.strategy && ui.strategy.radTimer) clearInterval(ui.strategy.radTimer);
  ui.strategy = null;
  document.documentElement.dataset.strategy = '0';
  const bar = $('#strategyBar');
  if (bar) bar.classList.add('hidden');
  const info = $('#stratInfoPanel');
  if (info) info.classList.add('hidden');
}

function strategyHp(p) {
  const st = ui.st;
  if (!st || !st.strategy || !p) return 0;
  const v = st.strategy.hp[p.id];
  return v == null ? STRAT[p.t].hp : v;
}

function strategyMaxHp(p) { return STRAT[p.t] ? STRAT[p.t].hp : 10; }
function strategyGold(color) { return ui.st && ui.st.strategy ? ui.st.strategy.gold[color] : 0; }

function strategyOnEnemyHalf(st, sq, color) {
  const y = Math.floor(sq / st.W);
  return color === 'w' ? y >= Math.ceil(st.H / 2) : y < Math.floor(st.H / 2);
}

function strategyCost(base, st, sq, color) {
  return Math.round(base * (strategyOnEnemyHalf(st, sq, color) ? 1.1 : 1));
}

function strategyAddGold(color, amount) {
  const s = ui.st && ui.st.strategy;
  if (!s) return;
  s.gold[color] = Math.min(s.cap, s.gold[color] + amount);
}

function strategyIncome(color) {
  const s = ui.st && ui.st.strategy;
  if (!s) return;
  let amount = 5;
  if (s.x2) { amount *= 2; s.x2 = false; }
  strategyAddGold(color, amount);
  toast(`+${amount} в казну`);
}

function strategyDrawHand(color) {
  const s = ui.st && ui.st.strategy;
  if (!s) return;
  const types = [...new Set(ui.st.board.filter((p) => p && p.c === color).map((p) => p.t))];
  const hand = [];
  const addSupport = () => (Math.random() < 0.3 ? 'heal' : (Math.random() < 0.15 && s.gold[color] >= 50 ? 'shield' : null));
  for (let i = 0; i < 4; i++) {
    const support = addSupport();
    if (support) hand.push({ kind: support, cost: support === 'shield' ? 50 : 35 });
    else {
      const type = types[Math.floor(Math.random() * types.length)] || 'p';
      hand.push({ kind: 'piece', type, cost: STRAT[type].atk });
    }
  }
  s.hands[color] = hand;
  if (color === ui.st.turn) {
    s.hand = hand;
    s.selected = 1;
  }
  s.attacker = null;
  s.targets = new Set();
  s.aim = new Set();
}

function strategyRender() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s) return;
  const fw = $('#stratFactionW');
  const fb = $('#stratFactionB');
  if (fw) fw.textContent = s.factions.w;
  if (fb) fb.textContent = s.factions.b;
  const gw = $('#stratGoldW');
  const gb = $('#stratGoldB');
  if (gw) gw.textContent = `${s.gold.w}/${s.cap}`;
  if (gb) gb.textContent = `${s.gold.b}/${s.cap}`;
  const badgeW = $('#stratGoldBadgeW');
  const badgeB = $('#stratGoldBadgeB');
  if (badgeW) badgeW.classList.toggle('active', st.turn === 'w');
  if (badgeB) badgeB.classList.toggle('active', st.turn === 'b');
  const phase = $('#stratPhase');
  if (phase) phase.textContent = st.turn === 'w' ? (s.phase === 'move' ? 'Ход белых' : 'Атака белых') : (s.phase === 'move' ? 'Ход чёрных' : 'Атака чёрных');
  const action = $('#stratAction');
  if (action) {
    const who = st.turn === 'w' ? 'белых' : 'чёрных';
    action.textContent = s.phase === 'move' ? `Ход ${who}: передвинь фигуру` : `Атака ${who}: выбери фигуру и жёлтую клетку`;
    action.classList.toggle('attack', s.phase === 'attack');
  }
  strategyRenderCards();
  strategyRenderTerritory();
  const sp = $('#stratSpecial');
  if (sp) {
    const atk = s.attacker != null ? st.board[s.attacker] : null;
    const labels = { n: '💣 Мина (15)', r: '🪨 Катапульта', q: '🚀 Ракета', k: '☢ Ядерка (120)' };
    sp.textContent = atk && labels[atk.t] ? labels[atk.t] : 'Спец';
    sp.disabled = !atk || !labels[atk.t];
  }
}

function strategyRenderCards() {
  const box = $('#stratCards');
  const s = ui.strategy;
  if (!box || !s) return;
  box.innerHTML = '';
  s.hand.slice(0, 4).forEach((card, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    const cost = card.cost != null ? card.cost : (card.kind === 'piece' ? STRAT[card.type].atk : card.kind === 'shield' ? 50 : 35);
    const locked = s.gold[ui.st.turn] < cost;
    el.className = 'strat-card' + (i === s.selected ? ' sel' : '') + (card.kind === 'heal' ? ' heal' : card.kind === 'shield' ? ' shield' : '') + (locked ? ' locked' : '');
    if (card.kind === 'piece') {
      const meta = STRAT[card.type] || STRAT.p;
      el.innerHTML = `<span class="sc-icon">${pieceSvg(card.type)}</span><span class="sc-name">${STRAT_NAMES[card.type] || card.type}</span><span class="sc-stats">${meta.hp} HP · ${meta.move}/${meta.atk}</span><span class="strat-card-cost">${cost}💰</span>`;
    } else {
      el.innerHTML = `<span class="sc-icon">${card.kind === 'heal' ? '💜' : '🛡'}</span><span class="sc-name">${card.kind === 'heal' ? 'Хилл' : 'Щит'}</span><span class="sc-stats">${card.kind === 'heal' ? '15–25 HP' : '+30 HP'}</span><span class="strat-card-cost">${cost}💰</span>`;
    }
    el.addEventListener('click', () => {
      if (locked) { toast('Не хватает золота на эту карточку'); return; }
      s.selected = i;
      strategyRenderCards();
    });
    box.appendChild(el);
  });
}

function strategyUpdateInfo(p) {
  if (!p || !ui.st || !ui.st.strategy) return;
  const meta = STRAT[p.t] || STRAT.p;
  const f = $('#sipFaction');
  if (f) f.textContent = ui.st.strategy.factions[p.c];
  const glyph = $('#sipGlyph');
  if (glyph) glyph.innerHTML = pieceSvg(p.t);
  const name = $('#sipName');
  if (name) name.textContent = STRAT_NAMES[p.t] || p.t;
  const hp = $('#sipHp');
  if (hp) hp.textContent = `${strategyHp(p)} / ${meta.hp} HP`;
  const mc = $('#sipMoveCost');
  if (mc) mc.textContent = String(meta.move);
  const ac = $('#sipAtkCost');
  if (ac) ac.textContent = String(meta.atk);
  const dmg = $('#sipDmg');
  if (dmg) dmg.textContent = p.t === 'q' ? '35–55' : String(meta.dmg);
  const desc = $('#sipDesc');
  if (desc) {
    desc.textContent = p.t === 'n' ? 'Спецатака: мина на 3 хода, взрыв 25–35.'
      : p.t === 'r' ? 'Спецатака: катапульта на 2–6 клеток, камень 30.'
      : p.t === 'q' ? 'Спецатака: ракета по 8 направлениям, 35–55 и отбрасывание.'
      : p.t === 'k' ? 'Спецатака: ядерка 150, разброс и радиация.'
      : p.t === 'b' ? 'Атака: три шара — 8 и по 4 по бокам.'
      : p.t === 'p' ? 'Атака: снаряд на 2 клетки (4, если не ходила).'
      : 'Карточка фигуры.';
  }
}

function strategyShowPieceCard(p) {
  const s = ui.strategy;
  if (!s || !p) return;
  s.hand[s.selected] = { kind: 'piece', type: p.t, cost: STRAT[p.t].atk };
  strategyRenderCards();
  strategyUpdateInfo(p);
}

function strategyTerritory() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s) return {};
  const map = {};
  for (let i = 0; i < st.board.length; i++) {
    const y = Math.floor(i / st.W);
    map[i] = y < Math.ceil(st.H / 2) ? 'w' : 'b';
  }
  const ownNear = (sq, color, source) => {
    const x = sq % st.W;
    const y = Math.floor(sq / st.W);
    for (let i = 0; i < st.board.length; i++) {
      if (i === source) continue;
      const q = st.board[i];
      if (!q || q.c !== color) continue;
      if (Math.max(Math.abs(i % st.W - x), Math.abs(Math.floor(i / st.W) - y)) <= 3) return true;
    }
    return false;
  };
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p || p.t === 'k') continue;
    if (!strategyOnEnemyHalf(st, i, p.c)) continue;
    const cells = [i];
    const x = i % st.W;
    const y = Math.floor(i / st.W);
    for (const [dx, dy] of ROOK_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (inside(st, nx, ny)) cells.push(sqAt(st, nx, ny));
    }
    for (const c of cells) {
      if (ownNear(c, p.c, i)) continue;
      map[c] = p.c;
    }
  }
  s.territory = map;
  return map;
}

function strategyRenderTerritory() {
  if (!ui.st || !ui.st.strategy) return;
  strategyTerritory();
}

function strategyAttackData(p, sq) {
  const st = ui.st;
  const s = st.strategy;
  const aim = new Set();
  const targets = new Set();
  const add = (s) => { if (inside(st, s % st.W, Math.floor(s / st.W))) aim.add(s); };
  const enemy = (s) => { const q = st.board[s]; return q && q.c !== p.c; };
  const x = sq % st.W;
  const y = Math.floor(sq / st.W);
  if (s.special === 'catapult' && p.t === 'r') {
    for (const [dx, dy] of ROOK_DIRS) {
      for (let d = 2; d <= 6; d++) {
        const nx = x + dx * d, ny = y + dy * d;
        if (!inside(st, nx, ny)) break;
        const cell = sqAt(st, nx, ny);
        const q = st.board[cell];
        if (q && q.c === p.c) break;
        aim.add(cell);
        targets.add(cell);
        if (q) break;
      }
    }
    return { aim, targets };
  }
  if (s.special === 'rocket' && p.t === 'q') {
    for (const [dx, dy] of QUEEN_DIRS) {
      for (let d = 1; d <= 6; d++) {
        const nx = x + dx * d, ny = y + dy * d;
        if (!inside(st, nx, ny)) break;
        const cell = sqAt(st, nx, ny);
        const q = st.board[cell];
        if (q && q.c === p.c) break;
        aim.add(cell);
        targets.add(cell);
        if (q) break;
      }
    }
    return { aim, targets };
  }
  if (s.special === 'nuke' && p.t === 'k') {
    for (let i = 0; i < st.board.length; i++) {
      const q = st.board[i];
      if (!q) continue;
      const nx = i % st.W, ny = Math.floor(i / st.W);
      if (Math.max(Math.abs(nx - x), Math.abs(ny - y)) <= 3) {
        aim.add(i);
        if (q.c !== p.c) targets.add(i);
      }
    }
    return { aim, targets };
  }
  if (p.t === 'p') {
    const dir = p.c === 'w' ? 1 : -1;
    const max = (st.strategy.moved[p.id] ? 2 : 4);
    for (let d = 1; d <= max; d++) {
      const nx = x, ny = y + dir * d;
      if (!inside(st, nx, ny)) break;
      const s = sqAt(st, nx, ny);
      add(s);
      if (d === max && !st.board[s]) targets.add(s);
      if (enemy(s)) targets.add(s);
      if (st.board[s]) break;
    }
  } else if (p.t === 'n') {
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(st, nx, ny)) continue;
      const s = sqAt(st, nx, ny);
      aim.add(s);
      if (!st.board[s] || enemy(s)) targets.add(s);
    }
  } else {
    const dirs = p.t === 'r' ? ROOK_DIRS : p.t === 'b' ? BISHOP_DIRS : QUEEN_DIRS;
    const range = p.t === 'k' ? 1 : STRAT[p.t].range;
    for (const [dx, dy] of dirs) {
      for (let d = 1; d <= range; d++) {
        const nx = x + dx * d, ny = y + dy * d;
        if (!inside(st, nx, ny)) break;
        const s = sqAt(st, nx, ny);
        if (st.board[s] && st.board[s].c === p.c) break;
        add(s);
        targets.add(s);
        if (st.board[s]) break;
      }
    }
  }
  return { aim, targets };
}

function strategySelectAttacker(sq) {
  const st = ui.st;
  const s = st.strategy;
  const p = st.board[sq];
  if (!p || p.c !== st.turn) return;
  const data = strategyAttackData(p, sq);
  s.attacker = sq;
  s.targets = data.targets;
  s.aim = data.aim;
  ui.selected = sq;
  strategyShowPieceCard(p);
  strategyRender();
  renderSquares();
}

function strategyClick(sq) {
  const st = ui.st;
  const s = st.strategy;
  if (!s || st.status !== 'play' || ui.gameLocked || ui.paused) return;
  if (ui.bot && st.turn === ui.bot.color) return;
  const p = st.board[sq];
  if (p) strategyUpdateInfo(p);

  if (s.phase === 'attack') {
    if (p && p.c === st.turn) {
      strategySelectAttacker(sq);
      return;
    }
    if (s.attacker != null && s.targets.has(sq)) {
      strategyAttack(s.attacker, sq);
      return;
    }
    s.attacker = null;
    s.targets = new Set();
    s.aim = new Set();
    renderSquares();
    return;
  }

  if (s.selected != null && s.hand[s.selected] && (s.hand[s.selected].kind === 'heal' || s.hand[s.selected].kind === 'shield')) {
    if (p && p.c === st.turn) { strategyUseSupport(s.hand[s.selected].kind, sq); return; }
  }

  if (ui.selected >= 0) {
    const candidates = legalMoves(st, st.turn).filter((m) => m.from === ui.selected && m.to === sq);
    if (candidates.length) {
      if (st.board[sq] && st.board[sq].c !== st.turn) strategyMelee(ui.selected, sq);
      else commitMove(candidates[0]);
      ui.selected = -1;
      return;
    }
  }
  if (p && p.c === st.turn) {
    ui.selected = sq;
    strategyShowPieceCard(p);
    renderSquares();
    renderHints();
  } else {
    ui.selected = -1;
    renderSquares();
  }
}

function strategyMelee(from, to) {
  const st = ui.st;
  const s = st.strategy;
  const p = st.board[from];
  const target = st.board[to];
  if (!p || !target) return;
  const cost = strategyCost(STRAT[p.t].move, st, from, p.c);
  if (s.gold[p.c] < cost) { toast('Не хватает очков на ход'); return; }
  s.gold[p.c] -= cost;
  s.moved[p.id] = true;
  const dmg = strategyHp(p);
  const died = strategyDamage(target, dmg);
  if (died) {
    const victimHp = STRAT[target.t].hp;
    if (target.t === 'k') st.capturedKing = target.c;
    st.board[to] = p;
    st.board[from] = null;
    st.strategy.hp[p.id] = Math.max(1, strategyHp(p) - Math.round(victimHp * 0.5));
    st.full++;
    if (target.t === 'k') {
      renderAll(false);
      const res = updateStatus(st);
      if (res) finishGame(res);
      return;
    }
  }
  renderAll(false);
  const res = updateStatus(st);
  if (res) { finishGame(res); return; }
  strategyAfterMove(p.c, to);
}


function strategyCellXY(sq) {
  const { dx, dy } = disp(ui.st, sq);
  return { x: (dx + 0.5) * ui.sq, y: (dy + 0.5) * ui.sq };
}

function strategyProjectile(from, to, icon) {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  const a = strategyCellXY(from);
  const b = strategyCellXY(to);
  const el = document.createElement('span');
  el.className = 'strat-proj';
  el.textContent = icon || '•';
  el.style.left = '0px';
  el.style.top = '0px';
  layer.appendChild(el);
  const midX = (a.x + b.x) / 2;
  const midY = Math.min(a.y, b.y) - 46;
  el.animate([
    { transform: `translate(${a.x}px,${a.y}px) scale(.7)`, opacity: 0 },
    { transform: `translate(${midX}px,${midY}px) scale(1.35)`, opacity: 1, offset: .55 },
    { transform: `translate(${b.x}px,${b.y}px) scale(.8)`, opacity: .9 },
  ], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
  setTimeout(() => { el.remove(); strategyBurst(to, '#ffd45e'); }, 420);
}

function strategyBurst(sq, color) {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  const { x, y } = strategyCellXY(sq);
  const ring = document.createElement('span');
  ring.className = 'strat-ring';
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  layer.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
  for (let i = 0; i < 12; i++) {
    const el = document.createElement('span');
    el.className = 'strat-particle';
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 46;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.setProperty('--c', color || '#ffd45e');
    el.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
    el.style.setProperty('--ty', Math.sin(ang) * dist + 'px');
    layer.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }
}

function strategyKnockback(sq) {
  const st = ui.st;
  const p = st.board[sq];
  if (!p || p.t === 'q' || p.t === 'k' || p.t === 'r') return;
  const x = sq % st.W;
  const y = Math.floor(sq / st.W);
  const spots = [];
  for (const [dx, dy] of QUEEN_DIRS) {
    const nx = x + dx, ny = y + dy;
    if (!inside(st, nx, ny)) continue;
    const s = sqAt(st, nx, ny);
    if (!st.board[s]) spots.push(s);
  }
  if (!spots.length) return;
  const target = spots[Math.floor(Math.random() * spots.length)];
  st.board[target] = p;
  st.board[sq] = null;
}

function strategyNuke(sq) {
  const board = $('#board');
  const layer = $('#brawlLayer');
  if (!board || !layer || !ui.st) return;
  const dark = document.createElement('div');
  dark.className = 'strat-nuke-dark';
  board.appendChild(dark);
  setTimeout(() => dark.remove(), 800);
  const flash = document.createElement('div');
  flash.className = 'strat-flash';
  board.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
  const x = sq % ui.st.W;
  const y = Math.floor(sq / ui.st.W);
  const br = board.getBoundingClientRect();
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inside(ui.st, nx, ny)) continue;
      const cell = sqAt(ui.st, nx, ny);
      const src = ui.squareEls[cell];
      if (!src) continue;
      const rect = src.getBoundingClientRect();
      const tile = document.createElement('div');
      tile.className = 'strat-tile';
      tile.style.left = (rect.left - br.left) + 'px';
      tile.style.top = (rect.top - br.top) + 'px';
      tile.style.width = rect.width + 'px';
      tile.style.height = rect.height + 'px';
      tile.style.background = getComputedStyle(src).backgroundColor;
      tile.style.setProperty('--tx', (dx * 20 + (Math.random() * 160 - 80)) + 'px');
      tile.style.setProperty('--ty', (-60 - Math.random() * 160) + 'px');
      tile.style.setProperty('--rz', (Math.random() * 180 - 90) + 'deg');
      layer.appendChild(tile);
      setTimeout(() => tile.remove(), 1350);
    }
  }
  for (let i = 0; i < 26; i++) {
    const shard = document.createElement('span');
    shard.className = 'strat-shard';
    const ang = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 180;
    shard.style.left = strategyCellXY(sq).x + 'px';
    shard.style.top = strategyCellXY(sq).y + 'px';
    shard.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
    shard.style.setProperty('--ty', Math.sin(ang) * dist - 40 + 'px');
    shard.style.setProperty('--c', i % 2 ? '#30d5ff' : '#f5fbff');
    layer.appendChild(shard);
    setTimeout(() => shard.remove(), 1000);
  }
  board.classList.remove('shake-2');
  void board.offsetWidth;
  board.classList.add('shake-2');
  setTimeout(() => board.classList.remove('shake-2'), 500);
  const ring = document.createElement('span');
  ring.className = 'strat-ring';
  ring.style.left = strategyCellXY(sq).x + 'px';
  ring.style.top = strategyCellXY(sq).y + 'px';
  layer.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
}

function strategyPlaceMine() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || !s.attacker) return;
  const sq = s.attacker;
  const p = st.board[sq];
  if (!p || p.t !== 'n' || p.c !== st.turn) return;
  if (s.gold[p.c] < 15) { toast('Мина стоит 15 очков'); return; }
  s.gold[p.c] -= 15;
  s.mines.push({ sq, owner: p.c, expires: st.full + 6 });
  strategyFloat(sq, '💣 мина', 'blue');
  s.special = null;
  toast('Мина установлена на 3 хода');
  renderAll(false);
  strategyEndTurn();
}

function strategyCheckMines() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || st.status !== 'play') return;
  for (let m = s.mines.length - 1; m >= 0; m--) {
    const mine = s.mines[m];
    if (st.full >= mine.expires) { s.mines.splice(m, 1); continue; }
    const x = mine.sq % st.W;
    const y = Math.floor(mine.sq / st.W);
    let victim = -1;
    for (let i = 0; i < st.board.length; i++) {
      const q = st.board[i];
      if (!q || q.c === mine.owner) continue;
      const nx = i % st.W, ny = Math.floor(i / st.W);
      if (Math.max(Math.abs(nx - x), Math.abs(ny - y)) <= 1) { victim = i; break; }
    }
    if (victim < 0) continue;
    const q = st.board[victim];
    const dmg = 25 + Math.floor(Math.random() * 11);
    strategyBurst(mine.sq, '#ff7b3b');
    strategyProjectile(mine.sq, victim, '💥');
    strategyDamage(q, dmg);
    strategyFloat(victim, `-${dmg}`, 'red');
    s.mines.splice(m, 1);
    toast('💣 Мина взорвалась');
    if (strategyHp(q) <= 0) {
      st.board[victim] = null;
      if (q.t === 'k') st.capturedKing = q.c;
    }
    renderAll(false);
    const res = updateStatus(st);
    if (res) finishGame(res);
    return;
  }
}

function strategyRadiationTick() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || st.status !== 'play' || ui.paused || ui.away) return;
  const now = performance.now();
  let changed = false;
  for (let r = s.rad.length - 1; r >= 0; r--) {
    const zone = s.rad[r];
    if (now > zone.until) { s.rad.splice(r, 1); changed = true; continue; }
    if (now - zone.last < 2000) continue;
    zone.last = now;
    const zx = zone.sq % st.W, zy = Math.floor(zone.sq / st.W);
    for (let i = 0; i < st.board.length; i++) {
      const q = st.board[i];
      if (!q) continue;
      const nx = i % st.W, ny = Math.floor(i / st.W);
      if (Math.max(Math.abs(nx - zx), Math.abs(ny - zy)) > 1) continue;
      strategyDamage(q, 2);
      strategyFloat(i, '-2 ☢', 'rad');
      if (strategyHp(q) <= 0) {
        st.board[i] = null;
        if (q.t === 'k') st.capturedKing = q.c;
        changed = true;
      }
    }
    changed = true;
  }
  if (changed) {
    renderAll(false);
    const res = updateStatus(st);
    if (res) finishGame(res);
  }
}

function strategySpecial() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || s.phase !== 'attack' || s.attacker == null) return;
  const sq = s.attacker;
  const p = st.board[sq];
  if (!p || p.c !== st.turn) return;
  if (p.t === 'n') { strategyPlaceMine(); return; }
  const map = { r: 'catapult', q: 'rocket', k: 'nuke' };
  if (!map[p.t]) return;
  s.special = s.special === map[p.t] ? null : map[p.t];
  strategySelectAttacker(sq);
  strategyRender();
  toast(s.special ? 'Выбери цель спецатаки' : 'Спецатака отменена');
}

function strategyAttack(from, to) {
  const st = ui.st;
  const s = st.strategy;
  const p = st.board[from];
  const target = st.board[to] || null;
  if (!p) return;
  const cost = strategyCost(STRAT[p.t].atk, st, from, p.c);
  if (s.gold[p.c] < cost) { toast('Не хватает очков на атаку'); return; }
  s.gold[p.c] -= cost;
  s.moved[p.id] = true;
  const special = s.special;
  s.special = null;
  let dmg = STRAT[p.t].dmg;
  if (p.t === 'q') dmg = 35 + Math.floor(Math.random() * 21);
  if (special === 'catapult') dmg = 30;
  if (strategyOnEnemyHalf(st, from, p.c)) dmg = Math.round(dmg * 1.15);
  const icon = special === 'catapult' ? '🪨' : special === 'rocket' ? '🚀' : p.t === 'n' ? '🐴' : p.t === 'b' ? '🔮' : p.t === 'k' ? '☢' : '•';
  strategyProjectile(from, to, icon);
  if (special === 'nuke') {
    strategyNuke(to);
    const targetsAoe = [];
    for (let i = 0; i < st.board.length; i++) {
      const q = st.board[i];
      if (!q || q === target) continue;
      const nx = i % st.W, ny = Math.floor(i / st.W);
      const tx = to % st.W, ty = Math.floor(to / st.W);
      if (Math.max(Math.abs(nx - tx), Math.abs(ny - ty)) <= 2) targetsAoe.push(i);
    }
    const nukeDied = target ? strategyDamage(target, 150) : false;
    if (target) strategyFloat(to, '-150', 'red');
    if (target && target.t === 'k') st.capturedKing = target.c;
    if (nukeDied && st.board[to]) st.board[to] = null;
    for (const i of targetsAoe) {
      const q = st.board[i];
      if (!q) continue;
      if (q.c !== p.c) { strategyDamage(q, 60); strategyFloat(i, '-60', 'red'); }
      strategyKnockback(i);
    }
    s.rad.push({ sq: to, until: performance.now() + 16000, last: performance.now() });
  } else {
    const died = target ? strategyDamage(target, dmg) : false;
    strategyBurst(to, special === 'rocket' ? '#ff9d3b' : '#ffd45e');
    if (target) strategyFloat(to, `-${dmg}`, 'red');

    if (p.t === 'b') {
      let side = 0;
      for (const [dx, dy] of QUEEN_DIRS) {
        if (side >= 2) break;
        const nx = to % st.W + dx, ny = Math.floor(to / st.W) + dy;
        if (!inside(st, nx, ny)) continue;
        const cell = sqAt(st, nx, ny);
        const q = st.board[cell];
        if (q && q.c !== p.c) {
          strategyProjectile(from, cell, '🔮');
          strategyDamage(q, 4);
          strategyFloat(cell, '-4', 'red');
          side++;
        }
      }
    }
    if (p.t === 'n') {
      const recoil = 3 + Math.floor(Math.random() * 3);
      st.strategy.hp[p.id] = Math.max(0, strategyHp(p) - recoil);
    }
    if (special === 'rocket' && !died && target) strategyKnockback(to);
    if (target && target.t === 'k') st.capturedKing = target.c;
    if (died && st.board[to]) st.board[to] = null;
  }
  renderAll(false);
  const res = updateStatus(st);
  if (res) { finishGame(res); return; }
  strategyEndTurn();
}

function strategyDamage(piece, dmg) {
  const st = ui.st;
  const s = st.strategy;
  if (!piece) return false;
  const shield = s.shield[piece.id] || 0;
  if (shield > 0) {
    const absorbed = Math.min(shield, dmg);
    s.shield[piece.id] = shield - absorbed;
    dmg -= absorbed;
  }
  const hp = Math.max(0, strategyHp(piece) - dmg);
  s.hp[piece.id] = hp;
  return hp <= 0;
}

function strategyFloat(sq, text, cls) {
  if (!ui.st || !ui.sq) return;
  const layer = $('#brawlLayer');
  if (!layer) return;
  const { dx, dy } = disp(ui.st, sq);
  const el = document.createElement('span');
  el.className = 'floating-dmg ' + (cls || 'red');
  el.textContent = text;
  el.style.left = ((dx + 0.5) * ui.sq) + 'px';
  el.style.top = ((dy + 0.5) * ui.sq) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function strategyUseSupport(kind, sq) {
  const st = ui.st;
  const s = st.strategy;
  const p = st.board[sq];
  if (!p || p.c !== st.turn) return;
  if (kind === 'heal') {
    const heal = 15 + Math.floor(Math.random() * 11);
    const cost = Math.ceil(heal * 1.5);
    if (s.gold[p.c] < cost) { toast('Не хватает очков на хилл'); return; }
    s.gold[p.c] -= cost;
    const max = strategyMaxHp(p);
    s.hp[p.id] = Math.min(max, strategyHp(p) + heal);
    strategyFloat(sq, `+${heal}`, 'green');
  } else {
    if (s.gold[p.c] < 50) { toast('Щит стоит 50 очков'); return; }
    s.gold[p.c] -= 50;
    s.shield[p.id] = (s.shield[p.id] || 0) + 30;
    strategyFloat(sq, '🛡+30', 'blue');
  }
  s.hand[s.selected] = { kind: 'piece', type: p.t };
  renderAll(false);
}

function strategyPrepareAttack(color) {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s) return;
  s.phase = 'attack';
  st.turn = color;
  s.attacker = null;
  s.targets = new Set();
  s.aim = new Set();
  s.special = null;
  if (s.hands[color]) s.hand = s.hands[color];
  const sq = s.lastMoved[color];
  if (sq != null) {
    const p = st.board[sq];
    if (p && p.c === color) strategySelectAttacker(sq);
  }
  renderAll(false);
  if (ui.bot && st.turn === ui.bot.color) setTimeout(strategyBotAttack, 650);
}

function strategyAfterMove(mover, to) {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || st.status !== 'play') return;
  mover = mover || st.turn;
  if (to != null) s.lastMoved[mover] = to;
  s.moveDone[mover] = true;
  s.attacker = null;
  s.targets = new Set();
  s.aim = new Set();
  s.special = null;
  if (s.moveDone.w && s.moveDone.b) {
    s.attackDone = { w: false, b: false };
    strategyCheckMines();
    strategyPrepareAttack('w');
    return;
  }
  st.turn = other(mover);
  s.phase = 'move';
  strategyIncome(st.turn);
  strategyDrawHand(st.turn);
  strategyCheckMines();
  renderAll(false);
  if (ui.bot && st.turn === ui.bot.color) setTimeout(maybeBotTurn, 500);
}

function strategyEndTurn() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || s.phase !== 'attack') return;
  const mover = st.turn;
  s.attackDone[mover] = true;
  s.attacker = null;
  s.targets = new Set();
  s.aim = new Set();
  s.special = null;
  if (s.attackDone.w && s.attackDone.b) {
    s.phase = 'move';
    s.moveDone = { w: false, b: false };
    s.attackDone = { w: false, b: false };
    s.lastMoved = {};
    st.turn = 'w';
    strategyIncome('w');
    strategyDrawHand('w');
    strategyCheckMines();
    renderAll(false);
    if (ui.bot && st.turn === ui.bot.color) setTimeout(maybeBotTurn, 500);
    return;
  }
  st.turn = other(mover);
  strategyPrepareAttack(st.turn);
}

function strategyBotAttack() {
  const st = ui.st;
  const s = st && st.strategy;
  if (!s || st.turn !== ui.bot.color || s.phase !== 'attack') return;
  const options = [];
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p || p.c !== st.turn) continue;
    const data = strategyAttackData(p, i);
    for (const t of data.targets) options.push([i, t]);
  }
  if (!options.length) { strategyEndTurn(); return; }
  const [from, to] = options[Math.floor(Math.random() * options.length)];
  strategyAttack(from, to);
}

/* ─────────── драфт Clash Brawl: баны, пики, случайные цвета ─────────── */

function brawlDraftPool() {
  return ['p', 'p', 'b', 'n', 'r', 'q'].map((type, i) => ({
    id: type + '-' + i + '-' + Math.random().toString(36).slice(2, 6),
    slot: type + '-' + i,
    t: type,
  }));
}

function startBrawlDraft() {
  const st = ui.st;
  if (!st || !st.flags.clashBrawl) return;
  const poolW = brawlDraftPool();
  const poolB = brawlDraftPool();
  const slots = ['p-0', 'p-1', 'b-2', 'n-3', 'r-4', 'q-5'];
  const protectCount = 1 + (Math.random() < 0.5 ? 1 : 0);
  const protectedTypes = new Set();
  while (protectedTypes.size < protectCount) {
    protectedTypes.add(slots[Math.floor(Math.random() * slots.length)]);
  }
  const botColor = ui.bot ? (Math.random() < 0.5 ? 'w' : 'b') : null;
  ui.brawl.draft = {
    pools: { w: poolW, b: poolB },
    protected: protectedTypes,
    bans: { w: [], b: [] },
    picks: { w: [], b: [] },
    step: 'ban',
    turn: 'w',
    botColor,
    done: false,
  };
  ui.brawl.decks = { w: [], b: [] };
  ui.gameLocked = true;
  $('#brawlDraft').classList.remove('hidden');
  renderBrawlDraft();
  if (botColor === 'w') setTimeout(draftBotTurn, 500);
}

function draftColorName(color) {
  const en = profile.language === 'en';
  return color === 'w' ? (en ? 'White' : 'Белые') : (en ? 'Black' : 'Чёрные');
}

function renderBrawlDraft() {
  const d = ui.brawl && ui.brawl.draft;
  if (!d) return;
  const en = profile.language === 'en';
  const color = d.turn;
  const pick = d.step === 'pick';
  const status = pick
    ? (en ? `${draftColorName(color)} picks cards: ${d.picks[color].length}/4` : `${draftColorName(color)} выбирает карты: ${d.picks[color].length}/4`)
    : (en ? `${draftColorName(color)} bans one piece` : `${draftColorName(color)} запрещает одну фигуру`);
  $('#bdTitle').textContent = en ? 'Clash Brawl draft' : 'Драфт Clash Brawl';
  $('#bdStatus').textContent = status;
  const prot = $('#bdProtected');
  if (prot) {
    const names = [...new Set([...d.protected].map((slot) => BRAWL_NAME[slot[0]]))];
    prot.textContent = names.length
      ? (en ? 'Protected this game: ' : 'Защищены в этой партии: ') + names.join(', ')
      : '';
  }
  const pool = $('#bdPool');
  if (pool) {
    pool.innerHTML = '';
    for (const card of d.pools[color]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brawl-card' + (d.protected.has(card.slot) ? ' protected' : '');
      b.style.color = color === 'w' ? '#fff' : '#9fc6ff';
      b.innerHTML = `<span class="brawl-card-cost">${BRAWL_COST[card.t]}</span>${pieceSvg(card.t, 'brawl-pc')}<span class="brawl-card-name">${BRAWL_NAME[card.t]}</span>`;
      b.addEventListener('click', () => brawlDraftCard(card.id));
      pool.appendChild(b);
    }
  }
  const decks = $('#bdDecks');
  if (decks) {
    decks.innerHTML = ['w', 'b'].map((c) => `<span>${draftColorName(c)}: <b>${d.picks[c].map((t) => BRAWL_NAME[t]).join(' · ') || '—'}</b></span>`).join('');
  }
}

function brawlDraftCard(id) {
  const d = ui.brawl && ui.brawl.draft;
  if (!d || d.done) return;
  const color = d.turn;
  const pool = d.pools[color];
  const card = pool.find((c) => c.id === id);
  if (!card) return;
  if (d.step === 'ban') {
    if (d.protected.has(card.slot)) {
      toast(profile.language === 'en' ? 'This piece is protected this game' : 'Эту фигуру нельзя запретить в этой партии');
      return;
    }
    d.pools[color] = pool.filter((c) => c.id !== id);
    d.bans[color].push(card.t);
    if (color === 'w') {
      d.turn = 'b';
    } else {
      d.step = 'pick';
      d.turn = 'w';
    }
    renderBrawlDraft();
    if (d.botColor === d.turn) setTimeout(draftBotTurn, 450);
    return;
  }
  const np = d.picks[color].filter((t) => t === 'n' || t === 'r' || t === 'q').length;
  if ((card.t === 'n' || card.t === 'r' || card.t === 'q') && np >= 2) {
    toast(profile.language === 'en' ? 'Only two non-pawn cards are allowed' : 'Можно выбрать только две не-пешки');
    return;
  }
  d.pools[color] = pool.filter((c) => c.id !== id);
  d.picks[color].push(card.t);
  if (d.picks[color].length >= 4) {
    if (color === 'w') d.turn = 'b';
    else finishBrawlDraft();
  }
  renderBrawlDraft();
  if (d.done) return;
  if (d.botColor === d.turn) setTimeout(draftBotTurn, 450);
}

function draftBotTurn() {
  const d = ui.brawl && ui.brawl.draft;
  if (!d || d.done || d.botColor !== d.turn) return;
  const color = d.turn;
  const pool = d.pools[color];
  const valid = pool.filter((card) => {
    if (d.step === 'ban') return !d.protected.has(card.slot);
    const np = d.picks[color].filter((t) => t === 'n' || t === 'r' || t === 'q').length;
    if ((card.t === 'n' || card.t === 'r' || card.t === 'q') && np >= 2) return false;
    return true;
  });
  if (!valid.length) return;
  brawlDraftCard(valid[Math.floor(Math.random() * valid.length)].id);
}

function finishBrawlDraft() {
  const d = ui.brawl && ui.brawl.draft;
  if (!d) return;
  d.done = true;
  ui.brawl.decks.w = d.picks.w.map((t) => ({ t, cost: BRAWL_COST[t] }))
    .sort((a, b) => a.cost - b.cost || a.t.localeCompare(b.t));
  ui.brawl.decks.b = d.picks.b.map((t) => ({ t, cost: BRAWL_COST[t] }))
    .sort((a, b) => a.cost - b.cost || a.t.localeCompare(b.t));
  $('#brawlDraft').classList.add('hidden');
  ui.brawl.draft = null;
  ui.gameLocked = false;
  if (d.botColor) {
    ui.bot.color = d.botColor;
    profile.side = other(d.botColor);
    ui.orientation = other(d.botColor);
  } else {
    ui.orientation = Math.random() < 0.5 ? 'w' : 'b';
  }
  if (Math.random() < 0.5) ui.st.turn = 'b';
  renderAll(false);
  renderPlayers();
  renderBrawl();
  toast(profile.language === 'en' ? 'Draft complete — fight!' : 'Драфт завершён — в бой!');
  if (ui.bot && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 700);
}

function autoBrawlDraft() {
  const d = ui.brawl && ui.brawl.draft;
  if (!d) return;
  let guard = 0;
  while (ui.brawl && ui.brawl.draft && guard < 40) {
    const color = ui.brawl.draft.turn;
    const pool = ui.brawl.draft.pools[color];
    if (!pool || !pool.length) break;
    const valid = pool.filter((card) => {
      if (ui.brawl.draft.step === 'ban') return !ui.brawl.draft.protected.has(card.slot);
      const np = ui.brawl.draft.picks[color].filter((t) => t === 'n' || t === 'r' || t === 'q').length;
      if ((card.t === 'n' || card.t === 'r' || card.t === 'q') && np >= 2) return false;
      return true;
    });
    if (!valid.length) break;
    brawlDraftCard(valid[0].id);
    guard += 1;
  }
}


/* ═══════════════════ 12.7. КОРОЛЕВСКАЯ БИТВА ═══════════════════ */


/* ═══════════════════ 12.8. ЗОМБИ-АПОКАЛИПСИС ═══════════════════ */

function zombieInit(st) {
  stopZombie();
  ui.zombie = { infect: {}, timer: 0, lastScan: 0 };
  document.documentElement.dataset.zombie = '1';
  $('#zombieHud').classList.remove('hidden');
  showZombieIntro('intro');
  clearInterval(ui.zombie.timer);
  ui.zombie.timer = setInterval(zombieTick, 100);
  zombieScan();
}

function stopZombie(hideIntro = true) {
  if (ui.zombie && ui.zombie.timer) clearInterval(ui.zombie.timer);
  if (ui.zombie && ui.zombie.introTimer) clearTimeout(ui.zombie.introTimer);
  ui.zombie = null;
  document.documentElement.dataset.zombie = '0';
  const hud = $('#zombieHud');
  if (hud) hud.classList.add('hidden');
  if (hideIntro) {
    const intro = $('#zombieIntro');
    if (intro) intro.classList.add('hidden');
  }
}

function showZombieIntro(kind, res) {
  const el = $('#zombieIntro');
  if (!el) return;
  const title = $('#zombieIntroTitle');
  const en = profile.language === 'en';
  let text = en ? 'MEDICS VS ZOMBIES' : 'МЕДИКИ ПРОТИВ ЗОМБИ';
  let rev = false;
  if (kind === 'outro' && res) {
    if (res.winner === 'w') text = en ? 'MEDICS WIN' : 'МЕДИКИ ПОБЕДИЛИ';
    else if (res.winner === 'b') { text = en ? 'ZOMBIES WIN' : 'ЗОМБИ ПОБЕДИЛИ'; rev = true; }
    else text = en ? 'DRAW' : 'НИЧЬЯ';
  }
  if (title) title.textContent = text;
  el.classList.toggle('rev', rev);
  el.classList.remove('hidden');
  clearTimeout(showZombieIntro.timer);
  showZombieIntro.timer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function zombieNeighbors(st, sq) {
  const x = sq % st.W;
  const y = Math.floor(sq / st.W);
  const out = [];
  for (const [dx, dy] of ROOK_DIRS) {
    const nx = x + dx, ny = y + dy;
    if (!inside(st, nx, ny)) continue;
    out.push(sqAt(st, nx, ny));
  }
  return out;
}

function zombieScan() {
  if (!ui.zombie || !ui.st || ui.st.status !== 'play') return;
  const st = ui.st;
  const now = performance.now();
  const next = {};
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p || p.c !== 'w') continue;
    const enemies = zombieNeighbors(st, i).map((s) => st.board[s]).filter((q) => q && q.c === 'b');
    if (!enemies.length) continue;
    let delay = 3000;
    if (p.special === 'redqueen') delay = 6000;
    if (enemies.some((q) => q.special === 'bluequeen')) delay = Math.min(delay, 1500);
    const old = ui.zombie.infect[i];
    next[i] = old || { deadline: now + delay };
  }
  ui.zombie.infect = next;
  renderZombieHud();
}

function zombieTick() {
  if (!ui.zombie || !ui.st || ui.st.status !== 'play') return;
  if (ui.paused || ui.away || ui.gameLocked || ui.screen !== 'game') {
    for (const key of Object.keys(ui.zombie.infect)) ui.zombie.infect[key].deadline += 100;
    return;
  }
  const now = performance.now();
  if (now - ui.zombie.lastScan > 300) {
    ui.zombie.lastScan = now;
    zombieScan();
  }
  for (const [key, item] of Object.entries(ui.zombie.infect)) {
    if (item.deadline > now) continue;
    const sq = Number(key);
    const p = ui.st.board[sq];
    if (!p || p.c !== 'w') { delete ui.zombie.infect[key]; continue; }
    const still = zombieNeighbors(ui.st, sq).some((s) => {
      const q = ui.st.board[s];
      return q && q.c === 'b';
    });
    if (!still) { delete ui.zombie.infect[key]; continue; }
    ui.st.board[sq] = { ...p, c: 'b', used: 0, zombie: true, special: undefined };
    delete ui.zombie.infect[key];
    if (p.t === 'k') ui.st.capturedKing = 'w';
    zombieConvertFx(sq);
    toast('🧟 Фигура заражена и стала зомби');
    renderAll(false);
    const res = updateStatus(ui.st);
    if (res) finishGame(res);
    else zombieScan();
  }
  renderZombieHud();
}

function zombieAfterMove() {
  if (!ui.zombie || !ui.st || ui.st.status !== 'play') return;
  zombieScan();
  renderZombieHud();
}

function renderZombieHud() {
  if (!ui.zombie || !ui.st) return;
  const keys = Object.keys(ui.zombie.infect);
  const count = $('#zombieCount');
  if (count) count.textContent = String(keys.length);
  const next = $('#zombieNext');
  if (next) {
    let min = Infinity;
    for (const key of keys) min = Math.min(min, ui.zombie.infect[key].deadline);
    next.textContent = keys.length ? `заражение через ${Math.max(0, (min - performance.now()) / 1000).toFixed(1)} с` : 'нет заражений';
  }
}

function zombieConvertFx(sq) {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  const { dx, dy } = disp(ui.st, sq);
  const el = document.createElement('span');
  el.className = 'zombie-burst';
  el.textContent = '🧟';
  el.style.left = ((dx + 0.5) * ui.sq) + 'px';
  el.style.top = ((dy + 0.5) * ui.sq) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function royalInit(st) {
  stopRoyal();
  ui.royal = {
    x0: 0, y0: 0, x1: st.W - 1, y1: st.H - 1,
    plies: 0, deadline: 0, timer: 0, remaining: 5000,
  };
  document.documentElement.dataset.royal = '1';
  $('#royalHud').classList.remove('hidden');
  renderRoyalHud();
}

function stopRoyal() {
  if (ui.royal && ui.royal.timer) clearInterval(ui.royal.timer);
  ui.royal = null;
  document.documentElement.dataset.royal = '0';
  const hud = $('#royalHud');
  if (hud) hud.classList.add('hidden');
}

function royalTurnText() {
  if (!ui.st) return '';
  return ui.st.turn === 'w' ? 'ход белых' : 'ход чёрных';
}

function renderRoyalHud() {
  if (!ui.royal || !ui.st) return;
  const z = ui.royal;
  const zone = $('#royalZone');
  const timer = $('#royalTimer');
  if (zone) zone.textContent = `Зона ${z.x1 - z.x0 + 1}×${z.y1 - z.y0 + 1}`;
  const left = Math.max(0, z.deadline - performance.now());
  if (timer) timer.textContent = (left / 1000).toFixed(1);
  const hud = $('#royalHud');
  if (hud) hud.classList.toggle('danger', left < 2200);
}

function startRoyalTimer() {
  if (!ui.royal || !ui.st || ui.st.status !== 'play') return;
  ui.royal.remaining = 5000;
  ui.royal.deadline = performance.now() + 5000;
  clearInterval(ui.royal.timer);
  ui.royal.timer = setInterval(() => {
    if (!ui.royal || !ui.st || ui.st.status !== 'play') return;
    if (ui.paused || ui.away || ui.gameLocked || ui.spectator) {
      ui.royal.deadline += 100;
      return;
    }
    renderRoyalHud();
    if (performance.now() >= ui.royal.deadline) royalTimeout();
  }, 100);
  renderRoyalHud();
}

function royalTimeout() {
  const st = ui.st;
  if (!st || st.status !== 'play') return;
  const color = st.turn;
  const pieces = [];
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (p && p.c === color) pieces.push(i);
  }
  if (!pieces.length) return;
  const nonKings = pieces.filter((i) => st.board[i].t !== 'k');
  const victim = (nonKings.length ? nonKings : pieces)[Math.floor(Math.random() * (nonKings.length || pieces.length))];
  const lost = st.board[victim];
  st.board[victim] = null;
  if (lost.t === 'k') st.capturedKing = color;
  st.turn = other(color);
  st.full += 1;
  ui.moves.push({ san: '⏱', from: victim, to: victim, color, captured: true, spent: 5000, at: Date.now() });
  ui.frames.push(snap(st, { from: victim, to: victim }));
  ui.viewPly = ui.frames.length - 1;
  toast(`5 секунд вышли: ${lost.t === 'k' ? 'король' : 'фигура'} разбита`);
  const res = updateStatus(st);
  renderAll(false);
  if (res) finishGame(res);
  else startRoyalTimer();
}

function royalAfterMove() {
  if (!ui.royal || !ui.st || ui.st.status !== 'play') return;
  ui.royal.plies += 1;
  if (ui.royal.plies % 6 === 0) royalShrink();
  startRoyalTimer();
  renderRoyalHud();
}

function royalShrink() {
  const st = ui.st;
  const z = ui.royal;
  if (!st || !z) return;
  const side = Math.floor((st.seed + z.plies * 7) % 4);
  if (side === 0 && z.x1 - z.x0 > 2) z.x0 += 1;
  else if (side === 1 && z.x1 - z.x0 > 2) z.x1 -= 1;
  else if (side === 2 && z.y1 - z.y0 > 2) z.y0 += 1;
  else if (z.y1 - z.y0 > 2) z.y1 -= 1;
  const broken = [];
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p) continue;
    const x = i % st.W;
    const y = Math.floor(i / st.W);
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) continue;
    const hazard = ((st.seed + i * 17 + z.plies * 31) % 10) < 9;
    if (!hazard) continue;
    broken.push({ i, p });
    st.board[i] = null;
    if (p.t === 'k') st.capturedKing = p.c;
  }
  if (broken.length) {
    toast(`Зона сжалась: разбито фигур — ${broken.length}`);
    sound.capture();
    for (const b of broken) {
      const el = document.createElement('span');
      el.className = 'royal-break';
      el.textContent = '💥';
      const { dx, dy } = disp(st, b.i);
      el.style.left = ((dx + .5) * ui.sq) + 'px';
      el.style.top = ((dy + .5) * ui.sq) + 'px';
      $('#brawlLayer').appendChild(el);
      setTimeout(() => el.remove(), 700);
    }
  }
  renderAll(false);
  const res = updateStatus(st);
  if (res) finishGame(res);
}

function initBrawl(st) {
  stopBrawl();
  ui.brawl = {
    elixir: { w: 5, b: 5 },
    max: 10,
    selected: null,
    timer: 0,
    decks: { w: brawlDeck(), b: brawlDeck() },
    shieldUses: { w: 3, b: 3 },
    shieldTurns: { w: 0, b: 0 },
    banUsed: { w: false, b: false },
    deckKey: null,
    deckButtons: [],
    lastCheck: null,
  };
  st.brawl = st.brawl || { hp: { w: 50, b: 50 }, shieldTurns: { w: 0, b: 0 } };
  ui.brawl.hp = st.brawl.hp;
  document.documentElement.dataset.brawl = '1';
  const deckBox = $('#brawlDeck');
  if (deckBox) deckBox.innerHTML = '';
  $('#brawlPanel').classList.remove('hidden');
  ui.timeMs = 0;
  ui.clocks = { w: 0, b: 0 };
  renderBrawl();
  clearInterval(ui.brawl.timer);
  ui.brawl.timer = setInterval(() => {
    if (!ui.brawl || !ui.st || ui.st.status !== 'play' || ui.paused || ui.away) return;
    ui.brawl.elixir.w = Math.min(ui.brawl.max, ui.brawl.elixir.w + 1);
    ui.brawl.elixir.b = Math.min(ui.brawl.max, ui.brawl.elixir.b + 1);
    renderBrawl();
  }, 2500);
}

function stopBrawl() {
  if (ui.brawl && ui.brawl.timer) clearInterval(ui.brawl.timer);
  const draftOverlay = $('#brawlDraft');
  if (draftOverlay) draftOverlay.classList.add('hidden');
  ui.brawl = null;
  document.documentElement.dataset.brawl = '0';
  const panel = $('#brawlPanel');
  if (panel) panel.classList.add('hidden');
  const layer = $('#brawlLayer');
  if (layer) layer.innerHTML = '';
}

function brawlColor() {
  if (ui.mode === 'online') return myColor();
  return ui.st ? ui.st.turn : 'w';
}

function brawlCanDeploy(sq, color) {
  const st = ui.st;
  if (!st || !st.flags.clashBrawl || !ui.brawl || ui.brawl.selected === null) return false;
  if (st.board[sq]) return false;
  const y = Math.floor(sq / st.W);
  const early = (st.full || 0) < 6;
  if (early) return color === 'w' ? y < 2 : y >= st.H - 2;
  return color === 'w' ? y < 4 : y >= 4;
}

function renderBrawl() {
  if (!ui.brawl || !ui.st) return;
  const color = brawlColor();
  const elixir = ui.brawl.elixir[color] || 0;
  const fill = $('#brawlElixirFill');
  const num = $('#brawlElixirNum');
  if (fill) fill.style.width = (elixir / ui.brawl.max * 100) + '%';
  if (num) num.textContent = `${elixir} / ${ui.brawl.max}`;
  const shield = $('#brawlShield');
  if (shield) {
    shield.disabled = ui.st.status !== 'play' || ui.brawl.shieldUses[color] <= 0 || ui.brawl.shieldTurns[color] > 0;
    const count = $('#brawlShieldCount');
    if (count) count.textContent = String(ui.brawl.shieldUses[color]);
  }
  const banBtn = $('#brawlBan');
  if (banBtn) banBtn.disabled = ui.st.status !== 'play' || ui.brawl.banUsed[color] || ui.moves.length > 0;
  const deck = $('#brawlDeck');
  if (deck) {
    const cards = ui.brawl.decks[color] || [];
    const deckKey = color + '|' + cards.map((c) => c.t).join(',');
    if (ui.brawl.deckKey !== deckKey) {
    ui.brawl.deckKey = deckKey;
    ui.brawl.deckButtons = [];
    deck.innerHTML = '';
    cards.forEach((card, index) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'brawl-card' + (ui.brawl.selected === index ? ' selected' : '') + (elixir < card.cost ? ' disabled' : '');
      b.style.color = color === 'w' ? '#ffffff' : '#9fc6ff';
      b.style.setProperty('--i', String(index));
      b.innerHTML = `<span class="brawl-card-cost">${card.cost}</span>${pieceSvg(card.t, 'brawl-pc')}<span class="brawl-card-name">${BRAWL_NAME[card.t]}</span>`;
      b.addEventListener('pointerdown', (e) => brawlCardDragStart(e, index));
      b.addEventListener('click', () => {
        if (ui.brawl.suppressCardClick) { ui.brawl.suppressCardClick = false; return; }
        if (ui.brawl.selected === index) ui.brawl.selected = null;
        else ui.brawl.selected = index;
        renderBrawl();
        renderSquares();
      });
      deck.appendChild(b);
      ui.brawl.deckButtons.push(b);
    });
    } else {
      (ui.brawl.deckButtons || []).forEach((b, index) => {
        const card = cards[index];
        if (!card) return;
        b.className = 'brawl-card' + (ui.brawl.selected === index ? ' selected' : '') + (elixir < card.cost ? ' disabled' : '');
      });
    }
  }
  renderBrawlHp();
}

function brawlFloat(sq, text, cls) {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  const { dx, dy } = disp(ui.st, sq);
  const el = document.createElement('span');
  el.className = 'floating-dmg ' + (cls || 'red');
  el.textContent = text;
  el.style.left = ((dx + 0.5) * ui.sq) + 'px';
  el.style.top = ((dy + 0.2) * ui.sq) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function brawlHpBar(color, st) {
  const king = findKing(st, color);
  if (king < 0) return '';
  const { dx, dy } = disp(st, king);
  const left = ((dx + 0.5) * ui.sq) + 'px';
  const top = (dy * ui.sq) + (dy === 0 ? ui.sq * 0.7 : 0) + 'px';
  const shift = dy === 0 ? 'transform:none;' : '';
  const hp = Math.max(0, ui.brawl.hp[color]);
  return `<div class="king-hp-bar" style="left:${left};top:${top};${shift}"><div class="king-hp-fill" style="width:${hp / 50 * 100}%"></div></div>
    <div class="king-hp-text" style="left:${left};top:${top};${shift}">${hp}/50</div>`;
}

function renderBrawlHp() {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  layer.querySelectorAll('.king-hp-bar,.king-hp-text').forEach((el) => el.remove());
  layer.insertAdjacentHTML('beforeend', brawlHpBar('w', ui.st) + brawlHpBar('b', ui.st));
}

function brawlTrail(from, to) {
  const layer = $('#brawlLayer');
  if (!layer || !ui.st) return;
  const a = from >= 0 ? disp(ui.st, from) : disp(ui.st, to);
  const b = disp(ui.st, to);
  for (let i = 0; i <= 7; i++) {
    const k = i / 7;
    const dot = document.createElement('span');
    dot.className = 'brawl-trail-dot';
    dot.style.left = ((a.dx + (b.dx - a.dx) * k + 0.5) * ui.sq) + 'px';
    dot.style.top = ((a.dy + (b.dy - a.dy) * k + 0.5) * ui.sq) + 'px';
    layer.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  }
}

function brawlYeet(st, sq, piece) {
  const layer = $('#brawlLayer');
  if (!layer) return;
  const { dx, dy } = disp(st, sq);
  const el = document.createElement('span');
  el.className = 'yeet-text';
  el.textContent = 'YEET!';
  el.style.left = ((dx + 0.5) * ui.sq) + 'px';
  el.style.top = ((dy + 0.5) * ui.sq) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);
  const fly = document.createElement('span');
  fly.style.cssText = `position:absolute;left:${(dx + .1) * ui.sq}px;top:${(dy + .1) * ui.sq}px;width:${ui.sq * .8}px;height:${ui.sq * .8}px;transition:transform .8s ease,opacity .8s ease;`;
  fly.innerHTML = pieceSvg(piece.t);
  layer.appendChild(fly);
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${ui.sq * 2.4}px, ${-ui.sq * 1.8}px) rotate(720deg) scale(0)`;
    fly.style.opacity = '0';
  });
  setTimeout(() => fly.remove(), 900);
}

function openBrawlBan() {
  if (!ui.brawl || !ui.st || ui.st.status !== 'play') return;
  const color = brawlColor();
  if (ui.brawl.banUsed[color] || ui.moves.length > 0) return;
  const row = $('#brawlBanRow');
  if (!row) return;
  row.innerHTML = '';
  for (const type of ['n', 'r', 'q']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'brawl-card';
    b.style.color = color === 'w' ? '#fff' : '#9fc6ff';
    b.innerHTML = `<span class="brawl-card-cost">${BRAWL_COST[type]}</span>${pieceSvg(type, 'brawl-pc')}<span class="brawl-card-name">${BRAWL_NAME[type]}</span>`;
    b.addEventListener('click', () => {
      ui.brawl.decks[color][3] = { t: type, cost: BRAWL_COST[type] };
      ui.brawl.banUsed[color] = true;
      $('#brawlBanModal').classList.add('hidden');
      renderBrawl();
      toast('Колода: ' + BRAWL_NAME[type]);
    });
    row.appendChild(b);
  }
  $('#brawlBanModal').classList.remove('hidden');
}

function brawlCardDragStart(e, index) {
  if (!ui.brawl || !ui.st || ui.st.status !== 'play') return;
  const color = brawlColor();
  const card = ui.brawl.decks[color][index];
  if (!card || ui.brawl.elixir[color] < card.cost) return;
  if (ui.brawl.selected === index) {
    ui.brawl.selected = null;
    renderBrawl();
    renderSquares();
    return;
  }
  ui.brawl.selected = index;
  ui.brawl.suppressCardClick = true;
  ui.brawl.drag = { index, x: e.clientX, y: e.clientY, active: false };
  renderBrawl();
  renderSquares();
}

function brawlCardDragMove(e) {
  if (!ui.brawl || !ui.brawl.drag) return;
  const d = ui.brawl.drag;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.active = true;
}

function brawlCardDragEnd(e) {
  if (!ui.brawl || !ui.brawl.drag) return;
  const d = ui.brawl.drag;
  ui.brawl.drag = null;
  if (!d.active) return;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = under && under.closest ? under.closest('.sq') : null;
  if (sqEl) {
    const to = Number(sqEl.dataset.sq);
    if (brawlCanDeploy(to, brawlColor())) {
      brawlDeploy(to);
      return;
    }
  }
}

function brawlShieldAction() {
  if (!ui.brawl || !ui.st || ui.st.status !== 'play') return;
  const color = brawlColor();
  if (ui.brawl.shieldUses[color] <= 0 || ui.brawl.shieldTurns[color] > 0) return;
  ui.brawl.shieldUses[color] -= 1;
  ui.brawl.shieldTurns[color] = 2;
  ui.st.turn = other(color);
  ui.st.full += 1;
  ui.frames.push(snap(ui.st));
  ui.viewPly = ui.frames.length - 1;
  ui.moves.push({ san: 'щит', from: -1, to: -1, color, captured: false, spent: 0, at: Date.now() });
  brawlTurnStart(ui.st.turn);
  renderAll(false);
  renderBrawl();
  toast('Щит активен на 2 хода');
}

function brawlTurnStart(color) {
  if (!ui.brawl) return;
  if (ui.brawl.shieldTurns[color] > 0) ui.brawl.shieldTurns[color] -= 1;
}

function brawlDeploy(sq) {
  const st = ui.st;
  if (!ui.brawl || !st || ui.brawl.selected === null) return false;
  const color = st.turn;
  if (!brawlCanDeploy(sq, color)) return false;
  const card = ui.brawl.decks[color][ui.brawl.selected];
  if (!card || ui.brawl.elixir[color] < card.cost) return false;
  ui.brawl.elixir[color] -= card.cost;
  const piece = { t: card.t, c: color, id: Date.now() + Math.floor(Math.random() * 1e6), used: 0 };
  if (card.t === 'p' && Math.random() < 0.25) piece.gold = true;
  st.board[sq] = piece;
  st.ep = -1;
  st.check = false;
  st.full += 1;
  ui.brawl.selected = null;
  ui.moves.push({ san: `${card.t.toUpperCase()}@${sqName(st, sq)}`, from: -1, to: sq, color, captured: false, spent: 0, at: Date.now() });
  st.turn = other(color);
  brawlTurnStart(st.turn);
  ui.frames.push(snap(st));
  ui.viewPly = ui.frames.length - 1;
  renderAll(false);
  renderBrawl();
  brawlTrail(-1, sq);
  brawlFloat(sq, '+' + (piece.gold ? 'золотая!' : BRAWL_NAME[card.t]), piece.gold ? 'gold' : 'purple');
  if (ui.bot && st.turn === ui.bot.color) setTimeout(maybeBotTurn, 700);
  return true;
}

function brawlCheckDamage(by, color) {
  if (!ui.brawl || !ui.st) return;
  if (ui.brawl.shieldTurns[color] > 0) {
    brawlFloat(findKing(ui.st, color), 'ЩИТ', 'purple');
    return;
  }
  const last = ui.brawl.lastCheck;
  const repeat = last && last.by === by && (ui.moves.length - last.ply) <= 2;
  const dmg = repeat ? 3 : 2;
  ui.brawl.lastCheck = { by, ply: ui.moves.length };
  ui.brawl.hp[color] = Math.max(0, ui.brawl.hp[color] - dmg);
  const king = findKing(ui.st, color);
  if (king >= 0) brawlFloat(king, '-' + dmg + ' HP', 'red');
  renderBrawl();
  brawlWin();
}

function brawlKingAttack(st, match) {
  if (!ui.brawl) return false;
  const p = st.board[match.from];
  const king = st.board[match.to];
  if (!p || !king || king.t !== 'k') return false;
  const color = king.c;
  const dx = Math.sign(fileOf(st, match.to) - fileOf(st, match.from));
  const dy = Math.sign(rankOf(st, match.to) - rankOf(st, match.from));
  let damage = 10;
  const bx = fileOf(st, match.to) + dx;
  const by = rankOf(st, match.to) + dy;
  if (inside(st, bx, by)) {
    const behind = sqAt(st, bx, by);
    if (st.board[behind]) {
      st.board[behind] = null;
      brawlFloat(behind, 'SPLAT!', 'gold');
    }
    st.board[match.to] = null;
    st.board[behind] = king;
  } else {
    damage += 5;
  }
  if (ui.brawl.shieldTurns[color] > 0) {
    damage = 0;
    brawlFloat(match.to, 'ЩИТ', 'purple');
  }
  if (damage > 0) {
    ui.brawl.hp[color] = Math.max(0, ui.brawl.hp[color] - damage);
    brawlFloat(match.to, '-' + damage + ' HP', 'red');
  }
  st.board[match.from] = null;
  if (p.t === 'q') {
    p.hp = (p.hp || 10) - 5;
    if (p.hp > 0) st.board[match.from] = p;
    else brawlFloat(match.from, 'ФЕРЗЬ ПАЛ', 'red');
  } else {
    brawlFloat(match.from, 'КАМИКАДЗЕ', 'red');
  }
  st.turn = other(p.c);
  st.full += 1;
  ui.moves.push({ san: 'KING HIT', from: match.from, to: match.to, color: p.c, captured: true, spent: 0, at: Date.now() });
  ui.frames.push(snap(st));
  ui.viewPly = ui.frames.length - 1;
  brawlTurnStart(st.turn);
  renderAll(false);
  renderBrawl();
  brawlTrail(match.from, match.to);
  brawlWin();
  return true;
}

function brawlWin() {
  if (!ui.brawl || !ui.st || ui.st.status !== 'play') return false;
  const hp = ui.brawl.hp;
  if (hp.w > 0 && hp.b > 0) return false;
  const winner = hp.w <= 0 ? 'b' : 'w';
  const result = { winner, reason: 'brawl' };
  ui.st.status = 'over';
  ui.st.result = result;
  renderAll(false);
  finishGame(result);
  return true;
}

function brawlCaptureFx(st, capInfo, match, mover) {
  if (!ui.brawl || !capInfo.length) return;
  const rook = st.board[match.to] && st.board[match.to].t === 'r';
  for (const item of capInfo) {
    brawlFloat(item.square, '+' + (BRAWL_POINTS[item.type] || 1), 'gold');
    if (rook) {
      const x = fileOf(st, item.square);
      const y = rankOf(st, item.square);
      if (x === 0 || x === st.W - 1 || y === 0 || y === st.H - 1) {
        brawlYeet(st, item.square, item);
      }
    }
  }
  brawlTrail(match.from, match.to);
}

function newGame(opts = {}) {
  const pickedMode = modeById(opts.modeId || profile.modeId);
  const mode = pickedMode.flags.randomPick ? randomRealMode() : pickedMode;
  if (mode.id === 'openIntent' && (opts.mode || 'local') !== 'online') {
    toast('Режим «Открытые намерения» работает только в онлайн-игре с живым соперником!');
    showScreen('online');
    return;
  }
  ui.rotated = false;
  ui.tableRotated = false;
  ui.away = false;
  ui.suppressClick = false;
  const boardEl = $('#board');
  if (boardEl) boardEl.classList.remove('board-rotated');
  ui.pieceStreak = null;
  const grayShell = $('#gameShell');
  if (grayShell) grayShell.style.setProperty('--gray', '0');
  ui.extremeShown = 0;
  ui.confirmAction = null;
  document.documentElement.dataset.infernal = mode.flags.infernal ? '1' : '0';
  document.body.classList.remove('flip-all');
  const boardElReset = $('#board');
  if (boardElReset) boardElReset.classList.remove('board-rotated');
  const shellEl = $('#gameShell');
  if (shellEl) {
    shellEl.classList.remove('gray-1', 'gray-2', 'gray-3', 'check-alert');
  }
  if (mode.flags.inverted && (opts.mode || 'local') === 'local') ui.orientation = 'b';
  stopBrawl();
  stopRaceClock();
  ui.race = null;
  if (mode.flags.captureRace) {
    const duration = opts.raceMs || pickRaceMs(opts.timeMs || profile.timeMs || 300000);
    ui.race = { duration, remaining: duration, timer: 0 };
    ui.timeMs = 0;
    ui.clocks = { w: 0, b: 0 };
  }
  ui.st = createState(mode.id, { square: opts.square != null ? opts.square : profile.square, seed: opts.seed });
  ui.frames = [snap(ui.st)];
  ui.moves = [];
  ui.viewPly = 0;
  ui.selected = -1;
  ui.hint = null;
  ui.lastMove = null;
  clearTimeout(ui.endTimer);
  ui.endTimer = 0;
  ui.endSquare = -1;
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
  if ($('#brawlBanModal')) $('#brawlBanModal').classList.add('hidden');
  if (mode.flags.clashBrawl) { ui.timeMs = 0; ui.clocks = { w: 0, b: 0 }; initBrawl(ui.st); }
  else if (mode.flags.royalBattle) royalInit(ui.st);
  else stopRoyal();
  if (mode.flags.zombie) zombieInit(ui.st);
  else stopZombie();
  if (mode.flags.strategy) strategyInit(ui.st);
  else stopStrategy();
  ui.orientation = opts.bot ? profile.side : (opts.orientation || (profile.side === 'b' && !opts.orientation ? 'b' : 'w'));
  if ((opts.mode || 'local') === 'local' && !opts.bot && !mode.flags.inverted) ui.orientation = 'w';
  ui.mode = opts.mode || 'local';
  if (ui.mode === 'local' && !opts.bot && profile.flip && window.innerWidth < 1000) {
    if (profile.flipAll) ui.rotated = ui.st.turn !== ui.orientation;
    else ui.tableRotated = ui.st.turn !== ui.orientation;
    if (ui.tableRotated) $('#board').classList.add('board-rotated');
  }
  ui.role = opts.role || null;
  ui.spectator = !!opts.spectator;
  ui.bot = opts.bot
    ? { ...opts.bot, name: opts.bot.fake ? (opts.bot.name || 'Игрок') : ('Бот · ' + (BOT_LABELS[opts.bot.level] || 'средний')) }
    : null;
  ui.paused = false;
  ui.movedId = null;
  ui.gameLocked = false;
  ui.remoteSelected = -1;
  if ($('#pauseOverlay')) $('#pauseOverlay').classList.add('hidden');
  if ($('#railPause')) {
    $('#railPause').classList.remove('paused');
    $('#railPause').classList.toggle('hidden', (opts.mode || 'local') === 'online');
  }
  ui.botThinking = false;
  ui.imported = false;
  ui.startedAt = Date.now();
  const mySide = ui.mode === 'online' ? (ui.role === 'host' ? 'w' : 'b') : profile.side;
  const oppName = ui.bot ? ui.bot.name : 'Соперник';
  ui.names = {
    w: { name: mySide === 'w' ? profile.name : oppName, avatar: mySide === 'w' ? profile.avatar : 'k' },
    b: { name: mySide === 'b' ? profile.name : oppName, avatar: mySide === 'b' ? profile.avatar : 'k' },
  };

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

  saveCurrentGame();
  if (opts.splash !== false) {
    // заморозка: пока играет «Дебют», ходы и часы стоят
    ui.gameLocked = true;
    ui.running = false;
    ui.phase = 'opening';
    showPhase('opening');
    playBoardIntro();
    clearTimeout(newGame.unlockTimer);
    newGame.unlockTimer = setTimeout(() => {
      if (!ui.st || ui.st.status !== 'play') { ui.gameLocked = false; return; }
      ui.gameLocked = false;
      if (!ui.paused) {
        ui.running = true;
        ui.turnStart = performance.now();
      }
      renderStatus();
      scheduleFirstMoveTimer();
      if (ui.race) startRaceClock();
      if (ui.royal) startRoyalTimer();
      if (ui.bot && ui.st.turn === ui.bot.color) maybeBotTurn();
    }, 2200);
  } else {
    ui.gameLocked = false;
    startClocks();
    scheduleFirstMoveTimer();
    if (ui.race) startRaceClock();
    if (ui.royal) startRoyalTimer();
    if (ui.bot && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 700);
  }
  if (mode.flags.clashBrawl && (opts.mode || 'local') === 'local') startBrawlDraft();
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
  if (st.flags.captureRace) bits.push(`съедено ${st.caps ? st.caps.w : 0} : ${st.caps ? st.caps.b : 0}`);
  if (ui.spectator) bits.push('наблюдение');
  if (ui.bot && ui.bot.fake) bits.push('Возможно, не совсем игрок');
  if (st.flags.jester) bits.push('Шуты: 5 ходов');
  if (st.flags.boy) bits.push('Пацанчики берут две');
  if (st.flags.kingFree) bits.push('короля можно съесть');
  if (st.flags.kingOnlyLose) bits.push('один король — поражение');
  $('#gameMeta').innerHTML = `<b>${escapeHtml(st.mode.name)}</b><br>${escapeHtml(bits.join(' · '))}`;
}

function renderPlayers() {  const st = ui.st;
  if (!st) return;
  const me = myColor();
  const bottomColor = barOrientation() === 'w' ? 'w' : 'b';
  const topColor = other(bottomColor);
  const mySide = ui.mode === 'online' ? (ui.role === 'host' ? 'w' : 'b') : me;

  const nameFor = (color) => {
    if (color === mySide) return profile.name;
    if (ui.mode === 'online' && ui.online && ui.online.names) return ui.online.names[other(mySide)] || 'Соперник';
    return (ui.names && ui.names[color] && ui.names[color].name) || 'Соперник';
  };
  const avatarFor = (color) => {
    if (color === mySide) return profile.avatar;
    if (ui.mode === 'online' && ui.online && ui.online.avatars) return ui.online.avatars[other(mySide)] || 'k';
    return (ui.names && ui.names[color] && ui.names[color].avatar) || 'k';
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

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, j: 5, g: 5, k: 0 };

function renderCaptured() {
  const st = ui.st;
  if (!st || !ui.frames.length) return;
  const startBoard = ui.frames[0].board;
  const count = (board) => {
    const map = {};
    for (const p of board) if (p) map[p.c + p.t] = (map[p.c + p.t] || 0) + 1;
    return map;
  };
  const a = count(startBoard);
  const b = count(st.board);
  const lost = { w: [], b: [] };
  const lostValue = { w: 0, b: 0 };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = (a[key] || 0) - (b[key] || 0);
    const color = key[0];
    const type = key[1];
    if (diff > 0) {
      for (let i = 0; i < diff; i++) lost[color].push(type);
      lostValue[color] += diff * (PIECE_VALUES[type] || 0);
    } else if (diff < 0) {
      // превращение добавило фигуру — уменьшаем «потери» на её стоимость
      lostValue[color] += diff * (PIECE_VALUES[type] || 0);
    }
  }

  // Порядок как на Chess.com: пешки → слоны → кони → ладьи → ферзи
  const ORDER = { p: 1, b: 2, n: 3, r: 4, q: 5, j: 6, g: 7, k: 8 };
  lost.w.sort((x, y) => (ORDER[x] || 0) - (ORDER[y] || 0));
  lost.b.sort((x, y) => (ORDER[x] || 0) - (ORDER[y] || 0));

  const bottomColor = ui.orientation === 'w' ? 'w' : 'b';
  const topColor = other(bottomColor);

  const build = (types, color) => types
    .map((type) => `<span class="cap-item ${color === 'w' ? 'w' : 'b'}">${pieceSvg(type, 'cap-pc')}</span>`)
    .join('');

  $('#topCaptured').innerHTML = build(lost[bottomColor], bottomColor);
  $('#bottomCaptured').innerHTML = build(lost[topColor], topColor);

  const diffTop = lostValue[bottomColor] - lostValue[topColor];
  const diffBottom = -diffTop;
  const topEl = $('#topMaterial');
  const bottomEl = $('#bottomMaterial');
  if (topEl) topEl.textContent = diffTop > 0 ? `+${diffTop}` : '';
  if (bottomEl) bottomEl.textContent = diffBottom > 0 ? `+${diffBottom}` : '';
}

function renderAll(animate) {
  if (!ui.st) return;
  renderBoard(animate);
  updateClockEls();
  updateEval();
  renderStatus();
  updateNav();
  renderCaptured();
  if (ui.royal) renderRoyalHud();
  if (ui.zombie) renderZombieHud();
  if (ui.strategy) strategyRender();
  if (ui.screen === 'settings') renderThemePreview();
  if (ui.brawl) { renderBrawlHp(); renderBrawl(); }
}

function renderStatus() {
  const st = ui.st;
  const el = $('#gameStatus');
  const sub = $('#gameSub');
  const shell = $('#gameShell');
  if (!st) return;
  if (ui.imported) {
    el.textContent = profile.language === 'en' ? 'Imported game' : 'Импортированная партия';
    sub.textContent = profile.language === 'en' ? 'review and export · moves disabled' : 'просмотр и экспорт · ходы недоступны';
    return;
  }
  if (ui.viewPly !== ui.frames.length - 1) {
    el.textContent = profile.language === 'en' ? 'Game review' : 'Просмотр партии';
    sub.textContent = profile.language === 'en'
      ? `position after ${ui.viewPly} plies · return to the end to play`
      : `позиция после ${ui.viewPly}-го полухода · вернитесь в конец, чтобы играть`;
    return;
  }
  if (st.status === 'over' && st.result) {
    if (shell) shell.classList.remove('check-alert');
    el.textContent = resultTitle(st.result);
    sub.textContent = resultReason(st.result);
    const text = el.textContent + '|' + sub.textContent;
    if (ui.lastStatusText !== text) {
      ui.lastStatusText = text;
      el.classList.remove('status-pop');
      void el.offsetWidth;
      el.classList.add('status-pop');
    }
    return;
  }
  if (shell) shell.classList.toggle('check-alert', !!st.check && st.status === 'play');
  if (ui.botThinking) {
    el.textContent = profile.language === 'en' ? 'Bot is thinking…' : 'Бот думает…';
  } else {
    el.textContent = st.turn === 'w'
      ? (profile.language === 'en' ? 'White to move' : 'Ход белых')
      : (profile.language === 'en' ? 'Black to move' : 'Ход чёрных');
  }
  const bits = [modeName(st.mode)];
  if (st.check) bits.push(profile.language === 'en' ? 'check!' : 'шах!');
  if (st.flags.checksToWin) bits.push(`шахи ${st.mv.w.checks}:${st.mv.b.checks}`);
  if (st.flags.crossCastle) bits.push(`обмены ${st.mv.w.cross}/${st.flags.crossCastle}`);
  if (st.flags.race) bits.push('цель: верхний ряд');
  if (st.flags.centerWin) bits.push('цель: d4, e4, d5, e5');
  const open = openingName();
  if (open) bits.push(open);
  sub.textContent = bits.join(' · ');
  const statusText = el.textContent + '|' + sub.textContent;
  if (ui.lastStatusText !== statusText) {
    ui.lastStatusText = statusText;
    if (st.status === 'over' && st.result) {
      el.classList.remove('status-pop');
      void el.offsetWidth;
      el.classList.add('status-pop');
    }
  }
}

function resultTitle(res) {
  const my = myColor();
  const en = profile.language === 'en';
  if (!res || !res.winner) return en ? 'Draw' : 'Ничья';
  return res.winner === my ? (en ? 'Victory' : 'Победа') : (en ? 'Defeat' : 'Поражение');
}

function resultReason(res) {
  if (!res) return '';
  if (profile.language === 'en') {
    const en = {
      mate: 'checkmate', time: 'time out', resign: 'resigned', stalemate: 'stalemate',
      fifty: '50-move rule', material: 'insufficient material', repetition: 'threefold repetition',
      draw: 'agreed draw', king: 'king captured', race: 'king reached the last rank',
      center: 'king in the centre', checks: 'three checks', kingOnly: 'opponent has only a king',
      abort: 'game aborted', brawl: 'king defeated', devoured: 'all pieces eaten',
      raceKing: 'king reached the edge', idle: 'white made no first move',
      monotony: 'one piece — stalemate', queenLost: 'queen lost', extreme: 'huge advantage',
    };
    return en[res.reason] || res.reason;
  }
  const map = {
    mate: 'мат', time: 'время истекло', resign: 'сдался', stalemate: 'пат',
    fifty: 'правило 50 ходов', material: 'недостаточно материала',
    repetition: 'троекратное повторение', draw: 'ничья по согласию',
    king: 'король съеден', race: 'король дошёл до верхнего ряда', center: 'король в центре',
    checks: 'три шаха', kingOnly: 'у соперника остался один король',
    abort: 'партия прервана',
  brawl: 'король побеждён',
  devoured: 'съедены все фигуры', race: 'время вышло — считаем взятия', raceKing: 'король добрался до края', idle: 'белые не сделали первый ход', monotony: 'монотонное повторение',
  queenLost: 'ферзь потерян', extreme: 'крайний перевес',
  };
  return map[res.reason] || res.reason;
}

/* ───────────────────────────── 9. ХОДЫ ────────────────────────────────── */

function onSquareClick(sq) {
  if (ui.spectator) return;
  if (ui.brawl && ui.st && ui.st.flags.clashBrawl && ui.brawl.selected !== null && ui.st.status === 'play') {
    if (brawlDeploy(sq)) return;
    ui.brawl.selected = null;
    renderBrawl();
    renderSquares();
    return;
  }
  if (!ui.st || ui.st.status !== 'play') return;
  if (ui.gameLocked) return;
  if (ui.paused) return;
  if (ui.imported) { toast('Импортированная партия — только просмотр'); return; }
  if (ui.bot && ui.st.turn === ui.bot.color) return;
  if (ui.viewPly !== ui.frames.length - 1) return;
  const st = ui.st;
  if (ui.mode === 'online' && st.turn !== myColor()) return;
  if (st.turn !== myColor() && ui.mode !== 'local') return;

  if (st.flags.strategy) { strategyClick(sq); return; }

  const legal = legalMoves(st, st.turn);

  // «Взялся — ходи»: выбор фигуры с ходами отменить нельзя
  if (st.flags.touchMove && ui.selected >= 0) {
    const currentLegal = legal.filter((m) => m.from === ui.selected);
    if (currentLegal.length > 0) {
      const isCandidate = currentLegal.some((m) => m.to === sq);
      if (!isCandidate) {
        buzz([40, 40]);
        toast('«Взялся — ходи»: обязаны ходить выбранной фигурой!');
        return;
      }
    }
  }

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
  const prevSelected = ui.selected;
  if (p && p.c === st.turn) {
    ui.selected = sq;
    renderSquares();
    renderHints();
  } else {
    ui.selected = -1;
    renderSquares();
    renderHints();
  }
  if (st.flags.openIntent && ui.mode === 'online' && ui.selected !== prevSelected) {
    netPublish({ t: 'intent', sq: ui.selected });
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
  if (st.flags.strategy && !opts.remote) {
    if (st.strategy.phase !== 'move') return false;
    if (match.capture != null) { strategyMelee(match.from, match.to); return true; }
    const cost = strategyCost(STRAT[st.board[match.from].t].move, st, match.from, mover);
    if (st.strategy.gold[mover] < cost) { toast('Не хватает очков на ход'); return false; }
    st.strategy.gold[mover] -= cost;
    st.strategy.moved[st.board[match.from].id] = true;
  }
  const now = performance.now();
  let spent = 0;
  if (ui.running && ui.timeMs) {
    spent = Math.max(0, now - ui.turnStart);
    ui.clocks[mover] = Math.max(0, ui.clocks[mover] - spent);
  }
  ui.turnStart = now;
  if (!opts.remote) ui.running = true;

  const san = moveToSan(st, match, legal);
  const capInfo = [];
  if (match.caps && match.caps.length) {
    for (const i of match.caps) {
      const p = st.board[i];
      if (p) capInfo.push({ type: p.t, color: p.c, square: i });
    }
  }
  if (match.capture != null && !capInfo.some((c) => c.square === match.capture)) {
    const p = st.board[match.capture];
    if (p) capInfo.push({ type: p.t, color: p.c, square: match.capture });
  }
  if (st.flags.clashBrawl && match.capture != null && st.board[match.capture] && st.board[match.capture].t === 'k') {
    brawlKingAttack(st, match);
    return true;
  }
  const evalBefore = evaluateWhite(st);
  applyMove(st, match);
  const explodedNow = !!st.exploded;
  if (st.flags.blocks) {
    const blockedSq = maybeBlock(st);
    if (blockedSq >= 0) {
      ui.blockFlash = blockedSq;
      setTimeout(() => { ui.blockFlash = -1; renderSquares(); }, 1200);
      if (!opts.silent) toast(`Клетка ${sqName(st, blockedSq)} заперта`);
    }
  }
  ui.frames.push(snap(st, { from: match.from, to: match.to }));
  ui.viewPly = ui.frames.length - 1;
  const captured = !!match.capture || (match.caps && match.caps.length) || match.ep;
  ui.moves.push({
    san, from: match.from, to: match.to, color: mover, spent,
    clock: ui.clocks[mover], captured, promo: match.promo || null, at: Date.now(),
  });
  ui.lastMove = { from: match.from, to: match.to };
  ui.selected = -1;
  ui.remoteSelected = -1;
  ui.hint = null;
  ui.movedId = st.board[match.to] ? st.board[match.to].id : null;
  const evalAfter = evaluateWhite(st);
  const movedPiece = st.board[match.to];
  const monotony = updateSameStreak(movedPiece ? movedPiece.id : null, mover);

  if (st.flags.checksToWin && inCheck(st, st.turn)) st.mv[mover].checks += 1;

  let res = updateStatus(st);
  if (!res && monotony) {
    res = { winner: null, reason: 'monotony' };
    st.status = 'over';
    st.result = res;
  }
  if (!res && st.flags.checksToWin && st.mv[mover].checks >= st.flags.checksToWin) {
    res = { winner: mover, reason: 'checks' };
    st.status = 'over';
    st.result = res;
  }

  if (!opts.silent) {
    if (captured && spent > 0 && spent < 2000 && capInfo.some((c) => c.type === 'r')) {
      fastRookWave(st, match.to);
    }
    if (Math.abs(evalAfter - evalBefore) >= 2.2 && ui.moves.length > 2 && Math.random() < 0.08) {
      showExtremeDiff(match.to);
    }
    if (st.flags.infernal && (captured || inCheck(st, st.turn) || Math.abs(evalAfter - evalBefore) >= 1.5)) {
      infernalJoke();
    }
  }
  clearTimeout(ui.firstMoveTimer);
  ui.firstMoveTimer = 0;

  if (st.flags.clashBrawl && ui.brawl) {
    brawlCaptureFx(st, capInfo, match, mover);
    if (st.status === 'play' && inCheck(st, other(mover))) brawlCheckDamage(mover, other(mover));
    renderBrawl();
  }
  if (!opts.silent && !opts.remote) {
    if (captured) { sound.capture(); buzz([12, 24, 12]); } else { sound.move(); buzz(8); }
    if (inCheck(st, st.turn)) sound.check();
  }

  if (st.flags.explode && explodedNow) {
    const board = $('#board');
    board.classList.remove('shake');
    void board.offsetWidth;
    board.classList.add('shake');
    setTimeout(() => board.classList.remove('shake'), 450);
  }

  let flippedNow = false;
  const prevRotated = ui.rotated;
  const prevTable = ui.tableRotated;
  if (ui.mode === 'local' && !ui.bot && profile.flip && !opts.remote && !opts.silent
      && window.innerWidth < 1000) {
    if (profile.flipAll) {
      ui.rotated = st.turn !== ui.orientation;
      ui.tableRotated = false;
    } else {
      ui.rotated = false;
      ui.tableRotated = st.turn !== ui.orientation;
    }
    flippedNow = ui.rotated !== prevRotated || ui.tableRotated !== prevTable;
  }
  if (!opts.silent) {
    document.body.classList.toggle('flip-all', !!ui.rotated);
    const boardRot = $('#board');
    if (boardRot) boardRot.classList.toggle('board-rotated', !!ui.tableRotated);
    renderAll(flippedNow ? false : !opts.noAnim);
    if (flippedNow) renderPlayers();
    if (st.flags.explode && explodedNow) explosionFx(st, match.to);
    if (capInfo.length) {
      captureFx(capInfo);
      if (!profile.epicFx && captured && window.innerWidth < 1000 && !capInfo.some((c) => c.type === 'q')) {
        softBurst(st, match.to);
      }
      if (profile.epicFx && !capInfo.some((c) => c.type === 'q')) {
        const boardFx = $('#board');
        if (boardFx) {
          boardFx.classList.remove('shake-2');
          void boardFx.offsetWidth;
          boardFx.classList.add('shake-2');
          setTimeout(() => boardFx.classList.remove('shake-2'), 420);
        }
        explosionFx(st, match.to);
      }
    }
    renderMoves();
    if (ui.royal) setTimeout(royalAfterMove, 30);
    if (ui.zombie) setTimeout(zombieAfterMove, 30);
    if (st.flags.strategy && !opts.remote) {
      st.turn = mover;
      setTimeout(() => strategyAfterMove(mover, match.to), 30);
    }
    saveCurrentGame();
  }

  if (ui.mode === 'online' && !opts.remote && !opts.silent) {
    netPublish({ t: 'move', from: match.from, to: match.to, promo: match.promo || null, cw: ui.clocks.w, cb: ui.clocks.b });
  }

  if (res) {
    renderAll(false);
    finishGame(res);
  } else if (!opts.silent) {
    maybePhase();
    maybeBotTurn();
  }
  return true;
}

/* ─────────────────────────── 10. РЕЗУЛЬТАТ ────────────────────────────── */

const REASON_TEXT = {
  mate: 'мат', time: 'время истекло', resign: 'сдача', stalemate: 'пат',
  fifty: 'правило 50 ходов', material: 'недостаточно материала',
  repetition: 'троекратное повторение', draw: 'ничья по согласию',
  king: 'король съеден', race: 'король на вершине', center: 'король в центре',
  checks: 'три шаха', kingOnly: 'остался один король', left: 'выход из партии',
  antichess: 'все фигуры потеряны',
  abort: 'партия прервана',
};

function scoreGame(res, st) {
  if (!res || res.reason === 'abort' || res.reason === 'idle' || res.reason === 'monotony') return 0;
  const side = myColor();
  if (!res.winner) {
    if (res.reason !== 'stalemate') return 0;
    if (onlyKing(st, 'w') || onlyKing(st, 'b')) return 0;
    return 1;
  }
  if (res.winner === side) return res.reason === 'time' ? 4 : 5;
  return st.full <= 10 ? -5 : -4;
}

function finishGame(res, opts = {}) {
  stopRaceClock();
  if (ui.st && ui.st.flags.zombie) showZombieIntro('outro', res);
  stopZombie(false);
  stopRoyal();
  stopStrategy();
  try { localStorage.removeItem(CURRENT_KEY); } catch (error) { /* ignore */ }
  ui.running = false;
  clearInterval(ui.timer);
  if (!ui.st) return;
  if (ui.scored) return;
  if (!opts.delayed && (res.reason === 'mate' || res.reason === 'stalemate')) {
    if (ui.endTimer) return;
    const loser = res.winner ? other(res.winner) : ui.st.turn;
    ui.endSquare = findKing(ui.st, loser);
    ui.endReason = res.reason;
    ui.st.status = 'over';
    ui.st.result = res;
    renderSquares();
    const statusEl = $('#gameStatus');
    if (statusEl) statusEl.textContent = res.reason === 'mate' ? 'МАТ' : 'ПАТ';
    ui.endTimer = setTimeout(() => {
      ui.endTimer = 0;
      ui.endSquare = -1;
      renderSquares();
      finishGame(res, { delayed: true });
    }, 3000);
    return;
  }
  ui.scored = true;

  const st = ui.st;
  let points = ui.spectator ? 0 : scoreGame(res, st);
  const side = ui.spectator ? (res.winner || 'w') : myColor();
  const win = res.winner === side;
  const draw = !res.winner;
  const lost = !!res.winner && !win;
  if (ui.bot && res.reason !== 'abort' && res.reason !== 'idle' && res.reason !== 'monotony') {
    const row = BOT_POINTS[ui.bot.level] || BOT_POINTS.medium;
    points = win ? row.win : lost ? row.loss : row.draw;
  }

  if (res.reason !== 'abort' && !ui.spectator) {
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
      mode: modeName(st.mode),
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
    : !res.winner ? 'Ничья'
      : ui.spectator ? (res.winner === 'w' ? 'Победа белых' : 'Победа чёрных')
        : (res.winner === side ? 'Победа' : 'Поражение');
  $('#resultTitle').className = 'result-title ' + (!res.winner ? 'draw' : res.winner === side ? 'win' : 'lose');
  const reasonText = REASON_TEXT[res.reason] || res.reason;
  $('#resultSub').textContent = res.winner
    ? `${res.winner === 'w' ? 'Белые' : 'Чёрные'} · ${reasonText}`
    : reasonText;
  if (res.reason === 'abort' || ui.spectator) {
    $('#resultPoints').innerHTML = '';
  } else {
    animateResultPoints(points);
  }
  ['#resultAgain', '#resultMenu', '#resultClose'].forEach((id) => $(id).classList.remove('hidden'));
  if (ui.spectator) $('#resultAgain').classList.add('hidden');
  $('#result').classList.remove('hidden');
  if (res.reason !== 'abort') playResultFx(!res.winner ? 'draw' : res.winner === side ? 'win' : 'lose');
  renderStatsIfOpen();
}

function animateResultPoints(points) {
  const el = $('#resultPoints');
  if (!el) return;
  const total = profile.points;
  const before = total - points;
  const cls = points > 0 ? 'up' : points < 0 ? 'down' : 'zero';
  const start = performance.now();
  const dur = 800;
  function frame(now) {
    const k = Math.min(1, (now - start) / dur);
    const shown = Math.round(points * k);
    const tot = Math.round(before + (total - before) * k);
    el.innerHTML = `<span class="pdelta ${cls}">${shown > 0 ? '+' : ''}${shown}</span> <em>всего ${tot}</em>`;
    if (k < 1) requestAnimationFrame(frame);
  }
  el.innerHTML = `<span class="pdelta ${cls}">${points > 0 ? '+' : ''}0</span> <em>всего ${before}</em>`;
  requestAnimationFrame(frame);
  const sb = $('#sbPoints');
  if (sb) {
    sb.classList.remove('pulse');
    void sb.offsetWidth;
    sb.classList.add('pulse');
    setTimeout(() => sb.classList.remove('pulse'), 900);
  }
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
  let pieces = 0;
  for (const p of st.board) if (p && p.t !== 'k') pieces += 1;
  /* Дебют — примерно 10–12 ходов. Эндшпиль — не по номеру хода,
     а по реальному уменьшению материала: полная доска на 30-м ходу
     больше не считается эндшпилем. */
  if (mat <= 16 || pieces <= 8 || (ply >= 80 && mat <= 44)) return 'endgame';
  if (ply >= 24) return 'middle';
  return 'opening';
}

const PHASES = {
  opening: { title: 'Дебют', sub: 'первые десять ходов' },
  middle: { title: 'Миттельшпиль', sub: 'середина партии' },
  endgame: { title: 'Эндшпиль', sub: 'развязка близко' },
};

const FLIER_TYPES = ['q', 'r', 'b', 'n', 'p', 'k'];

function fitPhaseBadge() {
  const badge = $('#phaseBadge');
  if (!badge) return;
  if (window.innerWidth >= 1000) { badge.style.removeProperty('font-size'); return; }
  badge.style.removeProperty('font-size');
  const max = window.innerWidth - 4;
  let size = Math.min(64, Math.round(window.innerWidth * 0.105));
  badge.style.setProperty('font-size', size + 'px', 'important');
  let guard = 0;
  while (badge.scrollWidth > max && size > 20 && guard < 40) {
    size -= 1;
    badge.style.setProperty('font-size', size + 'px', 'important');
    guard += 1;
  }
}

function spawnPhaseFliers() {
  if (profile.calm) return;
  const box = $('#phaseFliers');
  if (!box) return;
  const reduced = !profile.epicFx && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  box.innerHTML = '';
  const count = Math.round((window.innerWidth < 700 ? 12 : 22) * (profile.epicFx ? 1.8 : 1));
  for (let i = 0; i < count; i++) {
    const type = FLIER_TYPES[Math.floor(Math.random() * FLIER_TYPES.length)];
    const el = document.createElement('span');
    el.className = 'flier ' + (Math.random() < 0.5 ? 'w' : 'b');
    const size = Math.round(26 + Math.random() * 112);
    const fromLeft = Math.random() < 0.5;
    const startX = fromLeft ? -20 - Math.random() * 18 : 100 + Math.random() * 18;
    const startY = -16 + Math.random() * 132;
    const dx = (fromLeft ? 1 : -1) * (72 + Math.random() * 45);
    const dy = -55 + Math.random() * 110;
    el.style.setProperty('--x', startX.toFixed(1) + 'vw');
    el.style.setProperty('--y', startY.toFixed(1) + 'vh');
    el.style.setProperty('--s', size + 'px');
    el.style.setProperty('--dx', dx.toFixed(1) + 'vw');
    el.style.setProperty('--dy', dy.toFixed(1) + 'vh');
    el.style.setProperty('--rot', Math.round(-560 + Math.random() * 1120) + 'deg');
    el.style.setProperty('--dur', (1.45 + Math.random() * 1.5).toFixed(2) + 's');
    el.style.setProperty('--delay', (Math.random() * 1.25).toFixed(2) + 's');
    el.innerHTML = pieceSvg(type, 'flier-pc');
    box.appendChild(el);
  }
  clearTimeout(spawnPhaseFliers.timer);
  spawnPhaseFliers.timer = setTimeout(() => { box.innerHTML = ''; }, 5000);
}

function playBoardIntro() {
  const reduced = !profile.epicFx && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const pieces = $('#pieces');
  const wrap = $('#boardWrap');
  if (!pieces || !wrap) return;
  const kids = Array.from(pieces.children);
  kids.forEach((el, i) => {
    const wave = kids.length > 1 ? i / (kids.length - 1) : 0;
    el.style.setProperty('--d', (wave * 0.45 + Math.random() * 0.05).toFixed(3) + 's');
  });
  pieces.classList.remove('intro');
  wrap.classList.remove('intro');
  void pieces.offsetWidth;
  pieces.classList.add('intro');
  wrap.classList.add('intro');
  clearTimeout(playBoardIntro.timer);
  playBoardIntro.timer = setTimeout(() => {
    pieces.classList.remove('intro');
    wrap.classList.remove('intro');
  }, 1600);
}

function showPhase(phase) {
  const info = PHASES[phase] || PHASES.opening;
  spawnPhaseFliers();
  const el = $('#phaseSplash');
  $('#phaseBadge').textContent = info.title;
  $('#phaseSub').textContent = info.sub;
  fitPhaseBadge();
  el.dataset.phase = phase;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(showPhase.timer);
  showPhase.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ───────────────────────── 11. СПИСОК ХОДОВ ───────────────────────────── */

function renderMobileMoves() {
  const strip = $('#mobileMoves');
  if (!strip) return;
  const last = ui.moves.slice(-8);
  if (!last.length) {
    strip.innerHTML = '<span class="mm mm-empty">сделайте первый ход</span>';
  } else {
    strip.innerHTML = last.map((m, idx) => {
      const ply = ui.moves.length - last.length + idx + 1;
      const num = Math.ceil(ply / 2) + (ply % 2 === 0 ? '…' : '.');
      return `<span class="mm ${ply === ui.viewPly ? 'last' : ''}"><span class="mm-num">${num}</span>${escapeHtml(m.san)}</span>`;
    }).join('');
  }
  strip.classList.toggle('turn-flip', ui.orientation === 'b' && !profile.flipAll && !ui.tableRotated);
  strip.classList.toggle('table-flip', !!ui.tableRotated);
}

function renderMoves() {
  renderMobileMoves();
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
  const hn = $('#historyNav');
  if (hn) hn.classList.toggle('hidden', !ui.st);
  const hp = $('#histPos');
  if (hp) hp.textContent = `${ui.viewPly}/${max}`;
  if ($('#histPrev')) $('#histPrev').disabled = ui.viewPly <= 0;
  if ($('#histNext')) $('#histNext').disabled = ui.viewPly >= max;
  const info = $('#infoLine');
  if (info) info.textContent = `${ui.moves.length} полуходов · ${ui.st ? ui.st.mode.name : ''}`;
}

function gotoPly(ply) {
  const max = ui.frames.length - 1;
  const target = Math.max(0, Math.min(max, ply));
  if (ui.mode === 'local' && !ui.bot && ui.st && target < max) {
    /* В игре на одном телефоне это настоящий откат, а не только просмотр. */
    const f = ui.frames[target];
    ui.st.board = f.board.slice();
    ui.st.turn = f.turn;
    ui.st.ep = f.ep;
    ui.st.castling = { w: { ...f.castling.w }, b: { ...f.castling.b } };
    ui.st.blocked = f.blocked.slice();
    ui.st.capturedKing = f.capturedKing;
    ui.st.check = f.check;
    ui.st.status = 'play';
    ui.st.result = null;
    ui.st.full = target;
    ui.frames = ui.frames.slice(0, target + 1);
    ui.moves = ui.moves.slice(0, target);
    ui.viewPly = target;
    ui.lastMove = f.lastMove || null;
    ui.scored = false;
    ui.endSquare = -1;
    clearTimeout(ui.endTimer);
    ui.endTimer = 0;
    ui.selected = -1;
    renderAll(false);
    renderMoves();
    updateNav();
    renderPgnBox();
    saveCurrentGame();
    return;
  }
  ui.viewPly = target;
  ui.selected = -1;
  renderAll(false);
  renderMoves();
  updateNav();
  renderPgnBox();
}

function buildPgnText() {
  const st = ui.st;
  if (!st) return '';
  const side = myColor();
  const names = ui.names || {};
  const white = names.w ? names.w.name : (side === 'w' ? profile.name : 'Соперник');
  const black = names.b ? names.b.name : (side === 'b' ? profile.name : 'Соперник');
  const result = st.result ? (st.result.winner ? (st.result.winner === 'w' ? '1-0' : '0-1') : '1/2-1/2') : '*';
  const lines = [
    `[Event "Daymix's Chess"]`,
    `[Site "${ui.mode === 'online' ? 'по сети' : ui.bot ? 'с ботом' : 'на одном устройстве'}"]`,
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
  return lines.join('\n') + body.join(' ') + (body.length ? ' ' + result : '');
}

function renderPgnBox() {
  const box = $('#pgnBox');
  if (box) box.value = buildPgnText();
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
    this.seen = new Set();
    this.pollOk = false;
    this.pollTimer = 0;
  }

  connect(code, rawTopic) {
    this.topic = rawTopic || topicFor(code);
    this.closed = false;
    /* Локальный канал между вкладками: работает даже без интернета
       и не зависит от лимитов публичной службы. */
    try {
      this.bc = new BroadcastChannel('daymix-chess-' + this.topic);
      this.bc.onmessage = (event) => {
        if (this.onMessage && typeof event.data === 'string') this.onMessage(event.data);
      };
    } catch (error) { this.bc = null; }
    this.startPolling();
    return new Promise((resolve, reject) => {
      let settled = false;
      /* Вкладки одного браузера общаются через BroadcastChannel сразу,
         не дожидаясь внешней сети. */
      if (this.bc) resolve();
      const ws = new WebSocket(`${RELAY_WS}${this.topic}/ws`);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (error) { /* уже закрыт */ }
        if (this.pollOk) resolve();
        else reject(new Error('служба связи не отвечает'));
      }, 12000);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        this.stopPolling();
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
        if (!settled) {
          if (this.pollOk) { settled = true; resolve(); }
          return;
        }
        if (this.onClose) this.onClose();
        if (!this.closed) this.startPolling();
      };
      ws.onerror = () => {
        try { ws.close(); } catch (error) { /* уже закрыт */ }
      };
    });
  }

  startPolling() {
    if (this.pollTimer) return;
    const poll = async () => {
      if (this.closed || !this.topic) return;
      try {
        const res = await fetch(`${RELAY_HTTP}${this.topic}/json?poll=1&since=8s&limit=50`, { cache: 'no-store' });
        if (!res.ok) return;
        this.pollOk = true;
        const text = await res.text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          let packet;
          try { packet = JSON.parse(line); } catch (error) { continue; }
          if (!packet || packet.event !== 'message' || typeof packet.message !== 'string') continue;
          if (packet.id) {
            if (this.seen.has(packet.id)) continue;
            this.seen.add(packet.id);
            if (this.seen.size > 400) this.seen.delete(this.seen.values().next().value);
          }
          if (this.onMessage) this.onMessage(packet.message);
        }
      } catch (error) { /* сеть моргнула */ }
    };
    poll();
    this.pollTimer = setInterval(poll, 3500);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = 0;
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
    this.stopPolling();
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
  if (ui.online.p2p) {
    try { ui.online.p2p.publish(payload); } catch (error) { /* P2P не поднялся */ }
  }
}

function randomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function setLobby(text) { $('#lobbyLine').textContent = text || ''; }

const LOBBY_TOPIC = 'daymixchess-v2-lobby';

function ensureLobby() {
  if (ui.lobbyRelay) return ui.lobbyRelay;
  const relay = new Relay();
  relay.onMessage = (text) => handleLobby(text);
  relay.connect('', LOBBY_TOPIC).catch(() => {});
  ui.lobbyRelay = relay;
  return relay;
}

function handleLobby(text) {
  let msg;
  try { msg = JSON.parse(text); } catch (error) { return; }
  if (!msg || msg.app !== 'daymix-chess' || msg.t !== 'lobby-room' || !msg.code) return;
  if (msg.ts && Date.now() - msg.ts > 15000) return;
  if (!ui.lobbyRooms) ui.lobbyRooms = new Map();
  if (!ui.liveRooms) ui.liveRooms = new Map();
  const room = {
    code: String(msg.code),
    name: String(msg.name || 'Игрок').slice(0, 24),
    modeName: String(msg.modeName || 'Классика').slice(0, 40),
    timeLabel: String(msg.timeLabel || '').slice(0, 20),
    status: msg.status === 'live' ? 'live' : 'waiting',
    net: msg.net === 'p2p' ? 'p2p' : 'internet',
    moves: Number(msg.moves) || 0,
    ts: Date.now(),
  };
  if (room.status === 'live') {
    ui.liveRooms.set(room.code, room);
    ui.lobbyRooms.delete(room.code);
  } else {
    ui.lobbyRooms.set(room.code, room);
  }
  renderLobby();
}

function renderLobby() {
  const waiting = $('#waitingList');
  const live = $('#liveList');
  if (!waiting || !live) return;
  const now = Date.now();
  for (const map of [ui.lobbyRooms, ui.liveRooms]) {
    if (!map) continue;
    for (const [code, room] of map) {
      if (now - room.ts > 15000) map.delete(code);
    }
  }
  const own = ui.online && ui.online.code;
  const filter = ui.lobbyFilter || 'all';
  const render = (map, kind) => {
    const rooms = [...(map ? map.values() : [])]
      .filter((r) => r.code !== own && (filter === 'all' || r.net === filter))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);
    if (!rooms.length) {
      return `<div class="lobby-empty">${kind === 'live' ? 'Пока никто не играет' : 'Никто не ждёт — выставите своё ожидание'}</div>`;
    }
    return rooms.map((r) => `
      <div class="lobby-item">
        <div class="lobby-info">
          <b>${escapeHtml(r.name)}</b>
          <span>${escapeHtml(r.modeName)}${r.timeLabel ? ' · ' + escapeHtml(r.timeLabel) : ''}${kind === 'live' ? ' · ' + r.moves + ' ходов' : ''}<em class="lobby-net ${r.net}">${r.net === 'p2p' ? 'P2P' : 'P∞INTERNET'}</em></span>
        </div>
        <span class="lobby-code">${escapeHtml(r.code)}</span>
        <button class="btn btn-sm" data-${kind === 'live' ? 'watch' : 'join'}="${escapeHtml(r.code)}" type="button">${kind === 'live' ? 'Смотреть' : 'Войти'}</button>
      </div>`).join('');
  };
  waiting.innerHTML = render(ui.lobbyRooms, 'waiting');
  live.innerHTML = render(ui.liveRooms, 'live');
  const mini = $('#onlineMiniList');
  if (mini) {
    const all = [
      ...(ui.liveRooms ? [...ui.liveRooms.values()].map((r) => ({ ...r, live: true })) : []),
      ...(ui.lobbyRooms ? [...ui.lobbyRooms.values()].map((r) => ({ ...r, live: false })) : []),
    ].filter((r) => r.code !== own).sort((a, b) => b.ts - a.ts).slice(0, 3);
    if (!all.length) {
      mini.innerHTML = '<div class="lobby-empty">Пока нет открытых партий — создайте комнату, и она появится здесь.</div>';
    } else {
      mini.innerHTML = all.map((r) => `
        <div class="lobby-item">
          <div class="lobby-info"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.modeName)}${r.timeLabel ? ' · ' + escapeHtml(r.timeLabel) : ''}${r.live ? ' · идёт' : ''}<em class="lobby-net ${r.net}">${r.net === 'p2p' ? 'P2P' : 'P∞INTERNET'}</em></span></div>
          <span class="lobby-code">${escapeHtml(r.code)}</span>
          <button class="btn btn-sm" data-${r.live ? 'watch' : 'join'}="${escapeHtml(r.code)}" type="button">${r.live ? 'Смотреть' : 'Войти'}</button>
        </div>`).join('');
    }
  }
}

function lobbyAnnounce() {
  if (!ui.online || ui.online.role !== 'host' || !ui.online.code || !ui.online.publicRoom) return;
  ensureLobby();
  if (!ui.lobbyRelay) return;
  const mode = modeById(ui.st ? ui.st.modeId : profile.modeId);
  ui.lobbyRelay.publish({
    app: 'daymix-chess',
    t: 'lobby-room',
    code: ui.online.code,
    name: profile.name,
    modeName: modeName(mode),
    timeLabel: profile.timeLabel,
    status: ui.st && ui.st.status === 'play' ? 'live' : 'waiting',
    net: ui.online.p2p ? 'p2p' : 'internet',
    moves: ui.moves.length,
    ts: Date.now(),
  });
}

function stopLobbyAnnounce(close) {
  if (ui.online && ui.online.lobbyTimer) clearInterval(ui.online.lobbyTimer);
  if (ui.online) ui.online.lobbyTimer = null;
  if (close && ui.online && ui.online.code && ui.lobbyRelay) {
    ui.lobbyRelay.publish({ app: 'daymix-chess', t: 'lobby-close', code: ui.online.code, ts: Date.now() });
  }
}

function switchOnlineTab(tab) {
  $$('.online-tab').forEach((b) => b.classList.toggle('active', b.dataset.otab === tab));
  const friend = $('#onlineFriend');
  const internet = $('#onlineInternet');
  if (friend) friend.classList.toggle('hidden', tab !== 'friend');
  if (internet) internet.classList.toggle('hidden', tab !== 'internet');
  if (tab === 'internet') { ensureLobby(); renderLobby(); }
}



/* Дополнительный P2P-канал (Trystero/WebRTC). Если ntfy режет сеть,
   браузеры соединяются напрямую; сигнализация идёт через публичные Nostr-релеи. */

let connectHudTimer = 0;
let connectHudStarted = 0;

function startConnectHud(role) {
  const hud = $('#connectHud');
  if (!hud) return;
  clearInterval(connectHudTimer);
  connectHudStarted = performance.now();
  hud.classList.remove('hidden');
  const title = $('#chTitle');
  if (title) { title.textContent = role === 'host' ? 'Создаём комнату и каналы связи…' : 'Подключаемся к комнате…'; title.dataset.long = ''; }
  const steps = $('#chSteps');
  if (steps) {
    steps.innerHTML = [
      ['room', 'Комната'],
      ['net', 'Интернет-канал'],
      ['nostr', 'P2P Nostr'],
      ['mqtt', 'P2P MQTT'],
      ['ping', 'Замер пинга'],
    ].map(([key, label]) => `<span class="ch-step" data-step="${key}">• ${label}</span>`).join('');
  }
  connectHudStep('room', 'active');
  const bar = $('#chBar');
  if (bar) bar.style.width = '8%';
  setTimeout(() => connectHudStep('net', 'active'), 250);
  setTimeout(() => connectHudStep('nostr', 'active'), 650);
  setTimeout(() => connectHudStep('mqtt', 'active'), 1050);
  connectHudTimer = setInterval(() => {
    const elapsed = (performance.now() - connectHudStarted) / 1000;
    const el = $('#chElapsed');
    if (el) el.textContent = elapsed.toFixed(1) + ' с';
    const b = $('#chBar');
    if (b) b.style.width = Math.min(88, 8 + elapsed * 6) + '%';
    if (elapsed > 10 && title && !title.dataset.long) {
      title.dataset.long = '1';
      title.textContent = 'Дольше обычного — пробуем резервные каналы…';
    }
  }, 100);
}

function connectHudStep(key, state, text) {
  const el = document.querySelector(`#chSteps .ch-step[data-step="${key}"]`);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
  if (text) el.textContent = text;
  else if (state === 'done') el.textContent = '✓ ' + el.textContent.replace(/^[•✓]\s*/, '');
}

function stopConnectHud() {
  clearInterval(connectHudTimer);
  connectHudTimer = 0;
  const hud = $('#connectHud');
  if (hud) hud.classList.add('hidden');
}

const P2P_ROOM_CONFIG = {
  appId: 'daymix-chess-p2p-v1',
  relayConfig: { warnOnRelayFailure: false },
  rtcConfig: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turns:openrelay.metered.ca:443',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  },
};
const P2P_SOURCES = [
  'https://esm.run/trystero',
  'https://esm.run/@trystero-p2p/mqtt',
];

async function startP2PSource(url, code) {
  const mod = await import(url);
  if (!ui.online || ui.online.code !== code) return;
  const room = mod.joinRoom(P2P_ROOM_CONFIG, 'room-' + code);
  const action = room.makeAction('msg');
  action.onMessage = (data) => {
    if (!ui.online || ui.online.code !== code) return;
    handleNet(JSON.stringify(data));
  };
  if (!ui.online.p2p) {
    const links = [];
    ui.online.p2p = {
      links,
      best: null,
      publish: (payload) => {
        const target = ui.online.p2p.best || null;
        for (const link of (target ? [target] : links)) {
          try { link.action.send(payload); } catch (error) { /* канал отвалился */ }
        }
      },
      close: () => {
        for (const link of links) {
          try { link.room.leave(); } catch (error) { /* уже закрыт */ }
        }
      },
    };
  }
  const link = { room, action, url, peerId: null, ping: null };
  ui.online.p2p.links.push(link);
  room.onPeerJoin = (peerId) => {
    if (!ui.online || ui.online.code !== code) return;
    link.peerId = peerId;
    connectHudStep(url.includes('mqtt') ? 'mqtt' : 'nostr', 'done');
    room.ping(peerId).then((ms) => {
      link.ping = ms;
      scheduleP2PSelect();
    }).catch(() => scheduleP2PSelect());
    ui.online.connected = true;
    updateLinkDots();
    if (ui.online.role === 'guest' && !ui.online.started) {
      netPublish({ t: 'join', name: profile.name, avatar: profile.avatar });
    } else if (ui.online.role === 'host') {
      announceRoom();
    }
  };
  room.onPeerLeave = () => {
    link.peerId = null;
    link.ping = null;
    if (ui.online && ui.online.p2p) {
      if (ui.online.p2p.best === link) ui.online.p2p.best = null;
      scheduleP2PSelect();
      if (!ui.online.started) updateLinkDots();
    }
  };
}

function scheduleP2PSelect() {
  if (!ui.online || !ui.online.p2p) return;
  clearTimeout(ui.online.p2p.selectTimer);
  ui.online.p2p.selectTimer = setTimeout(() => {
    if (!ui.online || !ui.online.p2p) return;
    const links = ui.online.p2p.links.filter((l) => l.peerId && l.ping != null);
    if (!links.length) return;
    links.sort((a, b) => a.ping - b.ping);
    ui.online.p2p.best = links[0];
    connectHudStep('ping', 'done', `Замер пинга: ${Math.round(links[0].ping)} мс`);
  }, 1400);
}

async function startTrysteroRoom(code) {
  if (!ui.online || ui.online.role === 'spectator') return;
  if (navigator.webdriver) return;
  for (const url of P2P_SOURCES) {
    startP2PSource(url, code).catch(() => { /* этот сигнальный канал недоступен */ });
  }
}

async function createRoom() {
  if (ui.online && ui.online.code) leaveOnline(true);
  if (!ui.online) {
    ui.online = { code: '', role: 'host', sid: Math.random().toString(36).slice(2, 10) };
  }
  if (profile.modeId === 'random') {
    const pick = randomRealMode();
    ui.online.modeId = pick.id;
    profile.modeId = pick.id;
    saveProfile();
    renderModeCard();
    toast('Случайный режим: ' + pick.name);
  } else {
    ui.online.modeId = profile.modeId;
  }
  const code = randomCode();
  ui.online.code = code;
  ui.online.role = 'host';
  ui.online.publicRoom = !!($('#optPublicRoom') && $('#optPublicRoom').checked);
  ui.online.connected = false;
  ui.online.names = { w: profile.name, b: null };
  ui.online.avatars = { w: profile.avatar, b: 'k' };
  profile.lastRoom = { code, ts: Date.now(), role: 'host' };
  saveProfile(true);
  $('#roomCode').textContent = code;
  $('#roomRow').classList.remove('hidden');
  setLobby('Код готов. Передайте его другу — он введёт код и присоединится.');
  profile.lastRoom = { code, ts: Date.now(), role: 'guest' };
  saveProfile(true);
  startConnectHud('host');
  ui.online.relay = new Relay();
  ui.online.relay.onMessage = (text) => handleNet(text);
  ui.online.relay.onClose = () => {
    if (!ui.online) return;
    ui.online.connected = false;
    updateLinkDots();
    if (ui.online.sid) scheduleReconnect();
  };
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    setLobby('Не удалось связаться со службой. Проверьте интернет и попробуйте снова.');
    stopConnectHud();
    ui.online = null;
    return;
  }
  ui.online.connected = true;
  connectHudStep('net', 'done');
  startTrysteroRoom(code);
  setTimeout(() => {
    if (!ui.online || !ui.online.started) stopConnectHud();
  }, 1600);
  updateLinkDots();
  $('#roomCode').textContent = code;
  $('#roomRow').classList.remove('hidden');
  const chosenMode = modeById(ui.online.modeId || profile.modeId);
  setLobby(`Комната создана. Режим: ${chosenMode.name}. Ждём соперника — партия начнётся, когда он присоединится.`);
  ensureLobby();
  stopLobbyAnnounce(false);
  if (ui.online.publicRoom) {
    ui.online.lobbyTimer = setInterval(lobbyAnnounce, 8000);
    lobbyAnnounce();
  }
  ui.online.waiting = true;
  ui.st = null;
  showScreen('online');
  $('#roomRow').classList.remove('hidden');
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
    timeMs: ui.st ? ui.timeMs : profile.timeMs,
    timeLabel: profile.timeLabel,
    seed: ui.st ? ui.st.seed : null,
    net: ui.online.p2p ? 'p2p' : 'internet',
    name: profile.name,
    avatar: profile.avatar,
  });
}

function watchRoom(code) {
  joinRoom(code, { spectate: true });
}

async function joinRoom(code, opts = {}) {
  if (!/^\d{5}$/.test(code)) { setLobby('Код состоит из пяти цифр.'); return; }
  if (ui.online) leaveOnline(true);
  const spectate = !!opts.spectate;
  ui.online = {
    code, role: spectate ? 'spectator' : 'guest', sid: Math.random().toString(36).slice(2, 10),
    connected: false,
    names: spectate ? { w: null, b: null } : { w: null, b: profile.name },
    avatars: spectate ? { w: 'k', b: 'k' } : { w: 'k', b: profile.avatar },
  };
  startConnectHud(spectate ? 'spectator' : 'guest');
  ui.online.relay = new Relay();
  ui.online.relay.onMessage = (text) => handleNet(text);
  ui.online.relay.onClose = () => {
    if (!ui.online) return;
    ui.online.connected = false;
    updateLinkDots();
    if (ui.st) scheduleReconnect();
  };
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    setLobby('Комната не отвечает. Проверьте код и интернет.');
    stopConnectHud();
    ui.online = null;
    return;
  }
  ui.online.connected = true;
  if (!spectate) startTrysteroRoom(code);
  setLobby(spectate ? 'Подключаемся к наблюдению за комнатой ' + code + '…' : 'Подключаемся к комнате ' + code + '…');
  netPublish(spectate ? { t: 'watch', name: profile.name } : { t: 'join', name: profile.name, avatar: profile.avatar });
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
    netPublish(spectate ? { t: 'watch', name: profile.name } : { t: 'join', name: profile.name, avatar: profile.avatar });
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
      if (!ui.online) return;
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

  if (msg.t === 'intent' && ui.st && ui.st.flags.openIntent) {
    ui.remoteSelected = Number.isFinite(msg.sq) ? msg.sq : -1;
    renderSquares();
    return;
  }

  if (msg.t === 'watch' && ui.online.role === 'host') {
    if (!ui.st || ui.st.status !== 'play') {
      netPublish({ t: 'watch-empty' });
      return;
    }
    netPublish({
      t: 'start',
      spectator: true,
      modeId: ui.st.modeId,
      square: !!ui.st.square,
      timeMs: ui.timeMs,
      timeLabel: profile.timeLabel,
      raceMs: ui.race ? ui.race.duration : null,
      seed: ui.st.seed,
      moves: ui.moves.map((m) => ({ from: m.from, to: m.to, promo: m.promo || null })),
      cw: ui.clocks.w, cb: ui.clocks.b,
      names: { w: ui.online.names?.w || profile.name, b: ui.online.guestName || 'Соперник' },
      name: profile.name,
      guestName: ui.online.guestName || 'Соперник',
    });
    return;
  }

  if (msg.t === 'join' && ui.online.role === 'host') {
    if (ui.online.guestName === msg.name && ui.st) return;
    ui.online.guestName = msg.name;
    ui.online.names = { w: profile.name, b: msg.name || 'Соперник' };
    ui.online.avatars = { w: profile.avatar, b: msg.avatar || 'k' };
    ui.online.sid = ui.online.sid || Math.random().toString(36).slice(2, 10);
    ui.online.waiting = false;
    clearInterval(ui.online.announce);
    setLobby('');
    $('#roomRow').classList.add('hidden');
    if (!ui.st) {
      newGame({
        mode: 'online', role: 'host', modeId: profile.modeId,
        timeMs: profile.timeMs, orientation: 'w', splash: true,
      });
    }
    ui.chat.push({ name: 'Система', text: `${ui.online.names.b} присоединился к партии` });
    renderChat();
    renderPlayers();
    toast('Соперник присоединился');
    netPublish({
      t: 'start',
      modeId: ui.st.modeId,
      square: !!ui.st.square,
      timeMs: ui.timeMs,
      timeLabel: profile.timeLabel,
      raceMs: ui.race ? ui.race.duration : null,
      seed: ui.st.seed,
      moves: ui.moves.map((m) => ({ from: m.from, to: m.to })),
      cw: ui.clocks.w, cb: ui.clocks.b,
      name: profile.name, avatar: profile.avatar,
    });
    return;
  }

  if (msg.t === 'start' && ui.online.role === 'spectator') {
    clearInterval(ui.online.joinTimer);
    ui.online.started = true;
    ui.online.names = msg.names || { w: msg.name || 'Белые', b: msg.guestName || 'Чёрные' };
    ui.spectator = true;
    ui.replaying = true;
    newGame({
      mode: 'online', role: 'spectator', spectator: true,
      modeId: msg.modeId, square: !!msg.square, timeMs: msg.timeMs,
      raceMs: msg.raceMs, seed: msg.seed, orientation: 'w', splash: false,
    });
    for (const mv of (msg.moves || [])) commitMove(mv, { remote: true, silent: true });
    ui.replaying = false;
    ui.running = false;
    ui.gameLocked = false;
    ui.viewPly = ui.frames.length - 1;
    renderAll(false);
    renderPlayers();
    renderMoves();
    showScreen('game');
    setLobby('');
    toast('Наблюдение за партией');
    return;
  }

  if (msg.t === 'watch-empty') {
    setLobby('Партия ещё не началась — попробуйте позже.');
    toast('Партия ещё не началась');
    return;
  }

  if (msg.t === 'start' && ui.online.role === 'guest') {
    clearInterval(ui.online.joinTimer);
    ui.online.started = true;
    ui.online.sid = msg.sid || ui.online.sid;
    ui.online.names = { w: msg.name || 'Соперник', b: profile.name };
    ui.online.avatars = { w: msg.avatar || 'k', b: profile.avatar };
    ui.replaying = true;
    newGame({ mode: 'online', role: 'guest', modeId: msg.modeId, square: !!msg.square, timeMs: msg.timeMs, raceMs: msg.raceMs, seed: msg.seed, orientation: 'b', splash: false });
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

function stopLobbyOnLeave(close) {
  try { stopLobbyAnnounce(close); } catch (error) { /* ignore */ }
}

function leaveOnline(silent) {
  stopLobbyOnLeave(true);
  if (ui.online) {
    clearInterval(ui.online.announce);
    clearInterval(ui.online.joinTimer);
    if (!silent) netPublish({ t: 'bye' });
    if (ui.online.relay) ui.online.relay.close();
    if (ui.online.p2p) { try { ui.online.p2p.close(); } catch (error) { /* уже закрыт */ } }
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

function togglePause(force) {
  if (!ui.st || ui.st.status !== 'play') return;
  if (ui.mode !== 'local') { toast('Пауза доступна в игре на одном устройстве'); return; }
  const next = force != null ? force : !ui.paused;
  if (next === ui.paused) return;
  if (next) {
    if (ui.running && ui.timeMs) {
      const now = performance.now();
      ui.clocks[ui.st.turn] = Math.max(0, ui.clocks[ui.st.turn] - (now - ui.turnStart));
    }
    ui.paused = true;
    ui.running = false;
    $('#pauseOverlay').classList.remove('hidden');
    $('#railPause').classList.add('paused');
    updateClockEls();
    renderStatus();
    toast('Пауза — часы стоят');
  } else {
    ui.paused = false;
    ui.turnStart = performance.now();
    ui.running = ui.timeMs > 0 && ui.moves.length > 0;
    $('#pauseOverlay').classList.add('hidden');
    $('#railPause').classList.remove('paused');
    renderStatus();
    if (ui.bot && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 400);
    toast('Продолжаем');
  }
}

function askLeave() {
  if (!ui.st || ui.st.status !== 'play' || ui.scored) { leaveGame(); return; }
  if (ui.paused) togglePause(false);
  ui.leaveResume = ui.running;
  ui.running = false;
  ui.confirmAction = 'leave';
  const side = ui.st.turn;
  const who = side === 'w' ? 'белых' : 'чёрных';
  const online = ui.mode === 'online';
  const early = online && ui.moves.length < 7;
  $('#confirmTitle').textContent = 'Покинуть партию?';
  if (!online) {
    $('#confirmText').textContent = 'Это партия с ботом или офлайн-партия. Выход не засчитывается как поражение, очки не изменятся.';
  } else if (early) {
    $('#confirmText').textContent = `Сделано меньше 7 ходов (${ui.moves.length}) — можно выйти без поражения и без потери очков.`;
  } else {
    $('#confirmText').textContent = `Сейчас ход ${who}. Выход после 7 ходов засчитается как поражение.`;
  }
  $('#confirmLeave').textContent = 'Выйти';
  $('#confirmModal').classList.remove('hidden');
}

function askResign() {
  if (!ui.st || ui.st.status !== 'play' || ui.scored) return;
  ui.confirmAction = 'resign';
  $('#confirmTitle').textContent = 'Сдаться?';
  $('#confirmText').textContent = 'Партия сразу закончится поражением того, за кого вы сейчас играете. Отменить будет нельзя.';
  $('#confirmLeave').textContent = 'Сдаться';
  $('#confirmModal').classList.remove('hidden');
}

function closeConfirm() {
  const modal = $('#confirmModal');
  if (modal) modal.classList.add('hidden');
  if (ui.leaveResume && ui.st && ui.st.status === 'play' && !ui.paused) {
    ui.running = true;
    ui.turnStart = performance.now();
  }
  ui.leaveResume = false;
  ui.confirmAction = null;
}

function confirmLeaveGame() {
  closeConfirm();
  if (!ui.st) { leaveGame(); return; }
  const online = ui.mode === 'online';
  const tooEarly = online && ui.moves.length < 7;
  const freeExit = !online || tooEarly;
  if (ui.st.status === 'play') {
    if (freeExit) {
      ui.scored = true;
      if (online) netPublish({ t: 'end', winner: null, reason: 'abort' });
      $('#result').classList.add('hidden');
      toast(online ? 'Меньше 7 ходов — вышли без поражения' : 'Вышли без поражения');
    } else {
      const result = { winner: other(myColor()), reason: 'left' };
      ui.st.status = 'over';
      ui.st.result = result;
      renderAll(false);
      finishGame(result);
      if (online) netPublish({ t: 'end', winner: result.winner, reason: 'left' });
      $('#result').classList.add('hidden');
      toast('Выход засчитан как поражение');
    }
  }
  setTimeout(leaveGame, 260);
}

function hardStopBotGame() {
  ui.scored = true;
  ui.running = false;
  clearInterval(ui.timer);
  stopBrawl();
  stopRaceClock();
  ui.race = null;
  ui.st = null;
  ui.bot = null;
  ui.away = false;
  ui.selected = -1;
  updateResumeFloat();
  toast('Партия с ботом остановлена');
}

function suspendGame() {
  if (!ui.st || ui.st.status !== 'play') return;
  ui.away = true;
  ui.running = false;
  if (ui.race) ui.race.last = performance.now();
  renderStatus();
  updateResumeFloat();
  toast('Партия ждёт вас — часы остановлены');
}

function resumeGame() {
  if (!ui.st || ui.st.status !== 'play') return;
  ui.away = false;
  ui.turnStart = performance.now();
  if (ui.timeMs) ui.running = true;
  renderAll(false);
  updateResumeFloat();
  if (ui.bot && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 500);
}

function updateResumeFloat() {
  const btn = $('#resumeFloat');
  if (!btn) return;
  const show = !!(ui.st && ui.st.status === 'play' && ui.screen !== 'game' && !ui.scored);
  btn.classList.toggle('hidden', !show);
}

function leaveGame() {
  clearTimeout(ui.endTimer);
  ui.endTimer = 0;
  ui.endSquare = -1;
  stopRoyal();
  stopZombie();
  stopStrategy();
  document.body.classList.remove('flip-all');
  const boardLeave = $('#board');
  if (boardLeave) boardLeave.classList.remove('board-rotated');
  stopBrawl();
  stopRaceClock();
  try { localStorage.removeItem(CURRENT_KEY); } catch (error) { /* ignore */ }
  leaveOnline();
  ui.st = null;
  ui.running = false;
  ui.paused = false;
  ui.bot = null;
  ui.movedId = null;
  clearInterval(ui.timer);
  $('#result').classList.add('hidden');
  if ($('#pauseOverlay')) $('#pauseOverlay').classList.add('hidden');
  if ($('#railPause')) $('#railPause').classList.remove('paused');
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
  $$('.sb-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.id === 'sbNavBots') {
        openBotModal();
        return;
      }
      openScreen(btn.dataset.screen);
    });
  });
  $('#sbBrand').addEventListener('click', () => showScreen('home'));
  $('#sbProfile').addEventListener('click', () => openScreen('settings'));
  if ($('#sbProfile')) $('#sbProfile').addEventListener('click', () => openScreen('settings'));
  if ($('#homeSettings')) $('#homeSettings').addEventListener('click', () => openScreen('settings'));
  $('#homeSettings').addEventListener('click', () => openScreen('settings'));
  $$('#btnPickMode, #homeSettings').forEach((b) => b.addEventListener('click', () => {
    if (b.id === 'btnPickMode') openScreen('modes');
  }));
  $$('.mode-filter').forEach((b) => b.addEventListener('click', () => {
    $$('.mode-filter').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    renderModesGrid(b.dataset.filter);
  }));
  if ($('#imboBack')) $('#imboBack').addEventListener('click', () => showScreen('modes'));
  if ($('#imboClose')) $('#imboClose').addEventListener('click', openImboHub);
  if ($('#imboRestart')) $('#imboRestart').addEventListener('click', () => {
    if (!ui.imbo) return;
    const [a, b] = ui.imbo.params || [];
    imboStart(ui.imbo.kind, b || a);
  });
  $$('.imbo-card').forEach((b) => b.addEventListener('click', () => imboStart(b.dataset.imbo, b.dataset.var)));
  if ($('#modesBackFloat')) $('#modesBackFloat').addEventListener('click', backFromScreen);
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
    if ($('#sbName')) $('#sbName').textContent = profile.name;
    if ($('#homeName')) $('#homeName').textContent = profile.name;
    saveProfile();
  });

  const setEpic = (on) => {
    profile.epicFx = !!on;
    document.documentElement.classList.toggle('epic-fx', !!on);
    if ($('#optEpicFx')) $('#optEpicFx').checked = !!on;
    if ($('#quickEpicFx')) $('#quickEpicFx').checked = !!on;
    saveProfile();
    toast(on ? 'Эпичные эффекты включены' : 'Эпичные эффекты выключены');
  };
  if ($('#quickEpicFx')) $('#quickEpicFx').addEventListener('change', (e) => setEpic(e.target.checked));
  if ($('#optCalm')) $('#optCalm').addEventListener('change', (e) => setCalm(e.target.checked));
  if ($('#btnRefreshGame')) $('#btnRefreshGame').addEventListener('click', refreshActiveGame);
  if ($('#btnImportLocal')) $('#btnImportLocal').addEventListener('click', openImport);
  if ($('#btnExportCurrent')) $('#btnExportCurrent').addEventListener('click', exportGameFile);
  if ($('#langSelect')) $('#langSelect').addEventListener('change', (e) => {
    profile.language = e.target.value === 'en' ? 'en' : 'ru';
    saveProfile();
    location.reload();
  });
  $$('.welcome-lang').forEach((b) => b.addEventListener('click', () => chooseWelcomeLanguage(b.dataset.lang)));
  if ($('#welcomeStart')) $('#welcomeStart').addEventListener('click', () => finishWelcome(false));
  if ($('#welcomeSettings')) $('#welcomeSettings').addEventListener('click', () => finishWelcome(true));
  if ($('#optEpicFx')) $('#optEpicFx').addEventListener('change', (e) => setEpic(e.target.checked));
  if ($('#resumeFloat')) $('#resumeFloat').addEventListener('click', () => showScreen('game'));
  if ($('#optFlipAll')) $('#optFlipAll').addEventListener('change', (e) => {
    profile.flipAll = e.target.checked;
    saveProfile();
    toast(profile.flipAll ? 'Переворачиваться будет весь игровой стол' : 'Переворачивается только доска');
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
    sound.click();
    startGameWithMode({ mode: 'local', timeMs: profile.timeMs, splash: true });
  });

  $$('.bot-level').forEach((b) => b.addEventListener('click', () => startBotGame(b.dataset.level)));
  $$('#botModal .bot-choice').forEach((b) => b.addEventListener('click', () => startBotGame(b.dataset.level)));
  if ($('#botClose')) $('#botClose').addEventListener('click', closeBotModal);
  if ($('#botCancel')) $('#botCancel').addEventListener('click', closeBotModal);
  if ($('#botModal')) $('#botModal').addEventListener('click', (e) => { if (e.target && e.target.id === 'botModal') closeBotModal(); });

  $('#btnExport').addEventListener('click', exportGameFile);
  $('#btnCopyGame').addEventListener('click', copyGameJson);
  $('#btnImport').addEventListener('click', openImport);
  $('#importClose').addEventListener('click', closeImport);
  $('#importConfirm').addEventListener('click', () => {
    const text = $('#importText').value.trim();
    if (!text) { toast('Вставьте JSON партии'); return; }
    importGameText(text);
  });
  $('#importPaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('#importText').value = text;
      importGameText(text);
    } catch (error) {
      toast('Нет доступа к буферу — вставьте текст вручную');
    }
  });
  $('#importFileBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importGameText(reader.result);
    reader.readAsText(file);
    e.target.value = '';
  });
  $('#skinClose').addEventListener('click', closeSkinModal);
  $('#skinModal').addEventListener('click', (e) => { if (e.target && e.target.id === 'skinModal') closeSkinModal(); });

  $('#btnCreateDirect').addEventListener('click', () => createRoom());

  $('#btnCopyCode').addEventListener('click', async () => {
    const code = $('#roomCode').textContent.trim();
    const shareUrl = `https://chess.daymix.dpdns.org/#${code}`;
    try { await navigator.clipboard.writeText(shareUrl); toast('Ссылка скопирована — отправьте её другу'); }
    catch (error) { toast('Код: ' + code); }
  });
  $('#btnCancelRoom').addEventListener('click', () => {
    leaveOnline(true);
    $('#roomRow').classList.add('hidden');
    setLobby('Создание отменено');
    if (ui.st) leaveGame();
  });

  $('#btnJoinDirect').addEventListener('click', () => joinRoom($('#joinCodeDirect').value.trim()));
  $('#joinCodeDirect').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(e.target.value.trim()); });
  $('#onlineBack').addEventListener('click', backFromScreen);


  $('#railHint').addEventListener('click', showHint);
  $('#railSettings').addEventListener('click', () => { closePanel(); toggleDrawer(); });
  if ($('#panelToggle')) $('#panelToggle').addEventListener('click', () => { closeDrawer(); togglePanel(); });
  $('#railHome').addEventListener('click', askLeave);
  $('#railPause').addEventListener('click', () => togglePause());
  if ($('#mobPause')) $('#mobPause').addEventListener('click', () => togglePause());
  if ($('#brawlShield')) $('#brawlShield').addEventListener('click', brawlShieldAction);
  if ($('#brawlBan')) $('#brawlBan').addEventListener('click', openBrawlBan);
  if ($('#brawlBanClose')) $('#brawlBanClose').addEventListener('click', () => $('#brawlBanModal').classList.add('hidden'));
  window.addEventListener('pointermove', brawlCardDragMove);
  window.addEventListener('pointerup', brawlCardDragEnd);
  window.addEventListener('pointercancel', brawlCardDragEnd);
  if ($('#mobResign')) $('#mobResign').addEventListener('click', () => {
    if (ui.st && ui.st.status === 'play') askResign();
    else toast('Партия ещё не начата');
  });
  if ($('#mobLeave')) $('#mobLeave').addEventListener('click', askLeave);
  if ($('#mobSettings')) $('#mobSettings').addEventListener('click', () => toggleDrawer());
  $$('.online-tab').forEach((b) => b.addEventListener('click', () => switchOnlineTab(b.dataset.otab)));
  if ($('#optPublicRoom')) {
    $('#optPublicRoom').checked = !!profile.publicRoom;
    $('#optPublicRoom').addEventListener('change', (e) => {
      profile.publicRoom = e.target.checked;
      saveProfile(true);
      if (ui.online && ui.online.role === 'host' && ui.online.code) {
        ui.online.publicRoom = e.target.checked;
        if (e.target.checked) {
          ensureLobby();
          lobbyAnnounce();
          clearInterval(ui.online.lobbyTimer);
          ui.online.lobbyTimer = setInterval(lobbyAnnounce, 8000);
        } else {
          clearInterval(ui.online.lobbyTimer);
          stopLobbyAnnounce(true);
        }
      }
    });
  }
  $$('.lobby-filter').forEach((b) => b.addEventListener('click', () => {
    ui.lobbyFilter = b.dataset.lfilter || 'all';
    $$('.lobby-filter').forEach((x) => x.classList.toggle('active', x === b));
    renderLobby();
  }));
  if ($('#lobbyCreate')) $('#lobbyCreate').addEventListener('click', () => {
    if ($('#optPublicRoom')) $('#optPublicRoom').checked = true;
    profile.publicRoom = true;
    saveProfile(true);
    switchOnlineTab('friend');
    createRoom();
  });
  if ($('#lobbyRefresh')) $('#lobbyRefresh').addEventListener('click', () => { ensureLobby(); renderLobby(); });
  if ($('#openLobby')) $('#openLobby').addEventListener('click', () => switchOnlineTab('internet'));
  if ($('#onlineMiniList')) $('#onlineMiniList').addEventListener('click', (e) => {
    const j = e.target.closest('[data-join]');
    const w = e.target.closest('[data-watch]');
    if (j) joinRoom(j.dataset.join);
    if (w) watchRoom(w.dataset.watch);
  });
  if ($('#waitingList')) $('#waitingList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-join]');
    if (b) joinRoom(b.dataset.join);
  });
  if ($('#liveList')) $('#liveList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-watch]');
    if (b) watchRoom(b.dataset.watch);
  });
  if ($('#resumeBtn')) $('#resumeBtn').addEventListener('click', resumeSavedGame);
  if ($('#sbProfileEdit')) $('#sbProfileEdit').addEventListener('click', () => {
    const pop = $('#profilePop');
    if (!pop) return;
    pop.classList.toggle('hidden');
    if (!pop.classList.contains('hidden')) renderProfilePop();
  });
  if ($('#ppClose')) $('#ppClose').addEventListener('click', () => $('#profilePop').classList.add('hidden'));
  if ($('#stratX2')) $('#stratX2').addEventListener('click', () => {
    if (!ui.strategy) return;
    ui.strategy.x2 = true;
    toast('Следующий доход ×2');
  });
  if ($('#stratPlus')) $('#stratPlus').addEventListener('click', () => {
    if (!ui.strategy) return;
    const extra = Math.random() < 0.5 ? 2 : 1;
    strategyAddGold(ui.st.turn, extra);
    toast('+25% к доходу');
    strategyRender();
  });
  if ($('#stratSkipMove')) $('#stratSkipMove').addEventListener('click', () => {
    const s = ui.strategy;
    if (!s || s.phase !== 'move') return;
    const mover = ui.st.turn;
    strategyAddGold(mover, 10);
    toast('Ход пропущен: +10 очков');
    strategyAfterMove(mover, null);
  });
  if ($('#stratSkipAttack')) $('#stratSkipAttack').addEventListener('click', () => {
    if (!ui.strategy || ui.strategy.phase !== 'attack') return;
    strategyEndTurn();
  });
  if ($('#stratSpecial')) $('#stratSpecial').addEventListener('click', strategySpecial);
  if ($('#stratCap')) $('#stratCap').addEventListener('click', () => {
    const s = ui.strategy;
    if (!s) return;
    if (s.cap >= 150) { toast('Лимит уже 150'); return; }
    if (s.gold[ui.st.turn] < 20) { toast('Нужно 20 очков'); return; }
    s.gold[ui.st.turn] -= 20;
    s.cap = Math.min(150, s.cap + 5);
    toast(`Лимит казны: ${s.cap}`);
    strategyRender();
  });

  if ($('#homeAvatarBtn')) $('#homeAvatarBtn').addEventListener('click', () => {
    const pop = $('#profilePop');
    if (!pop) return;
    pop.classList.toggle('hidden');
    if (!pop.classList.contains('hidden')) renderProfilePop();
  });
  if ($('#homeNickSave')) $('#homeNickSave').addEventListener('click', saveHomeNick);
  if ($('#homeNickInput')) $('#homeNickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveHomeNick(); });
  if ($('#ppSaveName')) $('#ppSaveName').addEventListener('click', saveProfileName);
  if ($('#ppName')) $('#ppName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveProfileName(); });
  if ($('#ppBoards')) $('#ppBoards').addEventListener('click', () => { $('#profilePop').classList.add('hidden'); showScreen('settings'); });
  if ($('#ppPieces')) $('#ppPieces').addEventListener('click', () => { $('#profilePop').classList.add('hidden'); showScreen('settings'); });
  if ($('#ppStatsBtn')) $('#ppStatsBtn').addEventListener('click', () => { $('#profilePop').classList.add('hidden'); showScreen('stats'); });
  document.querySelectorAll('.side-pick').forEach((b) => {
    b.addEventListener('click', () => {
      const pick = b.dataset.side;
      profile.side = pick === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
      saveProfile();
      renderQuickSide();
      if (pick === 'random') toast(profile.side === 'w' ? 'Вы за белых' : 'Вы за чёрных');
    });
  });
  const randomTheme = () => {
    const pool = THEMES.filter((item) => item.id !== profile.theme);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setTheme(pick.id);
    toast('Доска: ' + pick.name);
  };
  if ($('#btnRandomTheme')) $('#btnRandomTheme').addEventListener('click', randomTheme);
  if ($('#btnRandomBoard')) $('#btnRandomBoard').addEventListener('click', randomTheme);
  if ($('#rejoinBtn')) $('#rejoinBtn').addEventListener('click', () => {
    if (profile.lastRoom && profile.lastRoom.code) joinRoom(profile.lastRoom.code);
  });
  $('#resumeGame').addEventListener('click', () => togglePause(false));
  $('#confirmCancel').addEventListener('click', closeConfirm);
  $('#confirmLeave').addEventListener('click', () => {
    if (ui.confirmAction === 'resign') {
      closeConfirm();
      resign();
    } else {
      confirmLeaveGame();
    }
  });
  $('#railSound').addEventListener('click', () => setSound(profile.sound === false));
  $('#railFlip').addEventListener('click', () => {
    if (profile.flipAll) {
      ui.rotated = !ui.rotated;
      ui.tableRotated = false;
      document.body.classList.toggle('flip-all', ui.rotated);
      $('#board').classList.remove('board-rotated');
    } else {
      ui.tableRotated = !ui.tableRotated;
      ui.rotated = false;
      document.body.classList.remove('flip-all');
      $('#board').classList.toggle('board-rotated', ui.tableRotated);
    }
    renderAll(false);
    renderPlayers();
  });
  $('#optSound').addEventListener('change', (e) => setSound(e.target.checked));
  $('#gSound').addEventListener('change', (e) => setSound(e.target.checked));

  $('#navStart').addEventListener('click', () => gotoPly(0));
  if ($('#histPrev')) $('#histPrev').addEventListener('click', () => gotoPly(ui.viewPly - 1));
  if ($('#histNext')) $('#histNext').addEventListener('click', () => gotoPly(ui.viewPly + 1));
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
  $('#btnLeave').addEventListener('click', askLeave);

  $('#resultAgain').addEventListener('click', () => {
    $('#result').classList.add('hidden');
    newGame({ mode: ui.mode || 'local', modeId: ui.st ? ui.st.modeId : profile.modeId, timeMs: ui.timeMs, splash: true });
  });
  $('#resultMenu').addEventListener('click', leaveGame);
  $('#resultClose').addEventListener('click', () => {
    $('#result').classList.add('hidden');
    ui.endSquare = -1;
    renderSquares();
  });

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

  let dragState = null;
  const clearDragHover = () => {
    document.querySelectorAll('.sq.drag-over').forEach((el) => el.classList.remove('drag-over'));
  };
  const finishDrag = (e) => {
    if (!dragState) return;
    const d = dragState;
    dragState = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', finishDrag);
    clearDragHover();
    if (!d.active) return;
    e.preventDefault();
    d.el.classList.remove('dragging');
    const piecesLayer = $('#pieces');
    if (piecesLayer) piecesLayer.classList.remove('raise');
    d.el.style.zIndex = '';
    if (d.target != null) {
      ui.suppressClick = true;
      d.el.style.transition = '';
      onSquareClick(d.target);
    } else {
      d.el.style.transition = 'transform .18s cubic-bezier(.2,.8,.3,1)';
      d.el.style.transform = `translate(${d.baseX}px, ${d.baseY}px)`;
      setTimeout(() => {
        d.el.style.transition = '';
        d.el.style.transform = `translate(${d.baseX}px, ${d.baseY}px)`;
      }, 200);
      ui.selected = -1;
      renderSquares();
      renderHints();
      ui.suppressClick = true;
    }
  };
  const onDragMove = (e) => {
    if (!dragState) return;
    const d = dragState;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active && Math.hypot(dx, dy) < 6) return;
    if (!d.active) {
      d.active = true;
      d.el.classList.add('dragging');
      const piecesLayer = $('#pieces');
      if (piecesLayer) piecesLayer.classList.add('raise');
      d.el.style.transition = 'none';
    }
    const tilt = Math.max(-11, Math.min(11, dx * 0.09));
    d.el.style.transform = `translate(${d.baseX + dx}px, ${d.baseY + dy}px) scale(1.12) rotate(${tilt}deg)`;
    d.el.style.zIndex = '9999';
    clearDragHover();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const sqEl = under && under.closest ? under.closest('.sq') : null;
    d.target = null;
    if (sqEl) {
      const to = Number(sqEl.dataset.sq);
      const legal = legalMoves(ui.st, ui.st.turn);
      if (legal.some((m) => m.from === d.from && m.to === to)) {
        d.target = to;
        sqEl.classList.add('drag-over');
      }
    }
  };
  const suppressNextClick = () => {
    ui.suppressClick = true;
    clearTimeout(suppressNextClick.timer);
    suppressNextClick.timer = setTimeout(() => { ui.suppressClick = false; }, 320);
  };
  $('#squares').addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const sqEl = e.target.closest('.sq');
    if (ui.spectator) return;
    if (!sqEl || !ui.st || ui.st.status !== 'play' || ui.gameLocked || ui.paused || ui.imported) return;
    if (ui.viewPly !== ui.frames.length - 1) return;
    if (ui.bot && ui.st.turn === ui.bot.color) return;
    if (ui.mode === 'online' && ui.st.turn !== myColor()) return;
    if (ui.mode !== 'local' && ui.st.turn !== myColor()) return;
    const sq = Number(sqEl.dataset.sq);
    const p = ui.st.board[sq];
    if (!p || p.c !== ui.st.turn) return;
    if (ui.st.flags.touchMove && ui.selected >= 0) {
      const selectedMoves = legalMoves(ui.st, ui.st.turn).filter((m) => m.from === ui.selected);
      if (selectedMoves.length && sq !== ui.selected) return;
    }
    if (ui.st.flags.touchMove && ui.selected >= 0 && !legalMoves(ui.st, ui.st.turn).some((m) => m.from === ui.selected)) return;
    /* Выделяем фигуру сразу на pointerdown: её можно тащить, не делая
       предварительный клик. Для touchMove это и есть «одно касание». */
    ui.selected = sq;
    renderSquares();
    renderHints();
    const el = ui.pieceNodes.get(p.id);
    if (!el) return;
    suppressNextClick();
    const { dx, dy } = disp(ui.st, sq);
    dragState = { from: sq, x: e.clientX, y: e.clientY, active: false, el, baseX: dx * ui.sq, baseY: dy * ui.sq, target: null };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  });

  $('#squares').addEventListener('click', (e) => {
    if (ui.suppressClick) { ui.suppressClick = false; return; }
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
    if (e.key === 'Escape') {
      closeSkinModal();
      closeImport();
      closeBotModal();
      closeDrawer();
      closePanel();
      ui.selected = -1;
      renderSquares();
      renderHints();
    }
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
  const roomHash = location.hash.replace('#', '').trim();
  if (/^\d{5}$/.test(roomHash)) {
    setTimeout(() => {
      if (!ui.st) {
        if ($('#joinCodeDirect')) $('#joinCodeDirect').value = roomHash;
        joinRoom(roomHash);
        toast('Подключаемся к комнате ' + roomHash + '…');
      }
    }, 500);
  }
  bindEvents();
  renderProfile();
  renderThemeRows();
  renderPieceRows();
  renderAvatarRow();
  renderTimeGroups();
  renderModeCard();
  if ($('#joinCodeDirect')) $('#joinCodeDirect').value = '';
  if (!profile.onboarded && !SKIP_WELCOME) showWelcome();
  showScreen('home');
  translateStaticDom();
  window.ChessApp = {
    engine: { createState, legalMoves, genPseudo, applyMove, undoMove, moveToSan, updateStatus, perft, toFen: null, findKing, sqName, positionKey, inCheck, attacked, materialOf, visSet, maybeBlock, centerCells, evaluateWhite, bestMove, MODES, modeById },
    ui, profile,
    newGame, commitMove, gotoPly, showScreen, myColor, scoreGame,
    startBotGame, maybeBotTurn, chooseBotMove, buildGameJson, importGameText,
    phaseFor, updateSameStreak, askLeave, confirmLeaveGame, closeConfirm, fitPhaseBadge,
    chooseWelcomeLanguage, finishWelcome, refreshActiveGame, setCalm, autoBrawlDraft, zombieScan, royalShrink, strategySelectAttacker, strategyAttack, strategyEndTurn, strategyAfterMove, strategySpecial, strategyRender,
    captureFx, playResultFx,
    PIECE_SKINS, applySkin, setPieces,
    openSkinModal: () => openSkinModal(),
    setProfile: (patch) => { Object.assign(profile, patch); renderProfile(); renderThemeRows(); renderPieceRows(); renderPreview(); saveProfile(true); },
  };
}

document.addEventListener('DOMContentLoaded', boot);
