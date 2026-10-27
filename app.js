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

const CAP_TIER = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 5 };

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
    if (label) label.textContent = n >= 8 ? 'пат' : `${Math.min(4, n - 4)}/4`;
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
  if (!stage || !wrap) return;
  const br = wrap.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const badge = document.createElement('div');
  badge.className = 'extreme-diff';
  badge.textContent = 'EXTREME DIFF';
  badge.style.left = (br.left - sr.left + br.width / 2) + 'px';
  badge.style.top = (br.top - sr.top + br.height * 0.16) + 'px';
  stage.appendChild(badge);
  setTimeout(() => badge.remove(), 1700);
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
    if (!ui.st || ui.imported || ui.mode === 'online' || ui.st.status === 'over' || ui.anim) {
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

function scheduleFirstMoveTimer() {
  clearTimeout(ui.firstMoveTimer);
  ui.firstMoveTimer = 0;
  if (!ui.st || ui.st.status !== 'play' || ui.moves.length || ui.st.turn !== 'w') return;
  if (ui.mode !== 'local') return;
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
  if (wrap) {
    wrap.classList.remove('drama-zoom');
    void wrap.offsetWidth;
    wrap.classList.add('drama-zoom');
  }
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
  if (!list || !list.length || !ui.st) return;
  const st = ui.st;
  const sq = ui.sq;
  const layer = $('#hints');
  let topTier = 1;
  for (const item of list) {
    const tier = CAP_TIER[item.type] || 1;
    topTier = Math.max(topTier, tier);
    if (!layer || tier === 4) continue;
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
  if (topTier === 1) {
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
  pawnBack: 'Назад', kingKnight: 'Король-конь', queenLose: 'Ферзь', weakKnights: 'Кони',
  castleReturn: 'Рокировка', square10: '10×10', square12: '12×12', infernal: 'Инферно',
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
  if ($('#homePoints')) $('#homePoints').textContent = `${profile.points} очков`;
  if ($('#resumeBtn')) $('#resumeBtn').classList.toggle('hidden', !loadCurrentGame());
  renderFakeBots();
  renderQuickSide();
  renderProfilePop();
  updateOnlineModeLine();
  const rejoin = $('#rejoinRow');
  if (rejoin) {
    const last = profile.lastRoom;
    const fresh = last && Date.now() - last.ts < 30 * 60 * 1000 && !ui.online;
    rejoin.classList.toggle('hidden', !fresh);
    if (fresh && $('#rejoinBtn')) $('#rejoinBtn').textContent = `↩ Вернуться в комнату ${last.code}`;
  }
  document.documentElement.dataset.theme = profile.theme;
  document.documentElement.dataset.pieces = profile.pieces;
  applySkin();
  $('#optFlip').checked = profile.flip;
  if ($('#optFlipAll')) $('#optFlipAll').checked = !!profile.flipAll;
  if ($('#optTableFlip')) $('#optTableFlip').checked = profile.tableFlip !== false;
  if ($('#optEpicFx')) $('#optEpicFx').checked = !!profile.epicFx;
  if ($('#quickEpicFx')) $('#quickEpicFx').checked = !!profile.epicFx;
  document.documentElement.classList.toggle('epic-fx', !!profile.epicFx);
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
  saveProfile();
}

function renderThemePreview() {
  const box = $('#themePreview');
  if (!box) return;
  const theme = THEMES.find((t) => t.id === profile.theme) || THEMES[0];
  let cells = '';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const light = (x + y) % 2 === 0;
      cells += `<span class="tp-sq" style="background:${light ? theme.light : theme.dark}"></span>`;
    }
  }
  box.innerHTML = `<div class="tp-board">${cells}
    <span class="tp-piece tp-w">${pieceSvg('q')}</span>
    <span class="tp-piece tp-b">${pieceSvg('n')}</span>
  </div>
  <div class="tp-caption">${theme.name} · ${PIECE_SKINS.find((s) => s.id === profile.pieces)?.name || 'Классика'}</div>`;
}

function setPieces(id) {
  document.querySelectorAll('.piece').forEach((el) => { el.dataset.tk = ''; });
  profile.pieces = String(id);
  document.documentElement.dataset.pieces = profile.pieces;
  applySkin();
  $$('.pset').forEach((b) => b.classList.toggle('active', b.dataset.pieces === profile.pieces));
  saveProfile();
  closeSkinModal();
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
        box.querySelectorAll('.time-item').forEach((el) => el.classList.toggle('active', el === b));
        box.querySelectorAll('details.time-group').forEach((d) => { d.open = false; });
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
      name.textContent = final.name;
      sub.textContent = 'режим выбран';
      if ($('#rouletteDesc')) $('#rouletteDesc').textContent = final.desc;
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

function startGameWithMode(opts = {}) {
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
  queenLose: 2, weakKnights: 1, castleReturn: 2, square10: 2, square12: 3, infernal: 3,
};
const GROUP_TITLES = {
  1: 'Классика и лёгкие изменения',
  2: 'Средние изменения',
  3: 'Сильные изменения и хаос',
};

function makeModeCard(m, mode) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mode-tile big' + (profile.modeId === m.id ? ' active' : '') + (m.flags.randomPick ? ' random-tile' : '');
  const size = m.square && profile.square ? `${m.W}×${m.W}` : `${m.W}×${m.H}`;
  const group = MODE_GROUP[m.id] || 1;
  card.innerHTML = `
    <span class="mt-icon">${m.icon}</span>
    <span class="mt-body">
      <span class="mt-name full">${m.name}</span>
      <span class="mt-name short">${MODE_SHORT[m.id] || m.name}</span>
      <span class="mt-desc">${m.desc}</span>
      <span class="mt-meta"><i class="mt-badge g${group}">${group === 1 ? 'лёгкий' : group === 2 ? 'средний' : 'сильный'}</i> ${size}${m.n ? ' · режим ' + m.n : ''}</span>
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
  for (const [label, count] of [['all', MODES.length], ['popular', MODE_CATS.popular.length], ['pieces', MODE_CATS.pieces.length], ['chaos', MODE_CATS.chaos.length]]) {
    const b = $(`.mode-filter[data-filter="${label}"]`);
    if (b) {
      const em = b.querySelector('em') || document.createElement('em');
      em.textContent = String(count);
      b.appendChild(em);
      b.classList.toggle('active', label === mode);
    }
  }
  const appendGrid = (parent, items) => {
    const grid = document.createElement('div');
    grid.className = 'modes-grid grouped';
    for (const m of items) grid.appendChild(makeModeCard(m, mode));
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
      title.innerHTML = `<b>${GROUP_TITLES[g]}</b><span class="chip">${items.length}</span>`;
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

function saveProfileName() {
  const input = $('#ppName');
  if (!input) return;
  const name = input.value.trim().slice(0, 18) || 'Игрок';
  profile.name = name;
  saveProfile(true);
  toast('Имя сохранено');
}

function updateOnlineModeLine() {
  const el = $('#onlineModeLine');
  if (!el) return;
  const m = modeById(profile.modeId);
  el.innerHTML = `Режим: <b>${escapeHtml(m.name)}</b> · ${m.W}×${m.H} · ${escapeHtml(profile.timeLabel || 'без ограничений')}`;
}

function showScreen(name) {
  if (name !== 'game') { closeDrawer(); closePanel(); }
  const wasGame = ui.screen === 'game';
  const activeGame = ui.st && ui.st.status === 'play' && !ui.scored;
  if (wasGame && name !== 'game' && activeGame && !ui.away) suspendGame();
  if (name === 'game' && ui.away) resumeGame();
  ui.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $$('.sb-btn').forEach((b) => b.classList.remove('active'));
  const nav = name === 'home' || name === 'game' ? $('#sbNavPlay') : $(`.sb-btn[data-screen="${name}"]`);
  if (nav) nav.classList.add('active');
  if (name === 'online') updateOnlineModeLine();
  if (name === 'stats') renderStats();
  updateResumeFloat();
  if (name === 'settings') renderSettings();
  if (name === 'home') { renderProfile(); }
  if (name === 'modes') renderModesGrid();
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
  const topBar = $('#barTop');
  const bottomBar = $('#barBottom');
  const cinema = window.matchMedia && window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches;
  const phone = window.innerWidth < 1000;
  const barH = phone
    ? (cinema ? 52 + 26 : 76 + 22 + 38)
    : 96;   // фиксировано: доска не дёргается при взятии
  const gaps = 8;
  const shell = $('#gameShell');
  const panel = $('#sidePanel');
  const desk = window.innerWidth >= 1000;
  const panelW = desk && panel ? panel.offsetWidth : 0;
  const padX = desk ? 32 : 0;
  const shellW = shell ? shell.clientWidth : stage.clientWidth;
  const availW = Math.max(160, (desk ? shellW - padX - panelW - 22 : stage.clientWidth));
  const availH = Math.max(160, stage.clientHeight - barH - gaps);
  const layoutKey = `${availW}x${availH}x${st.W}x${st.H}`;
  if (ui.layoutKey === layoutKey && wrap.style.width) return;
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
    el.className = `piece ${p.c === 'w' ? 'w' : 'b'} t-${p.t}`;
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
  const pickedMode = modeById(opts.modeId || profile.modeId);
  const mode = pickedMode.flags.randomPick ? randomRealMode() : pickedMode;
  ui.rotated = false;
  ui.tableRotated = false;
  ui.away = false;
  const boardEl = $('#board');
  if (boardEl) boardEl.classList.remove('board-rotated');
  ui.pieceStreak = null;
  const grayShell = $('#gameShell');
  if (grayShell) grayShell.style.setProperty('--gray', '0');
  ui.extremeShown = 0;
  ui.confirmAction = null;
  document.documentElement.dataset.infernal = mode.flags.infernal ? '1' : '0';
  const shellEl = $('#gameShell');
  if (shellEl) {
    shellEl.classList.remove('flip-all', 'gray-1', 'gray-2', 'gray-3', 'check-alert');
  }
  if (mode.flags.inverted && (opts.mode || 'local') === 'local') ui.orientation = 'b';
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
  ui.orientation = opts.bot ? profile.side : (opts.orientation || (profile.side === 'b' && !opts.orientation ? 'b' : 'w'));
  ui.mode = opts.mode || 'local';
  ui.role = opts.role || null;
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
      if (ui.bot && ui.st.turn === ui.bot.color) maybeBotTurn();
    }, 2200);
  } else {
    ui.gameLocked = false;
    startClocks();
    scheduleFirstMoveTimer();
    if (ui.bot && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 700);
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
}

function renderStatus() {
  const st = ui.st;
  const el = $('#gameStatus');
  const sub = $('#gameSub');
  const shell = $('#gameShell');
  if (!st) return;
  if (ui.imported) {
    el.textContent = 'Импортированная партия';
    sub.textContent = 'просмотр и экспорт · ходы недоступны';
    return;
  }
  if (ui.viewPly !== ui.frames.length - 1) {
    el.textContent = 'Просмотр партии';
    sub.textContent = `позиция после ${ui.viewPly}-го полухода · вернитесь в конец, чтобы играть`;
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
    el.textContent = 'Бот думает…';
  } else {
    el.textContent = st.turn === 'w' ? 'Ход белых' : 'Ход чёрных';
  }
  const bits = [st.mode.name];
  if (st.check) bits.push('шах!');
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
    abort: 'партия прервана', idle: 'белые не сделали первый ход', monotony: 'одной фигурой — пат',
  queenLost: 'ферзь потерян', extreme: 'крайний перевес',
  };
  return map[res.reason] || res.reason;
}

/* ───────────────────────────── 9. ХОДЫ ────────────────────────────────── */

function onSquareClick(sq) {
  if (!ui.st || ui.st.status !== 'play') return;
  if (ui.gameLocked) return;
  if (ui.paused) return;
  if (ui.imported) { toast('Импортированная партия — только просмотр'); return; }
  if (ui.bot && ui.st.turn === ui.bot.color) return;
  if (ui.viewPly !== ui.frames.length - 1) return;
  const st = ui.st;
  if (ui.mode === 'online' && st.turn !== myColor()) return;
  if (st.turn !== myColor() && ui.mode !== 'local') return;

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
  ui.frames.push(snap(st));
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
  if (ui.mode === 'local' && !ui.bot && profile.flip && !opts.remote && !opts.silent
      && window.innerWidth < 1000) {
    if (profile.flipAll) {
      ui.rotated = !ui.rotated;
      flippedNow = true;
    } else if (profile.tableFlip !== false) {
      ui.tableRotated = !ui.tableRotated;
      flippedNow = true;
    } else {
      const prevOrientation = ui.orientation;
      ui.orientation = st.turn;
      flippedNow = ui.orientation !== prevOrientation;
    }
  }
  if (!opts.silent) {
    const shellRot = $('#gameShell');
    if (shellRot) shellRot.classList.toggle('flip-all', !!ui.rotated);
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

function finishGame(res) {
  try { localStorage.removeItem(CURRENT_KEY); } catch (error) { /* ignore */ }
  ui.running = false;
  clearInterval(ui.timer);
  if (!ui.st) return;
  if (ui.scored) return;
  ui.scored = true;

  const st = ui.st;
  let points = scoreGame(res, st);
  const side = myColor();
  const win = res.winner === side;
  const draw = !res.winner;
  const lost = !!res.winner && !win;
  if (ui.bot && res.reason !== 'abort' && res.reason !== 'idle' && res.reason !== 'monotony') {
    const row = BOT_POINTS[ui.bot.level] || BOT_POINTS.medium;
    points = win ? row.win : lost ? row.loss : row.draw;
  }

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
  if (res.reason === 'abort') {
    $('#resultPoints').innerHTML = '';
  } else {
    animateResultPoints(points);
  }
  ['#resultAgain', '#resultMenu', '#resultClose'].forEach((id) => $(id).classList.remove('hidden'));
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
  if (mat <= 20 || ply >= 60) return 'endgame';
  if (ply >= 20) return 'middle';
  return 'opening';
}

const PHASES = {
  opening: { title: 'Дебют', sub: 'первые десять ходов' },
  middle: { title: 'Миттельшпиль', sub: 'середина партии' },
  endgame: { title: 'Эндшпиль', sub: 'развязка близко' },
};

const FLIER_TYPES = ['q', 'r', 'b', 'n', 'p', 'k'];

function spawnPhaseFliers() {
  const box = $('#phaseFliers');
  if (!box) return;
  const reduced = !profile.epicFx && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  box.innerHTML = '';
  const count = Math.round((window.innerWidth < 700 ? 10 : 18) * (profile.epicFx ? 1.8 : 1));
  for (let i = 0; i < count; i++) {
    const type = FLIER_TYPES[Math.floor(Math.random() * FLIER_TYPES.length)];
    const el = document.createElement('span');
    el.className = 'flier ' + (Math.random() < 0.5 ? 'w' : 'b');
    const size = Math.round(34 + Math.random() * 86);
    const fromLeft = Math.random() < 0.5;
    const startX = fromLeft ? -8 - Math.random() * 12 : 100 + Math.random() * 12;
    const startY = Math.random() * 108 - 4;
    const dx = (fromLeft ? 1 : -1) * (55 + Math.random() * 70);
    const dy = -25 + Math.random() * 50;
    el.style.setProperty('--x', startX.toFixed(1) + 'vw');
    el.style.setProperty('--y', startY.toFixed(1) + 'vh');
    el.style.setProperty('--s', size + 'px');
    el.style.setProperty('--dx', dx.toFixed(1) + 'vw');
    el.style.setProperty('--dy', dy.toFixed(1) + 'vh');
    el.style.setProperty('--rot', Math.round(-240 + Math.random() * 480) + 'deg');
    el.style.setProperty('--dur', (1.7 + Math.random() * 1.1).toFixed(2) + 's');
    el.style.setProperty('--delay', (Math.random() * 0.9).toFixed(2) + 's');
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
    ui.online = null;
    return;
  }
  ui.online.connected = true;
  updateLinkDots();
  $('#roomCode').textContent = code;
  $('#roomRow').classList.remove('hidden');
  const chosenMode = modeById(ui.online.modeId || profile.modeId);
  setLobby(`Комната создана. Режим: ${chosenMode.name}. Ждём соперника — партия начнётся, когда он присоединится.`);
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
    if (!ui.online) return;
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

function suspendGame() {
  if (!ui.st || ui.st.status !== 'play') return;
  ui.away = true;
  ui.running = false;
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
  if ($('#optEpicFx')) $('#optEpicFx').addEventListener('change', (e) => setEpic(e.target.checked));
  if ($('#resumeFloat')) $('#resumeFloat').addEventListener('click', () => showScreen('game'));
  if ($('#optTableFlip')) $('#optTableFlip').addEventListener('change', (e) => {
    profile.tableFlip = e.target.checked;
    saveProfile();
    toast(profile.tableFlip ? 'Доска будет физически переворачиваться' : 'Доска будет менять стороны без поворота');
  });
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
    const shareUrl = `${location.origin}${location.pathname}#${code}`;
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
  if ($('#mobResign')) $('#mobResign').addEventListener('click', () => {
    if (ui.st && ui.st.status === 'play') askResign();
    else toast('Партия ещё не начата');
  });
  if ($('#mobLeave')) $('#mobLeave').addEventListener('click', askLeave);
  if ($('#mobSettings')) $('#mobSettings').addEventListener('click', () => toggleDrawer());
  if ($('#resumeBtn')) $('#resumeBtn').addEventListener('click', resumeSavedGame);
  if ($('#sbProfileEdit')) $('#sbProfileEdit').addEventListener('click', () => {
    const pop = $('#profilePop');
    if (!pop) return;
    pop.classList.toggle('hidden');
    if (!pop.classList.contains('hidden')) renderProfilePop();
  });
  if ($('#ppClose')) $('#ppClose').addEventListener('click', () => $('#profilePop').classList.add('hidden'));
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
      $('#gameShell').classList.toggle('flip-all', ui.rotated);
      renderAll(false);
      return;
    }
    if (profile.tableFlip !== false) {
      ui.tableRotated = !ui.tableRotated;
      $('#board').classList.toggle('board-rotated', ui.tableRotated);
      renderAll(false);
      renderPlayers();
      return;
    }
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
  $('#btnLeave').addEventListener('click', askLeave);

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
  showScreen('home');
  window.ChessApp = {
    engine: { createState, legalMoves, genPseudo, applyMove, undoMove, moveToSan, updateStatus, perft, toFen: null, findKing, sqName, positionKey, inCheck, attacked, materialOf, visSet, maybeBlock, centerCells, evaluateWhite, bestMove, MODES, modeById },
    ui, profile,
    newGame, commitMove, gotoPly, showScreen, myColor, scoreGame,
    startBotGame, maybeBotTurn, chooseBotMove, buildGameJson, importGameText,
    phaseFor, updateSameStreak, askLeave, confirmLeaveGame, closeConfirm,
    captureFx, playResultFx,
    PIECE_SKINS, applySkin, setPieces,
    openSkinModal: () => openSkinModal(),
    setProfile: (patch) => { Object.assign(profile, patch); renderProfile(); renderThemeRows(); renderPieceRows(); renderPreview(); saveProfile(true); },
  };
}

document.addEventListener('DOMContentLoaded', boot);
