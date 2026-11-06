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
  glass: false,
  glassVariant: 'aurora',
  resultPause: false,
  autoQueen: true,
  sound: true,
  side: 'w',
  modeId: 'classic',
  square: false,
  timeMs: 5 * 60 * 1000,
  timeLabel: '5 минут',
  publicRoom: false,
  points: 0,
  trainingDate: '',
  trainingUsed: 0,
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
  tick() { if (this.on) this.tone(880, 0.018, 'square', 0.022); },
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

const BOT_LABELS = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', gm: 'Гроссмейстер', engine: 'Максимальный' };
const BOT_LABELS_EN = { easy: 'Easy', medium: 'Medium', hard: 'Hard', gm: 'Grandmaster', engine: 'Maximum' };
const BOT_DELAY = { easy: 420, medium: 600, hard: 780, gm: 900, engine: 1100 };
const BOT_DEPTH = { medium: 2, hard: 4, gm: 4, engine: 5 };
const botLabel = (level) => (profile && profile.language === 'en' ? BOT_LABELS_EN : BOT_LABELS)[level] || BOT_LABELS.medium;
const BOT_POINTS = {
  easy: { win: 1, loss: 0, draw: 0 },
  medium: { win: 4, loss: -3, draw: 0 },
  hard: { win: 5, loss: -3, draw: 0 },
  gm: { win: 8, loss: -2, draw: 0 },
  engine: { win: 12, loss: -1, draw: 0 },
};

const BOT_PERSONAS = {
  friendly: {
    title: 'Дружелюбный', icon: '😊', level: 'hard', glow: 'friendly',
    desc: 'Между средним и сильным. Замечает ваш глупый ход и специально снижает планку.',
  },
  tilter: {
    title: 'Дотер', icon: '😤', level: 'hard', glow: 'tilter',
    desc: 'После неудач синеет и плачет, копит злость и играет всё агрессивнее. Если вы ошибаетесь — наоборот, успокаивается.',
  },
  catchup: {
    title: 'Подстраивающийся: догоняющий', icon: '🏃', level: 'medium', glow: 'catchup',
    desc: 'Чуть слабее вас. После каждого вашего хода подтягивается к вашему уровню.',
  },
  overtake: {
    title: 'Подстраивающийся: обгоняющий', icon: '⚡', level: 'hard', glow: 'overtake',
    desc: 'Чуть сильнее вас. После вашего хода старается держаться на шаг впереди.',
  },
  cinema: {
    title: 'Абсолют синема', icon: '🎬', level: 'engine', glow: 'cinema',
    desc: 'Тёмно-фиолетовый король. Играет максимально глубоко и думает ровно секунду — мощно, но без вечной паузы.',
  },
};

function personaById(id) {
  return BOT_PERSONAS[id] || null;
}

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
  startGameWithMode({
    mode: 'local',
    modeId,
    timeMs: profile.timeMs,
    splash: true,
    bot: { level, fake: true, name },
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
  const ultra = profile.modeId === 'ultraBalance';
  if (ultra) level = 'gm';
  closeBotModal();
  ui.online = null;
  sound.click();
  if (ultra) {
    newGame({
      mode: 'local',
      modeId: 'ultraBalance',
      timeMs: profile.timeMs,
      splash: true,
      side: 'w',
      orientation: 'w',
      bot: { level: 'gm', color: 'b' },
    });
    return;
  }
  startGameWithMode({
    mode: 'local',
    timeMs: profile.timeMs,
    splash: true,
    bot: { level },
  });
}

/** Пять характеров ботов из вкладки «Боты». */
function startPersonaGame(id) {
  const persona = personaById(id);
  if (!persona) return;
  ui.online = null;
  closeBotModal();
  sound.click();
  startGameWithMode({
    mode: 'local',
    modeId: profile.modeId,
    timeMs: profile.timeMs,
    splash: true,
    bot: {
      level: persona.level,
      persona: id,
      name: persona.title,
    },
  });
}

function levelFromSkill(skill) {
  if (skill < 1.6) return 'easy';
  if (skill < 2.6) return 'medium';
  if (skill < 3.7) return 'hard';
  if (skill < 4.7) return 'gm';
  return 'engine';
}

/** Текущая сила бота с учётом характера и его настроения. */
function personaLevel() {
  const p = ui.persona;
  if (!p) return ui.bot ? ui.bot.level : 'medium';
  if (p.id === 'friendly') return p.throw > 0 ? 'medium' : 'hard';
  if (p.id === 'tilter') {
    if (p.anger >= 72) return 'gm';
    if (p.anger >= 34) return 'hard';
    return 'medium';
  }
  if (p.id === 'catchup') return levelFromSkill(p.skill - 0.45);
  if (p.id === 'overtake') return levelFromSkill(p.skill + 0.55);
  if (p.id === 'cinema') return 'engine';
  return ui.bot ? ui.bot.level : 'medium';
}

function personaDelay(level) {
  const p = ui.persona;
  if (!p) return BOT_DELAY[level] || 600;
  if (p.id === 'cinema') return 1000;
  if (p.id === 'friendly' && p.throw > 0) return 760;
  if (p.id === 'tilter' && p.anger >= 72) return 620;
  return BOT_DELAY[level] || 650;
}

/** Реакция характера на ход: до/после — оценка в пользу белых. */
function personaAfterMove(mover, before, after) {
  const p = ui.persona;
  if (!p || !ui.bot) return;
  const botSide = ui.bot.color;
  const botMoved = mover === botSide;
  // Положительная дельта — ход удачен для того, кто его сделал.
  const delta = mover === 'w' ? after - before : before - after;
  const now = performance.now();
  if (p.id === 'friendly') {
    if (!botMoved && delta < -1.05) {
      p.throw = 2;
      p.limeUntil = now + 2600;
    } else if (botMoved && p.throw > 0) {
      p.throw -= 1;
    }
  } else if (p.id === 'tilter') {
    if (botMoved && delta < -0.85) {
      p.anger = Math.min(100, p.anger + 19);
      p.cryUntil = now + 2100;
      p.limeUntil = 0;
      if (p.anger >= 72) p.rageUntil = now + 2400;
    } else if (!botMoved && delta < -1.05) {
      p.anger = Math.max(0, p.anger - 17);
      p.limeUntil = now + 2800;
      p.cryUntil = 0;
    } else if (botMoved && delta > 0.7) {
      p.anger = Math.max(0, p.anger - 2);
    }
  } else if (p.id === 'catchup' || p.id === 'overtake') {
    if (!botMoved) {
      if (delta > -0.35) p.skill = Math.min(5.2, p.skill + 0.13);
      else if (delta < -1.1) p.skill = Math.max(0.8, p.skill - 0.18);
    }
  }
  const until = Math.max(p.cryUntil || 0, p.limeUntil || 0, p.rageUntil || 0);
  clearTimeout(p.fxTimer);
  if (until > now) {
    p.fxTimer = setTimeout(() => {
      if (ui.persona === p) renderPersonaFx();
    }, until - now + 40);
  }
  renderPersonaFx();
}

function chooseBotMove(st, level, persona) {
  const moves = legalMoves(st, st.turn);
  if (!moves.length) return null;
  /* Если короля реально можно съесть — бот не проходит мимо. */
  const kingCap = moves.find((m) => m.capture != null && st.board[m.capture] && st.board[m.capture].t === 'k');
  if (kingCap) return kingCap;
  const p = persona || ui.persona;
  if (level === 'easy' && !p) {
    if (Math.random() < 0.55) return moves[Math.floor(Math.random() * moves.length)];
    const caps = moves.filter((m) => m.capture != null || m.ep || (m.caps && m.caps.length));
    if (caps.length) return caps[Math.floor(Math.random() * caps.length)];
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const big = st.W * st.H > 64;
  let depth = big ? 2 : (BOT_DEPTH[level] || 2);
  if (p && p.id === 'friendly' && p.throw > 0 && !big) depth = 2;
  let ranked = [];
  try { ranked = rankMoves(st, depth); } catch (error) { ranked = []; }
  if (!ranked.length) return moves[Math.floor(Math.random() * moves.length)];
  if (p && p.id === 'friendly') {
    // Дружелюбный иногда выбирает второй-третий по силе ход, а в поддавках — почти случайный.
    const pool = p.throw > 0 ? 7 : 2;
    const top = ranked.slice(0, Math.min(pool, ranked.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }
  if (p && p.id === 'tilter') {
    if (p.anger >= 72) {
      const strike = ranked.find((row) => row.move.capture != null || row.move.ep);
      return (strike || ranked[0]).move;
    }
    const pool = p.anger >= 34 ? 2 : 4;
    const top = ranked.slice(0, Math.min(pool, ranked.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }
  if (p && p.id === 'overtake' && level !== 'engine') {
    const top = ranked.slice(0, Math.min(2, ranked.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }
  if (level === 'medium' || level === 'easy') {
    const top = ranked.slice(0, Math.min(3, ranked.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }
  return ranked[0].move;
}

let botWorker = null;
let botWorkerUrl = null;
let botWorkSeq = 0;
const botWork = new Map();
function stopBotWorker() {
  if (botWorker) botWorker.terminate();
  if (botWorkerUrl) URL.revokeObjectURL(botWorkerUrl);
  botWorker = null;
  botWorkerUrl = null;
  for (const task of botWork.values()) task.resolve(null);
  botWork.clear();
}
function chooseBotMoveOffThread(st, level, persona) {
  if (typeof Worker !== 'function') return Promise.resolve(chooseBotMove(st, level, persona));
  try {
    if (!botWorker) {
      const engineUrl = new URL('engine.js?v=20261105-84', location.href).href;
      const source = "'use strict'; importScripts(" + JSON.stringify(engineUrl) + ");"
        + 'const BOT_DEPTH=' + JSON.stringify(BOT_DEPTH) + '; const ui={persona:null};'
        + chooseBotMove.toString()
        + '; self.onmessage = (event) => { const d=event.data; try {'
        + 'const st=d.state; st.mode=modeById(st.modeId); st.flags=st.mode.flags; ui.persona=d.persona;'
        + 'self.postMessage({id:d.id,move:chooseBotMove(st,d.level,d.persona)});'
        + '} catch(error) { self.postMessage({id:d.id,error:String(error)}); } };';
      botWorkerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      botWorker = new Worker(botWorkerUrl);
      botWorker.onmessage = (event) => {
        const task = botWork.get(event.data.id);
        if (!task) return;
        botWork.delete(event.data.id);
        task.resolve(event.data.error && ui.st === task.state
          ? chooseBotMove(task.state, task.level, task.persona) : event.data.move || null);
      };
      botWorker.onerror = () => {
        const tasks = [...botWork.values()];
        botWork.clear();
        stopBotWorker();
        for (const task of tasks) {
          task.resolve(ui.st === task.state ? chooseBotMove(task.state, task.level, task.persona) : null);
        }
      };
    }
    return new Promise((resolve) => {
      const id = ++botWorkSeq;
      botWork.set(id, { resolve, state: st, level, persona });
      botWorker.postMessage({ id, state: st, level, persona });
    });
  } catch (error) {
    stopBotWorker();
    return Promise.resolve(ui.st === st ? chooseBotMove(st, level, persona) : null);
  }
}
function maybeBotTurn() {
  if (ui.paused || ui.away || ui.gameLocked) return;
  if (ui.st?.flags.strategy) { strategyMaybeBot(); return; }
  if (ui.st?.flags.clashBrawl) { brawlMaybeBot(); return; }
  const coopHost = ui.mode === 'online' && ui.online && ui.online.coop && ui.role === 'host';
  if (!ui.bot || !ui.st || ui.st.status !== 'play' || (ui.mode !== 'local' && !coopHost)) return;
  if (ui.st.turn !== ui.bot.color || ui.bot.busy) return;
  const bot = ui.bot;
  const state = ui.st;
  const ply = state.plySeq;
  bot.busy = true;
  ui.botThinking = true;
  renderStatus();
  const level = ui.persona ? personaLevel() : bot.level;
  bot.turnTimer = setTimeout(async () => {
    const valid = () => ui.bot === bot && ui.st === state && state.plySeq === ply
      && state.status === 'play' && !ui.paused && !ui.away && state.turn === bot.color;
    if (!valid()) { bot.busy = false; if (ui.bot === bot) { ui.botThinking = false; renderStatus(); } return; }
    if (state.flags.clashBrawl && brawlBotTryDeploy()) { bot.busy = false; ui.botThinking = false; renderStatus(); return; }
    const move = await chooseBotMoveOffThread(state, level, ui.persona);
    bot.busy = false;
    if (valid() && move) { ui.botThinking = false; commitMove(move, { bot: true }); }
    if (ui.bot === bot) { ui.botThinking = false; renderStatus(); }
  }, bot.fake ? 3000 + Math.random() * 12000 : (ui.persona ? personaDelay(level) : (BOT_DELAY[level] || 600)));
}

/* ─────────────────────── ЭКСПОРТ И ИМПОРТ ───────────────────────────── */

function buildGameJson() {
  const st = ui.st;
  if (!st) return null;
  const names = ui.names || {};
  return {
    app: 'daymix-chess',
    version: 3,
    initial: specialMode(st) ? (ui.initialState || ui.frames[0]?.specialState) : undefined,
    state: specialMode(st) ? captureNetworkState(st) : undefined,
    exportedAt: new Date().toISOString(),
    mode: { id: st.modeId, name: st.mode.name, W: st.W, H: st.H, square: !!st.square, seed: st.seed },
    time: { ms: ui.timeMs, label: ui.timeMs ? profile.timeLabel : 'без ограничений' },
    players: {
      w: names.w || { name: 'Белые', avatar: 'k' },
      b: names.b || { name: 'Чёрные', avatar: 'k' },
    },
    startedAt: ui.startedAt ? new Date(ui.startedAt).toISOString() : null,
    endedAt: st.status === 'over' ? new Date().toISOString() : null,
    result: st.result || null,
    viewSide: myColor(),
    bot: ui.bot ? { level: ui.bot.level, color: ui.bot.color, name: ui.bot.name, fake: !!ui.bot.fake } : null,
    moves: ui.moves.map((m, i) => ({
      n: i + 1,
      side: m.color,
      san: m.san,
      from: m.from>=0 ? sqName(st, m.from) : null,
      to: m.to>=0 ? sqName(st, m.to) : null,
      action: m.action || null, special: m.special || null,
      promo: m.promo || null,
      at: m.at ? new Date(m.at).toISOString() : null,
      ms: Math.round(m.spent || 0),
      clockSec: m.clock != null ? Math.round(m.clock / 1000) : null,
    })),
    pgn: buildPgnText(),
  };
}

function lastGameData() {
  if (ui.st) return buildGameJson();
  const rec = profile.history.find((g) => g && g.game);
  return rec ? rec.game : null;
}

function buildGameText(data) {
  if (!data) return '';
  const names = data.players || {};
  const mode = data.mode || {};
  const white = (names.w && names.w.name) || 'Белые';
  const black = (names.b && names.b.name) || 'Чёрные';
  const ms = Number(data.time && data.time.ms) || 0;
  const control = ms ? `${Math.round(ms / 60000)} мин (${ms} мс)` : 'без ограничений';
  const started = data.startedAt ? new Date(data.startedAt) : new Date();
  const date = Number.isNaN(started.getTime()) ? '' : started.toLocaleString('ru-RU');
  let result = 'партия не завершена';
  if (data.result) {
    const why = REASON_TEXT[data.result.reason] || data.result.reason || '';
    result = data.result.winner
      ? `${data.result.winner === 'w' ? 'победа белых' : 'победа чёрных'}${why ? ' · ' + why : ''}`
      : `ничья${why ? ' · ' + why : ''}`;
  }
  const lines = [
    'Daymix’s Chess — запись партии',
    '',
    `Режим: ${mode.name || 'Классика'} (${mode.id || 'classic'})`,
    `Белые: ${white}`,
    `Чёрные: ${black}`,
    `Контроль: ${control}`,
    `Начало: ${date}`,
    `Результат: ${result}`,
    '',
    'Ходы:',
  ];
  const moves = Array.isArray(data.moves) ? data.moves : [];
  moves.forEach((m, i) => {
    const num = Math.floor(i / 2) + 1;
    const prefix = i % 2 === 0 ? `${num}.` : `${num}...`;
    const promo = m.promo ? '=' + String(m.promo).toUpperCase() : '';
    const san = m.san ? ` (${m.san})` : '';
    const time = m.ms != null && Number(m.ms) > 0 ? `${(Number(m.ms) / 1000).toFixed(1)} с` : 'без времени';
    lines.push(`${prefix} ${m.from}-${m.to}${promo}${san} — ${time}`);
  });
  if (!moves.length) lines.push('— ходов пока нет —');
  return lines.join('\n');
}

function gameJsonText(data) {
  const payload = data || buildGameJson();
  return payload ? JSON.stringify(payload, null, 2) : '';
}

function currentGameText() {
  const data = lastGameData();
  return data ? buildGameText(data) : '';
}

function downloadText(text, ext, mime) {
  if (!text) { toast('Партия ещё не начата'); return; }
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `daymix-chess-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportGameFile() {
  const data = lastGameData();
  if (!data) { toast('Партия ещё не начата'); return; }
  downloadText(gameJsonText(data), 'json', 'application/json');
  toast('JSON сохранён');
}

async function copyGameJson() {
  const text = gameJsonText(lastGameData());
  if (!text) { toast('Партия ещё не начата'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('JSON партии в буфере');
  } catch (error) {
    toast('Не удалось скопировать');
  }
}

function openExport() {
  const text = currentGameText();
  if (!text) { toast('Партия ещё не начата'); return; }
  const modal = $('#exportModal');
  const box = $('#exportText');
  if (!modal || !box) return;
  box.value = text;
  modal.classList.remove('hidden');
  setTimeout(() => { box.focus(); box.select(); }, 60);
}

function closeExport() {
  const modal = $('#exportModal');
  if (modal) modal.classList.add('hidden');
}

async function copyExportText() {
  const box = $('#exportText');
  const text = box ? box.value : currentGameText();
  if (!text) { toast('Партия ещё не начата'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Текст партии в буфере');
  } catch (error) {
    toast('Не удалось скопировать');
  }
}

function downloadExportText() {
  const box = $('#exportText');
  const text = box ? box.value : currentGameText();
  downloadText(text, 'txt', 'text/plain;charset=utf-8');
  toast('TXT сохранён');
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

/** Разбор человекочитаемого TXT-экспорта. */
function parseExportText(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const data = {
    app: 'daymix-chess',
    version: 3,
    exportedAt: new Date().toISOString(),
    mode: { id: 'classic', name: 'Классика', W: 8, H: 8, square: false },
    time: { ms: 0, label: 'без ограничений' },
    players: { w: { name: 'Белые', avatar: 'k' }, b: { name: 'Чёрные', avatar: 'k' } },
    startedAt: null,
    result: null,
    moves: [],
  };
  for (const line of lines) {
    const value = line.trim();
    const mode = value.match(/^Режим:\s*(.+?)\s*\(([a-zA-Z0-9_-]+)\)\s*$/);
    if (mode) {
      data.mode.name = mode[1];
      data.mode.id = modeIdOr(mode[2]);
      continue;
    }
    const white = value.match(/^Белые:\s*(.+)$/);
    if (white) { data.players.w.name = white[1].trim(); continue; }
    const black = value.match(/^Чёрные:\s*(.+)$/);
    if (black) { data.players.b.name = black[1].trim(); continue; }
    const control = value.match(/^Контроль:\s*(.*?)\s*\((\d+)\s*мс\)\s*$/);
    if (control) {
      data.time.ms = Number(control[2]) || 0;
      data.time.label = control[1].trim();
      continue;
    }
    const move = value.match(/^(\d+)\.{1,3}\s+([a-n]\d{1,2})-([a-n]\d{1,2})(?:=([qrbnQRBN]))?\s*(?:\(([^)]*)\))?\s*(?:—|-)\s*(?:([\d.]+)\s*с|без времени)\s*$/i);
    if (move) {
      data.moves.push({
        n: data.moves.length + 1,
        side: data.moves.length % 2 === 0 ? 'w' : 'b',
        san: move[5] || '',
        from: move[2].toLowerCase(),
        to: move[3].toLowerCase(),
        promo: move[4] ? move[4].toLowerCase() : null,
        at: null,
        ms: move[6] ? Math.round(Number(move[6]) * 1000) : 0,
        clockSec: null,
      });
    }
  }
  return data.moves.length ? data : null;
}

function modeIdOr(id) {
  return modeById(String(id || '').toLowerCase()) ? String(id).toLowerCase() : 'classic';
}

function parseGameText(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      return data && data.app === 'daymix-chess' ? data : null;
    } catch (error) { return null; }
  }
  return parseExportText(text);
}

function importGameText(raw, opts = {}) {
  const data = parseGameText(raw);
  if (!data) {
    toast('Не удалось разобрать партию — нужен JSON или TXT-экспорт Daymix’s Chess');
    return false;
  }
  return importGameData(data, opts);
}

function importGameData(data, opts = {}) {
  if (!data) return false;
  const review = !!opts.review;
  if (review) ui.reviewFrom = opts.from || ui.reviewFrom || (ui.screen === 'stats' ? 'stats' : 'home');
  const mode = modeById(data.mode && data.mode.id) || modeById('classic');
  ui.online = null;
  ui.bot = null;
  ui.persona = null;
  ui.training = null;
  ui.reviewOnly = review;
  ui.imported = review;
  ui.scored = true;
  ui.spectator = false;
  ui.role = null;
  ui.mode = 'local';
  ui.away = false;
  ui.paused = false;
  ui.timeMs = Number(data.time && data.time.ms) || 0;
  ui.clocks = { w: ui.timeMs, b: ui.timeMs };
  ui.st = createState(mode.id, { square: !!(data.mode && data.mode.square), seed: data.mode && data.mode.seed });
  ui.modePick = mode.id;
  ui.frames = [snap(ui.st)];
  ui.moves = [];
  ui.viewPly = 0;
  ui.lastMove = null;
  ui.chat = [];
  ui.selected = -1;
  ui.hint = null;
  ui.endSquare = -1;
  ui.persona = null;
  clearTimeout(ui.endTimer);
  ui.endTimer = 0;
  ui.names = {
    w: (data.players && data.players.w) || { name: 'Белые', avatar: 'k' },
    b: (data.players && data.players.b) || { name: 'Чёрные', avatar: 'k' },
  };
  const pname = String(profile.name || '').trim().toLowerCase();
  const wname = String(ui.names.w.name || '').trim().toLowerCase();
  const bname = String(ui.names.b.name || '').trim().toLowerCase();
  let side = profile.side === 'b' ? 'b' : 'w';
  if (pname && pname === wname) side = 'w';
  else if (pname && pname === bname) side = 'b';
  if (review) side = data.viewSide === 'b' ? 'b' : 'w';
  ui.playerSide = side;
  ui.orientation = review ? side : side;
  ui.startedAt = data.startedAt ? Date.parse(data.startedAt) : Date.now();
  if (Number.isNaN(ui.startedAt)) ui.startedAt = Date.now();
  const list = Array.isArray(data.moves) ? data.moves : [];
  if(specialMode(ui.st)) { const initial=restoreNetworkState(data.initial); if(!initial){toast('Для этого режима нужен JSON с полным начальным состоянием');return false;} ui.st=initial;ui.initialState=captureNetworkState(initial);bindSpecialState(initial);ui.frames=[snap(initial)]; }
  for (const rec of list) {
    if(specialMode(ui.st)){ if(!replayRecordedMove(rec,true)){toast('Повреждён журнал действий');return false;} continue; }
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
      captured: !!found.capture || !!(found.caps && found.caps.length) || !!found.ep,
    });
    ui.lastMove = { from, to };
  }
  if(specialMode(ui.st)) bindSpecialState(ui.st);
  ui.viewPly = review ? 0 : ui.frames.length - 1;
  updateStatus(ui.st);
  if (data.result) {
    ui.st.result = data.result;
    ui.st.status = 'over';
  }
  closeImport();
  closeExport();
  document.body.classList.toggle('reviewing', review);
  const shell = $('#gameShell');
  if (shell) {
    shell.classList.toggle('review-mode', review);
    shell.classList.remove('training-on', 'paused');
  }
  showScreen('game');
  buildSquares();
  renderAll(false);
  renderMoves();
  renderPlayers();
  renderMeta();
  switchTab('moves');
  updateNav();
  if (review) {
    toast(`Просмотр партии: ${ui.moves.length} ходов`);
  } else {
    ui.running = ui.st.status === 'play' && ui.timeMs > 0;
    ui.turnStart = performance.now();
    startClocks();
    ui.running = ui.st.status === 'play' && ui.timeMs > 0;
    saveCurrentGame();
    toast(`Партия импортирована: ${ui.moves.length} ходов — можно продолжать`);
  }
  return true;
}

/** Открыть запись из истории в режиме просмотра. */
function reviewHistoryGame(rec) {
  const data = rec && rec.game;
  if (!data) { toast('У этой записи нет полной партии для просмотра'); return; }
  ui.reviewFrom = ui.screen === 'stats' ? 'stats' : 'home';
  importGameData(data, { review: true, from: ui.reviewFrom });
}

function leaveReview() {
  if (ui.training) { endTraining(); return; }
  const dest = ui.reviewFrom || 'stats';
  ui.reviewOnly = false;
  ui.imported = false;
  ui.reviewFrom = null;
  ui.selected = -1;
  document.body.classList.remove('reviewing');
  const shell = $('#gameShell');
  if (shell) shell.classList.remove('review-mode');
  const exit = $('#reviewExit');
  if (exit) exit.classList.add('hidden');
  showScreen(dest === 'game' ? 'stats' : dest);
}

function showHint() {
  const st = ui.st;
  if (!st || st.status !== 'play') return;
  if (ui.reviewOnly) { toast('Режим просмотра — ходы недоступны'); return; }
  if (ui.viewPly !== ui.frames.length - 1 && !canBranchHere()) { toast('Вернитесь в конец партии'); return; }
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
  const savedBot = data.bot && data.bot.level ? data.bot : null;
  ui.imported = false;
  ui.mode = 'local';
  ui.bot = savedBot
    ? {
      level: savedBot.level,
      color: savedBot.color || (profile.side === 'w' ? 'b' : 'w'),
      name: savedBot.name || ('Бот · ' + botLabel(savedBot.level)),
      fake: !!savedBot.fake,
    }
    : null;
  ui.timeMs = data.timeMs || 0;
  ui.clocks = { w: data.clocks ? data.clocks.w : ui.timeMs, b: data.clocks ? data.clocks.b : ui.timeMs };
  ui.playerSide = savedBot ? other(savedBot.color) : (profile.side === 'b' ? 'b' : 'w');
  if (data.orientation) ui.orientation = data.orientation;
  else ui.orientation = ui.playerSide;
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
  renderMeta();
  renderMoves();
  updateNav();
  showScreen('game');
  if (ui.moves.length) toast(savedBot ? `Партия восстановлена — играете с ботом «${ui.bot.name}»` : 'Партия восстановлена');
  scheduleFirstMoveTimer();
  if (ui.bot && ui.st.status === 'play' && ui.st.turn === ui.bot.color) setTimeout(maybeBotTurn, 650);
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

function annihilationFx(st, squares) {
  if (!st || !squares || !squares.length) return;
  const board = $('#board');
  if (board) {
    for (let i = 1; i <= 5; i++) board.classList.remove('shake-' + i);
    void board.offsetWidth;
    board.classList.add('shake-3');
    setTimeout(() => board.classList.remove('shake-3'), 480);
  }
  const layer = $('#hints');
  if (!layer) return;
  const unique = [...new Set(squares)].filter((s) => s >= 0);
  unique.forEach((sq, index) => {
    const { dx, dy } = disp(st, sq);
    const ring = document.createElement('span');
    ring.className = 'annihilate-ring';
    ring.style.left = ((dx + .5) * ui.sq) + 'px';
    ring.style.top = ((dy + .5) * ui.sq) + 'px';
    ring.style.animationDelay = (index * 0.035).toFixed(3) + 's';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
  });
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

function kingDeathFx(item) {
  if (profile.calm || !ui.st || !item) return;
  const st = ui.st;
  const layer = $('#hints');
  if (!layer) return;
  const sq = ui.sq;
  const { dx, dy } = disp(st, item.square);
  const kinds = ['fall', 'tremble', 'explode', 'shatter', 'tear', 'rage'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const x = dx * sq;
  const y = dy * sq;
  const makeGhost = () => {
    const el = document.createElement('div');
    el.className = `king-ghost king-${kind} ${item.color === 'w' ? 'w' : 'b'}`;
    el.style.width = sq + 'px';
    el.style.height = sq + 'px';
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.innerHTML = pieceSvg('k');
    if (kind === 'tear') {
      const tear = document.createElement('i');
      tear.className = 'king-tear-drop';
      tear.textContent = '💧';
      el.appendChild(tear);
    }
    if (kind === 'rage') {
      const anger = document.createElement('i');
      anger.className = 'king-anger';
      anger.textContent = '💢';
      el.appendChild(anger);
    }
    layer.appendChild(el);
    return el;
  };

  if (kind === 'shatter') {
    for (let i = 0; i < 5; i++) {
      const shard = document.createElement('div');
      shard.className = `king-shard ${item.color === 'w' ? 'w' : 'b'}`;
      shard.dataset.shard = String(i);
      shard.style.width = sq + 'px';
      shard.style.height = sq + 'px';
      shard.style.transform = `translate(${x}px, ${y}px)`;
      shard.style.setProperty('--tx', `${(Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.9) * sq}px`);
      shard.style.setProperty('--ty', `${(Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.8) * sq}px`);
      shard.style.setProperty('--rot', `${Math.round(-180 + Math.random() * 360)}deg`);
      shard.innerHTML = pieceSvg('k');
      layer.appendChild(shard);
      setTimeout(() => shard.remove(), 1500);
    }
  } else {
    const ghost = makeGhost();
    if (kind === 'explode') {
      explosionFx(st, item.square);
      ghost.classList.add('king-explode');
    }
    setTimeout(() => ghost.remove(), kind === 'tremble' ? 1900 : 1600);
  }

  if (kind === 'rage') {
    const board = $('#board');
    for (let i = 0; i < st.board.length; i++) {
      const p = st.board[i];
      if (!p) continue;
      const node = ui.pieceNodes.get(p.id);
      if (!node) continue;
      const pos = disp(st, i);
      node.style.setProperty('--px', `${pos.dx * sq}px`);
      node.style.setProperty('--py', `${pos.dy * sq}px`);
      node.style.setProperty('--fx', `${Math.round((Math.random() - 0.5) * sq * 2.6)}px`);
      node.style.setProperty('--fr', `${Math.round(-540 + Math.random() * 1080)}deg`);
      node.style.setProperty('--fd', `${(Math.random() * 0.18).toFixed(2)}s`);
    }
    if (board) board.classList.add('king-rage');
    setTimeout(() => {
      if (board) board.classList.remove('king-rage');
      renderBoard(false);
    }, 1800);
  }
}

function captureFx(list) {
  if (profile.calm) return;
  if (!list || !list.length || !ui.st) return;
  if (typeof v84FunnyCapture === 'function' && v84FunnyCapture(list)) return;
  const st = ui.st;
  const sq = ui.sq;
  const layer = $('#hints');
  const kingItem = list.find((x) => x.type === 'k');
  if (kingItem) {
    kingDeathFx(kingItem);
    list = list.filter((x) => x.type !== 'k');
    if (!list.length) return;
  }
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

/* Оранжевое попадание в режимах урона: цифра, кольцо, искры и тряска. */
function damageFx(square, dmg, survived, type) {
  if (!ui.st || !ui.sq || square == null || square < 0) return;
  const layer = $('#hints');
  if (!layer) return;
  const { dx, dy } = disp(ui.st, square);
  const cx = (dx + .5) * ui.sq;
  const cy = (dy + .5) * ui.sq;
  const ring = document.createElement('span');
  ring.className = 'dmg-ring';
  ring.style.left = cx + 'px';
  ring.style.top = cy + 'px';
  ring.style.width = Math.round(ui.sq * 0.92) + 'px';
  ring.style.height = Math.round(ui.sq * 0.92) + 'px';
  layer.appendChild(ring);
  const float = document.createElement('span');
  float.className = 'dmg-float';
  float.textContent = '−' + dmg;
  float.style.left = cx + 'px';
  float.style.top = cy + 'px';
  layer.appendChild(float);
  const sparks = survived ? 9 : 14;
  for (let i = 0; i < sparks; i++) {
    const spark = document.createElement('i');
    spark.className = 'dmg-spark';
    const a = Math.random() * Math.PI * 2;
    const dist = ui.sq * (0.3 + Math.random() * 0.8);
    spark.style.left = cx + 'px';
    spark.style.top = cy + 'px';
    spark.style.setProperty('--dx', (Math.cos(a) * dist).toFixed(0) + 'px');
    spark.style.setProperty('--dy', (Math.sin(a) * dist).toFixed(0) + 'px');
    layer.appendChild(spark);
    setTimeout(() => spark.remove(), 700);
  }
  const victim = ui.st.board[square];
  const el = victim ? ui.pieceNodes.get(victim.id) : null;
  if (el) {
    el.classList.remove('hp-hit');
    void el.offsetWidth;
    el.classList.add('hp-hit');
    setTimeout(() => el.classList.remove('hp-hit'), 340);
  }
  if (survived) {
    const board = $('#board');
    if (board && !profile.calm) {
      board.classList.remove('shake-1');
      void board.offsetWidth;
      board.classList.add('shake-1');
      setTimeout(() => board.classList.remove('shake-1'), 260);
    }
  }
  /* Тяжёлое попадание на ПК — янтарная вспышка, как у старого съедения. */
  if (!profile.calm && dmg >= 5 && window.innerWidth >= 1000) {
    const flash = $('#fxFlash');
    if (flash) {
      flash.className = 'fx-flash';
      void flash.offsetWidth;
      flash.classList.add('flash-3');
      setTimeout(() => { flash.className = 'fx-flash'; }, 520);
    }
  }
  setTimeout(() => { ring.remove(); float.remove(); }, 950);
}

function mateKingWaves(sq) {
  if (profile.calm || sq < 0 || !ui.st) return;
  const layer = $('#hints');
  if (!layer) return;
  const { dx, dy } = disp(ui.st, sq);
  const cx = (dx + .5) * ui.sq;
  const cy = (dy + .5) * ui.sq;
  for (let i = 0; i < 5; i++) {
    const wave = document.createElement('span');
    wave.className = 'mate-wave';
    wave.style.left = cx + 'px';
    wave.style.top = cy + 'px';
    wave.style.animationDelay = (i * 0.16).toFixed(2) + 's';
    layer.appendChild(wave);
    setTimeout(() => wave.remove(), 1800);
  }
}

function renderResultKings(res) {
  const box = $('#resultKings');
  if (!box) return;
  box.innerHTML = '';
  const mate = res && res.reason === 'mate' && res.winner;
  const stale = res && res.reason === 'stalemate';
  if (!mate && !stale) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  if (stale) {
    box.className = 'result-kings draw';
    box.innerHTML = `
      <div class="rk-slot rk-draw-left"><span class="rk-shadow gray"></span><span class="rk-king w grayed">${pieceSvg('k')}</span></div>
      <div class="rk-slot rk-draw-right"><span class="rk-shadow gray"></span><span class="rk-king b grayed">${pieceSvg('k')}</span></div>`;
    return;
  }
  const winner = res.winner;
  const loser = other(winner);
  box.className = 'result-kings mate ' + (winner === 'w' ? 'winner-white' : 'winner-black');
  box.innerHTML = `
    <div class="rk-slot rk-winner">
      <span class="rk-shadow lime"></span>
      <span class="rk-king ${winner}">${pieceSvg('k')}</span>
    </div>
    <div class="rk-slot rk-loser">
      <span class="rk-shadow red"></span>
      <span class="rk-king ${loser} grayed">${pieceSvg('k')}</span>
    </div>`;
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
  damage: 'Урон', damageKing: 'Король HP',
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
  annihilation: 'Аннигиляция', ultraBalance: 'Ультрабаланс',
};

const MODE_EN = {
  classic: ['Classic', "Standard 8×8 chess: castling, en passant, promotion, mate, stalemate and the 50-move rule."],
  threeChecks: ['Three-check', "No mate needed: give three checks to win."],
  kingCapture: ['King capture', "The king may move into danger. Lose your king and you lose."],
  damage: ['Damage hardcore', "Pieces have HP: pawn 1, knight and bishop 3, rook 5, queen 9. An attack deals the attacker's HP; if the attacker has less HP than the target, the attacker dies and the target stays wounded."],
  damageKing: ['King damage', "Same, but the king has 15 HP. Check is not forced: you may capture the king, and each new check removes 1 HP."],
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
  raceKings: ['Racing kings', "No pawns: race your king to the far rank. Checks are allowed, but the king cannot be captured."],
  andernach: ['Andernach', "A capturing piece changes colour. Every capture is a small betrayal."],
  clashBrawl: ['Clash Brawl', "A mobile-game parody: 50 HP kings, purple elixir, a 4-card deck, shields and knockback."],
  annihilation: ['Annihilation', "Every capture erases both pieces and all eight neighbours in 3×3 areas around both squares. Kings survive."],
  ultraBalance: ['Ultrabalance', "You play White against a grandmaster bot. Black has no rooks and pushed flank pawns; you get two extra wing pawns. Online, a friend can take your moves after the bot."],
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
  { id: 'thin', name: 'Тонкие', w: '#ffffff', we: '#2b2b2b', wd: '#4a4a4a', b: '#312e2b', be: '#111111', bd: '#5a5652', sw: 1.45 },
  /* ровно посередине между «Тонкими» 1.45 и «Жирными» 4.2 */
  { id: 'medium', name: 'Средние', w: '#ffffff', we: '#252525', wd: '#454545', b: '#312e2b', be: '#0f0f0f', bd: '#5a5652', sw: 2.83 },
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
const QUICK_SKINS = 7;
const skinById = (id) => PIECE_SKINS.find((s) => s.id === String(id)) || PIECE_SKINS[0];

/* ──────────────────────────── 3. СОСТОЯНИЕ UI ─────────────────────────── */

const ui = {
  screen: 'home',
  lastSheenAt: 0,
  mode: null,            // 'local' | 'online'
  role: null,            // 'host' | 'guest'
  st: null,
  frames: [],
  moves: [],
  viewPly: 0,
  selected: -1,
  playerSide: 'w',
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
  hintKey: '',
  hintAt: 0,
  reviewOnly: false,
  reviewFrom: null,
  training: null,
  trainingSkipped: false,
  persona: null,
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
  imboMode: 'local',
  imboSide: 'w',
  imboBot: null,
  imboHistory: [],
  imboChat: [],
  imboBusy: false,
  imboHistoryOpen: false,
  imboChatOpen: false,
  imboResult: null,
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
  applyGlassDom();
  renderGlassRow();
  if ($('#optResultPause')) $('#optResultPause').checked = !!profile.resultPause;
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
      if (ui.dragging && ui.dragNode === el) continue;
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

/* ─────────────────────── 5а. ПЯТЬ ТИПОВ ЖИДКОГО СТЕКЛА ──────────────────
   Клик по образцу применяет тему сразу и остаётся в профиле навсегда. */
const GLASS_VARIANTS = [
  { id: 'aurora', name: 'Аврора', nameEn: 'Aurora', note: 'бирюза · медь', noteEn: 'teal · copper', p: ['#4fbea0', '#5c84e8', '#dc8c46'] },
  { id: 'frost', name: 'Иней', nameEn: 'Frost', note: 'лёд · лаванда', noteEn: 'ice · lavender', p: ['#7fd4ff', '#9b8cff', '#4a6fa8'] },
  { id: 'amber', name: 'Янтарь', nameEn: 'Amber', note: 'закат · мёд', noteEn: 'sunset · honey', p: ['#ffb45e', '#e2607a', '#7a3f8f'] },
  { id: 'midnight', name: 'Полночь', nameEn: 'Midnight', note: 'индиго · дым', noteEn: 'indigo · smoke', p: ['#2a3f78', '#5a7bd8', '#161a2e'] },
  { id: 'neon', name: 'Неон', nameEn: 'Neon', note: 'фуксия · циан', noteEn: 'fuchsia · cyan', p: ['#ff4fd8', '#22e0ff', '#7a2bff'] },
];

function glassVariantId() {
  const id = String(profile.glassVariant || 'aurora');
  return GLASS_VARIANTS.some((v) => v.id === id) ? id : 'aurora';
}

function applyGlassDom() {
  document.documentElement.dataset.glass = profile.glass ? glassVariantId() : '0';
}

function setGlass(id) {
  if (id === 'off') {
    profile.glass = false;
  } else {
    if (!GLASS_VARIANTS.some((v) => v.id === id)) return;
    profile.glass = true;
    profile.glassVariant = id;
  }
  applyGlassDom();
  renderGlassRow();
  saveProfile(true);
  if (id === 'off') toast('Жидкое стекло выключено');
  else {
    const v = GLASS_VARIANTS.find((x) => x.id === id);
    toast(`Стекло «${profile.language === 'en' ? v.nameEn : v.name}» закреплено`);
  }
}

function renderGlassRow() {
  const box = $('#glassRow');
  if (!box) return;
  const en = profile.language === 'en';
  const current = profile.glass ? glassVariantId() : 'off';
  box.innerHTML = '';
  const add = (id, name, note, colors) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'glass-tile' + (current === id ? ' active' : '') + (id === 'off' ? ' off' : '');
    b.dataset.glassId = id;
    b.title = note ? `${name} — ${note}` : name;
    b.setAttribute('aria-pressed', current === id ? 'true' : 'false');
    const prev = document.createElement('span');
    prev.className = 'gt-preview';
    if (colors) {
      prev.style.setProperty('--p1', colors[0]);
      prev.style.setProperty('--p2', colors[1]);
      prev.style.setProperty('--p3', colors[2]);
    }
    prev.innerHTML = '<i></i><i></i><i></i>';
    const nm = document.createElement('span');
    nm.className = 'gt-name';
    nm.textContent = name;
    const nt = document.createElement('span');
    nt.className = 'gt-note';
    nt.textContent = note || '';
    b.append(prev, nm, nt);
    b.addEventListener('click', () => setGlass(id));
    box.appendChild(b);
  };
  add('off', en ? 'Off' : 'Выкл', en ? 'plain panels' : 'обычные панели', null);
  for (const v of GLASS_VARIANTS) add(v.id, en ? v.nameEn : v.name, en ? v.noteEn : v.note, v.p);
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

function modeAllowedForTime(mode, ms = profile.timeMs) {
  return !(mode.flags.clashBrawl || mode.flags.strategy) || !ms || ms >= 180000;
}
const REAL_MODES = (ms = profile.timeMs) => MODES.filter((m) => !m.flags.randomPick && modeAllowedForTime(m, ms));

function randomRealMode(ms = profile.timeMs) {
  const list = REAL_MODES(ms);
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
/* Правила — в engine.js (VariantEngine). Здесь экран, история, чат, бот,
   онлайн-комната и анимации. */

function openImboHub() {
  stopImboGame();
  if (ui.online && ui.online.imbo) {
    netPublish({ t: 'imbo-bye' });
    leaveOnline(true);
  }
  const hub = $('#imboHub');
  const play = $('#imboPlay');
  if (hub) hub.classList.remove('hidden');
  if (play) play.classList.add('hidden');
  const result = $('#imboResult');
  if (result) result.classList.add('hidden');
  ui.imbo = null;
  ui.imboMode = 'local';
  ui.imboResult = null;
  ui.imboHistory = [];
  ui.imboChat = [];
  ui.imboHistoryOpen = false;
  ui.imboChatOpen = false;
  imboUpdatePanels();
}

function imboT(ru, en) {
  return profile.language === 'en' ? en : ru;
}

function imboTitle(st) {
  if (!st) return imboT('Игра', 'Game');
  if (profile.language !== 'en') return VariantEngine.title(st);
  if (st.kind === 'checkers') {
    return st.variant === 'intl' ? 'Checkers · international 10×10' : 'Checkers · Russian 8×8';
  }
  if (st.kind === 'backgammon') return 'Backgammon · 24 points';
  if (st.kind === 'corners') return 'Corners 3×3';
  if (st.kind === 'dodgeball') {
    if (st.variant === '10') return 'Dodgeball 10×10';
    if (st.variant === 'row') return `Dodgeball · 1 row · ${st.count} vs ${st.count}`;
    if (st.variant === 'rand') return `Dodgeball · ${st.count} vs ${st.count}`;
    return st.variant === '1' ? 'Dodgeball · 1 layer' : 'Dodgeball · 2 layers';
  }
  return VariantEngine.title(st);
}

/** Английские подписи для русских строк движка: перевод по частям. */
function imboText(text) {
  if (!text || profile.language !== 'en') return text;
  return String(text)
    .replace(/Продолжайте взятие/g, 'Continue capturing')
    .replace(/взятие обязательно/g, 'capture is mandatory')
    .replace(/Белые потеряли все шашки — победа чёрных/g, 'White lost all pieces — Black wins')
    .replace(/Чёрные потеряли все шашки — победа белых/g, 'Black lost all pieces — White wins')
    .replace(/Белые без ходов — победа чёрных/g, 'White has no moves — Black wins')
    .replace(/Чёрные без ходов — победа белых/g, 'Black has no moves — White wins')
    .replace(/Ничья: 15 ходов подряд без взятия/g, 'Draw: 15 moves without a capture')
    .replace(/Ничья: 300 ходов без победы/g, 'Draw: 300 moves without a win')
    .replace(/Белые/g, 'White')
    .replace(/Чёрные/g, 'Black')
    .replace(/русские/g, 'Russian')
    .replace(/международные/g, 'international')
    .replace(/зары/g, 'dice')
    .replace(/сбито/g, 'hit')
    .replace(/вынесено/g, 'borne off')
    .replace(/бросьте зары/g, 'roll the dice')
    .replace(/сначала введите шашку с бара/g, 'enter a checker from the bar first')
    .replace(/нет ходов — передайте/g, 'no moves — pass')
    .replace(/занять чужой угол 3×3/g, 'occupy the opposite 3×3 corner')
    .replace(/Шашки летят… 3 секунды/g, 'Pieces are flying… 3 seconds')
    .replace(/тяни вниз и отпусти/g, 'drag down and release')
    .replace(/Время вышло на первых ходах — партия прервана/g, 'Time is up — game aborted')
    .replace(/Все шашки улетели — ПАТ/g, 'All pieces are out — stalemate')
    .replace(/Расставьте шашки: нажмите две свои, чтобы поменять местами/g, 'Arrange your pieces: tap two of yours to swap them')
    .replace(/можно выносить/g, 'you can bear off')
    .replace(/сначала соберите все в дом/g, 'bring all checkers home first')
    .replace(/сначала введите с бара/g, 'enter from the bar first');
}

function imboStart(kind, variant, opts = {}) {
  stopImboGame();
  if (ui.online && ui.online.imbo && opts.mode !== 'online') leaveOnline(true);
  const mode = opts.mode || 'local';
  let st;
  try {
    st = VariantEngine.create(kind, { variant, count: opts.count });
  } catch (error) {
    toast('Эта игра пока недоступна');
    return;
  }
  ui.imbo = st;
  ui.imboMode = mode;
  ui.imboSide = opts.side || 'w';
  ui.imboHistory = [];
  ui.imboChat = [];
  ui.imboBusy = false;
  ui.imboResult = null;
  ui.imboBursts = [];
  ui.imboBot = mode === 'bot'
    ? { level: opts.level || ($('#imboBotLevel') && $('#imboBotLevel').value) || 'medium', color: 'b' }
    : null;
  if (mode === 'online' && st.kind === 'dodgeball' && st.phase === 'setup') {
    VariantEngine.ready(st, Date.now());
  }
  imboResetView(imboTitle(st));
  imboModeUi();
  imboRenderAll();
  if (mode === 'bot') setTimeout(imboMaybeBot, 700);
}

function imboRestartGame() {
  const g = ui.imbo;
  if (!g) return;
  if (ui.imboMode === 'online') {
    toast('В онлайне новую партию начинает хозяин комнаты');
    return;
  }
  imboStart(g.kind, (g.params || [])[0], {
    mode: ui.imboMode,
    level: ui.imboBot && ui.imboBot.level,
    count: g.kind === 'dodgeball' ? g.count : undefined,
  });
}

function imboResetView(title) {
  const hub = $('#imboHub');
  const play = $('#imboPlay');
  if (hub) hub.classList.add('hidden');
  if (play) play.classList.remove('hidden');
  const t = $('#imboGameTitle');
  if (t) t.textContent = title;
  const s = $('#imboStatus');
  if (s) s.textContent = '';
  const result = $('#imboResult');
  if (result) result.classList.add('hidden');
}

function imboModeUi() {
  $$('#imboModeSeg [data-imbo-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.imboMode === ui.imboMode);
  });
  const botWrap = $('#imboBotLevelWrap');
  if (botWrap) botWrap.classList.toggle('hidden', ui.imboMode !== 'bot');
  const box = $('#imboOnlineBox');
  if (box) box.classList.toggle('hidden', ui.imboMode !== 'online');
  const leave = $('#imboRoomLeave');
  if (leave) leave.classList.toggle('hidden', !(ui.online && ui.online.imbo));
  const chatWho = $('#imboChatWho');
  if (chatWho) chatWho.textContent = ui.online && ui.online.started
    ? (ui.online.names ? `${ui.online.names.w} / ${ui.online.names.b}` : 'соперник')
    : '';
}

function imboSetMode(mode) {
  if (!ui.imbo) return;
  if (mode === 'online') {
    ui.imboMode = 'online';
    imboModeUi();
    imboOnlineLine(ui.online && ui.online.imbo
      ? `Комната ${ui.online.code} · ${ui.online.started ? 'партия идёт' : 'ждём соперника'}`
      : 'Создайте комнату или введите код соперника.');
    return;
  }
  if (ui.online && ui.online.imbo) leaveOnline(true);
  if (mode === ui.imboMode && mode !== 'bot') return;
  const g = ui.imbo;
  imboStart(g.kind, (g.params || [])[0], {
    mode,
    level: ui.imboBot && ui.imboBot.level,
    count: g.kind === 'dodgeball' ? g.count : undefined,
  });
  toast(mode === 'bot' ? 'Новая партия с ботом' : 'Локальная партия');
}

/* ── общий ход ── */

function imboCanAct() {
  const g = ui.imbo;
  if (!g || g.over || ui.imboBusy) return false;
  if (ui.imboMode === 'online') {
    return !!(ui.online && ui.online.started && g.turn === ui.imboSide);
  }
  if (ui.imboMode === 'bot') return g.turn === 'w';
  return true;
}

function imboTurnWarn() {
  const g = ui.imbo;
  if (!g) return;
  if (ui.imboMode === 'online' && (!ui.online || !ui.online.started)) {
    toast('Сначала создайте комнату или войдите по коду');
  } else {
    toast('Сейчас ход соперника');
  }
}

function imboGeom(from, to, captures) {
  const g = ui.imbo;
  if (!g || (g.kind !== 'checkers' && g.kind !== 'corners')) return null;
  const rect = (sq) => {
    const el = document.querySelector(`#imboBoardWrap .imbo-sq[data-sq="${sq}"]`);
    return el ? el.getBoundingClientRect() : null;
  };
  return { from: rect(from), to: rect(to), caps: (captures || []).map(rect) };
}

function imboPushHistory(res, mover) {
  const g = ui.imbo;
  if (!g || !res) return;
  const text = VariantEngine.notation(g, res);
  if (!text) return;
  ui.imboHistory.push({
    n: ui.imboHistory.length + 1,
    color: mover,
    text,
    capture: !!(res.captures && res.captures.length) || !!res.hit,
  });
}

function imboPushText(text, capture = false) {
  if (!text) return;
  const g = ui.imbo;
  ui.imboHistory.push({
    n: ui.imboHistory.length + 1,
    color: g ? g.turn : 'w',
    text,
    capture,
  });
}

function imboApplyMove(from, to, opts = {}) {
  const g = ui.imbo;
  if (!g || g.over) return null;
  if (!opts.bot && !imboCanAct()) { imboTurnWarn(); return null; }
  const candidates = (g.legal || []).concat(VariantEngine.movesFrom(g, from));
  const move = candidates.find((m) => m.from === from && m.to === to);
  const caps = move && move.cap >= 0 ? [move.cap] : [];
  const geom = imboGeom(from, to, caps);
  const mover = g.turn;
  const res = VariantEngine.apply(g, from, to);
  if (!res.ok) return null;
  imboPushHistory(res, mover);
  imboRenderAll();
  imboAnimate(res, geom);
  imboSyncState();
  if (g.over) {
    imboCheckFinish();
    ui.imboBusy = false;
    return res;
  }
  if (ui.imboMode === 'bot' && ui.imboBot && g.turn === ui.imboBot.color) {
    ui.imboBusy = true;
    setTimeout(() => { ui.imboBusy = false; imboMaybeBot(); }, 380);
  } else {
    ui.imboBusy = false;
  }
  return res;
}

function imboMarkSquares(squares) {
  $$('#imboBoardWrap .last-move').forEach((el) => el.classList.remove('last-move'));
  for (const sq of squares || []) {
    if (sq == null || sq < 0) continue;
    const el = document.querySelector(`#imboBoardWrap .imbo-sq[data-sq="${sq}"]`);
    if (el) el.classList.add('last-move');
  }
}

function imboMarkPoint(point) {
  $$('#imboBoardWrap .last-move').forEach((el) => el.classList.remove('last-move'));
  if (point == null || point < 0) return;
  const el = document.querySelector(`#imboBoardWrap .bg-point[data-point="${point}"]`);
  if (el) el.classList.add('last-move');
}

function imboAnimate(res, geom) {
  const g = ui.imbo;
  if (!g || !res) return;
  if (g.kind === 'backgammon') {
    imboMarkPoint(res.off ? -1 : res.to);
    if (res.off) {
      const bar = document.querySelector('#imboBoardWrap .bg-msg');
      if (bar) bar.classList.add('bg-pulse');
      setTimeout(() => { if (bar) bar.classList.remove('bg-pulse'); }, 450);
    }
    return;
  }
  imboMarkSquares([res.from, res.to]);
  if (!geom || !geom.from) return;
  const target = document.querySelector(`#imboBoardWrap .imbo-sq[data-sq="${res.to}"]`);
  if (target) {
    const checker = target.querySelector('.checker');
    if (checker) {
      const nr = target.getBoundingClientRect();
      checker.style.setProperty('--mx', `${geom.from.left - nr.left}px`);
      checker.style.setProperty('--my', `${geom.from.top - nr.top}px`);
      checker.classList.add('arrive');
      setTimeout(() => {
        checker.classList.remove('arrive');
        checker.style.removeProperty('--mx');
        checker.style.removeProperty('--my');
      }, 420);
    }
  }
  for (const cap of res.captures || []) {
    const el = document.querySelector(`#imboBoardWrap .imbo-sq[data-sq="${cap}"]`);
    if (!el) continue;
    el.classList.add('captured');
    setTimeout(() => el.classList.remove('captured'), 520);
  }
}

function imboRenderAll() {
  const g = ui.imbo;
  if (!g) return;
  if (g.kind === 'checkers') imboCheckersRender();
  else if (g.kind === 'backgammon') imboBgRender();
  else if (g.kind === 'dodgeball') imboDodgeRender();
  else if (g.kind === 'corners') imboCornersRender();
  imboUpdateHistory();
  imboUpdateChat();
  imboUpdatePanels();
  imboCheckFinish();
}

function imboUpdateHistory() {
  const list = $('#imboMoveList');
  const count = $('#imboPlyCount');
  if (count) count.textContent = String(ui.imboHistory.length);
  if (!list) return;
  if (!ui.imboHistory.length) {
    list.innerHTML = `<li class="imbo-empty"><span>${imboT('Пока нет ходов', 'No moves yet')}</span></li>`;
    return;
  }
  list.innerHTML = ui.imboHistory.map((m) => (
    `<li class="${m.capture ? 'capture' : ''}"><b>${m.color === 'w' ? (profile.language === 'en' ? 'W' : 'Б') : (profile.language === 'en' ? 'B' : 'Ч')}${m.n}</b><span>${escapeHtml(imboText(m.text))}</span></li>`
  )).join('');
  list.scrollTop = list.scrollHeight;
}

function imboUpdateChat() {
  const box = $('#imboChat');
  const count = $('#imboChatCount');
  if (count) count.textContent = String(ui.imboChat.length);
  if (!box) return;
  if (!ui.imboChat.length) {
    box.innerHTML = `<div class="chat-empty">${ui.imboMode === 'online' ? imboT('Напишите сопернику', 'Message your opponent') : imboT('Чат доступен в партии по сети', 'Chat is available in online games')}</div>`;
    return;
  }
  box.innerHTML = ui.imboChat.map((m) => (
    `<div class="chat-msg ${m.me ? 'me' : ''}"><b>${escapeHtml(m.name)}</b><span>${escapeHtml(m.text)}</span></div>`
  )).join('');
  box.scrollTop = box.scrollHeight;
}

function imboUpdatePanels() {
  const layout = $('#imboLayout');
  const side = $('#imboSide');
  const hist = $('#imboHistoryPanel');
  const chat = $('#imboChatPanel');
  const open = ui.imboHistoryOpen || ui.imboChatOpen;
  if (layout) layout.classList.toggle('has-side', open);
  if (side) side.classList.toggle('hidden', !open);
  if (hist) hist.classList.toggle('hidden', !ui.imboHistoryOpen);
  if (chat) chat.classList.toggle('hidden', !ui.imboChatOpen);
}

function imboToggleHistory(force) {
  ui.imboHistoryOpen = force != null ? !!force : !ui.imboHistoryOpen;
  imboUpdatePanels();
}

function imboToggleChat(force) {
  ui.imboChatOpen = force != null ? !!force : !ui.imboChatOpen;
  imboUpdatePanels();
  if (ui.imboChatOpen && $('#imboChatInput')) setTimeout(() => $('#imboChatInput').focus(), 60);
}

function sendImboChat(text) {
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) return;
  ui.imboChat.push({ name: profile.name, text: clean, me: true });
  imboUpdateChat();
  if (ui.imboMode === 'online' && ui.online && ui.online.started) {
    netPublish({ t: 'imbo-chat', text: clean, name: profile.name });
  }
}

function imboCheckFinish() {
  const g = ui.imbo;
  if (!g || !g.over || ui.imboResult) return;
  ui.imboResult = { winner: g.winner, text: g.text };
  let title;
  if (!g.winner) title = imboT('Ничья', 'Draw');
  else if (ui.imboMode === 'local') {
    title = imboT(
      `${g.winner === 'w' ? 'Белые' : 'Чёрные'} победили`,
      `${g.winner === 'w' ? 'White' : 'Black'} wins`,
    );
  } else {
    title = g.winner === ui.imboSide
      ? imboT('Вы победили', 'You win')
      : imboT('Победил соперник', 'Your opponent wins');
  }
  const t = $('#imboResultTitle');
  const p = $('#imboResultText');
  if (t) t.textContent = title;
  if (p) p.textContent = imboText(g.text) || '';
  const modal = $('#imboResult');
  if (modal) modal.classList.remove('hidden');
  if (ui.imboMode !== 'local' && g.winner && g.winner !== ui.imboSide) sound.lose();
  else sound.win();
}

function imboSyncState() {
  const g = ui.imbo;
  if (!g || ui.imboMode !== 'online' || !ui.online || !ui.online.imbo || !ui.online.started) return;
  netPublish({
    t: 'imbo-state',
    state: VariantEngine.serialize(g),
    history: ui.imboHistory,
  });
}

/* ── шашки ── */

function imboCheckersRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'checkers') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  VariantEngine.status(g);
  wrap.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'imbo-checkers';
  board.style.gridTemplateColumns = `repeat(${g.W}, minmax(0, 1fr))`;
  board.style.width = `min(${g.W * 62}px, 100%)`;
  const targets = new Set(g.legal.map((m) => m.to));
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
      if (p.king) d.innerHTML = '<span class="checker-crown">♛</span>';
      d.title = (p.c === 'w' ? 'Белые' : 'Чёрные') + ' · ' + VariantEngine.pieceName(g, p);
      sq.appendChild(d);
    }
    sq.addEventListener('click', () => imboCheckersClick(i));
    board.appendChild(sq);
  }
  wrap.appendChild(board);
  const last = g.lastMove;
  if (last) imboMarkSquares([last.from, last.to]);
  const st = $('#imboStatus');
  if (st) st.textContent = imboText(g.text);
}

function imboCheckersClick(sq) {
  const g = ui.imbo;
  if (!g || g.kind !== 'checkers' || g.over) return;
  if (!imboCanAct()) { imboTurnWarn(); return; }
  const p = g.board[sq];
  if (p && p.c === g.turn) {
    if (g.selected != null && g.legal.some((m) => m.cap >= 0) && sq !== g.selected) {
      toast('Сначала завершите взятие');
      return;
    }
    const all = VariantEngine.allMoves(g);
    const moves = all.filter((m) => m.from === sq);
    if (!moves.length) {
      if (all.some((m) => m.cap >= 0)) toast('Есть обязательное взятие — выбери другую шашку');
      return;
    }
    g.selected = sq;
    g.legal = moves;
    imboCheckersRender();
    return;
  }
  if (g.selected == null) return;
  imboApplyMove(g.selected, sq);
}

/* ── нарды ── */

function imboBgRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'backgammon') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  VariantEngine.status(g);
  const board = document.createElement('div');
  board.className = 'bg-board';
  const makePoint = (i, top) => {
    const p = document.createElement('button');
    p.type = 'button';
    p.className = 'bg-point' + (top ? ' top' : '');
    p.dataset.point = String(i);
    const n = Math.abs(g.points[i]);
    const color = g.points[i] > 0 ? 'w' : g.points[i] < 0 ? 'b' : null;
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
  for (let i = 12; i < 24; i++) board.appendChild(makePoint(i, true));
  for (let i = 11; i >= 0; i--) board.appendChild(makePoint(i, false));
  wrap.innerHTML = '';
  wrap.appendChild(board);

  const bar = document.createElement('div');
  bar.className = 'bg-msg';
  const homeNote = g.bar[g.turn] > 0
    ? 'сначала введите с бара'
    : VariantEngine.canBearOff(g) ? 'можно выносить' : 'сначала соберите все в дом';
  bar.textContent = `Бар: белые ${g.bar.w} · чёрные ${g.bar.b} | Дом: ${homeNote}`;

  if (g.bar[g.turn] > 0) {
    const enter = document.createElement('button');
    enter.type = 'button';
    enter.className = 'btn btn-sm';
    enter.textContent = `Ввести с бара (${g.bar[g.turn]})`;
    enter.addEventListener('click', () => {
      if (!imboCanAct()) { imboTurnWarn(); return; }
      g.selected = -1;
      g.legal = VariantEngine.movesFrom(g, -1);
      imboBgRender();
    });
    bar.appendChild(enter);
  }
  if (g.legal.some((m) => m.off)) {
    const offBtn = document.createElement('button');
    offBtn.type = 'button';
    offBtn.className = 'btn btn-sm';
    offBtn.textContent = 'Вынести шашку';
    offBtn.addEventListener('click', () => {
      if (g.selected == null) return;
      imboApplyMove(g.selected, -99);
    });
    bar.appendChild(offBtn);
  }
  if (g.canPass) {
    const pass = document.createElement('button');
    pass.type = 'button';
    pass.className = 'btn btn-sm';
    pass.textContent = 'Передать ход';
    pass.addEventListener('click', () => {
      if (!imboCanAct()) { imboTurnWarn(); return; }
      imboSubmit({kind:'pass'});
    });
    bar.appendChild(pass);
  }
  const roll = document.createElement('button');
  roll.type = 'button';
  roll.className = 'btn btn-sm';
  roll.textContent = '🎲 Бросить зары';
  roll.disabled = g.dice.length > 0 || g.over || !imboCanAct();
  roll.addEventListener('click', () => {
    if (!imboCanAct()) { imboTurnWarn(); return; }
    imboSubmit({kind:'roll'});
  });
  bar.appendChild(roll);
  wrap.appendChild(bar);
  const last = g.lastMove;
  if (last) imboMarkPoint(last.to);
  const st = $('#imboStatus');
  if (st) st.textContent = imboText(g.text);
}

function imboBgClick(i) {
  const g = ui.imbo;
  if (!g || g.kind !== 'backgammon' || g.over) return;
  if (!imboCanAct()) { imboTurnWarn(); return; }
  const target = g.legal.find((m) => m.to === i);
  if (target) {
    imboApplyMove(g.selected, i);
    return;
  }
  if (i < 0) return;
  if (g.points[i] === 0 || Math.sign(g.points[i]) !== (g.turn === 'w' ? 1 : -1)) return;
  if (g.bar[g.turn] > 0) { toast('Сначала введите шашку с бара'); return; }
  const targets = VariantEngine.movesFrom(g, i);
  if (!targets.length) return;
  g.selected = i;
  g.legal = targets;
  imboBgRender();
}

/* ── вышибалы ── */

function stopImboGame() {
  if (ui.imbo && ui.imbo.raf) cancelAnimationFrame(ui.imbo.raf);
  if (ui.imbo) ui.imbo.raf = 0;
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
    c.width = g.W;
    c.height = g.H;
    c.style.width = `min(${g.W}px, 100%)`;
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
  imboDodgeHud();
  imboDodgeDraw();
}

function imboDodgeHud() {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball') return;
  const wrap = $('#imboBoardWrap');
  const st = $('#imboStatus');
  if (st) st.textContent = imboText(g.text);
  if (!wrap) return;
  const setup = wrap.querySelector('.imbo-setup');
  if (g.phase !== 'setup') {
    if (setup) setup.remove();
    return;
  }
  let panel = setup;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'imbo-setup';
    const label = document.createElement('span');
    label.textContent = 'Шашек в ряду:';
    panel.appendChild(label);
    for (const n of [4, 6, 8, 10, 12]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.dataset.count = String(n);
      b.textContent = String(n);
      b.addEventListener('click', () => {
        if (!imboCanAct()) { imboTurnWarn(); return; }
        imboSubmit({kind:'count',count:n});
      });
      panel.appendChild(b);
    }
    const ready = document.createElement('button');
    ready.type = 'button';
    ready.className = 'btn btn-sm';
    ready.textContent = 'Готов';
    ready.addEventListener('click', () => {
      imboSubmit({kind:'ready'});
    });
    panel.appendChild(ready);
    wrap.appendChild(panel);
  }
  panel.querySelectorAll('[data-count]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.count) === g.count);
  });
}

function imboDodgeDraw() {
  const g = ui.imbo;
  if (!g || !g.canvas) return;
  const c = g.canvas;
  const ctx = c.getContext('2d');
  const W = g.W;
  const H = g.H;
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.55);
  grad.addColorStop(0, '#ffe14d');
  grad.addColorStop(0.32, '#ff9d2e');
  grad.addColorStop(0.72, '#c83232');
  grad.addColorStop(1, '#2c1717');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, i * W * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < g.discs.length; i++) {
    const d = g.discs[i];
    if (!d.alive) continue;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = d.team === 'w' ? '#f4f4ee' : '#22262b';
    ctx.strokeStyle = d.team === 'w' ? '#777' : '#ddd';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    if (g.phase === 'setup' && g.setupSel === i) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(d.x - d.r * 0.28, d.y - d.r * 0.28, d.r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff88';
    ctx.fill();
  }
  for (const b of ui.imboBursts || []) {
    ctx.globalAlpha = Math.max(0, b.life);
    ctx.fillStyle = b.team === 'w' ? '#fff3c4' : '#ff9b6a';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * Math.max(0.2, b.life), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (g.drag) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.drag.x0, g.drag.y0);
    ctx.lineTo(g.drag.x1, g.drag.y1);
    ctx.stroke();
    const power = Math.min(1, Math.hypot(g.drag.x1 - g.drag.x0, g.drag.y1 - g.drag.y0) / (W * 0.35));
    ctx.fillStyle = '#0008';
    ctx.fillRect(16, H - 30, W * 0.4, 14);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(16, H - 30, W * 0.4 * power, 14);
  }
}

function imboDodgeLocal(e) {
  const g = ui.imbo;
  const rect = g.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * g.W / rect.width,
    y: (e.clientY - rect.top) * g.H / rect.height,
  };
}

function imboDodgeNearest(p, team) {
  const g = ui.imbo;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.discs.length; i++) {
    const d = g.discs[i];
    if (!d.alive || (team && d.team !== team)) continue;
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < d.r * 1.8 && dist < bestD) { best = i; bestD = dist; }
  }
  return best;
}

function imboDodgeDown(e) {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball' || g.over) return;
  const p = imboDodgeLocal(e);
  if (g.phase === 'setup') {
    if (g.turn !== 'w' && ui.imboMode !== 'local') return;
    const i = imboDodgeNearest(p, null);
    if (i < 0) return;
    if (g.setupSel == null || g.setupSel === i) {
      g.setupSel = g.setupSel === i ? null : i;
    } else {
      const a = g.discs[g.setupSel];
      const b = g.discs[i];
      if (a && b && a.team === b.team) {
        VariantEngine.swap(g, g.setupSel, i);
        g.setupSel = null;
      } else {
        g.setupSel = i;
      }
    }
    imboDodgeDraw();
    return;
  }
  if (!imboCanAct()) { imboTurnWarn(); return; }
  if (g.phase !== 'aim') return;
  const i = imboDodgeNearest(p, g.turn);
  if (i < 0) return;
  const best = g.discs[i];
  g.drag = { index: i, x0: best.x, y0: best.y, x1: p.x, y1: p.y };
  g.selected = i;
  imboDodgeDraw();
}

function imboDodgeMove(e) {
  const g = ui.imbo;
  if (!g || !g.drag) return;
  const p = imboDodgeLocal(e);
  g.drag.x1 = p.x;
  g.drag.y1 = p.y;
  imboDodgeDraw();
}

function imboDodgeUp(e) {
  const g = ui.imbo;
  if (!g || !g.drag) return;
  const d = g.drag;
  g.drag = null;
  if (g.phase !== 'aim' || !imboCanAct()) { imboDodgeDraw(); return; }
  const before = g.turn;
  if (VariantEngine.shoot(g, d.index, d.x0 - d.x1, d.y0 - d.y1, Date.now())) {
    imboPushText(`выстрел ${g.turn === 'w' ? 'белых' : 'чёрных'}`, false);
    imboUpdateHistory();
    imboSyncState();
  }
  imboDodgeDraw();
}

function imboDodgeLoop() {
  const g = ui.imbo;
  if (!g || g.kind !== 'dodgeball') return;
  ui.imboBursts = ui.imboBursts || [];
  const now = Date.now();
  const wasTurn = g.turn;
  const wasPhase = g.phase;
  const before = g.discs.map((d) => d.alive);
  VariantEngine.step(g, 0.016, now);
  if (wasPhase === 'settle' && g.phase === 'aim' && g.turn !== wasTurn) imboSyncState();
  for (let i = 0; i < g.discs.length; i++) {
    if (before[i] && !g.discs[i].alive) {
      const d = g.discs[i];
      ui.imboBursts.push({ x: d.x, y: d.y, r: d.r, team: d.team, life: 1 });
      sound.capture();
      buzz([18, 30, 18]);
    }
  }
  for (const b of ui.imboBursts) {
    b.x += (Math.random() - 0.5) * 2.4;
    b.y += (Math.random() - 0.5) * 2.4;
    b.life -= 0.022;
  }
  ui.imboBursts = ui.imboBursts.filter((b) => b.life > 0);
  VariantEngine.status(g, now);
  imboDodgeHud();
  imboDodgeDraw();
  if (g.over) {
    imboCheckFinish();
    imboSyncState();
  } else if (g.phase === 'aim' && ui.imboMode === 'bot' && g.turn === ui.imboBot.color) {
    imboMaybeBot();
  }
  if (!g.over) g.raf = requestAnimationFrame(imboDodgeLoop);
}

/* ── уголки 3×3 ── */

function imboCornersRender() {
  const g = ui.imbo;
  if (!g || g.kind !== 'corners') return;
  const wrap = $('#imboBoardWrap');
  if (!wrap) return;
  VariantEngine.status(g);
  wrap.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'imbo-checkers';
  board.style.gridTemplateColumns = `repeat(${g.W}, minmax(0, 1fr))`;
  board.style.width = `min(${g.W * 62}px, 100%)`;
  const targets = new Set(g.legal.map((m) => m.to));
  const goalW = VariantEngine.cornersTarget('w');
  const goalB = VariantEngine.cornersTarget('b');
  for (let i = 0; i < g.board.length; i++) {
    const x = i % g.W;
    const y = Math.floor(i / g.W);
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
  const last = g.lastMove;
  if (last) imboMarkSquares([last.from, last.to]);
  const st = $('#imboStatus');
  if (st) st.textContent = imboText(g.text);
}

function imboCornersClick(sq) {
  const g = ui.imbo;
  if (!g || g.kind !== 'corners' || g.over) return;
  if (!imboCanAct()) { imboTurnWarn(); return; }
  const p = g.board[sq];
  if (p && p.c === g.turn) {
    const moves = VariantEngine.movesFrom(g, sq);
    if (!moves.length) return;
    g.selected = sq;
    g.legal = moves;
    imboCornersRender();
    return;
  }
  if (g.selected == null) return;
  imboApplyMove(g.selected, sq);
}

/* ── бот ── */

function imboMaybeBot() {
  const g = ui.imbo;
  if (ui.imboMode !== 'bot' || !g || g.over || ui.imboBusy || !ui.imboBot) return;
  if (g.turn !== ui.imboBot.color) return;
  if (g.kind === 'dodgeball' && g.phase !== 'aim') return;
  ui.imboBusy = true;
  const level = ui.imboBot.level;
  const delay = level === 'easy' ? 450 : level === 'hard' ? 800 : 600;
  setTimeout(() => {
    ui.imboBusy = false;
    if (ui.imboMode !== 'bot' || !ui.imbo || ui.imbo.over || ui.imbo.turn !== ui.imboBot.color) return;
    const game = ui.imbo;
    if (game.kind === 'dodgeball') {
      const shot = VariantEngine.botShot(game);
      if (shot) {
        VariantEngine.shoot(game, shot.index, shot.dx, shot.dy, Date.now());
        imboPushText(`выстрел ${game.turn === 'w' ? 'белых' : 'чёрных'}`, false);
        imboUpdateHistory();
        imboDodgeDraw();
        imboSyncState();
      }
      return;
    }
    if (game.kind === 'backgammon' && !game.dice.length) {
      if (VariantEngine.roll(game)) {
        imboPushText('зары ' + game.dice.join(' · '), false);
        imboRenderAll();
        imboSyncState();
        setTimeout(imboMaybeBot, 350);
      }
      return;
    }
    const choice = VariantEngine.botMove(game, level);
    if (!choice) return;
    if (choice.type === 'pass') {
      if (VariantEngine.pass(game)) {
        imboPushText('нет ходов — передача', false);
        imboRenderAll();
        imboSyncState();
      }
      return;
    }
    if (choice.type === 'roll') {
      if (VariantEngine.roll(game)) {
        imboPushText('зары ' + game.dice.join(' · '), false);
        imboRenderAll();
        imboSyncState();
        setTimeout(imboMaybeBot, 350);
      }
      return;
    }
    if (choice.type === 'move') {
      imboApplyMove(choice.move.from, choice.move.to, { bot: true });
    }
  }, delay);
}

/* ── онлайн ── */

function imboOnlineLine(text) {
  let out = text || '';
  if (profile.language === 'en') {
    out = out
      .replace(/^Комната (\d+): подключаемся…$/, 'Room $1: connecting…')
      .replace(/^Комната (\d+)\. Передайте код сопернику\.$/, 'Room $1. Share the code with your opponent.')
      .replace(/^Комната (\d+): ждём ответа хозяина…$/, 'Room $1: waiting for the host…')
      .replace(/^Комната (\d+): (.*?) ждёт\. Подключаемся…$/, 'Room $1: $2 is waiting. Connecting…')
      .replace(/^Комната (\d+) · вы белые$/, 'Room $1 · you are White')
      .replace(/^Комната (\d+) · вы чёрные$/, 'Room $1 · you are Black')
      .replace(/^Комната (\d+) · (.*)$/, 'Room $1 · $2')
      .replace(/^Комната (\d+):/, 'Room $1:')
      .replace(/^Комната (\d+)\./, 'Room $1.')
      .replace('Связь пропала — переподключаемся…', 'Connection lost — reconnecting…')
      .replace('Не удалось связаться со службой. Проверьте интернет.', 'Could not connect. Check your internet.')
      .replace('Код состоит из пяти цифр.', 'The code has five digits.')
      .replace('Комната не отвечает. Проверьте код и интернет.', 'The room is not responding. Check the code and internet.')
      .replace('Вы вышли из комнаты. Можно играть локально.', 'You left the room. You can keep playing locally.')
      .replace('Соперник вышел из комнаты', 'Your opponent left the room');
  }
  const line = $('#imboOnlineLine');
  if (line) line.textContent = out;
}

async function imboOnlineHost() {
  if (!ui.imbo) return;
  if (ui.online) leaveOnline(true);
  const code = randomCode();
  ui.online = {
    code, role: 'host', sid: Math.random().toString(36).slice(2, 10),
    connected: false, imbo: true, started: false,
    names: { w: profile.name, b: null },
    avatars: { w: profile.avatar, b: 'k' },
  };
  ui.online.relay = new Relay();
  const session=netSessionState();
  ui.online.relay.onMessage = (text) => {if(ui.online===session)handleNet(text);};
  ui.online.relay.onOpen=()=>{if(ui.online===session&&session.started)requestNetworkSync(session,'imbo-open');};
  ui.online.relay.onClose = () => {
    if (ui.online && ui.online.imbo) imboOnlineLine('Связь пропала — переподключаемся…');
  };
  ui.imboMode = 'online';
  ui.imboSide = 'w';
  imboModeUi();
  imboOnlineLine(`Комната ${code}: подключаемся…`);
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    imboOnlineLine('Не удалось связаться со службой. Проверьте интернет.');
    ui.online = null;
    imboModeUi();
    return;
  }
  ui.online.connected = true;
  ui.online.announce = setInterval(() => {
    if (!ui.online || !ui.online.imbo || ui.online.started) return;
    netPublish({
      t: 'imbo-room',
      kind: ui.imbo.kind,
      variant: (ui.imbo.params || [])[0],
      name: profile.name,
      status: 'waiting',
    });
  }, 4000);
  netPublish({
    t: 'imbo-room',
    kind: ui.imbo.kind,
    variant: (ui.imbo.params || [])[0],
    name: profile.name,
    status: 'waiting',
  });
  imboOnlineLine(`Комната ${code}. Передайте код сопернику.`);
  toast(imboT('Комната создана: ', 'Room created: ') + code);
}

async function imboOnlineJoin() {
  const input = $('#imboRoomCode');
  const code = input ? input.value.trim() : '';
  if (!/^\d{5}$/.test(code)) { imboOnlineLine('Код состоит из пяти цифр.'); return; }
  if (!ui.imbo) return;
  if (ui.online) leaveOnline(true);
  ui.online = {
    code, role: 'guest', sid: Math.random().toString(36).slice(2, 10),
    connected: false, imbo: true, started: false,
    names: { w: null, b: profile.name },
    avatars: { w: 'k', b: profile.avatar },
  };
  ui.online.relay = new Relay();
  const session=netSessionState();
  ui.online.relay.onMessage = (text) => {if(ui.online===session)handleNet(text);};
  ui.online.relay.onOpen=()=>{if(ui.online===session&&session.started)requestNetworkSync(session,'imbo-open');};
  ui.online.relay.onClose = () => {
    if (ui.online && ui.online.imbo) imboOnlineLine('Связь пропала — переподключаемся…');
  };
  ui.imboMode = 'online';
  ui.imboSide = 'b';
  imboModeUi();
  imboOnlineLine(`Комната ${code}: подключаемся…`);
  try {
    await ui.online.relay.connect(code);
  } catch (error) {
    imboOnlineLine('Комната не отвечает. Проверьте код и интернет.');
    ui.online = null;
    imboModeUi();
    return;
  }
  ui.online.connected = true;
  netPublish({ t: 'imbo-join', name: profile.name, kind: ui.imbo.kind, variant: (ui.imbo.params || [])[0] });
  let tries = 0;
  ui.online.joinTimer = setInterval(() => {
    tries += 1;
    if (!ui.online || ui.online.started || tries > 24) {
      if (ui.online) clearInterval(ui.online.joinTimer);
      return;
    }
    netPublish({ t: 'imbo-join', name: profile.name, kind: ui.imbo.kind, variant: (ui.imbo.params || [])[0] });
    if (tries % 5 === 0) imboOnlineLine(`Ждём ответа комнаты ${code}…`);
  }, 4000);
  imboOnlineLine(`Комната ${code}: ждём ответа хозяина…`);
}

function imboOnlineLeave() {
  if (ui.online && ui.online.imbo) {
    netPublish({ t: 'imbo-bye' });
    leaveOnline(true);
  }
  ui.imboMode = 'local';
  imboModeUi();
  imboOnlineLine('Вы вышли из комнаты. Можно играть локально.');
}

function handleImboNet(msg) {
  if (!ui.online || !ui.online.imbo) return;
  if (msg.t === 'imbo-room' && ui.online.role === 'guest') {
    if (!ui.online.started) imboOnlineLine(`Комната ${ui.online.code}: ${msg.name || 'соперник'} ждёт. Подключаемся…`);
    return;
  }
  if (msg.t === 'imbo-join' && ui.online.role === 'host') {
    if (ui.online.started) return;
    clearInterval(ui.online.announce);
    ui.online.guestName = String(msg.name || 'Соперник').slice(0, 24);
    ui.online.started = true;
    const g = ui.imbo;
    const kind = g ? g.kind : msg.kind;
    const variant = g ? (g.params || [])[0] : msg.variant;
    imboStart(kind, variant, { mode: 'online', side: 'w' });
    ui.online.names = { w: profile.name, b: ui.online.guestName };
    ui.imboMode = 'online';
    ui.imboSide = 'w';
    ui.imboChat.push({ name: 'Система', text: `${ui.online.guestName} присоединился к партии` });
    imboModeUi();
    imboRenderAll();
    imboOnlineLine(`Комната ${ui.online.code} · вы белые`);
    netPublish({
      t: 'imbo-start',
      state: VariantEngine.serialize(ui.imbo),
      history: ui.imboHistory,
      names: ui.online.names,
      kind: ui.imbo.kind,
      variant: (ui.imbo.params || [])[0],
    });
    toast(imboT('Соперник присоединился', 'Opponent joined'));
    return;
  }
  if (msg.t === 'imbo-start' && ui.online.role === 'guest') {
    ui.online.sid = msg.sid || ui.online.sid;
    clearInterval(ui.online.joinTimer);
    ui.online.started = true;
    ui.online.names = msg.names || { w: 'Хозяин', b: profile.name };
    const state = VariantEngine.deserialize(msg.state);
    if (!state) return;
    stopImboGame();
    ui.imbo = state;
    ui.imboMode = 'online';
    ui.imboSide = 'b';
    ui.imboBot = null;
    ui.imboHistory = Array.isArray(msg.history) ? msg.history : [];
    ui.imboChat = [{ name: 'Система', text: `Вы подключились к комнате ${ui.online.code}` }];
    ui.imboResult = null;
    ui.imboBusy = false;
    ui.imboBursts = [];
    imboResetView(imboTitle(state));
    imboModeUi();
    imboRenderAll();
    if (state.kind === 'dodgeball') imboDodgeLoop();
    imboOnlineLine(`Комната ${ui.online.code} · вы чёрные`);
    toast(imboT('Вы подключились к партии', 'You joined the game'));
    return;
  }
  if (msg.t === 'imbo-state') {
    if (!ui.online.started) return;
    const state = VariantEngine.deserialize(msg.state);
    if (!state) return;
    const wasDodge = ui.imbo && ui.imbo.kind === 'dodgeball';
    if (wasDodge) stopImboGame();
    ui.imbo = state;
    ui.imboHistory = Array.isArray(msg.history) ? msg.history : ui.imboHistory;
    ui.imboResult = null;
    ui.imboBusy = false;
    ui.imboBursts = [];
    imboRenderAll();
    if (state.kind === 'dodgeball') imboDodgeLoop();
    return;
  }
  if (msg.t === 'imbo-chat') {
    const name = ui.online.names
      ? ui.online.names[msg.sender === 'host' ? 'w' : 'b'] || 'Соперник'
      : (msg.name || 'Соперник');
    ui.imboChat.push({ name, text: String(msg.text || '').slice(0, 200) });
    imboUpdateChat();
    return;
  }
  if (msg.t === 'imbo-bye') {
    ui.online.started = false;
    imboOnlineLine('Соперник вышел из комнаты');
    toast(imboT('Соперник вышел', 'Opponent left'));
  }
}


function randomSide() {
  return Math.random() < 0.5 ? 'w' : 'b';
}

/** Жеребьёвка цвета: лента королей в духе кейсов, медленно тормозит на цвете. */
function showSideRoulette(side, done, opts = {}) {
  const overlay = $('#sideRoulette');
  if (!overlay || opts.immediate) { done(side); return; }
  const chosen = side === 'b' ? 'b' : 'w';
  overlay.classList.remove('sr-mode-parity');
  clearTimeout(showParityDraw.timer);
  const track = $('#srTrack');
  const reel = $('#srReel');
  const result = $('#srResult');
  const sub = $('#srSub');
  const kicker = overlay.querySelector('.sr-kicker');
  const card = overlay.querySelector('.sr-card');
  if (kicker) kicker.textContent = profile.language === 'en' ? 'DRAWING COLOURS' : 'ЖЕРЕБЬЁВКА';
  if (result) result.textContent = profile.language === 'en' ? 'Drawing colours…' : 'Определяем цвет…';
  if (sub) {
    sub.textContent = profile.language === 'en' ? 'fate decides for you' : 'судьба решает за вас';
  }
  overlay.classList.remove('hidden', 'sr-stopped');
  overlay.removeAttribute('data-side');
  if (card) { card.classList.remove('sr-show'); void card.offsetWidth; card.classList.add('sr-show'); }
  sound.click();
  clearTimeout(showSideRoulette.timer);
  clearTimeout(showSideRoulette.doneTimer);
  showSideRoulette.token = (showSideRoulette.token || 0) + 1;
  const token = showSideRoulette.token;

  function finish() {
    if (token !== showSideRoulette.token) return;
    overlay.dataset.side = chosen;
    overlay.classList.add('sr-stopped');
    if (result) {
      result.textContent = profile.language === 'en'
        ? `You are ${chosen === 'w' ? 'White' : 'Black'}`
        : `Вы за ${chosen === 'w' ? 'белых' : 'чёрных'}`;
    }
    if (sub) sub.textContent = profile.language === 'en' ? 'the board is ready' : 'доска уже ждёт';
    sound.check();
    showSideRoulette.doneTimer = setTimeout(() => {
      if (token !== showSideRoulette.token) return;
      overlay.classList.add('hidden');
      done(chosen);
    }, 1100);
  }

  if (track && reel) {
    const mirror = opts.direction === 'left' ? true
      : opts.direction === 'right' ? false
        : opts.mirror ? true : Math.random() < 0.5;
    const base = 32 + Math.floor(Math.random() * 3) * 2; // чётный индекс
    const target = base + (chosen === 'b' ? 1 : 0);
    const total = target + 34;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const color = i % 2 === 0 ? 'w' : 'b';
      const tile = document.createElement('div');
      tile.className = 'sr-tile ' + color;
      const king = document.createElement('span');
      king.className = 'sr-king ' + color;
      king.innerHTML = pieceSvg('k');
      tile.appendChild(king);
      frag.appendChild(tile);
    }
    if (track.getAnimations) track.getAnimations().forEach((a) => a.cancel());
    track.innerHTML = '';
    track.appendChild(frag);
    track.style.transform = 'translateX(0px)';
    const first = track.firstElementChild;
    const tileW = first ? first.offsetWidth : 98;
    const gap = parseFloat(getComputedStyle(track).gap) || 10;
    const step = tileW + gap;
    const viewW = reel.clientWidth || 500;
    const final = viewW / 2 - tileW / 2 - target * step;
    const travel = 2300 + Math.random() * 500;
    const start = mirror ? final + travel : final - travel;
    track.style.transform = `translateX(${start}px)`;
    void track.offsetWidth;
    let delay = 55;
    for (let i = 0; i < 11; i++) {
      delay += 55 * Math.pow(1.3, i);
      setTimeout(() => sound.tick(), delay);
    }
    track.animate(
      [{ transform: `translateX(${start}px)` }, { transform: `translateX(${final}px)` }],
      { duration: 3000, easing: 'cubic-bezier(.05,.62,.08,1)', fill: 'forwards' },
    ).onfinish = () => {
      const win = track.children[target];
      if (win) win.classList.add('win');
      finish();
    };
  } else {
    showSideRoulette.timer = setTimeout(finish, 1200);
  }
}

/* 30% жеребьёвок — «Чётное или нечётное»: игрок выбирает чётность,
   а игра уже загадала, какой цвет за ней спрятан. */
function showColorDraw(done, opts = {}) {
  const chance = opts.parityChance != null ? opts.parityChance : 0.30;
  const useParity = !opts.noParity && (opts.force === 'parity'
    || (opts.force !== 'roulette' && Math.random() < chance));
  if (useParity) showParityDraw(done, opts);
  else showSideRoulette(randomSide(), done, opts);
}

function showParityDraw(done, opts = {}) {
  const overlay = $('#sideRoulette');
  if (!overlay) { done(randomSide()); return; }
  const track = $('#srTrack');
  if (track && track.getAnimations) track.getAnimations().forEach((a) => a.cancel());
  clearTimeout(showSideRoulette.timer);
  clearTimeout(showSideRoulette.doneTimer);
  clearTimeout(showParityDraw.timer);
  showSideRoulette.token = (showSideRoulette.token || 0) + 1;
  const token = showSideRoulette.token;
  const kicker = overlay.querySelector('.sr-kicker');
  const result = $('#srResult');
  const sub = $('#srSub');
  const card = overlay.querySelector('.sr-card');
  if (kicker) kicker.textContent = profile.language === 'en' ? 'DRAWING COLOURS' : 'ЖЕРЕБЬЁВКА';
  if (result) result.textContent = profile.language === 'en' ? 'Even or odd?' : 'Чётное или нечётное?';
  if (sub) sub.textContent = profile.language === 'en'
    ? 'the game already hid a colour behind the parity'
    : 'игра уже загадала, какой цвет прячется за чётным';
  overlay.classList.remove('hidden', 'sr-stopped');
  overlay.removeAttribute('data-side');
  overlay.classList.add('sr-mode-parity');
  if (card) { card.classList.remove('sr-show'); void card.offsetWidth; card.classList.add('sr-show'); }
  const kw = $('#srDuelW');
  const kb = $('#srDuelB');
  if (kw && !kw.firstChild) kw.innerHTML = pieceSvg('k');
  if (kb && !kb.firstChild) kb.innerHTML = pieceSvg('k');
  const btns = Array.from(overlay.querySelectorAll('.sr-parity-btn'));
  for (const btn of btns) {
    btn.disabled = false;
    btn.classList.remove('active');
    const old = btn.querySelector('em');
    if (old) old.remove();
  }
  let locked = false;
  const choose = (parity) => {
    if (locked || token !== showSideRoulette.token) return;
    locked = true;
    clearTimeout(showParityDraw.timer);
    const evenColor = randomSide();
    const chosen = parity === 'even' ? evenColor : other(evenColor);
    overlay.dataset.side = chosen;
    overlay.classList.add('sr-stopped');
    for (const btn of btns) {
      const color = btn.dataset.parity === 'even' ? evenColor : other(evenColor);
      btn.disabled = true;
      const em = document.createElement('em');
      em.textContent = profile.language === 'en'
        ? (color === 'w' ? '♔ White' : '♚ Black')
        : (color === 'w' ? '♔ белые' : '♚ чёрные');
      btn.appendChild(em);
      if (btn.dataset.parity === parity) btn.classList.add('active');
    }
    if (result) {
      result.textContent = profile.language === 'en'
        ? `You are ${chosen === 'w' ? 'White' : 'Black'}`
        : `Вы за ${chosen === 'w' ? 'белых' : 'чёрных'}`;
    }
    if (sub) {
      const ev = evenColor === 'w' ? (profile.language === 'en' ? 'White' : 'белые') : (profile.language === 'en' ? 'Black' : 'чёрные');
      const od = other(evenColor) === 'w' ? (profile.language === 'en' ? 'White' : 'белые') : (profile.language === 'en' ? 'Black' : 'чёрные');
      sub.textContent = profile.language === 'en'
        ? `even → ${ev} · odd → ${od}`
        : `чётное → ${ev} · нечётное → ${od}`;
    }
    sound.check();
    showParityDraw.timer = setTimeout(() => {
      if (token !== showSideRoulette.token) return;
      overlay.classList.add('hidden');
      overlay.classList.remove('sr-mode-parity');
      done(chosen);
    }, 1200);
  };
  for (const btn of btns) btn.onclick = () => choose(btn.dataset.parity);
  showParityDraw.timer = setTimeout(() => choose(Math.random() < 0.5 ? 'even' : 'odd'), 12000);
}

function normalizeBot(bot, side) {
  if (!bot) return null;
  return { ...bot, color: bot.color || other(side) };
}

function startGameWithMode(opts = {}) {
  const pickedId = opts.modeId || profile.modeId;
  if (!modeAllowedForTime(modeById(pickedId), opts.timeMs != null ? opts.timeMs : profile.timeMs)) {
    toast('Этот режим доступен с контролем от 3 минут или без ограничения.'); return false;
  }
  if (pickedId === 'ultraBalance' && opts.mode !== 'online') {
    newGame({
      ...opts,
      modeId: 'ultraBalance',
      side: 'w',
      orientation: 'w',
      bot: { level: 'gm', color: 'b' },
    });
    return;
  }
  if (pickedId === 'openIntent' && opts.mode !== 'online') {
    toast('Режим «Открытые намерения» работает только в онлайн-игре с живым соперником!');
    showScreen('online');
    return;
  }
  const pref = opts.side || profile.side;
  if (pref === 'random' && !opts.sideResolved) {
    showColorDraw((side) => {
      startGameWithMode({ ...opts, side, sideResolved: true });
    }, { noParity: opts.mode === 'online' });
    return;
  }
  const side = pref === 'b' ? 'b' : 'w';
  const resolved = { ...opts, side, bot: normalizeBot(opts.bot, side) };
  if (pickedId !== 'random') {
    newGame({ ...resolved, modeId: pickedId });
    return;
  }
  closeBotModal();
  rollRandomMode((modeId) => {
    renderModeCard();
    newGame({ ...resolved, modeId, modePick: 'random' });
  });
}

const MODE_CATS = {
  popular: ['classic', 'fischer', 'threeChecks', 'kingCapture'],
  pieces: ['jester', 'boy', 'queens', 'pawnField', 'pawnFieldQ', 'knights', 'rooks', 'bishops'],
  chaos: ['explode', 'annihilation', 'fog', 'blocks', 'race', 'queenPierce', 'noPawns', 'center', 'damage', 'damageKing'],
  mini: ['strategy', 'ultraBalance', 'zombie', 'royalBattle', 'clashBrawl', 'infernal', 'devourAll', 'captureRace', 'antichess'],
  bots: [],
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
  annihilation: 3, ultraBalance: 3, damage: 3, damageKing: 3,
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
  for (const [label, count] of [['all', MODES.length], ['popular', MODE_CATS.popular.length], ['pieces', MODE_CATS.pieces.length], ['chaos', MODE_CATS.chaos.length], ['mini', MODE_CATS.mini.length], ['bots', Object.keys(BOT_PERSONAS).length], ['imbo', 9]]) {
    const b = $(`.mode-filter[data-filter="${label}"]`);
    if (b) {
      const em = b.querySelector('em') || document.createElement('em');
      em.textContent = String(count);
      b.appendChild(em);
      b.classList.toggle('active', label === mode);
    }
  }
  if (mode === 'bots') {
    const grid = document.createElement('div');
    grid.className = 'persona-grid';
    for (const [id, persona] of Object.entries(BOT_PERSONAS)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'persona-card ' + persona.glow;
      card.innerHTML = `
        <span class="pc-icon">${persona.icon}</span>
        <b>${persona.title}</b>
        <span>${persona.desc}</span>
        <em>Играть</em>`;
      card.addEventListener('click', () => startPersonaGame(id));
      grid.appendChild(card);
    }
    box.appendChild(grid);
    return;
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
  const recent = profile.history.slice(0, 40);
  recent.forEach((g, idx) => {
    const row = document.createElement('div');
    row.className = 'history-row ' + (g.result || 'draw');
    const delta = g.points > 0 ? `+${g.points}` : String(g.points);
    row.innerHTML = `
      <span class="hr-res">${g.result === 'win' ? 'победа' : g.result === 'loss' ? 'поражение' : 'ничья'}</span>
      <span class="hr-mode">${escapeHtml(g.mode || '')}</span>
      <span class="hr-why">${escapeHtml(g.reasonText || '')}</span>
      <span class="hr-moves">${g.plies} ход.</span>
      <span class="hr-date">${g.date || ''}</span>
      <span class="hr-points ${g.points >= 0 ? 'up' : 'down'}">${delta}</span>
      <button class="hr-eye" data-idx="${idx}" type="button" title="${g.game ? 'Просмотреть партию' : 'Для этой старой записи нет полного просмотра'}" ${g.game ? '' : 'disabled'}>👁</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll('.hr-eye[data-idx]').forEach((b) => {
    b.addEventListener('click', () => {
      const rec = recent[Number(b.dataset.idx)];
      if (rec) reviewHistoryGame(rec);
    });
  });
}

/* ────────────────────────── 5. ЭКРАНЫ И ТОСТЫ ─────────────────────────── */

function openScreen(name) {
  ui.prevScreen = ui.screen === 'game' ? 'game' : (ui.screen === 'settings' || ui.screen === 'modes' || ui.screen === 'stats' ? ui.prevScreen || 'home' : 'home');
  showScreen(name);
}

function backFromScreen() {
  showScreen(ui.prevScreen === 'imbo' && ui.imbo ? 'imbo' : ui.prevScreen === 'game' && ui.st ? 'game' : 'home');
  if (ui.screen === 'imbo' && ui.imbo?.kind === 'dodgeball') imboDodgeLoop();
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
  const coop = m.id === 'ultraBalance'
    ? ` · ${profile.language === 'en'
      ? 'you + friend White vs grandmaster bot; friend moves after the bot'
      : 'вы и друг играете белыми против бота-гроссмейстера; друг ходит после бота'}`
    : '';
  el.innerHTML = `${profile.language === 'en' ? 'Mode' : 'Режим'}: <b>${escapeHtml(modeName(m))}</b> · ${m.W}×${m.H} · ${escapeHtml(profile.timeLabel || (profile.language === 'en' ? 'no limit' : 'без ограничений'))}${coop}`;
}

const SKIP_WELCOME = location.search.includes('skipwelcome=1') || (!!navigator.webdriver && !location.search.includes('welcome=1'));

const EN_STATIC = {
  'Играть': 'Play', 'С ботом': 'Vs Bot', 'Онлайн': 'Online', 'Режимы': 'Modes',
  'Статистика': 'Stats', 'Настройки': 'Settings', 'Игрок': 'Player', '0 очков': '0 points',
  'Сыграйте партию за десять секунд': 'Play a game in ten seconds',
  'Выберите режим и время — остальное уже настроено.': 'Pick a mode and time — the rest is ready.',
  'Сменить': 'Change', 'Контроль времени': 'Time control', 'Твой цвет:': 'Your color:',
  'Белые': 'White', 'Чёрные': 'Black', 'Играть здесь': 'Play here', 'С ботом:': 'Vs bot:',
  'лёгкий': 'easy', 'средний': 'medium', 'сложный': 'hard', 'гроссмейстер': 'grandmaster', 'движок': 'maximum',
  'Максимальный': 'Maximum', 'Лёгкий': 'Easy', 'Средний': 'Medium', 'Сложный': 'Hard', 'Гроссмейстер': 'Grandmaster',
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
  'Жидкое стекло': 'Liquid glass',
  'Язык / Language': 'Language', 'В локальной игре я играю за': 'In local games I play as',
  'белых': 'white', 'чёрных': 'black',
  'Партии, очки и статистика хранятся в этом браузере. История — последние 60 партий.': 'Games, points and stats are stored in this browser. History keeps the last 60 games.',
  'Все': 'All', 'Популярные': 'Popular', 'Хаос': 'Chaos', 'Мини-игры': 'Mini-games', 'Имбовинки': 'Interesting things',
  'Локально': 'Local', 'Заново': 'Restart', '↻ Заново': '↻ Restart', '✕ В меню': '✕ To menu',
  'Написать сопернику…': 'Message your opponent…',
  'Создать комнату': 'Create room', 'Код из 5 цифр': '5-digit code', 'Войти': 'Join',
  'Бот': 'Bot', 'Изи': 'Easy', 'Средний': 'Medium', 'Сложный': 'Hard',
  'Создайте комнату или введите код соперника.': 'Create a room or enter your opponent’s code.',
  'Шашки': 'Checkers', 'Русские · 8×8 · дамки летают': 'Russian · 8×8 · flying kings',
  'Шашки мировые': 'International checkers', 'Международные · 10×10 · бой назад': 'International · 10×10 · backwards capture',
  'Нарды': 'Backgammon', '24 пункта · зары · вынос': '24 points · dice · bearing off',
  'Вышибалы · 2 слоя': 'Dodgeball · 2 layers', '16 на 16 · физика · 10 секунд': '16 vs 16 · physics · 10 seconds',
  'Вышибалы · 1 слой': 'Dodgeball · 1 layer', 'Один ряд · та же физика': 'One row · same physics',
  'Вышибалы 10×10': 'Dodgeball 10×10', 'Большое поле': 'Big board',
  'Вышибалы · 1 ряд': 'Dodgeball · 1 row', '4–12 в линию · перестановка перед боем': '4–12 in a row · swap before the fight',
  'Вышибалы · рандом': 'Dodgeball · random', '4–12 шашек · равные составы': '4–12 pieces · equal teams',
  'Уголки 3×3': 'Corners 3×3', 'Переведи все 9 фигур в чужой угол': 'Move all 9 pieces into the opposite corner',
  'Шашки, нарды, вышибалы и уголки — расширение шахматного движка, а не отдельная песочница.': 'Checkers, backgammon, dodgeball and corners — an extension of the chess engine, not a separate sandbox.',
  '🎲 Случайно': '🎲 Random', '✨ Эпично': '✨ Epic', '🎲 Случайная доска': '🎲 Random board', 'Фигуры ': 'Pieces ',
  'Очки, счёт партий и последние игры.': 'Points, game count and recent games.',
  'История партий': 'Game history', 'Соперник': 'Opponent', 'чёрные': 'black', 'Вы': 'You',
  'Превращение': 'Promotion', '≡ Ходы': '≡ Moves', '⚑ Сдаться': '⚑ Resign', 'Выйти': 'Leave',
  'ПАУЗА': 'PAUSED', 'Часы остановлены': 'Clocks stopped', 'Продолжить': 'Continue',
  '▶ Продолжить партию': '▶ Continue game',
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

function menuIntroFx(name) {
  if (name === 'game' || profile.calm) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const box = $('#menuFx');
  if (!box) return;
  box.innerHTML = '';
  const count = window.innerWidth < 700 ? 4 : 9;
  const types = ['n', 'q', 'r', 'b', 'p', 'k'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'menu-flier';
    const fromLeft = i % 2 === 0;
    el.style.left = fromLeft ? '-4vw' : '104vw';
    el.style.top = (8 + Math.random() * 78) + 'vh';
    el.style.setProperty('--mx', (fromLeft ? 1 : -1) * (28 + Math.random() * 42) + 'vw');
    el.style.setProperty('--my', (-12 + Math.random() * 24).toFixed(1) + 'vh');
    el.style.setProperty('--mr', Math.round(-220 + Math.random() * 440) + 'deg');
    el.style.setProperty('--ms', Math.round(22 + Math.random() * 36) + 'px');
    el.style.setProperty('--md', (0.7 + Math.random() * 0.5).toFixed(2) + 's');
    el.style.setProperty('--mde', (Math.random() * 0.18).toFixed(2) + 's');
    el.innerHTML = pieceSvg(types[i % types.length]);
    box.appendChild(el);
  }
  clearTimeout(menuIntroFx.timer);
  menuIntroFx.timer = setTimeout(() => { box.innerHTML = ''; }, 1800);
}

/** Слабый отблеск перехода — не чаще одного раза в 15 секунд. */
function markScreenSheen() {
  const active = document.querySelector('.screen.active');
  if (!active) return;
  active.classList.remove('screen-sheen');
  const now = Date.now();
  if (now - ui.lastSheenAt < 15000) return;
  ui.lastSheenAt = now;
  void active.offsetWidth;
  active.classList.add('screen-sheen');
  clearTimeout(markScreenSheen.timer);
  markScreenSheen.timer = setTimeout(() => active.classList.remove('screen-sheen'), 760);
}

function showScreen(name) {
  if (name !== 'game' && ui.cancelDrag) ui.cancelDrag();
  if (name !== 'game' && ui.reviewOnly) {
    if (ui.training) clearInterval(ui.training.auto);
    ui.reviewOnly = false;
    ui.imported = false;
    ui.training = null;
    ui.reviewFrom = null;
    document.body.classList.remove('reviewing', 'training');
    const cleanShell = $('#gameShell');
    if (cleanShell) cleanShell.classList.remove('review-mode', 'training-on');
    const cleanPanel = $('#trainingPanel');
    if (cleanPanel) cleanPanel.classList.add('hidden');
  }
  const changed = ui.screen !== name;
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
  if (name === 'imbo') {
    if (!ui.imbo) openImboHub();
    else { imboResetView(imboTitle(ui.imbo)); imboModeUi(); imboRenderAll(); }
  } else if (ui.imbo) stopImboGame();
  if (changed && name !== 'game') {
    menuIntroFx(name);
    markScreenSheen();
  }
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
  if (ui.mode === 'online') {
    if (ui.online && ui.online.coop) return 'w';
    return ui.playerSide || (ui.role === 'host' ? 'w' : 'b');
  }
  if (ui.st && ui.st.flags.ultraBalance) return 'w';
  if (ui.playerSide) return ui.playerSide;
  if (ui.bot && ui.bot.color) return other(ui.bot.color);
  return profile.side === 'b' ? 'b' : 'w';
}

/** В онлайн-кооперативе друг ходит белыми только после хода бота. */
function onlineCoachMayMove() {
  if (ui.mode !== 'online' || !ui.online || !ui.online.coop) return true;
  if (ui.online.role === 'host') return true;
  const last = ui.moves[ui.moves.length - 1];
  return !!last && last.color === 'b';
}

function viewState() {
  if (!ui.st) return null;
  const last = ui.frames.length - 1;
  if (ui.viewPly >= last) return ui.st;
  const f = ui.frames[ui.viewPly];
  return {
    ...ui.st,
    ...(f.specialState ? restoreNetworkState(f.specialState) : {}),
    board: f.board,
    lastMove: f.lastMove || null,
    turn: f.turn,
    ep: f.ep,
    castling: f.castling,
    blocked: f.blocked,
    capturedKing: f.capturedKing,
    check: f.check,
    checkSide: f.checkSide,
    status: f.status,
    result: f.result,
    plySeq: f.plySeq || 0,
    checkDamagedSeq: f.checkDamagedSeq != null ? f.checkDamagedSeq : -1,
    rngState: f.rngState,
  };
}

function disp(st, i) {
  const x = i % st.W;
  const y = Math.floor(i / st.W);
  return ui.orientation === 'w'
    ? { dx: x, dy: st.H - 1 - y }
    : { dx: st.W - 1 - x, dy: y };
}

/** Клетка под точкой экрана: считаем по геометрии доски, а не по DOM.
 *  Так хитбокс не зависит от того, попал ли палец на SVG фигуры или на щель. */
function squareAtPoint(st, clientX, clientY) {
  const board = $('#board');
  if (!board || !st) return -1;
  const r = board.getBoundingClientRect();
  if (!r.width || !r.height) return -1;
  const relX = clientX - r.left;
  const relY = clientY - r.top;
  const pad = 8;
  if (relX < -pad || relY < -pad || relX > r.width + pad || relY > r.height + pad) return -1;
  let dx = Math.max(0, Math.min(st.W - 1, Math.floor((relX / r.width) * st.W)));
  let dy = Math.max(0, Math.min(st.H - 1, Math.floor((relY / r.height) * st.H)));
  if (ui.rotated || ui.tableRotated) {
    dx = st.W - 1 - dx;
    dy = st.H - 1 - dy;
  }
  const x = ui.orientation === 'w' ? dx : st.W - 1 - dx;
  const y = ui.orientation === 'w' ? st.H - 1 - dy : dy;
  return y * st.W + x;
}

function layoutBoard() {
  if (typeof v84LayoutBoard === 'function' && v84LayoutBoard()) return;
  const shellReset = $('#gameShell');
  if (shellReset) shellReset.classList.remove('v84-centered', 'v84-panel-below');
  const stageReset = $('#stage');
  if (stageReset) { stageReset.style.left = ''; stageReset.style.height = ''; }
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
  /* Стрелки истории живут внутри нижней плашки, отдельной полосы больше нет.
     Высоту плашек считаем по фактическому состоянию экрана: иначе на телефоне
     и в кинематическом ландшафте доска выходит неквадратной. */
  const shortLandscape = !!(window.matchMedia && window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches);
  const tightLandscape = !shortLandscape && !!(window.matchMedia && window.matchMedia('(max-height: 560px)').matches);
  const phoneBar = shortLandscape ? 86 : tightLandscape ? 136 : 152;
  const barH = (phone
    ? phoneBar
    : 104) + brawlH + (ui.strategy ? 46 : 0);   // фиксировано: доска не дёргается при взятии
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
    if (ui.dragHoverEl === el) cls.push('drag-over');
    if (st.blocked.includes(i)) cls.push('blocked');
    if (ui.brawl && brawlCanDeploy(i, st.turn)) cls.push('brawl-deploy');
    if (ui.zombie && ui.zombie.infect[i]) cls.push('zombie-threat');
    if (ui.strategy) {
      const terr = st.strategy?.territory || {};
      const influence = st.strategy?.influence?.[i];
      if (influence != null) el.style.setProperty('--claim', Math.abs(influence)/3);
      const object = st.strategy?.objects?.find(o=>o.sq===i);
      if(object) { el.dataset.object = '⚑'; el.title=object.name+' · +'+object.income+' золота/раунд'; } else delete el.dataset.object;
      if(ui.strategy.recruit && terr[i]===st.turn && !st.board[i]) cls.push('brawl-deploy');
      if (terr[i] === 'w') cls.push('strat-w');
      else if (terr[i] === 'b') cls.push('strat-b');
      if (ui.strategy.aim && ui.strategy.aim.has(i)) cls.push('strat-aim');
      if (ui.strategy.targets && ui.strategy.targets.has(i)) cls.push('strat-target');
      if ((ui.strategy.mines || []).some((m) => m.sq === i)) cls.push('strat-mine');
      if ((ui.strategy.rad || []).some((z) => {
        const zx = z.sq % st.W, zy = Math.floor(z.sq / st.W);
        const nx = i % st.W, ny = Math.floor(i / st.W);
        return Math.max(Math.abs(nx - zx), Math.abs(ny - zy)) <= 1 && z.rounds > 0;
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
    if (ui.dragging && ui.dragNode === el) continue;
    el.className = `piece ${p.c === 'w' ? 'w' : 'b'} t-${p.t}${p.gold ? ' gold' : ''}${p.special ? ' ' + p.special : ''}`;
    if (ui.persona && ui.bot && p.t === 'k' && p.c === ui.bot.color) {
      el.classList.add('bot-king', 'bot-king-' + ui.persona.id);
      if (ui.persona.id === 'tilter' && performance.now() < ui.persona.cryUntil) el.classList.add('bot-king-cry');
    }
    if (st.flags.strategy) {
      const hp = st.strategy.hp[p.id] ?? STRAT[p.t].hp;
      const max = strategyMaxHp(p);
      el.dataset.hp = `${hp}${st.strategy.shield[p.id] ? ' 🛡' : ''}`;
      el.classList.toggle('hp-low', hp <= max * 0.35);
    } else if (st.flags.clashBrawl) {
      el.dataset.hp = String(p.hp ?? p.maxHp ?? 12);
      el.classList.toggle('hp-low', p.hp <= p.maxHp*.35);
    } else if ((st.flags.damage || st.flags.damageKing) && p.hp != null && p.maxHp && p.hp < p.maxHp) {
      el.dataset.hp = String(p.hp);
      el.classList.toggle('hp-low', p.hp <= Math.ceil(p.maxHp * 0.35));
    } else {
      delete el.dataset.hp;
      el.classList.remove('hp-low');
    }
    if (typeof v84RenderMood === 'function') v84RenderMood(el, p);
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

/* Одинаковые кружки не пересобираются чаще 0,2 с: иначе клик по уже
   выбранной фигуре заново запускает анимацию их появления. */
const HINT_REDRAW_MS = 200;

/* Правила считаем один раз на позицию, а не на каждое движение пальца.
   ХП и лимиты ходов входят в ключ: специальные режимы не получают устаревший кеш. */
function getUiLegalMoves(st) {
  let key = positionKey(st) + '|' + st.full;
  for (const p of st.board) if (p) key += '|' + p.id + ':' + (p.used || 0) + ':' + (p.hp ?? '');
  key += '|' + st.mv.w.cross + ':' + st.mv.b.cross;
  const cache = ui.legalCache;
  if (cache && cache.state === st && cache.key === key) return cache.moves;
  const moves = legalMoves(st, st.turn);
  ui.legalCache = { state: st, key, moves };
  return moves;
}

function renderHints() {
  const st = viewState();
  const layer = $('#hints');
  if (!layer) return;
  if (!ui.st || (ui.viewPly !== ui.frames.length - 1 && !canBranchHere()) || ui.selected < 0) {
    if (layer.childNodes.length || ui.hintKey) layer.innerHTML = '';
    ui.hintKey = '';
    ui.hintAt = 0;
    return;
  }
  const moves = getUiLegalMoves(ui.st).filter((m) => m.from === ui.selected);
  const marks = moves.map((m) => {
    const capture = m.capture != null || m.ep || (m.caps && m.caps.length);
    return m.to + (capture ? 'x' : '');
  }).join(',');
  const key = [ui.selected, ui.st.turn, ui.st.full, ui.viewPly, ui.sq,
    ui.orientation, ui.rotated ? 1 : 0, ui.tableRotated ? 1 : 0, marks].join('|');
  const now = performance.now();
  if (key === ui.hintKey && now - ui.hintAt < HINT_REDRAW_MS) return;
  layer.innerHTML = '';
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
  ui.hintKey = key;
  ui.hintAt = now;
}

function renderPersonaFx() {
  const layer = $('#personaFx');
  if (!layer) return;
  layer.innerHTML = '';
  if (!ui.persona || !ui.st || !ui.bot) return;
  const kingSq = findKing(ui.st, ui.bot.color);
  if (kingSq < 0) return;
  const now = performance.now();
  const p = ui.persona;
  const { dx, dy } = disp(ui.st, kingSq);
  const sq = ui.sq;
  const piece = ui.st.board[kingSq];
  const kingEl = piece ? ui.pieceNodes.get(piece.id) : null;
  if (kingEl) {
    kingEl.classList.add('bot-king', 'bot-king-' + p.id);
    kingEl.classList.toggle('bot-king-cry', p.id === 'tilter' && now < p.cryUntil);
  }
  let halo = '';
  if (p.id === 'friendly') halo = (p.throw > 0 || now < p.limeUntil) ? 'yellow' : 'blue';
  else if (p.id === 'tilter') {
    if (now < p.limeUntil) halo = 'lime';
    else if (p.anger >= 72) halo = 'rage';
    else halo = 'blue';
  } else if (p.id === 'cinema') halo = 'cinema';
  if (halo) {
    const el = document.createElement('span');
    el.className = 'persona-halo ' + halo;
    el.style.width = (sq * 0.92) + 'px';
    el.style.height = (sq * 0.46) + 'px';
    el.style.left = (dx * sq + sq * 0.04) + 'px';
    el.style.top = (dy * sq - sq * 0.24) + 'px';
    layer.appendChild(el);
  }
  let emote = '';
  if (p.id === 'friendly' && p.throw > 0) emote = '🙂';
  else if (p.id === 'tilter') {
    if (now < p.cryUntil) emote = '😭';
    else if (now < p.limeUntil) emote = '😌';
    else if (p.anger >= 72) emote = '💢';
  }
  if (emote) {
    const el = document.createElement('span');
    el.className = 'persona-emote';
    el.textContent = emote;
    el.style.fontSize = Math.max(13, Math.round(sq * 0.28)) + 'px';
    el.style.left = (dx * sq + sq * 0.62) + 'px';
    el.style.top = (dy * sq - sq * 0.12) + 'px';
    layer.appendChild(el);
  }
  if (p.id === 'tilter') {
    const rant = document.createElement('span');
    rant.className = 'persona-rant';
    rant.textContent = '##%@@&??"!!!';
    rant.style.left = (dx * sq - sq * 0.15) + 'px';
    rant.style.top = (dy * sq + sq * 0.76) + 'px';
    layer.appendChild(rant);
  }
}

function renderBoard(animate) {
  if (!ui.st) return;
  const boardEl = document.getElementById('board');
  if (boardEl) {
    boardEl.classList.toggle('fog-on', !!ui.st.flags.fog);
    boardEl.classList.toggle('brawl-locked', !!ui.st.flags.clashBrawl && (ui.st.brawl?.plies || 0) < 6);
  }
  layoutBoard();
  positionSquares();
  renderSquares();
  renderPieces(animate);
  renderHints();
  renderPersonaFx();
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
    const text = fmtClock(ms);
    if (el.textContent !== text) el.textContent = text;
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
    checkSide: st.checkSide ? { ...st.checkSide } : null,
    status: st.status,
    result: st.result ? { ...st.result } : null,
    plySeq: st.plySeq || 0,
    checkDamagedSeq: st.checkDamagedSeq != null ? st.checkDamagedSeq : -1,
    rngState: st.rngState,
    specialState: (st.flags.strategy || st.flags.clashBrawl) ? captureNetworkState(st) : null,
  };
}


/* ═══════════════════════ 12.5. CLASH BRAWL ═══════════════════════════ */

const BRAWL_COST = { p: 3, b: 6, n: 7, r: 10, q: 14 };
const BRAWL_HP = { p: 12, b: 22, n: 26, r: 38, q: 46, k: 50 };
const BRAWL_ATK = { p: 6, b: 10, n: 12, r: 16, q: 20, k: 12 };
const BRAWL_NAME = { p: 'Пешка', b: 'Слон', n: 'Конь', r: 'Ладья', q: 'Ферзь', k: 'Король' };
const BRAWL_POINTS = { p: 1, b: 3, n: 3, r: 5, q: 9, k: 10 };
const BRAWL_UPGRADES = {
  power: { name: '⚔ Оружие', text: '+2 к урону всех своих фигур', cost: 5 },
  heal: { name: '💚 Ремонт', text: '+8 HP всем своим, не выше максимума', cost: 4 },
  shield: { name: '🛡 Купол', text: 'Вдвое меньше входящего урона до следующего своего хода', cost: 4 },
  economy: { name: '💜 Генератор', text: '+1 эликсир в начале следующих своих ходов (до +3)', cost: 7 },
  reserve: { name: '📦 Резерв', text: '+4 к вместимости эликсира (до 28)', cost: 4 },
};
function brawlDeck() {
  return ['p', 'b', 'n', 'r', 'q'].map((t) => ({ t, cost: BRAWL_COST[t] }));
}



/* ═══════════════════ 12.9. СТРАТЕГИЯ ═══════════════════ */

const STRAT = {
  p: { hp: 16, move: 2, atk: 6, dmg: 8, range: 2 },
  b: { hp: 32, move: 4, atk: 10, dmg: 12, range: 3 },
  n: { hp: 38, move: 5, atk: 12, dmg: 16, range: 2 },
  r: { hp: 65, move: 7, atk: 18, dmg: 28, range: 5 },
  q: { hp: 90, move: 10, atk: 25, dmg: 35, range: 3 },
  k: { hp: 210, move: 12, atk: 20, dmg: 25, range: 1 },
};
const STRAT_NUKE = { round: 5, cost: 120, center: 150, inner: 80, outer: 30 };
const STRAT_UPGRADES = {
  income: { name: 'Экономика', base: 30, max: 3 },
  arsenal: { name: 'Арсенал', base: 35, max: 3 },
  logistics: { name: 'Снабжение', base: 25, max: 3 },
};

/* Only rule data lives in st.strategy. Selections/aiming are non-enumerable and
   rebuilt after JSON import: no DOM, Set, timers or wall-clock in the reducer. */
function strategyEnsure(st) {
  if (st.strategy && st.strategy.version === 84) return st.strategy;
  const territory = {}, influence = {};
  for (let i = 0; i < st.board.length; i++) {
    const owner = Math.floor(i / st.W) < st.H / 2 ? 'w' : 'b';
    territory[i] = owner; influence[i] = owner === 'w' ? 3 : -3;
  }
  st.strategy = {
    version: 84, hp: {}, shield: {}, moved: {}, gold: { w: 35, b: 35 }, cap: 180,
    factions: { w: 'Светлая республика', b: 'Тёмная федерация' },
    phase: 'move', phaseSide: 0, round: 1, seq: 0, phaseRepeated: false,
    nextPhase: 'attack', nextRepeat: false, notice: '',
    upgrades: { w: { income: 0, arsenal: 0, logistics: 0 }, b: { income: 0, arsenal: 0, logistics: 0 } },
    nukeUsed: { w: false, b: false }, territory, influence,
    nextPiece: 1, objects: [ { sq: 2 * st.W + 2, name: 'Завод', income: 4 },
      { sq: (st.H - 3) * st.W + st.W - 3, name: 'Порт', income: 4 },
      { sq: Math.floor(st.H / 2) * st.W + Math.floor(st.W / 2), name: 'Столица торговли', income: 6 } ],
    mines: [], rad: [], lastMoved: {},
  };
  for (const p of st.board) if (p) st.strategy.hp[p.id] = STRAT[p.t].hp;
  const neutral=st.strategy.objects[2].sq; st.strategy.territory[neutral]=null; st.strategy.influence[neutral]=0;
  strategyPlanPhase(st);
  return st.strategy;
}
function strategyPlanPhase(st) {
  const s = st.strategy;
  s.nextRepeat = !s.phaseRepeated && stateRandom(st) < 0.1;
  s.nextPhase = s.nextRepeat ? s.phase : (s.phase === 'move' ? 'attack' : 'move');
}
function strategyPieceHp(st, p) { return p ? (st.strategy.hp[p.id] ?? STRAT[p.t].hp) : 0; }
function strategyRuleCost(st, p, kind, sq) {
  const u = st.strategy.upgrades[p.c];
  const base = kind === 'nuke' ? STRAT_NUKE.cost : kind === 'mine' ? 15
    : STRAT[p.t][kind === 'move' ? 'move' : 'atk'];
  if (kind === 'nuke') return base;
  return Math.max(1, Math.ceil(base * (kind === 'move' ? 1 - u.logistics * .15 : 1)
    * (strategyOnEnemyHalf(st, sq, p.c) ? 1.1 : 1)));
}
function strategyRuleDamage(st, p) { return STRAT[p.t].dmg + st.strategy.upgrades[p.c].arsenal * 4; }
function strategyCleanup(st, events = []) {
  for (let sq = 0; sq < st.board.length; sq++) {
    const p = st.board[sq];
    if (!p || strategyPieceHp(st, p) > 0) continue;
    st.board[sq] = null;
    events.push({ type: 'destroy', sq, piece: { ...p } });
  }
  const w = findKing(st, 'w') >= 0, b = findKing(st, 'b') >= 0;
  if (!w || !b) {
    st.capturedKing = !w && !b ? null : (!w ? 'w' : 'b');
    st.status = 'over'; st.result = { winner: w === b ? null : (w ? 'w' : 'b'), reason: 'king' };
  } else { st.capturedKing = null; st.status = 'play'; st.result = null; }
}
function strategyDealDamage(st, p, amount, events, sq) {
  if (!p) return false;
  const s = st.strategy, shield = s.shield[p.id] || 0;
  const absorbed = Math.min(shield, amount);
  s.shield[p.id] = shield - absorbed;
  s.hp[p.id] = Math.max(0, strategyPieceHp(st, p) - (amount - absorbed));
  events.push({ type: 'damage', sq, amount: amount - absorbed, absorbed });
  return s.hp[p.id] === 0;
}
function strategyRuleKnockback(st, sq, from, events) {
  const p = st.board[sq];
  if (!p || p.t === 'q' || p.t === 'k' || strategyPieceHp(st, p) <= 0) return;
  const x = sq % st.W, y = Math.floor(sq / st.W);
  const fx = from % st.W, fy = Math.floor(from / st.W);
  const dx = Math.sign(x - fx), dy = Math.sign(y - fy);
  const candidates = [[dx, dy], ...QUEEN_DIRS.filter(([a, b]) => a !== dx || b !== dy)];
  for (const [a, b] of candidates) {
    if (!a && !b) continue;
    const nx = x + a, ny = y + b;
    if (!inside(st, nx, ny)) {
      /* Only the direction of impact can throw a piece over the edge. */
      if (a !== dx || b !== dy) continue;
      st.strategy.hp[p.id] = 0;
      events.push({ type: 'knockout', from: sq, dx: a, dy: b, piece: { ...p } });
      return;
    }
    const to = sqAt(st, nx, ny);
    if (st.board[to]) continue;
    st.board[to] = p; st.board[sq] = null; st.strategy.moved[p.id] = true;
    events.push({ type: 'knockback', from: sq, to, piece: { ...p } });
    strategyDealDamage(st, p, 4, events, to);
    return;
  }
}
function strategyUpdateTerritory(st) {
  const s = st.strategy;
  for (let sq = 0; sq < st.board.length; sq++) {
    const x = sq % st.W, y = Math.floor(sq / st.W);
    /* One-rank home borders cannot be repainted. */
    if (y === 0 || y === st.H - 1) {
      s.influence[sq] = y === 0 ? 3 : -3; s.territory[sq] = y === 0 ? 'w' : 'b'; continue;
    }
    let dw = Infinity, db = Infinity;
    for (let i = 0; i < st.board.length; i++) {
      const p = st.board[i]; if (!p) continue;
      const d = Math.max(Math.abs(i % st.W - x), Math.abs(Math.floor(i / st.W) - y));
      if (d > 1) continue;
      if (p.c === 'w') dw = Math.min(dw, d); else db = Math.min(db, d);
    }
    if (dw === db) continue;
    const favored = dw < db ? 1 : -1;
    const n = s.influence[sq] || 0;
    /* Three interactions convert a fully hostile cell: -3,-1,+1,+3. */
    s.influence[sq] = Math.max(-3, Math.min(3, n + favored * 2));
    if (Math.abs(s.influence[sq]) === 3) s.territory[sq] = s.influence[sq] > 0 ? 'w' : 'b';
  }
}
function strategyRuleIncome(st, color) {
  const s = st.strategy;
  const objects = s.objects.filter(o => s.territory[o.sq] === color).reduce((n, o) => n + o.income, 0);
  return 10 + s.upgrades[color].income * 4 + objects;
}
function strategyRuleAttackData(st, p, from, special = null) {
  const aim = new Set(), targets = new Set();
  if (!p) return { aim, targets };
  const x = from % st.W, y = Math.floor(from / st.W);
  if (special === 'nuke' && p.t === 'k') {
    for (let i = 0; i < st.board.length; i++) { aim.add(i); targets.add(i); }
    return { aim, targets };
  }
  const lob = special === 'rocket' || special === 'catapult';
  let dirs = p.t === 'p' ? [[0, p.c === 'w' ? 1 : -1]] : p.t === 'r' ? ROOK_DIRS
    : p.t === 'b' ? BISHOP_DIRS : QUEEN_DIRS;
  const range = lob ? 6 : p.t === 'p' ? (st.strategy.moved[p.id] ? 2 : 4) : STRAT[p.t].range;
  if (p.t === 'n') {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      if (!inside(st, x + dx, y + dy)) continue;
      const to = sqAt(st, x + dx, y + dy); aim.add(to);
      if (!st.board[to] || st.board[to].c !== p.c) targets.add(to);
    }
    return { aim, targets };
  }
  for (const [dx, dy] of dirs) for (let d = 1; d <= range; d++) {
    const nx = x + dx * d, ny = y + dy * d;
    if (!inside(st, nx, ny)) break;
    const to = sqAt(st, nx, ny), q = st.board[to];
    aim.add(to);
    if (lob) { if (special !== 'catapult' || d >= 2) targets.add(to); continue; }
    if (!q || q.c !== p.c) targets.add(to);
    if (q) break;
  }
  return { aim, targets };
}
function strategyNukePreview(st, to) {
  const tx = to % st.W, ty = Math.floor(to / st.W), cells = [];
  for (let sq = 0; sq < st.board.length; sq++) {
    const d = Math.max(Math.abs(sq % st.W - tx), Math.abs(Math.floor(sq / st.W) - ty));
    if (d > 2) continue;
    cells.push({ sq, damage: d === 0 ? STRAT_NUKE.center : d === 1 ? STRAT_NUKE.inner : STRAT_NUKE.outer });
  }
  return cells;
}
function strategyRuleRadiation(st, events) {
  const s = st.strategy;
  for (const zone of s.rad) {
    if (zone.createdRound >= s.round) continue;
    for (const sq of zone.cells) {
      const p = st.board[sq]; if (p) strategyDealDamage(st, p, 6, events, sq);
    }
    zone.rounds--;
  }
  s.rad = s.rad.filter(z => z.rounds > 0);
  strategyCleanup(st, events);
}
function strategyAdvance(st, mover, events) {
  const s = st.strategy;
  strategyUpdateTerritory(st);
  s.seq++; st.plySeq = (st.plySeq || 0) + 1;
  if (mover === 'b') st.full++;
  if (s.phaseSide === 0) { s.phaseSide = 1; st.turn = 'b'; }
  else {
    const old = s.phase;
    const repeat = s.nextRepeat;
    s.phase = s.nextPhase; s.phaseRepeated = repeat; s.phaseSide = 0; st.turn = 'w';
    if (old === 'attack') {
      strategyRuleRadiation(st, events); s.round++;
      for (const color of ['w', 'b']) s.gold[color] = Math.min(s.cap, s.gold[color] + strategyRuleIncome(st, color));
    }
    s.notice = repeat ? `Тактический сюрприз: ещё одна фаза ${s.phase === 'move' ? 'манёвров' : 'атаки'}!` : '';
    strategyPlanPhase(st);
  }
  strategyCleanup(st, events);
}
function strategyReduceAction(st, action) {
  const s = strategyEnsure(st), mover = st.turn, events = [];
  const fail = reason => ({ ok: false, reason, action, mover, seq: s.seq, events: [] });
  if (!action || typeof action !== 'object') return fail('Неверное действие');
  if (st.status !== 'play') return fail('Партия уже завершена');
  if (action.seq != null && action.seq !== s.seq + 1) return fail('Неверный номер действия');
  if (action.color && action.color !== mover) return fail('Сейчас ход другой стороны');
  const kind = action.kind;
  const p = Number.isInteger(action.from) ? st.board[action.from] : null;
  const costFor = type => strategyRuleCost(st, p, type, action.from);
  const pay = cost => { if (s.gold[mover] < cost) return false; s.gold[mover] -= cost; return true; };
  if (kind === 'pass') {
    s.gold[mover] = Math.min(s.cap, s.gold[mover] + (s.phase === 'move' ? 6 : 3));
    events.push({ type: 'pass', color: mover });
  } else if (kind === 'upgrade') {
    const meta = STRAT_UPGRADES[action.upgrade], levels = s.upgrades[mover];
    if (!meta || levels[action.upgrade] >= meta.max) return fail('Улучшение уже максимальное');
    const cost = meta.base + levels[action.upgrade] * 15;
    if (!pay(cost)) return fail(`Улучшение стоит ${cost}, в казне ${s.gold[mover]}`);
    levels[action.upgrade]++; events.push({ type: 'upgrade', upgrade: action.upgrade, color: mover });
  } else if (kind === 'support') {
    const target = st.board[action.to], heal = action.support === 'heal';
    if (!target || target.c !== mover || !['heal','shield'].includes(action.support)) return fail('Выбери свою фигуру');
    if (heal && strategyPieceHp(st, target) >= STRAT[target.t].hp) return fail('Фигура уже здорова');
    if (!heal && (s.shield[target.id] || 0) >= 30) return fail('У фигуры уже полный щит');
    if (!pay(heal ? 20 : 25)) return fail('Недостаточно золота на поддержку');
    if (heal) s.hp[target.id] = Math.min(STRAT[target.t].hp, strategyPieceHp(st, target) + 25);
    else s.shield[target.id] = 30;
    events.push({ type: 'support', sq: action.to, support: action.support });
  } else if (kind === 'deploy') {
    if(s.phase!=='move') return fail('Подкрепления доступны в фазе манёвров');
    const price={p:12,b:26,n:28,r:46,q:65}[action.piece];
    if(!price || !Number.isInteger(action.to) || action.to<0 || action.to>=st.board.length || st.board[action.to] || s.territory[action.to]!==mover) return fail('Выбери пустую захваченную клетку');
    if(st.board.filter(p=>p&&p.c===mover).length>=24) return fail('На поле уже 24 своих фигуры');
    if(!pay(price)) return fail('Не хватает золота на подкрепление');
    let id=850000000+s.nextPiece++; while(st.board.some(p=>p&&p.id===id))id=850000000+s.nextPiece++;
    st.board[action.to]={t:action.piece,c:mover,id,used:0}; s.hp[id]=STRAT[action.piece].hp;
    s.moved[id]=true;events.push({type:'deploy',to:action.to,piece:{...st.board[action.to]}});
  } else if (kind === 'move') {
    if (s.phase !== 'move') return fail('Сейчас фаза атаки, движение закрыто');
    if (!p || p.c !== mover) return fail('Выбери свою фигуру');
    const move = legalMoves(st, mover).find(m => m.from === action.from && m.to === action.to
      && (m.promo || null) === (action.promo || null));
    if (!move) return fail('Недоступное движение');
    if (!pay(costFor('move'))) return fail(`Нужно ${costFor('move')} золота. Можно пропустить и получить +6`);
    if (st.board[action.to]) {
      const victim = st.board[action.to];
      strategyDealDamage(st, victim, strategyRuleDamage(st, p), events, action.to);
      strategyRuleKnockback(st, action.to, action.from, events);
      strategyCleanup(st, events);
      if (!st.board[action.to]) { st.board[action.to] = p; st.board[action.from] = null; }
      s.moved[p.id] = true; st.ep = -1;
      if(p.t==='k') st.castling[p.c]={k:null,q:null};
      if(p.t==='r') for(const side of ['k','q'])if(st.castling[p.c][side]===p.id)st.castling[p.c][side]=null;
    } else {
      const seq = st.plySeq, full = st.full;
      applyMove(st, move); st.turn = mover; st.plySeq = seq; st.full = full;
      s.moved[p.id] = true;
      if (move.promo) s.hp[st.board[action.to].id] = STRAT[move.promo].hp;
    }
    s.lastMoved[mover] = action.to;
    events.push({ type: 'move', from: action.from, to: action.to });
  } else if (kind === 'attack' || kind === 'mine') {
    if (s.phase !== 'attack') return fail('Сейчас фаза манёвров, стрельба закрыта');
    if (!p || p.c !== mover) return fail('Выбери свою фигуру');
    const special = action.special || null;
    if (kind === 'mine') {
      if (p.t !== 'n' || s.mines.some(m => m.sq === action.from)) return fail('Здесь нельзя поставить мину');
      if (!pay(15)) return fail('Мина стоит 15 золота');
      s.mines.push({ sq: action.from, owner: mover, expiresRound: s.round + 3 });
      events.push({ type: 'mine', sq: action.from });
    } else {
      if (special && !((special === 'nuke' && p.t === 'k') || (special === 'rocket' && p.t === 'q') || (special === 'catapult' && p.t === 'r'))) return fail('У этой фигуры нет такой спецатаки');
      if (special === 'nuke' && (s.nukeUsed[mover] || s.round < STRAT_NUKE.round)) return fail(`Ядерка: с раунда ${STRAT_NUKE.round}, один запуск на сторону`);
      const data = strategyRuleAttackData(st, p, action.from, special);
      if (!data.targets.has(action.to)) return fail('Цель вне дальности или перекрыта');
      if (action.aim && (!Number.isFinite(action.aim.x) || !Number.isFinite(action.aim.y)
        || action.aim.x < 0 || action.aim.x > 1 || action.aim.y < 0 || action.aim.y > 1)) return fail('Неверные координаты прицела');
      if (!pay(costFor(special === 'nuke' ? 'nuke' : 'attack'))) return fail('Не хватает золота на выстрел — пропусти или выбери другую фигуру');
      const aim = action.aim || { x: .5, y: .5 };
      const hit = special === 'nuke' || special === 'catapult' || (Math.abs(aim.x - .5) <= .34 && Math.abs(aim.y - .5) <= .4);
      events.push({ type: 'shot', from: action.from, to: action.to, special, hit });
      if (special === 'nuke') {
        s.nukeUsed[mover] = true;
        const area = strategyNukePreview(st, action.to);
        for (const cell of area) { const q = st.board[cell.sq]; if (q) strategyDealDamage(st, q, cell.damage, events, cell.sq); }
        strategyCleanup(st, events);
        const survivors = area.map(c => ({ sq: c.sq, id: st.board[c.sq]?.id })).filter(c => c.id != null);
        for (const c of survivors) { const sq = st.board.findIndex(q => q && q.id === c.id); if (sq >= 0) strategyRuleKnockback(st, sq, action.to, events); }
        s.rad.push({ sq: action.to, cells: area.filter(c => c.damage >= STRAT_NUKE.inner).map(c => c.sq), rounds: 3, createdRound: s.round });
      } else if (hit) {
        const target = st.board[action.to];
        if (target && target.c !== mover) {
          strategyDealDamage(st, target, strategyRuleDamage(st, p), events, action.to);
          if (special === 'rocket' || p.t === 'n') strategyRuleKnockback(st, action.to, action.from, events);
        }
        if (p.t === 'b') for (const [dx, dy] of [[-1,0],[1,0]]) {
          const x = action.to % st.W + dx, y = Math.floor(action.to / st.W) + dy;
          if (!inside(st, x, y)) continue;
          const sq = sqAt(st, x, y), q = st.board[sq]; if (q && q.c !== mover) strategyDealDamage(st, q, 6, events, sq);
        }
      }
    }
  } else return fail('Неизвестное действие');
  strategyCleanup(st, events);
  strategyRuleMines(st, events);
  if(st.status==='play') strategyAdvance(st, mover, events); else {s.seq++;st.plySeq=(st.plySeq||0)+1;}
  return { ok: true, mover, action: { ...action, color: mover, seq: s.seq }, seq: s.seq, events, result: st.result };
}
function strategyRuleMines(st, events) {
  const s = st.strategy;
  s.mines = s.mines.filter(m => m.expiresRound > s.round);
  for (let n = s.mines.length - 1; n >= 0; n--) {
    const m = s.mines[n];
    const sq = st.board.findIndex((p, i) => p && p.c !== m.owner && Math.max(Math.abs(i % st.W - m.sq % st.W), Math.abs(Math.floor(i / st.W) - Math.floor(m.sq / st.W))) <= 1);
    if (sq < 0) continue;
    strategyDealDamage(st, st.board[sq], 30, events, sq); s.mines.splice(n, 1);
    events.push({ type: 'mine-explosion', sq });
  }
  strategyCleanup(st, events);
}
function strategyBindState(st = ui.st) {
  if (!st || !st.flags.strategy) return null;
  const s = strategyEnsure(st);
  for (const [key, value] of Object.entries({ attacker: null, selected: null, special: null, targets: new Set(), aim: new Set(), preview: [], previewTarget: null, support: null, recruit: null, hand: [], radTimer: 0 })) {
    Object.defineProperty(s, key, { value, writable: true, configurable: true, enumerable: false });
  }
  ui.strategy = s; return s;
}
function strategyPerformAction(action, opts = {}) {
  const st = opts.state || ui.st;
  if (!st || !st.flags.strategy) return { ok: false, reason: 'Не Стратегия' };
  if (!opts.remote && !opts.replay && !opts.bot && (ui.viewPly !== ui.frames.length - 1 && !canBranchHere() || ui.paused || ui.gameLocked || ui.spectator
    || (ui.mode === 'online' && st.turn !== myColor()) || (ui.bot && st.turn === ui.bot.color))) return { ok: false, reason: 'Сейчас действие недоступно' };
  const result = strategyReduceAction(st, action);
  if (!result.ok) { if (!opts.silent && !opts.remote) toast(result.reason); return result; }
  if (st === ui.st) {
    strategyBindState(st); ui.selected = -1;
    if (typeof ui.onStrategyAction === 'function') ui.onStrategyAction(result, opts);
    else if (!opts.silent) { renderAll(false); strategyAnimateEvents(result.events); strategyRender(); if(st.status==='over')finishGame(st.result);else strategyScheduleBot(); }
  }
  return result;
}
function strategyReceiveAction(action, opts = {}) { return strategyPerformAction(action, { ...opts, remote: true }); }
function strategyScheduleBot() {
  const st = ui.st, seq = st?.strategy?.seq;
  if (!st || !ui.bot || st.turn !== ui.bot.color || st.status !== 'play') return;
  setTimeout(() => { if (ui.st === st && st.strategy.seq === seq) strategyMaybeBot(); }, 450);
}
function strategyChooseBotAction(st) {
  const s = strategyEnsure(st), color = st.turn;
  if (s.phase === 'move') {
    const moves = legalMoves(st, color).filter(m => strategyRuleCost(st, st.board[m.from], 'move', m.from) <= s.gold[color]);
    moves.sort((a, b) => (st.board[b.to] ? 10 : 0) - (st.board[a.to] ? 10 : 0)
      + (s.territory[a.to] === color ? 0 : 2) - (s.territory[b.to] === color ? 0 : 2)
      + (color === 'w' ? Math.floor(b.to/st.W)-Math.floor(a.to/st.W) : Math.floor(a.to/st.W)-Math.floor(b.to/st.W)));
    return moves.length ? { kind: 'move', ...moves[0] } : { kind: 'pass' };
  }
  const options = [];
  for (let from = 0; from < st.board.length; from++) {
    const p = st.board[from]; if (!p || p.c !== color) continue;
    for (const special of [null, ...(p.t === 'q' ? ['rocket'] : p.t === 'r' ? ['catapult'] : p.t === 'k' && !s.nukeUsed[color] && s.round >= STRAT_NUKE.round ? ['nuke'] : [])]) {
      if (strategyRuleCost(st, p, special === 'nuke' ? 'nuke' : 'attack', from) > s.gold[color]) continue;
      for (const to of strategyRuleAttackData(st, p, from, special).targets) {
        const q = st.board[to]; let score = q && q.c !== color ? strategyRuleDamage(st, p) + (q.t === 'k' ? 25 : 0) : 0;
        if (special === 'nuke') score = strategyNukePreview(st, to).reduce((n,c) => { const v=st.board[c.sq]; return n + (v ? Math.min(strategyPieceHp(st,v),c.damage)*(v.c===color?-1:1) : 0); },0);
        if (score > 0) options.push({ kind: 'attack', from, to, special, score });
      }
    }
  }
  options.sort((a,b)=>b.score-a.score);
  return options[0] || { kind: 'pass' };
}
function strategyMaybeBot() {
  const st = ui.st;
  if (!st || !ui.bot || st.turn !== ui.bot.color || st.status !== 'play' || ui.paused || ui.away || ui.gameLocked) return false;
  if (ui.mode === 'online' && ui.role !== 'host') return false;
  const result = strategyPerformAction(strategyChooseBotAction(st), { bot: true });
  if (!result.ok) strategyPerformAction({ kind: 'pass' }, { bot: true });
  ui.bot.busy = false; ui.botThinking = false; return true;
}
function strategyAimAt(sq, x = .5, y = .5, fire = false) {
  const s = ui.strategy, st = ui.st;
  if (!s || s.attacker == null) return { ok: false, reason: 'Сначала выбери стрелка' };
  s.preview = s.special === 'nuke' ? strategyNukePreview(st, sq) : [{ sq, damage: strategyRuleDamage(st, st.board[s.attacker]) }];
  strategyRenderPreview();
  const action = { kind: 'attack', from: s.attacker, to: sq, special: s.special, aim: { x, y } };
  if (fire) return strategyPerformAction(action);
  return { ok: s.targets.has(sq), hit: Math.abs(x-.5)<=.34 && Math.abs(y-.5)<=.4, action, cells: s.preview };
}
function strategyAnimateEvents(events) {
  for (const e of events) {
    if (e.type === 'shot') { strategyProjectile(e.from,e.to,e.special === 'nuke' ? '☢' : e.special === 'rocket' ? '🚀' : e.special === 'catapult' ? '🪨' : '•'); if(e.special==='nuke') strategyNuke(e.to); }
    if(e.type==='shot'&&!e.hit)strategyFloat(e.to,'МИМО','purple');
    if (e.type === 'damage') strategyFloat(e.sq, `-${e.amount}${e.absorbed ? ' 🛡' : ''}`, 'red');
    if (e.type === 'knockback' || e.type === 'knockout') strategyKnockbackFx(e);
    if (e.type === 'destroy') strategyBurst(e.sq, '#ff944b');
    if (e.type === 'mine-explosion') strategyBurst(e.sq, '#ff7b3b');
  }
}
function strategyKnockbackFx(e) {
  const layer = $('#brawlLayer'); if (!layer || !e.piece) return;
  const el = document.createElement('span'); el.className = 'strat-toss'; el.innerHTML = pieceSvg(e.piece.t);
  const a = strategyCellXY(e.from), b = e.to != null ? strategyCellXY(e.to) : { x: a.x + e.dx * ui.sq * 2, y: a.y + e.dy * ui.sq * 2 };
  el.style.left = a.x + 'px'; el.style.top = a.y + 'px'; el.style.width = ui.sq * .8 + 'px'; el.style.height = ui.sq * .8 + 'px';
  layer.appendChild(el);
  el.animate([{transform:'translate(-50%,-50%) scale(1.2,.7)'},{transform:`translate(${(b.x-a.x)/2- ui.sq*.4}px,${(b.y-a.y)/2-ui.sq}px) rotate(100deg) scale(1.05)`},{transform:`translate(${b.x-a.x-ui.sq*.4}px,${b.y-a.y-ui.sq*.4}px) rotate(240deg) scale(${e.type==='knockout'?'.05':'.8,1.15'})`,opacity:e.type==='knockout'?0:1}],{duration:650,easing:'ease-in-out'});
  setTimeout(()=>el.remove(),700);
}
function strategyRenderPreview() {
  const s = ui.strategy; if (!s) return;
  const board = $('#board'); if (!board) return;
  board.querySelectorAll('.strat-preview').forEach(el=>el.remove());
  for (const c of s.preview || []) {
    const pt = strategyCellXY(c.sq), el = document.createElement('span'); el.className = 'strat-preview';
    el.style.left = pt.x - ui.sq/2 + 'px'; el.style.top = pt.y - ui.sq/2 + 'px'; el.style.width = el.style.height = ui.sq + 'px'; el.textContent = `−${c.damage}`;
    board.appendChild(el);
  }
}
const STRAT_NAMES = {
  p: 'Пешка', b: 'Слон', n: 'Конь', r: 'Ладья', q: 'Ферзь', k: 'Король',
};

function strategyInit(st) {
  stopStrategy(); strategyBindState(st);
  document.documentElement.dataset.strategy = '1';
  $('#strategyBar')?.classList.remove('hidden');
  $('#stratInfoPanel')?.classList.remove('hidden');
  strategyUpdateInfo(st.board.find(p => p && p.c === st.turn));
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

function strategyDrawHand() { strategyRenderCards(); }

function strategyCanAct() {
  return !!(ui.st && ui.strategy && ui.st.status==='play' && !ui.paused && !ui.away && !ui.gameLocked && !ui.spectator && (!ui.bot || ui.st.turn!==ui.bot.color) && (ui.mode!=='online'||ui.st.turn===myColor()) && (ui.viewPly===ui.frames.length-1||canBranchHere()));
}
function strategyRender() {
  const st=viewState(), s=st?.strategy; if(!s)return;
  for(const c of ['w','b']) { const key=c.toUpperCase(); const f=$('#stratFaction'+key),g=$('#stratGold'+key); if(f)f.textContent=s.factions[c]; if(g)g.textContent=`${s.gold[c]}/${s.cap}`; $('#stratGoldBadge'+key)?.classList.toggle('active',st.turn===c); }
  const own=st.turn,can=strategyCanAct(),phase=s.phase==='move'?'Манёвры':'Атака';
  $('#stratPhase').textContent=`Раунд ${s.round} · ${phase}`;
  $('#stratAction').textContent=`${own==='w'?'Белые':'Чёрные'}: ${s.phase==='move'?'передвинь фигуру, вызови подкрепление или развивай страну':'выбери стрелка, затем прицелься в подсвеченную клетку'}${s.nextRepeat?' · далее повтор этой фазы!':''}`;
  $('#stratAction').classList.toggle('attack',s.phase==='attack');
  $('#stratSkipMove').classList.toggle('hidden',s.phase!=='move'); $('#stratSkipAttack').classList.toggle('hidden',s.phase!=='attack');
  $('#stratSkipMove').textContent='Пропустить (+6)'; $('#stratSkipAttack').textContent='Пропустить (+3)';
  for(const id of ['stratSkipMove','stratSkipAttack'])$('#'+id).disabled=!can;
  for(const [id,key] of [['stratX2','income'],['stratPlus','arsenal'],['stratCap','logistics']]){
    const el=$('#'+id),meta=STRAT_UPGRADES[key],level=s.upgrades[own][key],cost=meta.base+level*15;if(!el)continue;
    el.textContent=`${meta.name} ${level}/${meta.max} · ${cost}💰`;el.disabled=!can||level>=meta.max||s.gold[own]<cost;
    el.title=key==='income'?'Доход +4 за раунд. Занимает действие.':key==='arsenal'?'Урон всех бойцов +4. Занимает действие.':'Стоимость движения −15%. Занимает действие.';
  }
  let timeline=$('#strategyTimeline');if(!timeline){timeline=document.createElement('div');timeline.id='strategyTimeline';timeline.className='strat-timeline';$('#strategyBar').appendChild(timeline);}
  timeline.innerHTML=['Белые: шаг','Чёрные: шаг','Белые: атака','Чёрные: атака'].map((v,i)=>`<span class="${i===(s.phase==='move'?0:2)+s.phaseSide?'active':''}">${v}</span>`).join('');
  const sp=$('#stratSpecial'),atk=ui.strategy.attacker!=null?ui.st.board[ui.strategy.attacker]:null;
  if(sp){const labels={n:'💣 Мина · 15',r:'🪨 Катапульта',q:'🚀 Ракета',k:'☢ Ядерка · 120'};sp.textContent=atk?labels[atk.t]||'Нет спецатаки':'Спецатака';sp.disabled=!can||s.phase!=='attack'||!atk||!labels[atk.t]||(atk.t==='k'&&(s.nukeUsed[own]||s.round<STRAT_NUKE.round||s.gold[own]<120));sp.classList.toggle('active',!!ui.strategy.special);}
  strategyRenderCards();
}
function strategyRenderCards() {
  const box=$('#stratCards'),st=ui.st,s=ui.strategy;if(!box||!s)return;box.innerHTML='';
  const can=strategyCanAct(),color=st.turn;
  const info=document.createElement('p');info.className='strat-economy';info.textContent=`Доход +${strategyRuleIncome(st,color)} / раунд · ядерка ${s.nukeUsed[color]?'использована':s.round<5?'с 5-го раунда':'готова при 120💰'} · каждое улучшение занимает действие.`;box.appendChild(info);
  for(const [kind,text,cost] of [['heal','💚 Ремонт +25 HP',20],['shield','🛡 Щит +30',25]]){
    const b=document.createElement('button');b.type='button';b.className='strat-card support';b.textContent=`${text} · ${cost}💰`;b.disabled=!can||s.gold[color]<cost;b.onclick=()=>{s.recruit=null;s.support=s.support===kind?null:kind;toast(s.support?'Нажми свою фигуру для поддержки':'Поддержка отменена');renderSquares();};box.appendChild(b);
  }
  if(s.phase==='move')for(const [type,cost] of Object.entries({p:12,b:26,n:28,r:46,q:65})){
    const b=document.createElement('button');b.type='button';b.className='strat-recruit'+(s.recruit===type?' active':'');b.innerHTML=`${pieceSvg(type)}<span>${STRAT_NAMES[type]} · ${cost}💰</span>`;b.disabled=!can||s.gold[color]<cost;b.onclick=()=>{s.support=null;s.recruit=s.recruit===type?null:type;toast(s.recruit?'Выбери пустую захваченную клетку':'Подкрепление отменено');renderSquares();strategyRenderCards();};box.appendChild(b);
  }
}
function strategyUpdateInfo(p) {
  const st=ui.st,s=st?.strategy;if(!p||!s)return;const m=STRAT[p.t],sq=st.board.findIndex(q=>q?.id===p.id);
  $('#sipFaction').textContent=s.factions[p.c];$('#sipGlyph').innerHTML=pieceSvg(p.t);$('#sipName').textContent=STRAT_NAMES[p.t];
  $('#sipHp').textContent=`${strategyPieceHp(st,p)}/${m.hp} HP${s.shield[p.id]?' · щит '+s.shield[p.id]:''}`;
  $('#sipMoveCost').textContent=strategyRuleCost(st,p,'move',sq);$('#sipAtkCost').textContent=strategyRuleCost(st,p,'attack',sq);$('#sipDmg').textContent=strategyRuleDamage(st,p);
  $('#sipDesc').textContent={p:'Прямой выстрел: 4 клетки до первого движения, потом 2. Фигуры заслоняют линию.',b:'Диагональный выстрел и осколки по соседям цели.',n:'Прыжок с отбрасыванием. Мина живёт 3 раунда.',r:'Прямая стрельба; катапульта на 2–6 клеток через препятствия.',q:'Линейный выстрел; ракета перелетает препятствия и отбрасывает.',k:'Штаб. Ядерный удар с раунда 5, 120 золота, один на сторону. Задевает и своих.'}[p.t];
}
function strategyShowPieceCard(p) { strategyUpdateInfo(p); }
function strategyTerritory() { return ui.st?.strategy?.territory||{}; }
function strategyRenderTerritory() {}

function strategyAttackData(p, sq) {
  return strategyRuleAttackData(ui.st, p, sq, ui.strategy?.special || null);
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
  const st = ui.st, s = ui.strategy;
  if (!s || st.status !== 'play' || ui.gameLocked || ui.paused || ui.spectator) return;
  if ((ui.bot && st.turn === ui.bot.color) || (ui.mode === 'online' && st.turn !== myColor())) return;
  const p = st.board[sq];
  if (p) strategyUpdateInfo(p);
  if (s.recruit) { strategyPerformAction({kind:'deploy',piece:s.recruit,to:sq}); return; }
  if (s.support) {
    const result = strategyPerformAction({kind:'support', support:s.support, to:sq});
    if (result.ok) s.support = null;
    return;
  }
  if (s.phase === 'attack') {
    if (p && p.c === st.turn && s.special !== 'nuke') { strategySelectAttacker(sq); return; }
    if (s.attacker != null && s.targets.has(sq)) {
      const point = ui.aimPoint?.sq === sq ? ui.aimPoint : {x:.5,y:.5};
      if (s.special === 'nuke' && s.previewTarget !== sq) {
        s.previewTarget = sq; strategyAimAt(sq,point.x,point.y); toast('Ядерный удар: зона показана. Нажми эту клетку ещё раз для запуска.'); return;
      }
      strategyAimAt(sq,point.x,point.y,true); return;
    }
    toast('Выбери подсвеченную цель. Серые клетки перекрыты или вне дальности.'); return;
  }
  if (ui.selected >= 0 && ui.selected !== sq) {
    const candidates = legalMoves(st, st.turn).filter(m=>m.from===ui.selected && m.to===sq);
    if (candidates.length) { strategyPerformAction({kind:'move', ...candidates.find(m=>!m.promo||m.promo==='q')||candidates[0]}); return; }
  }
  if (p && p.c === st.turn) {
    ui.selected=sq; strategyShowPieceCard(p); renderSquares(); renderHints();
  } else { ui.selected=-1; renderSquares(); }
}

function strategyMelee(from, to) { return strategyPerformAction({ kind: 'move', from, to }); }


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
  const midY = ['🚀','🪨','☢'].includes(icon) ? Math.min(a.y,b.y)-46 : (a.y+b.y)/2;
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
  if(profile.calm || matchMedia('(prefers-reduced-motion: reduce)').matches){strategyFloat(sq,'☢','rad');return;}
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

function strategyPlaceMine() { return strategyPerformAction({kind:'mine',from:ui.strategy?.attacker}); }
function strategyCheckMines() {}
function strategyRadiationTick() {}

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

function strategyAttack(from, to, aim = { x: .5, y: .5 }) {
  return strategyPerformAction({ kind: 'attack', from, to, special: ui.strategy?.special || null, aim });
}

function strategyDamage(piece, dmg) {
  const events=[]; const sq=ui.st.board.indexOf(piece);
  const died=strategyDealDamage(ui.st,piece,dmg,events,sq);
  strategyCleanup(ui.st,events); return died;
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

function strategyUseSupport(kind,sq) { return strategyPerformAction({kind:'support',support:kind,to:sq}); }

function strategyPrepareAttack() { strategyRender(); strategyScheduleBot(); }
/* Legacy commitMove integration must be replaced with strategyPerformAction.
   Do not advance a second time if an old delayed callback is still queued. */
function strategyAfterMove() { strategyRender(); strategyScheduleBot(); }
function strategyEndTurn() { return strategyPerformAction({ kind: 'pass' }); }
function strategyBotAttack() { return strategyMaybeBot(); }

/* ─────────── Clash Brawl: serializable deterministic action model ─────────── */
function brawlEnsure(st) {
  if (!st || !st.flags.clashBrawl) return null;
  const s = st.brawl || (st.brawl = {});
  if (!s.elixir) {
    Object.assign(s, { version: 84, plies: s.plies || 0, seq: 0, phase: 'develop', maxByColor: { w: 16, b: 16 }, max: 16,
      elixir: { w: 8, b: 8 }, income: { w: 3, b: 3 }, power: { w: 0, b: 0 },
      decks: { w: brawlDeck(), b: brawlDeck() }, shieldTurns: { w: 0, b: 0 }, hp: { w: 50, b: 50 },
      draft: null, stage: 'main', offer: [], prepared: -1, nextPiece: 1, ranked: false });
    s.selected = null;
  }
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (p && p.hp == null) st.board[i] = { ...p, hp: BRAWL_HP[p.t], maxHp: BRAWL_HP[p.t] };
  }
  if (s.prepared !== s.plies && !s.draft) brawlPrepareTurn(st);
  return s;
}
function brawlPrepareTurn(st) {
  const s = st.brawl;
  s.prepared = s.plies;
  s.selected = null;
  s.offer = [];
  if (stateRandom(st) < 0.5) {
    const pool = Object.keys(BRAWL_UPGRADES);
    while (s.offer.length < 3) s.offer.push(pool.splice(Math.floor(stateRandom(st) * pool.length), 1)[0]);
  }
  s.stage = s.offer.length ? 'upgrade' : 'main';
  s.phase = s.plies < 6 ? 'develop' : 'battle';
}
function brawlDraftPool() {
  return ['p', 'p', 'b', 'n', 'r', 'q'].map((t, i) => ({ id: String(i), slot: String(i), t }));
}
function brawlActionFail(reason) { return { ok: false, reason }; }
/** Pure DOM-free reducer. opts.color must be the authenticated actor on remote calls. */
function brawlApplyAction(st, action, opts = {}) {
  const s = brawlEnsure(st);
  if (!s || !action || st.status !== 'play') return brawlActionFail('Партия недоступна');
  const mover = s.draft ? s.draft.turn : st.turn;
  if (opts.color && opts.color !== mover) return brawlActionFail('Сейчас очередь соперника');
  if (action.seq != null && action.seq !== s.seq) return brawlActionFail('Устаревшее действие');
  const result = { ok: true, action: { ...action }, mover, consumed: false, events: [], record: null };
  if (action.type === 'draft-start') {
    if (s.plies || s.draft || s.ranked) return brawlActionFail('Драфт доступен только до первого действия');
    s.draft = { turn: st.turn, first: st.turn, step: 'ban', bans: { w: [], b: [] }, picks: { w: [], b: [] }, pools: { w: brawlDraftPool(), b: brawlDraftPool() } };
    s.ranked = true;
  } else if (action.type === 'draft-card') {
    const d = s.draft;
    if (!d) return brawlActionFail('Драфт не идёт');
    const target = d.step === 'ban' ? other(mover) : mover;
    const pool = d.pools[target];
    const card = pool.find((c) => c.id === action.id);
    if (!card) return brawlActionFail('Карта недоступна');
    d.pools[target] = pool.filter((c) => c.id !== card.id);
    if (d.step === 'ban') {
      d.bans[target].push(card.t);
      d.turn = other(mover); st.turn=d.turn;
      if (d.turn === d.first) d.step = 'pick';
    } else {
      d.picks[mover].push(card.t);
      const next = other(mover);
      d.turn = d.picks[next].length < 4 ? next : mover; st.turn=d.turn;
      if (d.picks.w.length === 4 && d.picks.b.length === 4) {
        s.decks = { w: d.picks.w.map((t) => ({ t, cost: BRAWL_COST[t] })), b: d.picks.b.map((t) => ({ t, cost: BRAWL_COST[t] })) };
        s.draftResult = { bans: d.bans, picks: d.picks };
        st.turn=d.first; s.draft = null;
      }
    }
  } else if (s.draft) return brawlActionFail('Сначала завершите баны и пики');
  else if (action.type === 'upgrade') {
    if (s.stage !== 'upgrade') return brawlActionFail('Сейчас нет выбора усиления');
    if (action.kind != null) {
      const u = BRAWL_UPGRADES[action.kind];
      if (!u || !s.offer.includes(action.kind)) return brawlActionFail('Усиление не предложено');
      if (s.elixir[mover] < u.cost) return brawlActionFail('Не хватает эликсира; можно отказаться');
      if (action.kind === 'economy' && s.income[mover] >= 6) return brawlActionFail('Генератор уже максимальный');
      if (action.kind === 'reserve' && s.maxByColor[mover] >= 28) return brawlActionFail('Резерв уже максимальный');
      s.elixir[mover] -= u.cost;
      if (action.kind === 'power') s.power[mover] += 2;
      if (action.kind === 'heal') st.board = st.board.map((p) => p && p.c === mover ? { ...p, hp: Math.min(p.maxHp || BRAWL_HP[p.t], p.hp + 8) } : p);
      if (action.kind === 'shield') s.shieldTurns[mover] = 1;
      if (action.kind === 'economy') s.income[mover]++;
      if (action.kind === 'reserve') s.maxByColor[mover] += 4;
      result.events.push({ type: 'upgrade', kind: action.kind });
    }
    s.stage = 'main'; s.offer = [];
  } else {
    if (s.stage !== 'main') return brawlActionFail('Выберите усиление или нажмите «Без усиления»');
    if (action.type === 'deploy') {
      const sq = action.to;
      const card = s.decks[mover][action.card];
      if (!Number.isInteger(sq) || sq < 0 || sq >= st.board.length || st.board[sq]) return brawlActionFail('Выберите свободную клетку');
      if (!brawlDeploymentCell(st, sq, mover)) return brawlActionFail('Высадка только на своей половине');
      if (!card || s.elixir[mover] < card.cost) return brawlActionFail('Не хватает эликсира на фигуру');
      s.elixir[mover] -= card.cost;
      let id = 840000000 + s.nextPiece++;
      while (st.board.some((p) => p && p.id === id)) id = 840000000 + s.nextPiece++;
      st.board[sq] = { t: card.t, c: mover, id, used: 0, hp: BRAWL_HP[card.t], maxHp: BRAWL_HP[card.t] };
      result.record = { san: `${card.t.toUpperCase()}@${sqName(st, sq)}`, from: -1, to: sq, captured: false };
      result.events.push({ type: 'deploy', to: sq, piece: { ...st.board[sq] } });
    } else if (action.type === 'move') {
      const match = legalMoves(st).find((m) => m.from === action.from && m.to === action.to && (m.promo || null) === (action.promo || null));
      if (!match || match.ep) return brawlActionFail('Такое действие недоступно');
      const p = st.board[match.from];
      const victim = st.board[match.to];
      const undo = applyMove(st, match);
      result.record = { san: `${BRAWL_NAME[p.t]} ${sqName(st, match.from)}${victim ? ' ⚔ ' : ' → '}${sqName(st, match.to)}`, from: match.from, to: match.to, promo: match.promo || null, captured: !!victim && !(undo.damage && undo.damage.survived) };
      result.events.push({ type: victim ? 'hit' : 'move', from: match.from, to: match.to, damage: undo.damage || null, victim: victim ? { ...victim } : null });
    } else if (action.type === 'pass') {
      s.elixir[mover] = Math.min(s.maxByColor[mover], s.elixir[mover] + 1);
      result.record = { san: 'Пропуск (+1 эликсир)', from: -1, to: -1, captured: false };
    } else return brawlActionFail('Неизвестное действие');
    if (action.type !== 'move') { st.plySeq = (st.plySeq || 0) + 1; if (mover === 'b') st.full++; }
    st.turn = other(mover); st.ep = -1; st.check = false;
    s.plies++; s.phase = s.plies < 6 ? 'develop' : 'battle';
    s.selected = null;
    s.shieldTurns[st.turn] = 0;
    s.elixir[st.turn] = Math.min(s.maxByColor[st.turn], s.elixir[st.turn] + s.income[st.turn]);
    result.consumed = true;
    result.record.color = mover;
    updateStatus(st);
    if (st.status === 'play') brawlPrepareTurn(st);
    else { s.stage = 'over'; result.events.push({ type: 'king-explosion', color: other(st.result.winner) }); }
  }
  s.seq++;
  result.seq = s.seq;
  result.ply = s.plies;
  return result;
}
function brawlDeploymentCell(st, sq, color) {
  const y = Math.floor(sq / st.W), mid = Math.ceil(st.H / 2);
  return color === 'w' ? y < mid : y >= mid;
}
function brawlBotAction(st) {
  const s = brawlEnsure(st), color = s.draft ? s.draft.turn : st.turn;
  if (s.draft) {
    const d = s.draft, pool = d.pools[d.step === 'ban' ? other(color) : color];
    const ranked = pool.slice().sort((a, b) => (d.step === 'ban' ? BRAWL_POINTS[b.t] - BRAWL_POINTS[a.t] : Math.abs(BRAWL_COST[a.t] - 6) - Math.abs(BRAWL_COST[b.t] - 6)));
    return { type: 'draft-card', id: ranked[0].id };
  }
  if (s.stage === 'upgrade') {
    const affordable = s.offer.filter((k) => s.elixir[color] >= BRAWL_UPGRADES[k].cost && (k !== 'economy' || s.income[color] < 6) && (k !== 'reserve' || s.maxByColor[color] < 28));
    const kind = affordable.find((k) => k === 'economy') || (s.elixir[color] >= 10 ? affordable[0] : null);
    return { type: 'upgrade', kind: kind || null };
  }
  const moves = legalMoves(st).filter((m) => !m.ep);
  const captures = moves.filter((m) => st.board[m.to]).sort((a, b) => BRAWL_POINTS[st.board[b.to].t] - BRAWL_POINTS[st.board[a.to].t]);
  if (captures.length) return { type: 'move', from: captures[0].from, to: captures[0].to, promo: captures[0].promo };
  const ready = s.decks[color].map((card, i) => ({ card, i })).filter(({card}) => card.cost <= s.elixir[color]);
  ready.sort((a,b) => b.card.cost - a.card.cost);
  const cells = st.board.map((p,i) => !p && brawlDeploymentCell(st,i,color) ? i : -1).filter((i) => i >= 0);
  cells.sort((a,b) => (color === 'w' ? b-a : a-b));
  if (ready.length && cells.length && st.board.filter((p) => p && p.c === color).length < 15) return { type:'deploy', card:ready[0].i, to:cells[0] };
  if (moves.length) {
    moves.sort((a,b) => { const advance = (m) => (Math.floor(m.to/st.W)-Math.floor(m.from/st.W))*(color==='w'?1:-1); return advance(b)-advance(a); });
    return { type:'move', from:moves[0].from,to:moves[0].to,promo:moves[0].promo };
  }
  return {type:'pass'};
}
function brawlSubmitAction(action, opts = {}) {
  const st = ui.st;
  if (!st || (!opts.remote && (ui.gameLocked || ui.paused || ui.away || ui.spectator || (ui.viewPly!==ui.frames.length-1&&!canBranchHere())))) return false;
  const s = brawlEnsure(st), actor = s.draft ? s.draft.turn : st.turn;
  if (!opts.remote && !opts.bot && ui.bot && actor === ui.bot.color) return false;
  if (!opts.remote && ui.mode === 'online' && actor !== myColor()) return false;
  const result = brawlApplyAction(st, action, {color:actor});
  if (!result.ok) { toast(result.reason); return false; }
  ui.brawl = st.brawl;
  if (typeof ui.onBrawlAction === 'function') ui.onBrawlAction(result, opts);
  else {
    if (result.consumed) { ui.moves.push({...result.record, at:Date.now(),spent:0}); ui.frames.push(snap(st)); ui.viewPly=ui.frames.length-1; }
    renderAll(false); renderBrawl(); renderBrawlDraft();
    if (st.status === 'over') finishGame(st.result);
    if (ui.bot && st.status === 'play') setTimeout(brawlRunBot,250);
  }
  return true;
}
function startBrawlDraft(explicit = false) { if (explicit) return brawlSubmitAction({type:'draft-start'}); renderBrawl(); return false; }
function draftColorName(c) { return c === 'w' ? 'Белые' : 'Чёрные'; }
function renderBrawlDraft() {
  const s = ui.st && brawlEnsure(ui.st), d = s && s.draft, overlay = $('#brawlDraft');
  if (!overlay) return;
  overlay.classList.toggle('hidden',!d);
  if (!d) return;
  $('#bdTitle').textContent = 'Ранговый драфт';
  $('#bdStatus').textContent = `${draftColorName(d.turn)}: ${d.step==='ban'?'запретите одну карту СОПЕРНИКУ':'выберите карту СЕБЕ'} · пики ${d.picks[d.turn].length}/4`;
  $('#bdProtected').textContent = 'Бан каждой стороны → поочерёдно 4 пика. Цвета и первый ход не меняются.';
  const target = d.step==='ban'?other(d.turn):d.turn;
  $('#bdPool').innerHTML='';
  for (const c of d.pools[target]) {
    const el=document.createElement('button');el.type='button';el.className='brawl-card';
    el.innerHTML=`${pieceSvg(c.t)}<b>${BRAWL_NAME[c.t]}</b><small>${BRAWL_COST[c.t]} 💜 · ${BRAWL_HP[c.t]} HP</small>`;
    el.onclick=()=>brawlDraftCard(c.id); $('#bdPool').appendChild(el);
  }
  $('#bdDecks').textContent=['w','b'].map((c)=>`${draftColorName(c)}: ${d.picks[c].map((t)=>BRAWL_NAME[t]).join(', ')||'—'}`).join(' | ');
}
function brawlDraftCard(id) { return brawlSubmitAction({type:'draft-card',id}); }
function draftBotTurn() { brawlRunBot(); }
function brawlBotPickCard(color, elixir) { const s=ui.st&&brawlEnsure(ui.st); return s?s.decks[color].findIndex((c)=>c.cost<=elixir):-1; }
function finishBrawlDraft() { renderBrawlDraft(); }
function autoBrawlDraft() { for(let i=0;ui.st&&ui.st.brawl.draft&&i<12;i++){const r=brawlApplyAction(ui.st,brawlBotAction(ui.st));if(!r.ok)break;} ui.brawl=ui.st.brawl;renderAll(false);renderBrawl();renderBrawlDraft(); }

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
  // Заражение идёт только на ходу белых (таймер медиков).
  if (st.turn !== 'w') { renderZombieHud(); return; }
  const now = performance.now();
  const candidates = [];
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p || p.c !== 'w') continue;
    const enemies = zombieNeighbors(st, i).map((s) => st.board[s]).filter((q) => q && q.c === 'b');
    if (!enemies.length) continue;
    let delay = 3000;
    if (p.special === 'redqueen') delay = 6000;
    if (enemies.some((q) => q.special === 'bluequeen')) delay = Math.min(delay, 1500);
    const old = ui.zombie.infect[i];
    candidates.push({ sq: i, deadline: old ? old.deadline : now + delay });
  }
  // Не более двух очагов заражения одновременно.
  candidates.sort((a, b) => a.deadline - b.deadline);
  const next = {};
  for (const item of candidates.slice(0, 2)) next[item.sq] = { deadline: item.deadline };
  ui.zombie.infect = next;
  renderZombieHud();
}

function zombieTick() {
  if (!ui.zombie || !ui.st || ui.st.status !== 'play') return;
  // Таймер белых: на ходу чёрных заражение замирает, а не тикает.
  if (ui.paused || ui.away || ui.gameLocked || ui.screen !== 'game' || ui.st.turn !== 'w') {
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
  const kings = ['w', 'b'].map((c) => findKing(st, c)).filter((i) => i >= 0);
  const insideZone = (i, x0, y0, x1, y1) => {
    const x = fileOf(st, i), y = rankOf(st, i);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const options = [];
  if (z.x1 - z.x0 > 2) options.push(0, 1);
  if (z.y1 - z.y0 > 2) options.push(2, 3);
  if (!options.length) return;
  // Не сжимаем сторону, которая сразу выкинула бы живого короля за границу.
  const safe = options.filter((side) => {
    const box = { x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 };
    if (side === 0) box.x0 += 1;
    else if (side === 1) box.x1 -= 1;
    else if (side === 2) box.y0 += 1;
    else box.y1 -= 1;
    return kings.every((k) => insideZone(k, box.x0, box.y0, box.x1, box.y1));
  });
  const pool = safe.length ? safe : options;
  const side = pool[Math.floor((st.seed + z.plies * 7) % pool.length)];
  if (side === 0) z.x0 += 1;
  else if (side === 1) z.x1 -= 1;
  else if (side === 2) z.y0 += 1;
  else z.y1 -= 1;
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
  stopBrawl(); ui.brawl = brawlEnsure(st);
  document.documentElement.dataset.brawl = '1'; $('#brawlPanel').classList.remove('hidden');
  renderBrawl(); renderBrawlDraft();
}
function stopBrawl() {
  if (ui.brawl?.timer) clearInterval(ui.brawl.timer);
  $('#brawlDraft')?.classList.add('hidden'); ui.brawl = null;
  document.documentElement.dataset.brawl = '0'; $('#brawlPanel')?.classList.add('hidden');
  const layer=$('#brawlLayer'); if(layer) layer.innerHTML='';
}
function brawlBindState(st=ui.st) { if(!st?.flags.clashBrawl)return; ui.brawl=brawlEnsure(st); ui.brawl.selected=null; }
function brawlColor() { return ui.mode==='online' ? myColor() : (ui.st?.brawl?.draft?.turn || ui.st?.turn || 'w'); }
function brawlCanAct() { const st=ui.st,s=st?.brawl,actor=s?.draft?.turn||st?.turn; return !!(s&&st.status==='play'&&!ui.paused&&!ui.away&&!ui.gameLocked&&!ui.spectator&&(ui.mode!=='online'||actor===myColor())&&(!ui.bot||actor!==ui.bot.color)); }
function brawlCanDeploy(sq,color) { const st=ui.st,s=st?.brawl; return !!(s&&s.stage==='main'&&!s.draft&&s.selected!=null&&!st.board[sq]&&brawlDeploymentCell(st,sq,color)); }
function renderBrawl() {
  const st=ui.st,s=st?.brawl; if(!s)return; ui.brawl=s;
  const color=brawlColor(),actor=s.draft?s.draft.turn:st.turn, can=brawlCanAct();
  const panel=$('#brawlPanel'); if(!panel)return;
  panel.classList.add('brawl-v84');
  let guidance=panel.querySelector('.brawl-guidance');
  if(!guidance){guidance=document.createElement('div');guidance.className='brawl-guidance';panel.prepend(guidance);}
  guidance.textContent=`${actor==='w'?'Белые':'Чёрные'} · ${s.plies<6?`Развитие ${s.plies}/6 — граница закрыта`:'Бой — взорви короля'} · ${s.stage==='upgrade'?'Усиление или отказ → затем действие':'Поставь фигуру / походи / пропусти'}`;
  const fill=$('#brawlElixirFill'),num=$('#brawlElixirNum'),max=s.maxByColor[color];
  if(fill)fill.style.width=s.elixir[color]/max*100+'%';
  if(num)num.textContent=`${s.elixir[color]}/${max} · доход +${s.income[color]}/свой ход`;
  const shield=$('#brawlShield'); if(shield){shield.textContent='Пропустить (+1)';shield.disabled=!can||s.stage!=='main'||!!s.draft;}
  const ban=$('#brawlBan');if(ban){ban.textContent='Баны и пики';ban.disabled=!can||s.plies>0||s.ranked;}
  let upgrades=panel.querySelector('.brawl-upgrades');if(!upgrades){upgrades=document.createElement('div');upgrades.className='brawl-upgrades';panel.appendChild(upgrades);}
  upgrades.innerHTML='';upgrades.classList.toggle('hidden',s.stage!=='upgrade'||!!s.draft);
  if(s.stage==='upgrade'&&!s.draft){
    for(const key of s.offer){const meta=BRAWL_UPGRADES[key],btn=document.createElement('button');btn.type='button';btn.innerHTML=`<b>${meta.name} · ${meta.cost} 💜</b><small>${meta.text}</small>`;btn.disabled=!can||s.elixir[color]<meta.cost;btn.onclick=()=>brawlSubmitAction({type:'upgrade',kind:key});upgrades.appendChild(btn);}
    const skip=document.createElement('button');skip.type='button';skip.textContent='Без усиления → к действию';skip.disabled=!can;skip.onclick=()=>brawlSubmitAction({type:'upgrade',kind:null});upgrades.appendChild(skip);
  }
  const deck=$('#brawlDeck');if(deck){deck.innerHTML='';s.decks[color].forEach((card,index)=>{
    const btn=document.createElement('button');btn.type='button';btn.className='brawl-card'+(s.selected===index?' selected':'');btn.innerHTML=`<span class="brawl-card-cost">${card.cost}💜</span>${pieceSvg(card.t)}<span class="brawl-card-name">${BRAWL_NAME[card.t]}</span><small>${BRAWL_HP[card.t]} HP · ${BRAWL_ATK[card.t]+s.power[color]} урон</small>`;
    btn.disabled=!can||s.stage!=='main'||s.elixir[color]<card.cost||!!s.draft;
    btn.onclick=()=>{if(s.suppressCardClick){s.suppressCardClick=false;return;}s.selected=s.selected===index?null:index;renderBrawl();renderSquares();};
    btn.onpointerdown=e=>brawlCardDragStart(e,index);deck.appendChild(btn);
  });}
  renderBrawlHp();renderBrawlDraft();
}
function brawlFloat(sq,text,cls) { if(sq<0||!ui.st)return;const layer=$('#brawlLayer');if(!layer)return;const {dx,dy}=disp(ui.st,sq),el=document.createElement('span');el.className='floating-dmg '+(cls||'red');el.textContent=text;el.style.left=(dx+.5)*ui.sq+'px';el.style.top=(dy+.3)*ui.sq+'px';layer.appendChild(el);setTimeout(()=>el.remove(),1000); }
function renderBrawlHp() { const layer=$('#brawlLayer');if(!layer||!ui.st?.brawl)return;layer.querySelectorAll('.king-hp-bar,.king-hp-text').forEach(el=>el.remove()); }
function brawlHpBar(){return '';}
function brawlTrail(from,to) { if(to>=0)brawlFloat(to,'✨','purple'); }
function brawlYeet(st,sq,piece) { v84FunnyCapture([{type:piece.t,color:piece.c,square:sq}]); }
function openBrawlBan(){return startBrawlDraft(true);}
function brawlShieldAction(){return brawlSubmitAction({type:'pass'});}
function brawlTurnStart(){renderBrawl();}
function brawlCardDragStart(e,index){if(e.button!==0||!brawlCanAct()||ui.brawl.stage!=='main')return;ui.brawl.drag={index,x:e.clientX,y:e.clientY,active:false,pointerId:e.pointerId};}
function brawlCardDragMove(e){const d=ui.brawl?.drag;if(!d||e.pointerId!==d.pointerId)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6){d.active=true;ui.brawl.selected=d.index;renderSquares();}}
function brawlCardDragEnd(e){const s=ui.brawl,d=s?.drag;if(!d)return;s.drag=null;if(e.type==='pointercancel'||!d.active)return;s.suppressCardClick=true;const to=squareAtPoint(ui.st,e.clientX,e.clientY);if(to>=0)brawlDeploy(to);}
function brawlDeploy(to){if(ui.brawl?.selected==null)return false;return brawlSubmitAction({type:'deploy',card:ui.brawl.selected,to});}
function brawlRunBot(){const st=ui.st,s=st?.brawl,actor=s?.draft?.turn||st?.turn;if(!s||!ui.bot||actor!==ui.bot.color||st.status!=='play'||ui.paused||ui.away||ui.gameLocked)return false;return brawlSubmitAction(brawlBotAction(st),{bot:true});}
function brawlMaybeBot(){return brawlRunBot();}
function brawlBotTryDeploy(){return brawlRunBot();}
function brawlCheckDamage(){}
function brawlKingAttack(st,m){return brawlSubmitAction({type:'move',from:m.from,to:m.to,promo:m.promo});}
function brawlAfterMove(){}

function newGame(opts = {}) {
  if (ui.cancelDrag) ui.cancelDrag();
  stopBotWorker();
  clearTimeout(ui.specialBotTimer);
  stopImboGame();
  const pickedMode = modeById(opts.modeId || profile.modeId);
  const selectedMs = opts.timeMs != null ? opts.timeMs : profile.timeMs;
  const mode = pickedMode.flags.randomPick ? randomRealMode(selectedMs) : pickedMode;
  if (!modeAllowedForTime(mode, selectedMs)) {
    toast('Для «Клеш Бравла» и «Стратегии» выберите 3 минуты или больше, либо без ограничения.');
    return false;
  }
  ui.mateMood = null;
  ui.modePick = opts.modePick || pickedMode.id;
  if (mode.flags.ultraBalance && ((opts.mode || 'local') !== 'online' || opts.bot)) {
    opts.bot = { ...(opts.bot || {}), level: 'gm', color: 'b' };
    opts.side = 'w';
    opts.orientation = 'w';
  }
  const requestedSide = opts.side
    || (opts.bot && opts.bot.color ? other(opts.bot.color) : null)
    || profile.side;
  let playerSide = requestedSide === 'random' ? randomSide() : requestedSide;
  if (mode.flags.ultraBalance) playerSide = 'w';
  if (opts.spectator) playerSide = 'w';
  // одна точка истины: за кого играет этот клиент
  opts.side = playerSide;
  if (opts.bot) opts.bot = { ...opts.bot, color: opts.bot.color || other(playerSide) };
  if (mode.id === 'openIntent' && (opts.mode || 'local') !== 'online') {
    toast('Режим «Открытые намерения» работает только в онлайн-игре с живым соперником!');
    showScreen('online');
    return;
  }
  ui.rotated = false;
  ui.tableRotated = false;
  ui.reviewOnly = false;
  ui.reviewFrom = null;
  ui.training = null;
  ui.trainingSkipped = false;
  ui.persona = null;
  document.body.classList.remove('reviewing', 'training');
  const reviewShell = $('#gameShell');
  if (reviewShell) reviewShell.classList.remove('review-mode', 'training-on', 'paused');
  const trainingPanel = $('#trainingPanel');
  if (trainingPanel) trainingPanel.classList.add('hidden');
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
  document.documentElement.dataset.damage = (mode.flags.damage || mode.flags.damageKing) ? '1' : '0';
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
  if ((opts.mode || 'local') === 'online' && ui.online) ui.online.initialState = captureNetworkState(ui.st);
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
  if (mode.flags.clashBrawl) initBrawl(ui.st);
  else if (mode.flags.royalBattle) royalInit(ui.st);
  else stopRoyal();
  if (mode.flags.zombie) zombieInit(ui.st);
  else stopZombie();
  if (mode.flags.strategy) strategyInit(ui.st);
  else stopStrategy();
  ui.frames = [snap(ui.st)];
  ui.initialState = captureNetworkState(ui.st);
  if ((opts.mode || 'local') === 'online' && ui.online) ui.online.initialState = ui.initialState;
  ui.playerSide = playerSide;
  ui.orientation = opts.orientation || playerSide;
  if (mode.flags.inverted && (opts.mode || 'local') === 'local') ui.orientation = 'b';
  if (mode.flags.ultraBalance) ui.orientation = 'w';
  ui.mode = opts.mode || 'local';
  if (ui.mode === 'local' && !opts.bot && profile.flip && window.innerWidth < 1000) {
    if (profile.flipAll) ui.rotated = ui.st.turn !== ui.orientation;
    else ui.tableRotated = ui.st.turn !== ui.orientation;
    if (ui.tableRotated) $('#board').classList.add('board-rotated');
  }
  ui.role = opts.role || null;
  ui.spectator = !!opts.spectator;
  ui.bot = opts.bot
    ? {
      ...opts.bot,
      name: opts.bot.persona
        ? (opts.bot.name || (personaById(opts.bot.persona) || {}).title || 'Бот')
        : opts.bot.fake ? (opts.bot.name || 'Игрок') : ('Бот · ' + botLabel(opts.bot.level)),
    }
    : null;
  if (ui.bot && ui.bot.persona) {
    const persona = personaById(ui.bot.persona);
    ui.persona = {
      id: ui.bot.persona,
      anger: 16,
      throw: 0,
      skill: 2.4,
      cryUntil: 0,
      limeUntil: 0,
      rageUntil: 0,
      label: persona ? persona.title : '',
    };
  }
  ui.paused = false;
  ui.movedId = null;
  ui.gameLocked = false;
  ui.remoteSelected = -1;
  if ($('#pauseOverlay')) $('#pauseOverlay').classList.add('hidden');
  if ($('#railPause')) {
    $('#railPause').classList.remove('paused');
    $('#railPause').classList.toggle('hidden', (opts.mode || 'local') === 'online');
  }
  if ($('#mobPause')) $('#mobPause').textContent = '⏸';
  ui.botThinking = false;
  ui.imported = false;
  ui.startedAt = Date.now();
  const mySide = ui.spectator ? 'w' : (ui.playerSide || (mode.flags.ultraBalance ? 'w' : profile.side));
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
  if (mode.flags.clashBrawl) renderBrawl();
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
  if (st.flags.annihilate) bits.push('аннигиляция: квадраты 3×3 вокруг обоих полей');
  if (st.flags.ultraBalance) bits.push('ультрабаланс: бот-гроссмейстер');
  if (st.flags.clashBrawl) bits.push((st.brawl?.plies || 0) < 6 ? 'развитие: ' + (st.brawl?.plies || 0) + '/6 полуходов' : 'граница открыта');
  if (ui.online && ui.online.coop) bits.push(ui.online.role === 'host' ? 'друг ходит после бота' : 'ваш ход после бота');
  if (st.flags.kingFree) bits.push(st.flags.strategy?'штаб уничтожается по HP':'короля можно съесть');
  if (st.flags.kingOnlyLose) bits.push('один король — поражение');
  $('#gameMeta').innerHTML = `<b>${escapeHtml(st.mode.name)}</b><br>${escapeHtml(bits.join(' · '))}`;
}

function renderPlayers() {  const st = ui.st;
  if (!st) return;
  const me = myColor();
  const bottomColor = barOrientation() === 'w' ? 'w' : 'b';
  const topColor = other(bottomColor);
  const mySide = ui.playerSide || (ui.mode === 'online' ? (ui.role === 'host' ? 'w' : 'b') : me);

  const nameFor = (color) => {
    if (color === mySide) return profile.name;
    if (ui.mode === 'online' && ui.online && ui.online.names) {
      const n = ui.online.names[color];
      return (n && n.name) || (typeof n === 'string' ? n : '') || 'Соперник';
    }
    return (ui.names && ui.names[color] && ui.names[color].name) || 'Соперник';
  };
  const avatarFor = (color) => {
    if (color === mySide) return profile.avatar;
    if (ui.mode === 'online' && ui.online && ui.online.avatars) return ui.online.avatars[color] || 'k';
    return (ui.names && ui.names[color] && ui.names[color].avatar) || 'k';
  };

  const setBar = (bar, color) => {
    const nameEl = bar === 'top' ? $('#topName') : $('#bottomName');
    const roleEl = bar === 'top' ? $('#topRole') : $('#bottomRole');
    const avEl = bar === 'top' ? $('#topAvatar') : $('#bottomAvatar');
    nameEl.textContent = nameFor(color);
    const personaRant = ui.persona && ui.persona.id === 'tilter' && ui.bot && color === ui.bot.color;
    roleEl.innerHTML = (color === 'w' ? 'белые' : 'чёрные')
      + (personaRant ? ' <span class="bot-rant">##%@@&amp;??"!!!</span>' : '');
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
  const session = ui.online;
  const peerReady = !!session && !!session.p2p && session.p2p.links.some((l) => l.peerId);
  const ok = ui.mode === 'online' && session && (peerReady || session.connected);
  for (const id of ['#topLink', '#bottomLink']) {
    const el = $(id);
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('bad', !ok);
    el.title = ok ? (session.ping != null ? 'связь есть · ' + Math.round(session.ping) + ' мс' : 'связь есть') : 'восстанавливаем связь';
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
  renderMeta();
  updateNav();
  if (ui.training) renderTrainingAtPly();
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
  if (ui.training) {
    el.textContent = 'ОБУЧЕНИЕ';
    sub.textContent = `${ui.viewPly}/${ui.frames.length - 1} · разбор ходов и ошибок`;
    return;
  }
  if (ui.reviewOnly) {
    el.textContent = profile.language === 'en' ? 'Game review' : 'Просмотр партии';
    sub.textContent = `${ui.viewPly}/${ui.frames.length - 1} · ${modeName(st.mode)}`;
    return;
  }
  if (ui.imported) {
    el.textContent = profile.language === 'en' ? 'Imported game' : 'Импортированная партия';
    sub.textContent = profile.language === 'en' ? 'review and export · moves disabled' : 'просмотр и экспорт · ходы недоступны';
    return;
  }
  if (ui.viewPly !== ui.frames.length - 1 && ui.mode === 'local' && !ui.bot) {
    el.textContent = profile.language === 'en' ? 'Rewound' : 'Откат';
    sub.textContent = profile.language === 'en'
      ? `position after ${ui.viewPly} plies · play from here to branch`
      : `позиция после ${ui.viewPly}-го полухода · можно играть отсюда`;
    if (shell) shell.classList.toggle('check-alert', !!st.check && st.status === 'play');
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
  if (st.flags.strategy) { el.textContent=`${st.strategy.phase==='move'?'Манёвры':'Атака'} ${st.turn==='w'?'белых':'чёрных'}`; sub.textContent=`Раунд ${st.strategy.round} · штаб с HP`; return; }
  if (st.flags.clashBrawl) { el.textContent=`${st.turn==='w'?'Белые':'Чёрные'} · ${st.brawl.stage==='upgrade'?'усиление':st.brawl.plies<6?'развитие':'бой'}`;sub.textContent=st.brawl.plies<6?`${st.brawl.plies}/6 полуходов подготовки`:'Взорви короля';return; }
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
      draw: 'agreed draw', king: 'king captured', kingHp: 'king lost all HP', race: 'king reached the last rank',
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
    king: 'король съеден', kingHp: 'король потерял все ХП', race: 'король дошёл до верхнего ряда', center: 'король в центре',
    checks: 'три шаха', kingOnly: 'у соперника остался один король',
    abort: 'партия прервана',
  brawl: 'король побеждён',
  devoured: 'съедены все фигуры', race: 'время вышло — считаем взятия', raceKing: 'король добрался до края', idle: 'белые не сделали первый ход', monotony: 'монотонное повторение',
  queenLost: 'ферзь потерян', extreme: 'крайний перевес',
  };
  return map[res.reason] || res.reason;
}

/* ───────────────────────────── 9. ХОДЫ ────────────────────────────────── */

/* В локальной игре откат — игровая позиция: отсюда можно ходить и ветвить. */
function canBranchHere() {
  return ui.mode === 'local' && !ui.bot && !ui.reviewOnly && !ui.training && !ui.imported;
}

function onSquareClick(sq) {
  if (ui.spectator) return;
  if (ui.reviewOnly) { toast('Режим просмотра — ходы недоступны'); return; }
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
  if (ui.viewPly !== ui.frames.length - 1 && !canBranchHere()) return;
  if (!onlineCoachMayMove()) { toast('Друг ходит белыми после хода бота'); return; }
  const st = ui.st;
  if (ui.mode === 'online' && st.turn !== myColor()) return;
  if (st.turn !== myColor() && ui.mode !== 'local') return;

  if (st.flags.strategy) { strategyClick(sq); return; }

  const legal = getUiLegalMoves(st);
  const p = st.board[sq];

  /* Повторный клик по уже выбранной фигуре ничего не меняет: не перерисовываем
     доску и кружки, иначе анимация подсказок начинается заново. */
  if (p && p.c === st.turn && ui.selected === sq) return;

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
  if (st.flags.strategy) return strategyPerformAction({kind:'move',from:m.from,to:m.to,promo:m.promo}, opts).ok;
  if (st.flags.clashBrawl) return brawlSubmitAction({type:'move',from:m.from,to:m.to,promo:m.promo}, opts);
  const legal = legalMoves(st, st.turn);
  const match = legal.find((x) => x.from === m.from && x.to === m.to
    && (x.promo || null) === (m.promo || null)
    && (m.castle == null || !!x.castle === !!m.castle)
    && (m.swap == null || !!x.swap === !!m.swap));
  if (!match) return false;
  if (ui.cancelDrag) ui.cancelDrag();

  /* Новый ход из отката: будущая история больше не существует. */
  if (ui.mode === 'local' && !ui.bot && ui.viewPly < ui.frames.length - 1) {
    ui.frames = ui.frames.slice(0, ui.viewPly + 1);
    ui.moves = ui.moves.slice(0, ui.viewPly);
    ui.viewPly = ui.frames.length - 1;
    ui.st.status = 'play';
    ui.st.result = null;
    ui.st.lastCheckDamage = null;
    ui.scored = false;
    ui.endSquare = -1;
    const staleResult = $('#result');
    if (staleResult) staleResult.classList.add('hidden');
  }

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
  let capInfo = [];
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
  const undo = applyMove(st, match);
  const damageHit = undo.damage || null;
  if (damageHit && damageHit.survived) {
    capInfo = capInfo.filter((c) => c.square !== damageHit.square);
  }
  const explodedNow = !!st.exploded;
  const annihilatedNow = !!st.annihilated;
  if (st.flags.blocks) {
    const blockedSq = maybeBlock(st);
    if (blockedSq >= 0) {
      ui.blockFlash = blockedSq;
      setTimeout(() => { ui.blockFlash = -1; renderSquares(); }, 1200);
      if (!opts.silent) toast(`Клетка ${sqName(st, blockedSq)} заперта`);
    }
  }
  const captured = (!!match.capture || !!(match.caps && match.caps.length) || !!match.ep)
    && !(damageHit && damageHit.survived);
  ui.moves.push({
    san, from: match.from, to: match.to, color: mover, spent,
    clock: ui.clocks[mover], captured, promo: match.promo || null, at: Date.now(),
  });
  ui.lastMove = { from: match.from, to: match.to };
  ui.selected = -1;
  ui.remoteSelected = -1;
  ui.hint = null;
  ui.movedId = (!damageHit || !damageHit.survived) && st.board[match.to] ? st.board[match.to].id : null;
  const evalAfter = evaluateWhite(st);
  if (ui.persona) personaAfterMove(mover, evalBefore, evalAfter);
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
  /* Снимок делаем после updateStatus: в нём уже ХП короля от шаха и результат. */
  ui.frames.push(snap(st, { from: match.from, to: match.to }));
  ui.viewPly = ui.frames.length - 1;
  if (ui.mode === 'online' && !opts.remote && !opts.silent) {
    netPublish({ t: 'move', from: match.from, to: match.to, promo: match.promo || null, cw: ui.clocks.w, cb: ui.clocks.b });
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
    if (damageHit) { sound.capture(); buzz([10, 20, 10]); }
    else if (captured) { sound.capture(); buzz([12, 24, 12]); }
    else { sound.move(); buzz(8); }
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
    if (st.flags.annihilate && annihilatedNow) {
      annihilationFx(st, undo.annihilationCells || [match.from, match.to, ...undo.removed.map((r) => r.sq)]);
    }
    if (capInfo.length) {
      captureFx(capInfo);
      /* Частицы телефонной версии теперь работают и на ПК, независимо от «Эпично». */
      if (!profile.calm && !capInfo.some((c) => c.type === 'q')) {
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
    if (damageHit) {
      damageFx(damageHit.square, damageHit.dmg, damageHit.survived, damageHit.type);
    }
    if (st.lastCheckDamage) {
      const checkHit = st.lastCheckDamage;
      st.lastCheckDamage = null;
      damageFx(checkHit.square, 1, true, 'k');
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

  if (res) {
    // Для обычного хода доска уже перерисована выше. Повторный renderAll
    // стирал бы только что запущенные анимации взятия/короля.
    if (!ui.replaying) {
      if (opts.silent || opts.remote) renderAll(false);
      finishGame(res);
    }
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
  king: 'король съеден', kingHp: 'король потерял все ХП', race: 'король на вершине', center: 'король в центре',
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
  if (ui.cancelDrag) ui.cancelDrag();
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
  if (!opts.delayed && (res.reason === 'mate' || res.reason === 'stalemate' || res.reason === 'king' || res.reason === 'kingHp')) {
    if (ui.endTimer) return;
    const kingEnd = res.reason === 'king' || res.reason === 'kingHp';
    const loser = res.winner ? other(res.winner) : ui.st.turn;
    ui.endSquare = kingEnd ? -1 : findKing(ui.st, loser);
    ui.endReason = res.reason;
    ui.st.status = 'over';
    ui.st.result = res;
    renderSquares();
    if (res.reason === 'mate') { renderPieces(false); mateKingWaves(ui.endSquare); if (typeof v84MateMood === 'function') v84MateMood(ui.endSquare); }
    const statusEl = $('#gameStatus');
    if (statusEl) statusEl.textContent = res.reason === 'mate' ? 'МАТ' : res.reason === 'stalemate' ? 'ПАТ' : res.reason === 'kingHp' ? 'КОРОЛЬ БЕЗ ХП' : 'КОРОЛЬ СНЯТ';
    const pause = kingEnd ? (profile.calm ? 600 : 1900) : 3000;
    ui.endTimer = setTimeout(() => {
      ui.endTimer = 0;
      ui.endSquare = -1;
      renderSquares();
      finishGame(res, { delayed: true });
    }, pause);
    return;
  }
  ui.scored = true;

  const st = ui.st;
  if (!st.result) st.result = res;
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
      game: buildGameJson(),
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
  lockResultCard();
  renderResultKings(res);
  if (res.reason !== 'abort') playResultFx(!res.winner ? 'draw' : res.winner === side ? 'win' : 'lose');
  renderTrainingCta();
  renderStatsIfOpen();
}

/* ───────────────────────── ОБУЧЕНИЕ ПОСЛЕ ПАРТИИ ─────────────────────── */

/* Первую секунду после мата/пата карточка результата «заморожена»:
   ни одна кнопка не срабатывает, закрыть её нельзя. Потом кнопки
   коротко вспыхивают и чуть увеличиваются — приглашение нажать. */
function lockResultCard() {
  const box = $('#result');
  if (!box) return;
  clearTimeout(ui.resultLockTimer);
  ui.resultLockTimer = 0;
  if (!profile.resultPause) {
    box.classList.remove('result-locked', 'result-ready');
    ui.resultLockedUntil = 0;
    return;
  }
  box.classList.remove('result-ready');
  box.classList.add('result-locked');
  ui.resultLockedUntil = performance.now() + 1000;
  ui.resultLockTimer = setTimeout(() => {
    ui.resultLockTimer = 0;
    ui.resultLockedUntil = 0;
    box.classList.remove('result-locked');
    box.classList.add('result-ready');
  }, 1000);
}

function trainingDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function trainingLeft() {
  const today = trainingDayKey();
  if (profile.trainingDate !== today) {
    profile.trainingDate = today;
    profile.trainingUsed = 0;
  }
  return Math.max(0, 3 - (Number(profile.trainingUsed) || 0));
}

function renderTrainingCta() {
  const row = $('#resultTrainingRow');
  if (!row) return;
  const can = !!(ui.st && ui.st.status === 'over' && ui.st.result
    && ui.st.result.reason !== 'abort' && ui.moves.length >= 2 && !ui.spectator && !ui.trainingSkipped && !ui.training);
  const left = trainingLeft();
  row.classList.toggle('hidden', !can);
  const btn = $('#resultTraining');
  const label = $('#trainingLeftLabel');
  if (btn) btn.disabled = left <= 0;
  if (label) label.textContent = `${left}/3`;
}

function trainingEval(frame) {
  if (!frame) return 0;
  try { return evaluateWhite({ ...ui.st, board: frame.board, turn: frame.turn }); } catch (error) { return 0; }
}

function trainingMoveText(mv, grade, bits) {
  const label = {
    best: 'Лучший ход', good: 'Хороший ход', inaccuracy: 'Неточность',
    mistake: 'Ошибка', blunder: 'Зевок',
  }[grade] || 'Ход';
  const extra = bits.length ? ` (${bits.join(', ')})` : '';
  const tail = {
    best: 'Позиция усилена, сопернику не за что зацепиться.',
    good: 'Спокойный и полезный ход, преимущество сохраняется.',
    inaccuracy: 'Соперник получает шанс перехватить инициативу.',
    mistake: 'Часть преимущества уходит — стоило поискать точнее.',
    blunder: 'Резкое ухудшение позиции: этот ход лучше было не делать.',
  }[grade] || '';
  return `${mv.san}${extra} — ${label}. ${tail}`;
}

function buildTrainingRows() {
  const rows = [];
  const W = ui.st ? ui.st.W : 8;
  for (let i = 0; i < ui.moves.length; i++) {
    const mv = ui.moves[i];
    const beforeFrame = ui.frames[i];
    const afterFrame = ui.frames[i + 1];
    if (!mv || !beforeFrame || !afterFrame) continue;
    const before = trainingEval(beforeFrame);
    const after = trainingEval(afterFrame);
    let loss = mv.color === 'w' ? Math.max(0, before - after) : Math.max(0, after - before);
    const state = { ...ui.st, board: beforeFrame.board, turn: beforeFrame.turn };
    try {
      const depth = ui.st.W * ui.st.H > 64 ? 1 : 2;
      const ranked = rankMoves(state, depth);
      if (ranked.length) {
        const best = ranked[0];
        const actual = ranked.find((row) => row.move.from === mv.from && row.move.to === mv.to
          && (row.move.promo || null) === (mv.promo || null));
        if (actual) loss = Math.max(loss, Math.max(0, best.score - actual.score));
      }
    } catch (error) { /* оставляем оценку по материалу */ }
    const p = beforeFrame.board[mv.from];
    const toX = mv.to % W;
    const toY = Math.floor(mv.to / W);
    // Ранние f/g-пешки и вылет ферзя — типичные ошибки дебюта, даже если материал цел.
    if (i < 8 && p && p.t === 'p' && (toX === 5 || toX === 6)) loss += 0.75;
    if (i < 8 && p && p.t === 'q' && !mv.captured) loss += 0.45;
    let grade = 'best';
    if (loss > 2.15) grade = 'blunder';
    else if (loss > 1.1) grade = 'mistake';
    else if (loss > 0.55) grade = 'inaccuracy';
    else if (loss > 0.2) grade = 'good';
    const x = toX;
    const y = toY;
    const bits = [];
    if (mv.captured) bits.push('взятие');
    if (mv.san && (mv.san.includes('+') || mv.san.includes('#'))) bits.push('шах');
    if (mv.san && mv.san.startsWith('O-O')) bits.push('рокировка');
    if (Math.abs(x - (W - 1) / 2) <= 1.1 && Math.abs(y - (ui.st.H - 1) / 2) <= 1.1) bits.push('центр');
    const white = Math.max(5, Math.min(95, 50 + after * 3.2));
    rows.push({
      ...mv, before, after, loss, grade, bits,
      white, black: 100 - white,
      text: trainingMoveText(mv, grade, bits),
    });
  }
  return rows;
}

function startTraining() {
  if (!ui.st || !ui.moves.length) { toast('Нужна партия хотя бы с двумя ходами'); return; }
  const left = trainingLeft();
  if (left <= 0) { toast('Обучение на сегодня закончилось — 3 из 3'); return; }
  profile.trainingUsed = (Number(profile.trainingUsed) || 0) + 1;
  saveProfile(true);
  const rows = buildTrainingRows();
  if (!rows.length) { toast('Не удалось разобрать ходы'); return; }
  ui.training = { rows, auto: 0, returnResult: true };
  ui.reviewOnly = true;
  ui.trainingSkipped = false;
  ui.running = false;
  clearInterval(ui.timer);
  ui.selected = -1;
  ui.viewPly = 0;
  $('#result').classList.add('hidden');
  const tPanel = $('#trainingPanel');
  if (tPanel) tPanel.classList.remove('collapsed');
  const tMin = $('#trainingMin');
  if (tMin) { tMin.textContent = '▾'; tMin.title = 'Свернуть'; tMin.setAttribute('aria-expanded', 'true'); }
  $('#trainingPanel').classList.remove('hidden');
  document.body.classList.add('training', 'reviewing');
  const shell = $('#gameShell');
  if (shell) shell.classList.add('training-on', 'review-mode');
  if (ui.screen !== 'game') showScreen('game');
  renderAll(false);
  renderMoves();
  updateNav();
  renderTrainingAtPly();
  toast(`Обучение: осталось ${trainingLeft()} из 3`);
}

function toggleTrainingMin() {
  const panel = $('#trainingPanel');
  if (!panel || !ui.training) return;
  const collapsed = panel.classList.toggle('collapsed');
  const btn = $('#trainingMin');
  if (btn) {
    btn.textContent = collapsed ? '▴' : '▾';
    btn.title = collapsed ? 'Развернуть' : 'Свернуть';
    btn.setAttribute('aria-expanded', String(!collapsed));
  }
  if (!collapsed) renderTrainingAtPly();
}

function renderTrainingAtPly() {
  const t = ui.training;
  if (!t) return;
  const rows = t.rows;
  const idx = Math.max(0, Math.min(rows.length, ui.viewPly) - 1);
  const row = ui.viewPly > 0 ? rows[idx] : null;
  const score = row ? row.after : trainingEval(ui.frames[0]);
  const white = Math.max(5, Math.min(95, 50 + score * 3.2));
  if ($('#trPowerW')) $('#trPowerW').textContent = Math.round(white) + '%';
  if ($('#trPowerB')) $('#trPowerB').textContent = Math.round(100 - white) + '%';
  if ($('#trBarW')) $('#trBarW').style.width = white + '%';
  if ($('#trBarB')) $('#trBarB').style.width = (100 - white) + '%';
  if ($('#trMoveSan')) $('#trMoveSan').textContent = row ? row.san : 'Начальная позиция';
  const grade = $('#trGrade');
  if (grade) {
    grade.className = 'tr-grade' + (row ? ' ' + row.grade : '');
    grade.textContent = row ? ({ best: 'ЛУЧШИЙ', good: 'ХОРОШИЙ', inaccuracy: 'НЕТОЧНОСТЬ', mistake: 'ОШИБКА', blunder: 'ЗЕВОК' }[row.grade] || '') : 'СТАРТ';
  }
  if ($('#trText')) {
    $('#trText').textContent = row ? row.text
      : 'Партия прогоняется через тестер. Дальше — ход за ходом: где вы усилили позицию, а где отдали перевес.';
  }
  const box = $('#trMoves');
  if (box) {
    box.innerHTML = rows.map((r, i) => `<button type="button" class="tr-mv ${r.grade}${ui.viewPly === i + 1 ? ' active' : ''}" data-ply="${i + 1}">${escapeHtml(r.san)}</button>`).join('');
    box.querySelectorAll('.tr-mv').forEach((b) => b.addEventListener('click', () => gotoPly(Number(b.dataset.ply))));
    const act = box.querySelector('.tr-mv.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const max = ui.frames.length - 1;
  if ($('#trPrev')) $('#trPrev').disabled = ui.viewPly <= 0;
  if ($('#trNext')) $('#trNext').disabled = ui.viewPly >= max;
  if ($('#trPlay')) $('#trPlay').textContent = t.auto ? '⏸ Пауза' : '▶ Авто';
  if ($('#trCount')) $('#trCount').textContent = `Ход ${ui.viewPly} из ${max} · осталось ${trainingLeft()} из 3`;
}

function stopTrainingAuto() {
  if (!ui.training) return;
  clearInterval(ui.training.auto);
  ui.training.auto = 0;
  if ($('#trPlay')) $('#trPlay').textContent = '▶ Авто';
}

function toggleTrainingAuto() {
  const t = ui.training;
  if (!t) return;
  if (t.auto) { stopTrainingAuto(); return; }
  if (ui.viewPly >= ui.frames.length - 1) gotoPly(0);
  t.auto = setInterval(() => {
    if (!ui.training) { stopTrainingAuto(); return; }
    if (ui.viewPly >= ui.frames.length - 1) { stopTrainingAuto(); return; }
    gotoPly(ui.viewPly + 1);
  }, 850);
  if ($('#trPlay')) $('#trPlay').textContent = '⏸ Пауза';
}

function endTraining() {
  stopTrainingAuto();
  const returnResult = ui.training && ui.training.returnResult;
  ui.training = null;
  ui.reviewOnly = false;
  ui.reviewFrom = null;
  ui.selected = -1;
  ui.viewPly = ui.frames.length - 1;
  document.body.classList.remove('training', 'reviewing');
  const shell = $('#gameShell');
  if (shell) shell.classList.remove('training-on', 'review-mode');
  const panel = $('#trainingPanel');
  if (panel) { panel.classList.add('hidden'); panel.classList.remove('collapsed'); }
  renderAll(false);
  renderMoves();
  updateNav();
  if (returnResult) {
    $('#result').classList.remove('hidden');
    renderTrainingCta();
  } else {
    showScreen('stats');
  }
}

function skipTraining() {
  ui.trainingSkipped = true;
  const row = $('#resultTrainingRow');
  if (row) row.classList.add('hidden');
  toast('Обучение пропущено');
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
      const grade = ui.training && ui.training.rows[ply - 1] ? ui.training.rows[ply - 1].grade : '';
      return `<button type="button" class="mv ${ply === cur ? 'active' : ''}${grade ? ' tr-' + grade : ''}" data-ply="${ply}">${escapeHtml(m.san)}${time}</button>`;
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
  const review = !!(ui.reviewOnly || ui.training);
  const shell = $('#gameShell');
  if (shell) shell.classList.toggle('review-mode', review);
  document.body.classList.toggle('reviewing', review);
  const exit = $('#reviewExit');
  if (exit) exit.classList.toggle('hidden', !review);
  const hp = $('#histPos');
  if (hp) hp.textContent = `${ui.viewPly}/${max}`;
  if ($('#histPrev')) $('#histPrev').disabled = ui.viewPly <= 0;
  if ($('#histNext')) $('#histNext').disabled = ui.viewPly >= max;
  const info = $('#infoLine');
  if (info) info.textContent = `${ui.moves.length} ${specialMode() ? 'действий' : 'полуходов'} · ${ui.st ? ui.st.mode.name : ''}`;
}

function gotoPly(ply) {
  if (ui.cancelDrag) ui.cancelDrag();
  const max = ui.frames.length - 1;
  const target = Math.max(0, Math.min(max, ply));
  const from = ui.viewPly;
  if (target === from) return;

  const cur = viewState();
  const prevView = { ...cur, board: cur.board.slice() };
  const targetView = frameViewAt(target);
  const ghosts = historyGhosts(targetView.board);

  if (ui.reviewOnly) {
    ui.viewPly = target;
    ui.selected = -1;
    renderAll(false);
    renderMoves();
    updateNav();
    renderPgnBox();
    if (ui.training) renderTrainingAtPly();
  } else if (ui.mode === 'local' && !ui.bot && ui.st) {
    /* Локальная игра: назад — настоящий откат, но история не стирается.
       Вперёд можно вернуться; ветку обрежет только новый ход. */
    const f = ui.frames[target];
    if (f.specialState) {
      const restored = restoreNetworkState(f.specialState);
      if (restored) { ui.st = restored; bindSpecialState(restored); }
    }
    if(!f.specialState) ui.st.board = f.board.slice();
    ui.st.turn = f.turn;
    ui.st.ep = f.ep;
    ui.st.castling = { w: { ...f.castling.w }, b: { ...f.castling.b } };
    ui.st.blocked = f.blocked.slice();
    ui.st.capturedKing = f.capturedKing;
    ui.st.check = f.check;
    ui.st.checkSide = f.checkSide ? { ...f.checkSide } : { w: false, b: false };
    ui.st.rngState = f.rngState;
    ui.st.plySeq = f.plySeq || 0;
    ui.st.checkDamagedSeq = f.checkDamagedSeq != null ? f.checkDamagedSeq : -1;
    ui.st.lastCheckDamage = null;
    ui.st.status = f.status || 'play';
    ui.st.result = f.result ? { ...f.result } : null;
    if(!f.specialState) ui.st.full = Math.floor(target / 2) + 1;
    ui.viewPly = target;
    ui.lastMove = f.lastMove || null;
    ui.selected = -1;
    ui.hint = null;
    ui.endSquare = -1;
    clearTimeout(ui.endTimer);
    ui.endTimer = 0;
    clearTimeout(ui.firstMoveTimer);
    ui.firstMoveTimer = 0;
    ui.turnStart = performance.now();
    ui.running = !!ui.timeMs && target > 0 && ui.st.status === 'play';
    const rolledResult = $('#result');
    if (rolledResult) rolledResult.classList.add('hidden');
    renderAll(false);
    renderMoves();
    updateNav();
    renderPgnBox();
    saveCurrentGame();
  } else {
    ui.viewPly = target;
    ui.selected = -1;
    renderAll(false);
    renderMoves();
    updateNav();
    renderPgnBox();
  }

  animateHistoryJump(prevView, targetView, ghosts);
  playHistorySound(prevView, targetView);
}

/* ── плавный переход по истории: фигуры едут, а не телепортируются ── */

function frameViewAt(ply) {
  const max = ui.frames.length - 1;
  const f = ui.frames[Math.max(0, Math.min(max, ply))];
  if (!f) return viewState();
  return {
    ...ui.st,
    ...(f.specialState ? restoreNetworkState(f.specialState) : {}),
    board: f.board,
    lastMove: f.lastMove || null,
    turn: f.turn,
    ep: f.ep,
    castling: f.castling,
    blocked: f.blocked,
    capturedKing: f.capturedKing,
    check: f.check,
    checkSide: f.checkSide,
    status: f.status,
    result: f.result,
    plySeq: f.plySeq || 0,
    checkDamagedSeq: f.checkDamagedSeq != null ? f.checkDamagedSeq : -1,
    rngState: f.rngState,
  };
}

function boardIdMap(board) {
  const map = new Map();
  for (let i = 0; i < board.length; i++) if (board[i]) map.set(board[i].id, i);
  return map;
}

/* Снятые фигуры остаются призраками и растворяются поверх доски. */
function historyGhosts(nextBoard) {
  const nextIds = new Set();
  for (const p of nextBoard) if (p) nextIds.add(p.id);
  const ghosts = [];
  for (const [id, el] of ui.pieceNodes) {
    if (nextIds.has(id)) continue;
    const ghost = el.cloneNode(true);
    ghost.classList.add('piece-ghost');
    ghost.style.transition = 'none';
    ghost.style.transform = el.style.transform;
    ghost.style.zIndex = '190';
    ghost.style.pointerEvents = 'none';
    ghosts.push(ghost);
  }
  return ghosts;
}

function animateHistoryJump(prevView, nextView, ghosts) {
  const layer = $('#pieces');
  const sq = ui.sq;
  if (!layer || !sq) return;
  ui.histAnim = (ui.histAnim || 0) + 1;
  const token = ui.histAnim;
  const prevMap = boardIdMap(prevView.board);
  const nextMap = boardIdMap(nextView.board);
  const movers = [];

  for (const [id, to] of nextMap) {
    const el = ui.pieceNodes.get(id);
    if (!el) continue;
    const from = prevMap.get(id);
    if (from == null) {
      /* откат взятия — фигура возвращается мягко */
      el.animate([
        { opacity: 0, transform: el.style.transform + ' scale(.6)' },
        { opacity: 1, transform: el.style.transform + ' scale(1)' },
      ], { duration: 210, easing: 'cubic-bezier(.2,.8,.3,1)' });
      continue;
    }
    if (from === to) continue;
    const a = disp(prevView, from);
    const b = disp(nextView, to);
    if (a.dx === b.dx && a.dy === b.dy) continue;
    movers.push({
      el,
      from: `translate(${a.dx * sq}px, ${a.dy * sq}px)`,
      to: `translate(${b.dx * sq}px, ${b.dy * sq}px)`,
      z: 10 + b.dy,
    });
  }

  for (const ghost of ghosts) layer.appendChild(ghost);

  if (movers.length) {
    for (const m of movers) {
      m.el.style.transition = 'none';
      m.el.style.transform = m.from;
      m.el.style.zIndex = '200';
    }
    void layer.offsetWidth; // фиксируем стартовый кадр до перехода
    requestAnimationFrame(() => {
      if (token !== ui.histAnim) return;
      for (const m of movers) {
        m.el.style.transition = 'transform .24s cubic-bezier(.22,.8,.25,1)';
        m.el.style.transform = m.to;
      }
    });
    setTimeout(() => {
      if (token !== ui.histAnim) return;
      for (const m of movers) {
        m.el.style.transition = '';
        m.el.style.zIndex = String(m.z);
      }
    }, 300);
  }

  for (const ghost of ghosts) {
    ghost.animate([
      { opacity: 1, transform: ghost.style.transform + ' scale(1)' },
      { opacity: 0, transform: ghost.style.transform + ' scale(.55)' },
    ], { duration: 220, easing: 'ease-out' }).onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), 420);
  }
}

function playHistorySound(prevView, nextView) {
  if (profile.sound === false) return;
  let before = 0;
  let after = 0;
  for (const p of prevView.board) if (p) before += 1;
  for (const p of nextView.board) if (p) after += 1;
  if (before !== after) sound.capture();
  else sound.move();
  if (nextView.check) setTimeout(() => sound.check(), 110);
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
    this.sse = null;
    this.bc = null;
    this.topic = '';
    this.onMessage = this.onClose = this.onOpen = null;
    this.closed = true;
    this.seen = new Set();
    this.fragments = new Map();
    this.lastId = '';
    this.remoteReady = this.localReady = false;
    this.localUntil = 0;
    this.retryDelay = 700;
    this.queue = [];
    this.sending = false;
    this.generation = 0;
  }

  connect(code, rawTopic) {
    this.close();
    this.topic = rawTopic || topicFor(code);
    this.lastId = '';
    this.lastPacketTime = 0;
    this.seen.clear();
    this.closed = false;
    const generation = ++this.generation;
    this.startedAt = Math.floor(Date.now() / 1000) - 15;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    try {
      this.bc = new BroadcastChannel('daymix-chess-' + this.topic);
      this.bc.onmessage = (event) => {
        if (this.closed || generation !== this.generation || typeof event.data !== 'string') return;
        const recovered = !this.hasLocalPeer();
        this.localReady = true;
        this.localUntil = Date.now() + 30000;
        this.resolveReady();
        if (recovered && this.onOpen) this.onOpen('local');
        this.receiveText(event.data);
      };
      // Локальные вкладки могут начать обмен сразу; это не подтверждение внешней сети.
      this.resolveReady();
    } catch (error) { this.bc = null; }
    this.connectSocket(generation);
    this.watchdogTimer = setInterval(() => {
      if (!this.closed && generation === this.generation) this.wake();
    }, 1000);
    this.fallbackTimer = setTimeout(() => {
      if (!this.closed && generation === this.generation && !this.remoteReady) this.startEvents(generation);
    }, 1400);
    this.readyTimer = setTimeout(() => {
      if (!this.closed && !this.remoteReady && !this.localReady && !this.bc) this.rejectReady(new Error('служба связи не отвечает'));
    }, 14000);
    return this.ready;
  }

  cursor() { return encodeURIComponent(this.lastId || this.startedAt); }
  markReady(generation) {
    if (this.closed || generation !== this.generation) return;
    const first = !this.remoteReady;
    this.remoteReady = true;
    this.retryDelay = 700;
    clearTimeout(this.readyTimer);
    this.stopPolling();
    if (this.resolveReady) this.resolveReady();
    if (first && this.onOpen) this.onOpen('remote');
  }
  connectSocket(generation = this.generation) {
    if (this.closed || generation !== this.generation || this.ws) return;
    let ws;
    try { ws = new WebSocket(`${RELAY_WS}${this.topic}/ws?since=${this.cursor()}`); }
    catch (error) { this.scheduleSocket(generation); this.startEvents(generation); return; }
    // Сохраняем даже ещё не открытый сокет — leave закроет и его.
    this.ws = ws;
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) ws.close();
    }, 8500);
    this.socketTimeout = timeout;
    ws.onopen = () => {
      if (this.closed || generation !== this.generation || this.ws !== ws) { ws.close(); return; }
      clearTimeout(timeout);
      if (this.sse) { this.sse.close(); this.sse = null; }
      this.markReady(generation);
    };
    ws.onmessage = (event) => {
      if (this.closed || generation !== this.generation) return;
      try { this.receivePacket(JSON.parse(event.data)); } catch (error) { /* некорректный пакет */ }
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws === ws) this.ws = null;
      if (this.closed || generation !== this.generation) return;
      this.remoteReady = !!this.sse && this.sse.readyState === 1;
      if (this.onClose) this.onClose();
      this.startEvents(generation);
      this.scheduleSocket(generation);
    };
    ws.onerror = () => { try { ws.close(); } catch (error) { /* уже закрыт */ } };
  }
  scheduleSocket(generation) {
    if (this.closed || generation !== this.generation || this.reconnectTimer) return;
    const delay = this.retryDelay + Math.random() * 250;
    this.retryDelay = Math.min(12000, this.retryDelay * 1.65);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 0;
      this.connectSocket(generation);
    }, delay);
  }
  startEvents(generation = this.generation) {
    if (this.closed || generation !== this.generation || this.sse || (this.ws && this.ws.readyState === 1)) return;
    if (typeof EventSource !== 'function') { this.startPolling(); return; }
    let source;
    try { source = new EventSource(`${RELAY_HTTP}${this.topic}/sse?since=${this.cursor()}`); }
    catch (error) { this.startPolling(); return; }
    this.sse = source;
    source.addEventListener('open', () => this.markReady(generation));
    source.onmessage = (event) => {
      if (this.closed || generation !== this.generation) return;
      try { this.receivePacket(JSON.parse(event.data)); } catch (error) { /* служебный пакет */ }
    };
    source.onerror = () => {
      if (this.closed || generation !== this.generation) return;
      this.remoteReady = !!this.ws && this.ws.readyState === 1;
      source.close();
      if (this.sse === source) this.sse = null;
      if (!this.sseRetryTimer) this.sseRetryTimer = setTimeout(() => {
        this.sseRetryTimer = 0;
        if (!this.closed && generation === this.generation) this.startEvents(generation);
      }, 2500);
      this.startPolling();
    };
    this.startPolling();
  }
  receivePacket(packet) {
    if (this.closed || !packet || packet.event !== 'message' || typeof packet.message !== 'string') return;
    if (packet.id) {
      if (this.seen.has(packet.id)) return;
      this.seen.add(packet.id);
      if (this.seen.size > 800) this.seen.delete(this.seen.values().next().value);
      if (!packet.time || packet.time >= (this.lastPacketTime || 0)) {
        this.lastId = packet.id;
        this.lastPacketTime = packet.time || this.lastPacketTime || 0;
      }
    }
    this.receiveText(packet.message);
  }
  receiveText(text) {
    if (this.closed) return;
    let part;
    try { part = JSON.parse(text); } catch (error) { return; }
    if (part.app !== 'daymix-chess-chunk') { if (this.onMessage) this.onMessage(text); return; }
    if (typeof part.id !== 'string' || !Number.isInteger(part.i) || !Number.isInteger(part.n)
      || part.i < 0 || part.n < 1 || part.n > 256 || part.i >= part.n || typeof part.text !== 'string') return;
    const now = Date.now();
    for (const [id, entry] of this.fragments) if (now - entry.at > 45000) this.fragments.delete(id);
    if (this.fragments.size > 16) this.fragments.delete(this.fragments.keys().next().value);
    let entry = this.fragments.get(part.id);
    if (!entry) { entry = { at: now, parts: new Array(part.n), count: 0, bytes: 0 }; this.fragments.set(part.id, entry); }
    if (entry.parts.length !== part.n || entry.parts[part.i] != null) return;
    entry.parts[part.i] = part.text;
    entry.count++;
    entry.bytes += part.text.length;
    if (entry.bytes > 512000) { this.fragments.delete(part.id); return; }
    if (entry.count === part.n) {
      this.fragments.delete(part.id);
      if (this.onMessage) this.onMessage(entry.parts.join(''));
    }
  }
  startPolling() {
    if (this.closed || this.pollTimer || this.polling) return;
    const generation = this.generation;
    const poll = async () => {
      this.pollTimer = 0;
      if (this.closed || generation !== this.generation || this.remoteReady) return;
      this.polling = true;
      const controller = new AbortController();
      this.pollAbort = controller;
      const timeout = setTimeout(() => controller.abort(), 7000);
      let delay = 1200;
      try {
        const res = await fetch(`${RELAY_HTTP}${this.topic}/json?poll=1&since=${this.cursor()}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (res.ok) {
          const text = await res.text();
          for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try { this.receivePacket(JSON.parse(line)); } catch (error) { /* пропускаем */ }
          }
          if (this.resolveReady) this.resolveReady();
        } else if (res.status === 429) delay = Math.max(15000, (Number(res.headers.get('Retry-After')) || 15) * 1000);
        else delay = 3500;
      } catch (error) { delay = 2500; }
      finally { clearTimeout(timeout); this.polling = false; this.pollAbort = null; }
      if (!this.closed && generation === this.generation && !this.remoteReady) this.pollTimer = setTimeout(poll, delay);
    };
    poll();
  }
  stopPolling() {
    clearTimeout(this.pollTimer);
    this.pollTimer = 0;
    if (this.pollAbort) this.pollAbort.abort();
  }
  broadcast(payload) {
    if (this.closed || !this.bc) return;
    try { this.bc.postMessage(JSON.stringify(payload)); } catch (error) { /* вкладка закрыта */ }
  }
  hasLocalPeer() { return this.localReady && Date.now() < this.localUntil; }
  publish(payload, opts = {}) {
    if (this.closed || !this.topic) return Promise.resolve(false);
    if (opts.local !== false) this.broadcast(payload);
    const body = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const parts = [];
    if (encoder.encode(body).length <= 3200) parts.push(body);
    else {
      let chunk = '', size = 0;
      const texts = [];
      for (const ch of body) {
        const bytes = encoder.encode(ch).length;
        if (size + bytes > 1500) { texts.push(chunk); chunk = ''; size = 0; }
        chunk += ch; size += bytes;
      }
      if (chunk) texts.push(chunk);
      const id = payload.mid || Math.random().toString(36).slice(2);
      for (let i = 0; i < texts.length; i++) parts.push(JSON.stringify({ app: 'daymix-chess-chunk', id, i, n: texts.length, text: texts[i] }));
    }
    return new Promise((resolve) => {
      if (this.queue.length >= 128) { resolve(false); return; }
      this.queue.push({ parts, resolve, generation: this.generation });
      this.flushQueue();
    });
  }
  async flushQueue() {
    if (this.sending || this.closed) return;
    this.sending = true;
    while (this.queue.length && !this.closed) {
      const task = this.queue.shift();
      let ok = true;
      for (const body of task.parts) {
        if (this.closed || task.generation !== this.generation) { ok = false; break; }
        const controller = new AbortController();
        this.publishAbort = controller;
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(RELAY_HTTP + this.topic, {
            method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' },
            body, signal: controller.signal,
          });
          ok = response.ok;
          if (!ok) break;
        } catch (error) { ok = false; break; }
        finally { clearTimeout(timeout); this.publishAbort = null; }
      }
      task.resolve(ok);
    }
    this.sending = false;
  }
  wake() {
    if (this.closed) return;
    if (this.ws && this.ws.readyState > 1) {
      const stale = this.ws;
      stale.onopen = stale.onclose = stale.onmessage = stale.onerror = null;
      try { stale.close(); } catch (error) { /* уже закрыт */ }
      this.ws = null;
      this.remoteReady = !!this.sse && this.sse.readyState === 1;
    }
    if (!this.ws && !this.reconnectTimer) this.connectSocket();
    if (!this.remoteReady) this.startEvents();
    this.flushQueue();
  }
  close() {
    this.closed = true;
    this.generation++;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = 0;
    clearTimeout(this.readyTimer);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.socketTimeout);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.sseRetryTimer);
    this.sseRetryTimer = 0;
    this.reconnectTimer = 0;
    this.stopPolling();
    if (this.publishAbort) this.publishAbort.abort();
    if (this.ws) { this.ws.onopen = this.ws.onclose = this.ws.onmessage = this.ws.onerror = null; try { this.ws.close(); } catch (error) {} }
    if (this.sse) this.sse.close();
    if (this.bc) { this.bc.onmessage = null; this.bc.close(); }
    this.ws = this.sse = this.bc = null;
    this.remoteReady = this.localReady = false;
    this.localUntil = 0;
    for (const task of this.queue) task.resolve(false);
    this.queue = [];
    this.fragments.clear();
  }
}

// Доставка ходов подтверждается приложением. Повтор использует тот же mid,
// поэтому ни резервный канал, ни дубликат не могут сделать ход дважды.
const NET_RELIABLE_TYPES = new Set(['move', 'mode-action', 'start', 'end', 'chat', 'reaction', 'draw-offer', 'imbo-action', 'imbo-sync-request', 'imbo-state', 'imbo-start', 'imbo-chat']);
function netSessionState() {
  const session = ui.online;
  if (!session) return null;
  if (!session.pendingDelivery) session.pendingDelivery = new Map();
  if (!session.moveBuffer) session.moveBuffer = new Map();
  if (!session.pendingMoves) session.pendingMoves = [];
  if (!session.clientId) {
    const words = new Uint32Array(2);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(words);
    else { words[0] = Math.random() * 0xffffffff; words[1] = Math.random() * 0xffffffff; }
    session.clientId = [...words].map((x) => x.toString(36)).join('-');
  }
  return session;
}
function wirePacket(payload, session) {
  session.packetSeq = (session.packetSeq || 0) + 1;
  return {
    ...payload, app: 'daymix-chess', v: 3, sender: session.role,
    sid: session.sid || null, client: session.clientId,
    mid: session.clientId + '-' + session.packetSeq, ts: Date.now(),
  };
}
function transmitPacket(packet, session, forceRelay = false) {
  if (!session || ui.online !== session || !session.relay) return;
  session.relay.broadcast(packet);
  const p2p = session.p2p;
  const direct = !!p2p && p2p.links.some((l) => l.peerId);
  if (direct) {
    try { p2p.publish(packet); } catch (error) { /* ниже остаётся HTTP-резерв */ }
  }
  // Во время нормальной P2P-партии не отправляем каждый клик и ACK через HTTP.
  // Наблюдатели всё равно могут получить ход через резерв или восстановление.
  if (forceRelay || ['start', 'sync-request', 'hello'].includes(packet.t)
    || (!direct && !session.relay.hasLocalPeer())
    || (session.hasSpectators && ['move', 'end'].includes(packet.t))) {
    session.relay.publish(packet, { local: false }).catch(() => {});
  }
}
function netPublish(payload) {
  const session = netSessionState();
  if (!session || !session.relay) return;
  const packet = wirePacket(payload, session);
  if (packet.t === 'move') {
    packet.ply = ui.moves.length;
    packet.hash = netPositionHash(ui.st);
    const last = ui.moves[ui.moves.length - 1];
    if (last) packet.color = last.color;
  }
  if (NET_RELIABLE_TYPES.has(packet.t) && session.role !== 'spectator') {
    session.pendingDelivery.set(packet.mid, { packet, attempts: 0, next: Date.now() + 700 });
    armDeliveryTimer(session);
  }
  transmitPacket(packet, session);
  return packet.mid;
}
function armDeliveryTimer(session) {
  if (session.deliveryTimer || !session.pendingDelivery.size) return;
  session.deliveryTimer = setTimeout(() => {
    session.deliveryTimer = 0;
    if (ui.online !== session) return;
    const now = Date.now();
    for (const [mid, entry] of session.pendingDelivery) {
      if (now < entry.next) continue;
      if (entry.attempts === 9) requestNetworkSync(session, 'delivery');
      if (session.peerVersion && session.peerVersion < 3 && entry.attempts >= 2) {
        session.pendingDelivery.delete(mid);
        continue;
      }
      entry.attempts++;
      entry.next = now + Math.min(8000, 700 * Math.pow(1.65, entry.attempts));
      transmitPacket(entry.packet, session, entry.attempts >= 2);
    }
    if (session.pendingDelivery.size) armDeliveryTimer(session);
  }, 350);
}
function acknowledgePacket(msg, session) {
  if (msg.v < 3 || !msg.mid) return;
  const ack = wirePacket({ t: 'ack', ack: msg.mid, target: msg.client || null, ply: ui.moves.length }, session);
  ack.sid = msg.sid; // первый ACK старта уже относится к хозяйскому sid
  transmitPacket(ack, session);
}
function netPositionHash(st) {
  if (!st) return '';
  // id фигур отличается между браузерами, поэтому сравниваются только правила.
  let value = st.modeId + '|' + st.W + 'x' + st.H + '|' + st.turn + '|' + st.ep + '|' + st.rngState;
  for (const p of st.board) value += p ? p.c + p.t + ':' + (p.used || 0) + ':' + (p.hp ?? '') + ';' : '.;';
  value += '|' + st.blocked.join(',');
  const available = (side) => {
    const id = st.castling[side].k;
    const iq = st.castling[side].q;
    return Number(id != null) + ':' + Number(iq != null) + ':' + st.mv[side].cross + ':' + st.mv[side].checks;
  };
  value += '|' + available('w') + '|' + available('b');
  if ((st.flags.strategy || st.flags.clashBrawl) && typeof specialRulesHash === 'function') value += '|' + specialRulesHash(st);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
function captureNetworkState(st = ui.st) {
  if (!st) return null;
  const copy = {};
  for (const key of Object.keys(st)) {
    if (key === 'mode' || key === 'flags') continue;
    copy[key] = st[key];
  }
  return JSON.parse(JSON.stringify(copy));
}
function restoreNetworkState(data) {
  if (!data || typeof data.modeId !== 'string') return null;
  const mode = modeById(data.modeId);
  if (mode.id !== data.modeId || !Array.isArray(data.board) || data.board.length !== mode.W * (data.square && mode.square ? mode.W : mode.H)) return null;
  if (data.turn !== 'w' && data.turn !== 'b') return null;
  const copy = JSON.parse(JSON.stringify(data));
  if (copy.board.some((p) => p && (!PIECE_NAMES[p.t] || (p.c !== 'w' && p.c !== 'b') || !Number.isFinite(p.id)))) return null;
  if (!copy.castling || !copy.mv || !copy.pawnStart || !Array.isArray(copy.blocked)) return null;
  copy.mode = mode;
  copy.flags = mode.flags;
  copy.W = mode.W;
  copy.H = copy.board.length / copy.W;
  if(specialMode(copy)&&!validSpecialState(copy))return null;
  return copy;
}
function requestNetworkSync(session = ui.online, reason = '') {
  if (!session || ui.online !== session) return;
  if(session.imbo){ if(session.role==='host')imboSyncState();else netPublish({t:'imbo-sync-request'}); return; }
  if(!ui.st)return;
  const now = Date.now();
  if (now - (session.lastSyncRequest || 0) < 1800) return;
  session.lastSyncRequest = now;
  if (session.role === 'host') publishOnlineStart({ recovery: true });
  else netPublish({ t: 'sync-request', ply: ui.moves.length, hash: netPositionHash(ui.st), reason });
}
function applyIncomingMove(msg, session) {
  if (session.started && msg.sid && msg.sid !== session.sid) return false;
  if (session.peerClient && msg.client && msg.sender !== 'spectator' && msg.client !== session.peerClient) return false;
  if (!ui.st || (session.initializing && !ui.replaying)) {
    if (session.pendingMoves.length < 256 && !session.pendingMoves.some((p) => p.mid === msg.mid)) session.pendingMoves.push(msg);
    return false;
  }
  if (Number.isInteger(msg.ply)) {
    if (msg.ply <= ui.moves.length) {
      const applied = ui.moves[msg.ply - 1];
      if (applied && applied.from === msg.from && applied.to === msg.to && (applied.promo || null) === (msg.promo || null)) return true;
      requestNetworkSync(session, 'duplicate-mismatch');
      return false;
    }
    if (msg.ply > ui.moves.length + 1) {
      if (session.moveBuffer.size < 128) session.moveBuffer.set(msg.ply, msg);
      requestNetworkSync(session, 'gap');
      return false;
    }
  }
  if (!['host', 'guest'].includes(msg.sender) || !Number.isInteger(msg.from) || !Number.isInteger(msg.to)) return false;
  const hostColor = session.hostColor || 'w';
  const expected = msg.sender === 'host' ? hostColor : other(hostColor);
  if (!session.coop && ui.st.turn !== expected) { requestNetworkSync(session, 'turn'); return false; }
  const ok = commitMove({ from: msg.from, to: msg.to, promo: msg.promo || null }, { remote: true });
  if (!ok) { requestNetworkSync(session, 'illegal'); return false; }
  if (Number.isFinite(msg.cw)) ui.clocks.w = msg.cw;
  if (Number.isFinite(msg.cb)) ui.clocks.b = msg.cb;
  ui.turnStart = performance.now();
  ui.running = ui.st.status === 'play';
  updateClockEls();
  if (msg.hash && msg.hash !== netPositionHash(ui.st)) requestNetworkSync(session, 'hash');
  return true;
}
function drainIncomingMoves(session) {
  if (ui.online !== session || !ui.st || session.initializing) return;
  for (const [ply] of session.moveBuffer) if (ply <= ui.moves.length) session.moveBuffer.delete(ply);
  const beforeStart = session.pendingMoves.splice(0);
  beforeStart.sort((a, b) => (a.ply || 0) - (b.ply || 0));
  for (const msg of beforeStart) {
    if (applyIncomingMove(msg, session)) acknowledgePacket(msg, session);
  }
  let next;
  while ((next = session.moveBuffer.get(ui.moves.length + 1))) {
    session.moveBuffer.delete(next.ply);
    if (!applyIncomingMove(next, session)) break;
    acknowledgePacket(next, session);
  }
}
function reconstructNetworkFrames(msg, finalState) {
  const start = restoreNetworkState(msg.initial);
  if (!start) return null;
  const frames = [snap(start)];
  const st = start;
  for (const recorded of msg.history) {
    if(specialMode(st)) { const r=reduceSpecialAction(st,recorded.action); if(!r?.ok)return null; frames.push(snap(st,recorded.from>=0?{from:recorded.from,to:recorded.to}:null)); continue; }
    const legal = legalMoves(st, st.turn);
    const move = legal.find((m) => m.from === recorded.from && m.to === recorded.to
      && (m.promo || null) === (recorded.promo || null));
    if (!move) return null;
    const mover = st.turn;
    applyMove(st, move);
    if (st.flags.blocks) maybeBlock(st);
    if (st.flags.checksToWin && inCheck(st, st.turn)) st.mv[mover].checks++;
    updateStatus(st);
    if (st.flags.checksToWin && st.mv[mover].checks >= st.flags.checksToWin) {
      st.status = 'over'; st.result = { winner: mover, reason: 'checks' };
    }
    frames.push(snap(st, { from: move.from, to: move.to }));
  }
  // Окончательное состояние содержит также таймеры/эффекты специальных режимов.
  frames[frames.length - 1] = snap(finalState, msg.lastMove || null);
  return frames;
}
function applyNetworkSnapshot(msg, session) {
  const state = restoreNetworkState(msg.state);
  if (!state || !Array.isArray(msg.history) || msg.history.length > 2048 || !Number.isInteger(msg.ply) || msg.history.length !== msg.ply) return false;
  if (msg.ply < ui.moves.length || (session.role === 'host' && !session.coop)) return true;
  if (msg.hash && msg.hash !== netPositionHash(state)) return false;
  if (msg.ply === ui.moves.length && (!msg.hash || msg.hash === netPositionHash(ui.st))) return true;
  const frames = reconstructNetworkFrames(msg, state);
  if (!frames) return false; // некорректный журнал не подменяет историю
  if (ui.cancelDrag) ui.cancelDrag();
  ui.st = state;
  bindSpecialState(state);
  idSeq = Math.max(idSeq, ...state.board.filter(Boolean).map((p) => p.id + 1));
  ui.moves = msg.history.map((m) => ({ ...m }));
  ui.frames = frames;
  ui.viewPly = msg.ply;
  ui.lastMove = msg.lastMove || null;
  ui.selected = -1;
  ui.hint = null;
  ui.legalCache = null;
  ui.endSquare = -1;
  session.initialState = msg.initial;
  for (const [ply] of session.moveBuffer) if (ply <= msg.ply) session.moveBuffer.delete(ply);
  for (const [mid, entry] of session.pendingDelivery) {
    if (entry.packet.t !== 'move' || entry.packet.ply > msg.ply) continue;
    const m = msg.history[entry.packet.ply - 1];
    if (m && m.from === entry.packet.from && m.to === entry.packet.to) session.pendingDelivery.delete(mid);
  }
  if (Number.isFinite(msg.cw)) ui.clocks.w = msg.cw;
  if (Number.isFinite(msg.cb)) ui.clocks.b = msg.cb;
  ui.turnStart = performance.now();
  ui.running = state.status === 'play' && !!ui.moves.length;
  renderAll(false);
  renderMoves();
  renderPlayers();
  drainIncomingMoves(session);
  if (state.status === 'over' && state.result && !ui.scored) finishGame(state.result);
  return true;
}
function startNetHeartbeat(session = ui.online) {
  if (!session || session.heartbeatTimer) return;
  session.lastPeerAt = Date.now();
  session.heartbeatTimer = setInterval(() => {
    if (ui.online !== session || !session.started) return;
    netPublish(session.imbo ? {t:'ping',at:Date.now(),imboSeq:ui.imbo?.seq||0} : { t: 'ping', at: Date.now(), ply: ui.moves.length, hash: netPositionHash(ui.st) });
    if (Date.now() - session.lastPeerAt > 30000) {
      session.connected = false;
      updateLinkDots();
      if (session.relay) session.relay.wake();
    }
  }, 12000);
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
  menuIntroFx('online');
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
  relayConfig: { warnOnRelayFailure: false, redundancy: 2 },
  maxReceiveBytes: 512 * 1024,
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
  'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.26.0/+esm',
  'https://cdn.jsdelivr.net/npm/@trystero-p2p/mqtt@0.26.0/+esm',
];

async function startP2PSource(url, code) {
  const session = ui.online;
  const mod = await import(url);
  if (!session || ui.online !== session || session.code !== code) return;
  const room = mod.joinRoom(P2P_ROOM_CONFIG, 'room-' + code);
  const rawAction = room.makeAction('msg');
  const action = Array.isArray(rawAction) ? { send: rawAction[0] } : rawAction;
  const receive = (data) => {
    if (!ui.online || ui.online.code !== code) return;
    if (ui.online === session) handleNet(typeof data === 'string' ? data : JSON.stringify(data));
  };
  if (Array.isArray(rawAction)) rawAction[1](receive); else action.onMessage = receive;
  if (!ui.online.p2p) {
    const links = [];
    ui.online.p2p = {
      links,
      best: null,
      publish: (payload) => {
        const target = ui.online.p2p.best || null;
        for (const link of (target && target.peerId ? [target] : links.filter((l) => l.peerId))) {
          try { Promise.resolve(link.action.send(payload)).catch(() => { link.peerId = null; }); }
          catch (error) { link.peerId = null; }
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
    if (ui.online !== session) return;
    link.peerId = peerId;
    connectHudStep(url.includes('mqtt') ? 'mqtt' : 'nostr', 'done');
    room.ping(peerId).then((ms) => {
      if (ui.online !== session) return;
      link.ping = ms;
      scheduleP2PSelect();
    }).catch(() => scheduleP2PSelect());
    ui.online.connected = true;
    updateLinkDots();
    if (ui.online.role === 'guest' && !ui.online.started) {
      netPublish({ t: 'join', name: profile.name, avatar: profile.avatar, side: profile.side });
    } else if (ui.online.role === 'host') {
      announceRoom();
    }
  };
  room.onPeerLeave = (peerId) => {
    if (ui.online !== session || (link.peerId && peerId !== link.peerId)) return;
    link.peerId = null;
    link.ping = null;
    if (ui.online && ui.online.p2p) {
      if (ui.online.p2p.best === link) ui.online.p2p.best = null;
      scheduleP2PSelect();
      updateLinkDots();
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
  }, 250);
}

async function startTrysteroRoom(code) {
  if (!ui.online || ui.online.role === 'spectator') return;
  for (const url of P2P_SOURCES) {
    startP2PSource(url, code).catch(() => { /* этот сигнальный канал недоступен */ });
  }
}

async function createRoom() {
  if (!modeAllowedForTime(modeById(profile.modeId), profile.timeMs)) {
    toast('Для этого режима выберите от 3 минут или без ограничения.'); return false;
  }
  if (ui.online && ui.online.code) leaveOnline(true);
  if (!ui.online) {
    ui.online = { code: '', role: 'host', sid: Math.random().toString(36).slice(2, 10) };
  }
  if (profile.modeId === 'random') {
    const pick = randomRealMode();
    ui.online.modeId = pick.id;
    ui.online.modePick = 'random';
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
  startConnectHud('host');
  const session = netSessionState();
  ui.st = null;
  session.relay = new Relay();
  session.relay.onMessage = (text) => { if (ui.online === session) handleNet(text); };
  session.relay.onOpen = () => {
    if (ui.online !== session) return;
    session.connected = true;
    connectHudStep('net', 'done');
    updateLinkDots();
    if (session.started) requestNetworkSync(session, 'channel-open');
  };
  session.relay.onClose = () => {
    if (ui.online !== session) return;
    ui.online.connected = false;
    updateLinkDots();
    if (ui.online.sid) scheduleReconnect();
  };
  try {
    const opening = session.relay.connect(code);
    if (session.role !== 'spectator') startTrysteroRoom(code);
    await opening;
    if (ui.online !== session) return;
  } catch (error) {
    setLobby('Не удалось связаться со службой. Проверьте интернет и попробуйте снова.');
    stopConnectHud();
    if (ui.online === session) { session.relay.close(); ui.online = null; }
    return;
  }
  session.connected = !!session.relay.remoteReady || !!session.relay.localReady;
  connectHudStep('net', 'done');
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
    modeId: ui.st ? ui.st.modeId : (ui.online.modeId || profile.modeId),
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
  const session = netSessionState();
  ui.st = null;
  session.relay = new Relay();
  session.relay.onMessage = (text) => { if (ui.online === session) handleNet(text); };
  session.relay.onOpen = () => {
    if (ui.online !== session) return;
    session.connected = true;
    connectHudStep('net', 'done');
    updateLinkDots();
    if (session.started) requestNetworkSync(session, 'channel-open');
  };
  session.relay.onClose = () => {
    if (ui.online !== session) return;
    ui.online.connected = false;
    updateLinkDots();
    if (ui.st) scheduleReconnect();
  };
  try {
    const opening = session.relay.connect(code);
    if (session.role !== 'spectator') startTrysteroRoom(code);
    await opening;
    if (ui.online !== session) return;
  } catch (error) {
    setLobby('Комната не отвечает. Проверьте код и интернет.');
    stopConnectHud();
    if (ui.online === session) { session.relay.close(); ui.online = null; }
    return;
  }
  session.connected = !!session.relay.remoteReady || !!session.relay.localReady;
  setLobby(spectate ? 'Подключаемся к наблюдению за комнатой ' + code + '…' : 'Подключаемся к комнате ' + code + '…');
  netPublish(spectate ? { t: 'watch', name: profile.name } : { t: 'join', name: profile.name, avatar: profile.avatar, side: profile.side });
  clearInterval(ui.online.joinTimer);
  let tries = 0;
  ui.online.joinTimer = setInterval(() => {
    tries += 1;
    if (ui.online !== session || session.started) { clearInterval(session.joinTimer); return; }
    if (tries > 24) {
      clearInterval(ui.online.joinTimer);
      setLobby('Комната не отвечает: служба связи перегружена. Нажмите «Присоединиться» ещё раз через минуту.');
      return;
    }
    if (tries % 5 === 0) setLobby('Ждём ответа комнаты ' + code + '… попытка ' + (tries + 1));
    netPublish(spectate ? { t: 'watch', name: profile.name } : { t: 'join', name: profile.name, avatar: profile.avatar, side: profile.side });
  }, 2500);
}

function scheduleReconnect() {
  const session = ui.online;
  if (!session || !session.relay) return;
  session.relay.wake();
  if (session.started) requestNetworkSync(session, 'reconnect');
}

function handleNet(text) {
  const session = netSessionState();
  if (!session || typeof text !== 'string' || text.length > 512000) return;
  let msg;
  try { msg = JSON.parse(text); } catch (error) { return; }
  if (!msg || msg.app !== 'daymix-chess' || msg.sender === session.role
    || !['host', 'guest', 'spectator'].includes(msg.sender)) return;
  if (msg.spectator && session.role !== 'spectator') return;
  if (msg.sender === 'spectator' && ['move', 'end', 'draw-offer'].includes(msg.t)) return;
  if (msg.target && msg.target !== session.clientId) return;
  const handshake = ['room', 'join', 'watch', 'watch-empty', 'start', 'imbo-room', 'imbo-join', 'imbo-start'].includes(msg.t);
  if (!handshake && session.started && msg.sid && msg.sid !== session.sid) return;
  if (msg.t === 'start' && session.started && msg.sid !== session.sid) return;
  session.lastPeerAt = Date.now();
  session.connected = true;
  if (session.started && session.peerClient && msg.client && msg.sender !== 'spectator' && msg.client !== session.peerClient) return;
  if (msg.client && msg.sender !== 'spectator') { session.peerClient = msg.client; session.peerVersion = msg.v || 2; }
  if (msg.t === 'ack') {
    const sent = session.pendingDelivery.get(msg.ack);
    if (sent && (msg.sender !== 'spectator' || !msg.target || msg.target === session.clientId)) session.pendingDelivery.delete(msg.ack);
    return;
  }
  if (msg.mid) {
    if (!session.seen) session.seen = new Set();
    if (session.seen.has(msg.mid)) {
      if (NET_RELIABLE_TYPES.has(msg.t) && (msg.t !== 'start' || (session.started && session.sid === msg.sid))) acknowledgePacket(msg, session);
      return;
    }
    session.seen.add(msg.mid);
    if (session.seen.size > 1200) session.seen.delete(session.seen.values().next().value);
  }
  if (msg.t === 'mode-action') {
    if (applyIncomingSpecial(msg, session)) acknowledgePacket(msg, session);
    else if (msg.mid) session.seen.delete(msg.mid);
    return;
  }
  if (msg.t === 'reaction') {
    if (msg.sender !== 'spectator' && Date.now() - (session.lastReactionAt || 0) >= 1200) {
      session.lastReactionAt = Date.now(); showGameReaction(msg.emoji, true);
    }
    acknowledgePacket(msg, session); return;
  }
  if (msg.t === 'move') {
    if (applyIncomingMove(msg, session)) {
      acknowledgePacket(msg, session);
      drainIncomingMoves(session);
    } else if (msg.mid) session.seen.delete(msg.mid);
    return;
  }
  if (NET_RELIABLE_TYPES.has(msg.t) && msg.t !== 'start') acknowledgePacket(msg, session);
  if (msg.t === 'sync-request' || msg.t === 'hello') {
    if (session.role === 'host' && ui.st) publishOnlineStart({ recovery: true, target: msg.client || null, spectator: msg.sender === 'spectator' });
    return;
  }
  if (ui.online.imbo && (msg.t==='ping'||msg.t==='pong')) { if(msg.t==='ping'){netPublish({t:'pong',at:msg.at,target:msg.client});if(msg.imboSeq>(ui.imbo?.seq||0))requestNetworkSync(session,'imbo-heartbeat');} return; }
  if (msg.t === 'ping') {
    netPublish({ t: 'pong', at: msg.at, ply: ui.moves.length, hash: netPositionHash(ui.st), target: msg.client || null });
    if (msg.ply > ui.moves.length || (msg.ply === ui.moves.length && msg.hash && msg.hash !== netPositionHash(ui.st))) requestNetworkSync(session, 'heartbeat');
    return;
  }
  if (msg.t === 'pong') {
    session.ping = Math.max(0, Date.now() - Number(msg.at || Date.now()));
    updateLinkDots();
    if (msg.ply > ui.moves.length) requestNetworkSync(session, 'heartbeat');
    return;
  }
  if (msg.t && String(msg.t).startsWith('imbo-')) { handleImboNet(msg); return; }

  if (msg.t === 'room' && ui.online.role === 'guest') {
    if (ui.online.started) return;
    if (!ui.online.started) setLobby(`Комната ${ui.online.code}: ${msg.name || 'соперник'} ждёт. Подключаемся…`);
    netPublish({ t: 'join', name: profile.name, avatar: profile.avatar, side: profile.side });
    return;
  }

  if (msg.t === 'intent' && ui.st && ui.st.flags.openIntent) {
    ui.remoteSelected = Number.isFinite(msg.sq) ? msg.sq : -1;
    renderSquares();
    return;
  }

  if (msg.t === 'watch' && ui.online.role === 'host') {
    session.hasSpectators = true;
    if (!ui.st) { netPublish({ t: 'watch-empty', target: msg.client || null }); return; }
    publishOnlineStart({ target: msg.client || null, spectator: true });
    return;
  }

  if (msg.t === 'join' && ui.online.role === 'host') {
    if (session.started && session.guestName !== msg.name) return;
    if (ui.online.guestName === msg.name && ui.st) {
      // Повторный join — это ещё и повторная доставка старта, если первый пакет потерялся.
      publishOnlineStart();
      return;
    }
    if (ui.online.guestName === msg.name && ui.online.starting) return;
    ui.online.guestName = msg.name;
    ui.online.starting = true;
    ui.online.sid = ui.online.sid || Math.random().toString(36).slice(2, 10);
    ui.online.waiting = false;
    clearInterval(ui.online.announce);
    const ultra = (ui.online.modeId || profile.modeId) === 'ultraBalance';
    ui.online.coop = ultra;
    const randomHost = !ultra && !ui.st && (profile.side === 'random' || msg.side === 'random');
    const hostColor = ultra
      ? 'w'
      : (ui.st ? (ui.playerSide || 'w') : (randomHost ? randomSide() : (profile.side === 'b' ? 'b' : 'w')));
    ui.online.hostColor = hostColor;
    const guestColor = other(hostColor);
    ui.online.names = ultra
      ? { w: { name: profile.name, avatar: profile.avatar }, b: { name: 'Бот · ' + botLabel('gm'), avatar: 'k' } }
      : (hostColor === 'w'
        ? { w: { name: profile.name, avatar: profile.avatar }, b: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' } }
        : { w: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' }, b: { name: profile.name, avatar: profile.avatar } });
    ui.online.avatars = {
      w: (ui.online.names.w && ui.online.names.w.avatar) || 'k',
      b: (ui.online.names.b && ui.online.names.b.avatar) || 'k',
    };
    setLobby('');
    $('#roomRow').classList.add('hidden');
    const beginHost = () => {
      if (ui.online !== session) return;
      ui.online.starting = false;
      if (!ui.st) {
        newGame({
          mode: 'online', role: 'host', modeId: ultra ? 'ultraBalance' : (ui.online.modeId || profile.modeId),
          timeMs: profile.timeMs, side: hostColor, orientation: hostColor, splash: true,
          bot: ultra ? { level: 'gm', color: 'b' } : null,
        });
      }
      ui.online.started = true;
      startNetHeartbeat(session);
      // Имена после newGame: хозяин и гость могут играть любым цветом.
      ui.names = ultra
        ? { w: { name: profile.name, avatar: profile.avatar }, b: { name: 'Бот · ' + botLabel('gm'), avatar: 'k' } }
        : (hostColor === 'w'
          ? { w: { name: profile.name, avatar: profile.avatar }, b: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' } }
          : { w: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' }, b: { name: profile.name, avatar: profile.avatar } });
      ui.chat.push({
        name: 'Система',
        text: ultra
          ? `${msg.name || 'Друг'} присоединился как союзник — он ходит белыми после бота`
          : `${msg.name || 'Соперник'} присоединился к партии за ${guestColor === 'w' ? 'белых' : 'чёрных'}`,
      });
      renderChat();
      renderPlayers();
      renderMeta();
      toast(ultra
        ? 'Друг присоединился — он сможет ходить после бота'
        : `Вы за ${hostColor === 'w' ? 'белых' : 'чёрных'} · ${msg.name || 'Соперник'} за ${guestColor === 'w' ? 'белых' : 'чёрных'}`);
      publishOnlineStart({ randomSide: randomHost });
    };
    if (randomHost) showSideRoulette(hostColor, beginHost);
    else beginHost();
    return;
  }

  if (msg.t === 'start' && ui.online.role === 'spectator') {
    if (session.started && ui.st) {
      if (applyNetworkSnapshot(msg, session)) acknowledgePacket(msg, session);
      return;
    }
    session.sid = msg.sid || session.sid;
    session.hostColor = msg.hostColor || 'w';
    acknowledgePacket(msg, session);
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
    const initial = restoreNetworkState(msg.initial);
    if (initial) { ui.st = initial; bindSpecialState(initial); ui.initialState=captureNetworkState(initial); ui.frames = [snap(initial)]; }
    for (const mv of (msg.history || msg.moves || [])) replayRecordedMove(mv);
    ui.replaying = false;
    startNetHeartbeat(session);
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
    if (ui.st && ui.online.started && !ui.online.initializing) {
      if (applyNetworkSnapshot(msg, session)) acknowledgePacket(msg, session);
      return;
    }
    if (ui.online.initializing) return;
    ui.online.initializing = true;
    clearInterval(ui.online.joinTimer);
    ui.online.started = true;
    ui.online.sid = msg.sid || ui.online.sid;
    acknowledgePacket(msg, session);
    ui.online.coop = !!msg.coop;
    const hostColor = msg.hostColor === 'b' ? 'b' : 'w';
    const mySide = msg.coop ? 'w' : other(hostColor);
    ui.online.hostColor = hostColor;
    ui.online.names = msg.names || (mySide === 'w'
      ? { w: { name: profile.name, avatar: profile.avatar }, b: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' } }
      : { w: { name: msg.name || 'Соперник', avatar: msg.avatar || 'k' }, b: { name: profile.name, avatar: profile.avatar } });
    ui.online.avatars = {
      w: (ui.online.names.w && ui.online.names.w.avatar) || 'k',
      b: (ui.online.names.b && ui.online.names.b.avatar) || 'k',
    };
    const beginGuest = () => {
      if (ui.online !== session) return;
      ui.replaying = true;
      newGame({
        mode: 'online', role: 'guest', modeId: msg.modeId, square: !!msg.square,
        timeMs: msg.timeMs, raceMs: msg.raceMs, seed: msg.seed,
        side: mySide, orientation: mySide, splash: false,
        bot: msg.coop ? (msg.bot || { level: 'gm', color: 'b' }) : null,
      });
      const initial = restoreNetworkState(msg.initial);
      if (initial) { ui.st = initial; bindSpecialState(initial); ui.initialState=captureNetworkState(initial); ui.frames = [snap(initial)]; idSeq = Math.max(idSeq, ...initial.board.filter(Boolean).map((p) => p.id + 1)); }
      if (msg.names) ui.names = msg.names;
      for (const mv of (msg.history || msg.moves || [])) replayRecordedMove(mv);
      session.initialState = msg.initial || captureNetworkState(ui.st);
      if (msg.state && msg.hash && netPositionHash(ui.st) !== msg.hash) applyNetworkSnapshot(msg, session);
      if (Number.isFinite(msg.cw)) ui.clocks = { w: msg.cw, b: msg.cb };
      ui.online.initializing = false;
      drainIncomingMoves(session);
      startNetHeartbeat(session);
      ui.replaying = false;
      ui.turnStart = performance.now();
      if (ui.moves.length) ui.running = true;
      renderAll(false);
      renderMoves();
      renderPlayers();
      renderMeta();
      setLobby('');
      toast(ui.online.coop
        ? 'Вы подключились: ходите белыми после хода бота'
        : (mySide === 'w' ? 'Вы за белых' : 'Вы за чёрных'));
      showPhase('opening');
    };
    if (msg.randomSide && !msg.coop) showSideRoulette(mySide, beginGuest, { mirror: true });
    else beginGuest();
    return;
  }

  if (msg.t === 'chat') {
    const hostSide = ui.online.hostColor || (ui.role === 'host' ? (ui.playerSide || 'w') : 'w');
    const side = ui.online.coop ? 'w' : (msg.sender === 'host' ? hostSide : other(hostSide));
    ui.chat.push({ name: ui.online.names?.[side]?.name || ui.online.names?.[side] || 'Соперник', text: String(msg.text || '').slice(0, 200) });
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

  if (msg.t === 'bye') {
    if (msg.sender !== 'spectator') { session.connected = false; session.lastPeerAt = 0; updateLinkDots(); }
    return;
  }
}

/** Единый пакет старта: используется и для первого join, и для повторной доставки. */
function publishOnlineStart(extra = {}) {
  if (!ui.st || !ui.online) return;
  netPublish({
    t: 'start',
    initial: ui.online.initialState || null,
    state: captureNetworkState(),
    ply: ui.moves.length, hash: netPositionHash(ui.st),
    history: ui.moves.map((m) => ({ ...m })), lastMove: ui.lastMove ? { ...ui.lastMove } : null,
    recovery: !!extra.recovery, target: extra.target || null, spectator: !!extra.spectator,
    modeId: ui.st.modeId,
    square: !!ui.st.square,
    timeMs: ui.timeMs,
    timeLabel: profile.timeLabel,
    raceMs: ui.race ? ui.race.duration : null,
    seed: ui.st.seed,
    moves: ui.moves.map((m) => ({ from: m.from, to: m.to, promo: m.promo || null })),
    cw: ui.clocks.w, cb: ui.clocks.b,
    name: profile.name, avatar: profile.avatar,
    hostColor: ui.online.hostColor || ui.playerSide || 'w',
    randomSide: !!extra.randomSide,
    coop: !!ui.online.coop,
    bot: ui.online.coop ? { level: 'gm', color: 'b' } : null,
    names: ui.names,
  });
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
    clearInterval(ui.online.heartbeatTimer);
    clearTimeout(ui.online.deliveryTimer);
    if (ui.online.pendingDelivery) ui.online.pendingDelivery.clear();
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
  if (ui.cancelDrag) ui.cancelDrag();
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
    const shell = $('#gameShell');
    if (shell) shell.classList.add('paused');
    $('#railPause').classList.add('paused');
    if ($('#mobPause')) $('#mobPause').textContent = '▶';
    updateClockEls();
    renderStatus();
    toast('Пауза — часы серые');
  } else {
    ui.paused = false;
    ui.turnStart = performance.now();
    ui.running = ui.timeMs > 0 && ui.moves.length > 0;
    const shell = $('#gameShell');
    if (shell) shell.classList.remove('paused');
    $('#railPause').classList.remove('paused');
    if ($('#mobPause')) $('#mobPause').textContent = '⏸';
    updateClockEls();
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
  ui.persona = null;
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
  if (ui.cancelDrag) ui.cancelDrag();
  stopBotWorker();
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
  ui.persona = null;
  ui.reviewOnly = false;
  ui.training = null;
  ui.movedId = null;
  clearInterval(ui.timer);
  $('#result').classList.add('hidden');
  if ($('#pauseOverlay')) $('#pauseOverlay').classList.add('hidden');
  if ($('#railPause')) $('#railPause').classList.remove('paused');
  if ($('#mobPause')) $('#mobPause').textContent = '⏸';
  const pauseShell = $('#gameShell');
  if (pauseShell) pauseShell.classList.remove('paused', 'review-mode', 'training-on');
  document.body.classList.remove('reviewing', 'training');
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
  if ($('#imboRestart')) $('#imboRestart').addEventListener('click', imboRestartGame);
  $$('#imboModeSeg [data-imbo-mode]').forEach((b) => {
    b.addEventListener('click', () => imboSetMode(b.dataset.imboMode));
  });
  if ($('#imboBotLevel')) $('#imboBotLevel').addEventListener('change', () => {
    if (ui.imboBot) ui.imboBot.level = $('#imboBotLevel').value;
  });
  if ($('#imboHistoryBtn')) $('#imboHistoryBtn').addEventListener('click', () => imboToggleHistory());
  if ($('#imboHistoryClose')) $('#imboHistoryClose').addEventListener('click', () => imboToggleHistory(false));
  if ($('#imboChatBtn')) $('#imboChatBtn').addEventListener('click', () => imboToggleChat());
  if ($('#imboChatClose')) $('#imboChatClose').addEventListener('click', () => imboToggleChat(false));
  if ($('#imboChatForm')) $('#imboChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#imboChatInput');
    if (!input) return;
    sendImboChat(input.value);
    input.value = '';
  });
  if ($('#imboRoomCreate')) $('#imboRoomCreate').addEventListener('click', imboOnlineHost);
  if ($('#imboRoomJoin')) $('#imboRoomJoin').addEventListener('click', imboOnlineJoin);
  if ($('#imboRoomLeave')) $('#imboRoomLeave').addEventListener('click', imboOnlineLeave);
  if ($('#imboRoomCode')) $('#imboRoomCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); imboOnlineJoin(); }
  });
  if ($('#imboResultAgain')) $('#imboResultAgain').addEventListener('click', imboRestartGame);
  if ($('#imboResultMenu')) $('#imboResultMenu').addEventListener('click', openImboHub);
  $$('.imbo-card').forEach((b) => b.addEventListener('click', () => imboStart(b.dataset.imbo, b.dataset.var, { mode: 'local' })));
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
  if ($('#optResultPause')) $('#optResultPause').addEventListener('change', (e) => {
    profile.resultPause = e.target.checked;
    saveProfile();
    toast(profile.resultPause ? 'Пауза на результате включена' : 'Пауза на результате выключена');
  });
  if ($('#btnRefreshGame')) $('#btnRefreshGame').addEventListener('click', refreshActiveGame);
  if ($('#btnImportLocal')) $('#btnImportLocal').addEventListener('click', openImport);
  if ($('#homeImport')) $('#homeImport').addEventListener('click', openImport);
  if ($('#btnExportCurrent')) $('#btnExportCurrent').addEventListener('click', exportGameFile);
  if ($('#exportClose')) $('#exportClose').addEventListener('click', closeExport);
  if ($('#exportCopy')) $('#exportCopy').addEventListener('click', copyExportText);
  if ($('#exportDownload')) $('#exportDownload').addEventListener('click', downloadExportText);
  if ($('#exportJson')) $('#exportJson').addEventListener('click', exportGameFile);
  if ($('#exportModal')) $('#exportModal').addEventListener('click', (e) => { if (e.target === $('#exportModal')) closeExport(); });
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
    if (!text) { toast('Вставьте JSON или TXT партии'); return; }
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
  $('#stratX2')?.addEventListener('click',()=>strategyPerformAction({kind:'upgrade',upgrade:'income'}));
  $('#stratPlus')?.addEventListener('click',()=>strategyPerformAction({kind:'upgrade',upgrade:'arsenal'}));
  $('#stratCap')?.addEventListener('click',()=>strategyPerformAction({kind:'upgrade',upgrade:'logistics'}));
  $('#stratSkipMove')?.addEventListener('click',()=>strategyPerformAction({kind:'pass'}));
  $('#stratSkipAttack')?.addEventListener('click',()=>strategyPerformAction({kind:'pass'}));
  $('#stratSpecial')?.addEventListener('click',strategySpecial);

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
      // «Случайно» — это preference, а не мгновенный бросок:
      // цвет определяется жеребьёвкой непосредственно перед партией.
      profile.side = pick === 'random' ? 'random' : pick;
      saveProfile();
      renderQuickSide();
      if (pick === 'random') toast(profile.language === 'en' ? 'Colour will be drawn before the game' : 'Цвет определится перед партией — жеребьёвка');
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
  if ($('#reviewExit')) $('#reviewExit').addEventListener('click', leaveReview);
  if ($('#trPlay')) $('#trPlay').addEventListener('click', toggleTrainingAuto);
  if ($('#trPrev')) $('#trPrev').addEventListener('click', () => gotoPly(ui.viewPly - 1));
  if ($('#trNext')) $('#trNext').addEventListener('click', () => gotoPly(ui.viewPly + 1));
  if ($('#trDone')) $('#trDone').addEventListener('click', endTraining);
  if ($('#trainingClose')) $('#trainingClose').addEventListener('click', endTraining);
  if ($('#trainingMin')) $('#trainingMin').addEventListener('click', toggleTrainingMin);
  const resultLockBox = $('#result');
  if (resultLockBox) resultLockBox.addEventListener('click', (e) => {
    if (performance.now() < (ui.resultLockedUntil || 0)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
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
  if ($('#btnExportTxt')) $('#btnExportTxt').addEventListener('click', openExport);
  if ($('#btnExportMenu')) $('#btnExportMenu').addEventListener('click', openExport);
  if ($('#mobExport')) $('#mobExport').addEventListener('click', openExport);
  if ($('#mobImport')) $('#mobImport').addEventListener('click', openImport);
  if ($('#railExport')) $('#railExport').addEventListener('click', openExport);
  if ($('#railImport')) $('#railImport').addEventListener('click', openImport);
  if ($('#homeExport')) $('#homeExport').addEventListener('click', openExport);

  $('#btnResign').addEventListener('click', resign);
  $('#btnDraw').addEventListener('click', offerDraw);
  $('#btnAbort').addEventListener('click', abortGame);
  $('#btnNew').addEventListener('click', () => newGame({ mode: ui.mode || 'local', modeId: ui.modePick || (ui.st ? ui.st.modeId : profile.modeId), timeMs: ui.timeMs, splash: true }));
  $('#btnLeave').addEventListener('click', askLeave);

  $('#resultAgain').addEventListener('click', () => {
    $('#result').classList.add('hidden');
    newGame({ mode: ui.mode || 'local', modeId: ui.modePick || (ui.st ? ui.st.modeId : profile.modeId), timeMs: ui.timeMs, splash: true });
  });
  $('#resultMenu').addEventListener('click', leaveGame);
  $('#resultExport').addEventListener('click', openExport);
  $('#resultTraining').addEventListener('click', startTraining);
  $('#resultTrainingSkip').addEventListener('click', skipTraining);
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

  // Последнее положение пальца применяется один раз за кадр. Геометрия и
  // допустимые поля кешируются до начала drag, а не пересчитываются на каждом событии.
  let dragState = null;
  const clearDragHover = (d = dragState) => {
    if (d && d.hoverEl) d.hoverEl.classList.remove('drag-over');
    if (ui.dragHoverEl === (d && d.hoverEl)) ui.dragHoverEl = null;
    if (d) d.hoverEl = null;
  };
  const locateDragTarget = (d, x, y) => {
    const r = d.rect;
    let target = -1;
    if (x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) {
      let dx = Math.max(0, Math.min(d.W - 1, Math.floor((x - r.left) * d.W / r.width)));
      let dy = Math.max(0, Math.min(d.H - 1, Math.floor((y - r.top) * d.H / r.height)));
      if (d.flipped) { dx = d.W - 1 - dx; dy = d.H - 1 - dy; }
      const file = d.orientation === 'w' ? dx : d.W - 1 - dx;
      const rank = d.orientation === 'w' ? d.H - 1 - dy : dy;
      target = rank * d.W + file;
    }
    const allowed = d.targets.has(target) ? target : null;
    if (allowed !== d.target) {
      clearDragHover(d);
      d.target = allowed;
      if (allowed != null) {
        d.hoverEl = ui.squareEls[allowed];
        ui.dragHoverEl = d.hoverEl;
        if (d.hoverEl) d.hoverEl.classList.add('drag-over');
      }
    }
  };
  const paintDrag = (d) => {
    d.raf = 0;
    if (dragState !== d || !d.active || ui.st !== d.state || ui.st.plySeq !== d.ply) return;
    const dx = (d.clientX - d.x) * d.scaleX * d.sign;
    const dy = (d.clientY - d.y) * d.scaleY * d.sign;
    const tilt = Math.max(-11, Math.min(11, (d.clientX - d.x) * 0.09));
    d.el.style.transform = `translate(${d.baseX + dx}px, ${d.baseY + dy}px) scale(1.12) rotate(${tilt}deg)`;
    locateDragTarget(d, d.clientX, d.clientY);
  };
  const suppressNextClick = () => {
    ui.suppressClick = true;
    clearTimeout(suppressNextClick.timer);
    suppressNextClick.timer = setTimeout(() => { ui.suppressClick = false; }, 320);
  };
  const finishDrag = (e) => {
    if (!dragState || (e.pointerId != null && e.pointerId !== dragState.pointerId)) return;
    const d = dragState;
    const cancelled = e.type === 'pointercancel' || e.type === 'blur'
      || ui.st !== d.state || ui.st.plySeq !== d.ply || ui.st.status !== 'play' || ui.paused || ui.screen !== 'game';
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.active && !cancelled && Number.isFinite(e.clientX)) {
      d.clientX = e.clientX; d.clientY = e.clientY;
      paintDrag(d); // последнее pointermove могло ещё ожидать кадр
    }
    if (d.raf) cancelAnimationFrame(d.raf);
    dragState = null;
    ui.dragging = false;
    ui.dragNode = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', finishDrag);
    clearDragHover(d);
    try { if (d.capture.hasPointerCapture(d.pointerId)) d.capture.releasePointerCapture(d.pointerId); } catch (error) { /* палец уже отпущен */ }
    if (!d.active) return;
    if (e.cancelable) e.preventDefault();
    d.el.classList.remove('dragging');
    d.layer.classList.remove('raise');
    d.el.style.zIndex = d.zIndex;
    d.el.style.willChange = '';
    suppressNextClick();
    if (!cancelled && d.target != null) {
      d.el.style.transition = '';
      onSquareClick(d.target);
    } else {
      d.el.style.transition = 'transform .18s cubic-bezier(.2,.8,.3,1)';
      d.el.style.transform = `translate(${d.baseX}px, ${d.baseY}px)`;
      setTimeout(() => {
        if (!d.el.isConnected || ui.st !== d.state || ui.st.plySeq !== d.ply) return;
        d.el.style.transition = '';
      }, 200);
      ui.selected = -1;
      renderSquares();
      renderHints();
    }
  };
  const onDragMove = (e) => {
    const d = dragState;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientX = e.clientX; d.clientY = e.clientY;
    if (!d.active) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (dx * dx + dy * dy < 36 || (d.touch && performance.now() < d.readyAt)) return;
      d.active = true;
      ui.dragging = true;
      ui.dragNode = d.el;
      suppressNextClick();
      d.el.classList.add('dragging');
      d.layer.classList.add('raise');
      d.el.style.transition = 'none';
      d.el.style.willChange = 'transform';
      d.el.style.zIndex = '9999';
    }
    if (e.cancelable) e.preventDefault();
    if (!d.raf) d.raf = requestAnimationFrame(() => paintDrag(d));
  };
  ui.cancelDrag = () => { if (dragState) finishDrag({ type: 'blur' }); };
  window.addEventListener('blur', ui.cancelDrag);
  $('#squares').addEventListener('lostpointercapture', (e) => {
    if (dragState && dragState.pointerId === e.pointerId) finishDrag({ type: 'pointercancel', pointerId: e.pointerId });
  });
  $('#squares').addEventListener('pointerdown', (e) => {
    if (dragState || (e.button !== undefined && e.button !== 0)) return;
    const sqEl = e.target.closest('.sq');
    if (ui.spectator || ui.reviewOnly) return;
    if (!sqEl || !ui.st || ui.st.status !== 'play' || ui.gameLocked || ui.paused || ui.imported) return;
    if (ui.viewPly !== ui.frames.length - 1 && !canBranchHere()) return;
    if (ui.st.flags.clashBrawl && ui.st.brawl.stage !== 'main') return;
    if (ui.st.flags.strategy && ui.st.strategy.phase === 'attack') return;
    if (ui.bot && ui.st.turn === ui.bot.color) return;
    if (!onlineCoachMayMove() || (ui.mode === 'online' && ui.st.turn !== myColor())) return;
    if (ui.mode !== 'local' && ui.st.turn !== myColor()) return;
    const sq = Number(sqEl.dataset.sq);
    const p = ui.st.board[sq];
    if (!p || p.c !== ui.st.turn) return;
    const allLegal = getUiLegalMoves(ui.st);
    if (ui.st.flags.touchMove && ui.selected >= 0) {
      const selectedMoves = allLegal.filter((m) => m.from === ui.selected);
      if (selectedMoves.length && sq !== ui.selected) return;
      if (!selectedMoves.length) return;
    }
    const targets = new Set(allLegal.filter((m) => m.from === sq).map((m) => m.to));
    ui.selected = sq;
    renderSquares();
    renderHints();
    const el = ui.pieceNodes.get(p.id);
    if (!el) return;
    // Единственный layout-read происходит до покадровых записей transform.
    const board = $('#board');
    const rect = board.getBoundingClientRect();
    const layer = $('#pieces');
    const { dx, dy } = disp(ui.st, sq);
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const flipped = !!(ui.rotated || ui.tableRotated);
    dragState = {
      from: sq, x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY,
      pointerId: e.pointerId, active: false, el, layer, capture: e.currentTarget,
      baseX: dx * ui.sq, baseY: dy * ui.sq, target: null, targets, hoverEl: null,
      touch, readyAt: performance.now() + (touch ? 200 : 0), raf: 0,
      state: ui.st, ply: ui.st.plySeq, W: ui.st.W, H: ui.st.H, rect,
      orientation: ui.orientation, flipped, sign: flipped ? -1 : 1,
      scaleX: ui.sq * ui.st.W / rect.width, scaleY: ui.sq * ui.st.H / rect.height,
      zIndex: el.style.zIndex,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (error) { /* старый браузер */ }
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  });

  $('#squares').addEventListener('click', (e) => {
    if (ui.suppressClick) { ui.suppressClick = false; return; }
    const sq = e.target.closest('.sq');
    if (!sq) return;
    const r = sq.getBoundingClientRect();
    ui.aimPoint = {sq:Number(sq.dataset.sq), x:r.width ? (e.clientX-r.left)/r.width : .5, y:r.height ? (e.clientY-r.top)/r.height : .5};
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

  const wakeNetwork = () => {
    const session = netSessionState();
    if (!session || !session.relay) return;
    session.relay.wake();
    if (session.started) requestNetworkSync(session, 'resume');
  };
  window.addEventListener('online', wakeNetwork);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeNetwork(); });
  window.addEventListener('resize', () => {
    if (ui.cancelDrag) ui.cancelDrag();
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
  if (typeof setupV84 === 'function') setupV84();
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
    engine: { createState, legalMoves, genPseudo, applyMove, undoMove, moveToSan, updateStatus, perft, toFen: null, findKing, sqName, positionKey, inCheck, attacked, materialOf, visSet, maybeBlock, centerCells, evaluateWhite, bestMove, MODES, modeById, variants: VariantEngine },
    ui, profile,
    newGame, commitMove, gotoPly, showScreen, myColor, scoreGame, finishGame,
    startBotGame, maybeBotTurn, chooseBotMove, buildGameJson, importGameText,
    startPersonaGame, personaLevel, personaDelay, startTraining, endTraining, trainingLeft, renderTrainingCta,
    openExport, openImport, togglePause, reviewHistoryGame, leaveReview,
    brawlBotTryDeploy, brawlDeploy, brawlCanDeploy, brawlBotPickCard, onlineCoachMayMove,
    phaseFor, updateSameStreak, askLeave, confirmLeaveGame, closeConfirm, fitPhaseBadge,
    chooseWelcomeLanguage, finishWelcome, refreshActiveGame, setCalm, autoBrawlDraft, zombieScan, royalShrink, strategySelectAttacker, strategyAttack, strategyEndTurn, strategyAfterMove, strategySpecial, strategyRender,
    captureFx, playResultFx, renderResultKings, mateKingWaves,
    PIECE_SKINS, applySkin, setPieces, GLASS_VARIANTS, setGlass,
    openSkinModal: () => openSkinModal(),
    setProfile: (patch) => { Object.assign(profile, patch); renderProfile(); renderThemeRows(); renderPieceRows(); renderPreview(); saveProfile(true); },
  };
}

document.addEventListener('DOMContentLoaded', boot);
