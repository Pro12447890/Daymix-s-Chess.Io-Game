'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   Daymix's Chess
   1. Движок правил (ходы, рокировка, взятие на проходе, превращение,
      повторение, правило 50 ходов, недостаточный материал, мат и пат).
   2. Сеть: канал комнаты на публичной службе ntfy (текстовые кадры
      WebSocket + POST) — комната на пять цифр, ходы и часы.
   3. Интерфейс: экраны, доска с анимацией, часы, список ходов.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── 1. ДВИЖОК ─────────────────────────────── */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const fileOf = (i) => i & 7;
const rankOf = (i) => i >> 3;
const idx = (f, r) => r * 8 + f;
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const sqName = (i) => FILES[fileOf(i)] + (rankOf(i) + 1);
const sqFromName = (name) => idx(FILES.indexOf(name[0]), Number(name[1]) - 1);
const otherColor = (c) => (c === 'w' ? 'b' : 'w');

/** Новая позиция из FEN (по умолчанию — начальная). */
function createState(fen = START_FEN) {
  const state = {
    board: new Array(64).fill(null),
    turn: 'w',
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    ep: -1,
    halfmove: 0,
    fullmove: 1,
    history: [],
    sanList: [],
    positions: new Map(),
    nextId: 1,
  };
  const parts = fen.trim().split(/\s+/);
  const [placement, turn, rights, ep, half, full] = parts;
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') { rank -= 1; file = 0; continue; }
    if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
    const color = ch === ch.toUpperCase() ? 'w' : 'b';
    state.board[idx(file, rank)] = { id: state.nextId++, c: color, t: ch.toLowerCase() };
    file += 1;
  }
  state.turn = turn === 'b' ? 'b' : 'w';
  state.castling = {
    wK: !!rights && rights.includes('K'),
    wQ: !!rights && rights.includes('Q'),
    bK: !!rights && rights.includes('k'),
    bQ: !!rights && rights.includes('q'),
  };
  state.ep = ep && ep !== '-' ? sqFromName(ep) : -1;
  state.halfmove = Number(half || 0);
  state.fullmove = Number(full || 1);
  state.positions.set(positionKey(state), 1);
  return state;
}

/** Ключ позиции для правила троекратного повторения. */
function positionKey(state) {
  let layout = '';
  for (let i = 0; i < 64; i += 1) {
    const piece = state.board[i];
    layout += piece ? (piece.c === 'w' ? piece.t.toUpperCase() : piece.t) : '.';
  }
  const rights = (state.castling.wK ? 'K' : '') + (state.castling.wQ ? 'Q' : '')
    + (state.castling.bK ? 'k' : '') + (state.castling.bQ ? 'q' : '');
  return `${layout}|${state.turn}|${rights || '-'}|${state.ep >= 0 ? sqName(state.ep) : '-'}`;
}

/** Бьёт ли поле фигура указанного цвета. */
function isAttacked(state, square, by) {
  const board = state.board;
  const f = fileOf(square);
  const r = rankOf(square);

  // пешки
  const pawnDir = by === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const af = f - df;
    const ar = r - pawnDir;
    if (!onBoard(af, ar)) continue;
    const piece = board[idx(af, ar)];
    if (piece && piece.c === by && piece.t === 'p') return true;
  }
  // кони
  for (const [df, dr] of KNIGHT_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const piece = board[idx(nf, nr)];
    if (piece && piece.c === by && piece.t === 'n') return true;
  }
  // король
  for (const [df, dr] of KING_STEPS) {
    const nf = f + df;
    const nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const piece = board[idx(nf, nr)];
    if (piece && piece.c === by && piece.t === 'k') return true;
  }
  // ладьи и ферзи
  for (const [df, dr] of ROOK_DIRS) {
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const piece = board[idx(nf, nr)];
      if (piece) {
        if (piece.c === by && (piece.t === 'r' || piece.t === 'q')) return true;
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  // слоны и ферзи
  for (const [df, dr] of BISHOP_DIRS) {
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const piece = board[idx(nf, nr)];
      if (piece) {
        if (piece.c === by && (piece.t === 'b' || piece.t === 'q')) return true;
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return false;
}

/** Стоит ли король цвета под шахом. */
function inCheck(state, color) {
  for (let i = 0; i < 64; i += 1) {
    const piece = state.board[i];
    if (piece && piece.t === 'k' && piece.c === color) {
      return isAttacked(state, i, otherColor(color));
    }
  }
  return false;
}

function makeMoveObj(from, to, piece, captured, promo, extra = {}) {
  return {
    from,
    to,
    piece: piece.t,
    color: piece.c,
    captured: captured ? captured.t : null,
    capturedPiece: captured || null,
    promo: promo || null,
    ep: !!extra.ep,
    castle: extra.castle || null,
    double: !!extra.double,
  };
}

/** Ходы без проверки на собственный шах. */
function pseudoMoves(state, color) {
  const moves = [];
  const board = state.board;
  const forward = color === 'w' ? 1 : -1;

  const addPawn = (from, to, captured, extra) => {
    const lastRank = color === 'w' ? 7 : 0;
    if (rankOf(to) === lastRank) {
      for (const promo of ['q', 'r', 'b', 'n']) {
        moves.push(makeMoveObj(from, to, board[from], captured, promo, extra));
      }
    } else {
      moves.push(makeMoveObj(from, to, board[from], captured, null, extra));
    }
  };

  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (!piece || piece.c !== color) continue;
    const f = fileOf(from);
    const r = rankOf(from);

    if (piece.t === 'p') {
      const oneR = r + forward;
      if (!onBoard(f, oneR)) continue;
      const one = idx(f, oneR);
      if (!board[one]) {
        addPawn(from, one, null, {});
        const startRank = color === 'w' ? 1 : 6;
        if (r === startRank) {
          const two = idx(f, r + 2 * forward);
          if (!board[two]) moves.push(makeMoveObj(from, two, piece, null, null, { double: true }));
        }
      }
      for (const df of [-1, 1]) {
        const cf = f + df;
        if (!onBoard(cf, oneR)) continue;
        const target = idx(cf, oneR);
        const victim = board[target];
        if (victim && victim.c !== color) {
          addPawn(from, target, victim, {});
        } else if (!victim && target === state.ep) {
          const victimSq = idx(cf, r);
          const victimPawn = board[victimSq];
          if (victimPawn && victimPawn.c !== color && victimPawn.t === 'p') {
            addPawn(from, target, victimPawn, { ep: true });
          }
        }
      }
      continue;
    }

    if (piece.t === 'n') {
      for (const [df, dr] of KNIGHT_STEPS) {
        const nf = f + df;
        const nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = idx(nf, nr);
        const victim = board[to];
        if (!victim || victim.c !== color) moves.push(makeMoveObj(from, to, piece, victim, null, {}));
      }
      continue;
    }

    if (piece.t === 'k') {
      for (const [df, dr] of KING_STEPS) {
        const nf = f + df;
        const nr = r + dr;
        if (!onBoard(nf, nr)) continue;
        const to = idx(nf, nr);
        const victim = board[to];
        if (!victim || victim.c !== color) moves.push(makeMoveObj(from, to, piece, victim, null, {}));
      }
      // Рокировка: король e1/e8, ладья на своём месте, поля пусты, шах не проходит.
      const homeRank = color === 'w' ? 0 : 7;
      const kingHome = idx(4, homeRank);
      const enemy = otherColor(color);
      const rightK = color === 'w' ? state.castling.wK : state.castling.bK;
      const rightQ = color === 'w' ? state.castling.wQ : state.castling.bQ;
      if (from === kingHome && !isAttacked(state, kingHome, enemy)) {
        if (rightK) {
          const rook = board[idx(7, homeRank)];
          if (rook && rook.t === 'r' && rook.c === color
            && !board[idx(5, homeRank)] && !board[idx(6, homeRank)]
            && !isAttacked(state, idx(5, homeRank), enemy)
            && !isAttacked(state, idx(6, homeRank), enemy)) {
            moves.push(makeMoveObj(from, idx(6, homeRank), piece, null, null, { castle: 'K' }));
          }
        }
        if (rightQ) {
          const rook = board[idx(0, homeRank)];
          if (rook && rook.t === 'r' && rook.c === color
            && !board[idx(1, homeRank)] && !board[idx(2, homeRank)] && !board[idx(3, homeRank)]
            && !isAttacked(state, idx(3, homeRank), enemy)
            && !isAttacked(state, idx(2, homeRank), enemy)) {
            moves.push(makeMoveObj(from, idx(2, homeRank), piece, null, null, { castle: 'Q' }));
          }
        }
      }
      continue;
    }

    // Ферзь, ладья, слон — скользящие.
    const dirs = piece.t === 'q' ? [...ROOK_DIRS, ...BISHOP_DIRS] : piece.t === 'r' ? ROOK_DIRS : BISHOP_DIRS;
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      while (onBoard(nf, nr)) {
        const to = idx(nf, nr);
        const victim = board[to];
        if (victim) {
          if (victim.c !== color) moves.push(makeMoveObj(from, to, piece, victim, null, {}));
          break;
        }
        moves.push(makeMoveObj(from, to, piece, null, null, {}));
        nf += df;
        nr += dr;
      }
    }
  }
  return moves;
}

/** Применить ход; возвращает запись для отката. */
function applyMove(state, move) {
  const board = state.board;
  const piece = board[move.from];
  const undo = {
    move,
    piece,
    captured: null,
    capturedSquare: -1,
    castling: { ...state.castling },
    ep: state.ep,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    keyBefore: positionKey(state),
  };

  board[move.from] = null;

  if (move.ep) {
    const capSq = move.to + (piece.c === 'w' ? -8 : 8);
    undo.captured = board[capSq];
    undo.capturedSquare = capSq;
    board[capSq] = null;
  } else if (board[move.to]) {
    undo.captured = board[move.to];
    undo.capturedSquare = move.to;
  }

  if (move.castle) {
    const homeRank = piece.c === 'w' ? 0 : 7;
    const [rookFrom, rookTo] = move.castle === 'K'
      ? [idx(7, homeRank), idx(5, homeRank)]
      : [idx(0, homeRank), idx(3, homeRank)];
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  board[move.to] = move.promo ? { id: piece.id, c: piece.c, t: move.promo } : piece;

  // Права на рокировку.
  if (piece.t === 'k') {
    if (piece.c === 'w') { state.castling.wK = false; state.castling.wQ = false; }
    else { state.castling.bK = false; state.castling.bQ = false; }
  }
  if (piece.t === 'r') {
    if (move.from === 0) state.castling.wQ = false;
    if (move.from === 7) state.castling.wK = false;
    if (move.from === 56) state.castling.bQ = false;
    if (move.from === 63) state.castling.bK = false;
  }
  if (undo.captured && undo.captured.t === 'r') {
    const sq = undo.capturedSquare;
    if (sq === 0) state.castling.wQ = false;
    if (sq === 7) state.castling.wK = false;
    if (sq === 56) state.castling.bQ = false;
    if (sq === 63) state.castling.bK = false;
  }

  state.ep = move.double ? move.from + (piece.c === 'w' ? 8 : -8) : -1;
  state.halfmove = (piece.t === 'p' || undo.captured) ? 0 : state.halfmove + 1;
  if (piece.c === 'b') state.fullmove += 1;
  state.turn = otherColor(piece.c);

  const key = positionKey(state);
  state.positions.set(key, (state.positions.get(key) || 0) + 1);
  return undo;
}

/** Откатить ход. */
function undoMove(state, undo) {
  const board = state.board;
  const key = positionKey(state);
  const count = state.positions.get(key) || 0;
  if (count <= 1) state.positions.delete(key);
  else state.positions.set(key, count - 1);

  const move = undo.move;
  board[move.from] = undo.piece;
  board[move.to] = null;
  if (undo.captured) board[undo.capturedSquare] = undo.captured;
  if (move.castle) {
    const homeRank = undo.piece.c === 'w' ? 0 : 7;
    const [rookFrom, rookTo] = move.castle === 'K'
      ? [idx(7, homeRank), idx(5, homeRank)]
      : [idx(0, homeRank), idx(3, homeRank)];
    board[rookFrom] = board[rookTo];
    board[rookTo] = null;
  }
  state.castling = undo.castling;
  state.ep = undo.ep;
  state.halfmove = undo.halfmove;
  state.fullmove = undo.fullmove;
  state.turn = undo.piece.c;
}

/** Легальные ходы стороны, которая сейчас ходит. */
function generateLegal(state) {
  const color = state.turn;
  const result = [];
  for (const move of pseudoMoves(state, color)) {
    const undo = applyMove(state, move);
    if (!inCheck(state, color)) result.push(move);
    undoMove(state, undo);
  }
  return result;
}

/** Достаточно ли материала для мата. */
function insufficientMaterial(state) {
  const pieces = { w: [], b: [] };
  for (const piece of state.board) {
    if (piece) pieces[piece.c].push(piece.t);
  }
  const minors = (list) => list.filter((t) => t !== 'k');
  const wm = minors(pieces.w);
  const bm = minors(pieces.b);
  if (wm.length === 0 && bm.length === 0) return true;
  if (wm.length === 1 && bm.length === 0 && (wm[0] === 'b' || wm[0] === 'n')) return true;
  if (bm.length === 1 && wm.length === 0 && (bm[0] === 'b' || bm[0] === 'n')) return true;
  if (wm.length === 1 && bm.length === 1 && wm[0] === 'b' && bm[0] === 'b') {
    const squares = [];
    for (let i = 0; i < 64; i += 1) {
      const piece = state.board[i];
      if (piece && piece.t === 'b') squares.push((fileOf(i) + rankOf(i)) % 2);
    }
    if (squares.length === 2 && squares[0] === squares[1]) return true;
  }
  return false;
}

/** Состояние партии: конец игры, шах, легальные ходы. */
function gameStatus(state) {
  const legal = generateLegal(state);
  const check = inCheck(state, state.turn);
  if (legal.length === 0) {
    return check
      ? { over: true, winner: otherColor(state.turn), reason: 'checkmate', legal, check }
      : { over: true, winner: null, reason: 'stalemate', legal, check };
  }
  if (state.halfmove >= 100) {
    return { over: true, winner: null, reason: 'fifty', legal, check };
  }
  if ((state.positions.get(positionKey(state)) || 0) >= 3) {
    return { over: true, winner: null, reason: 'repetition', legal, check };
  }
  if (insufficientMaterial(state)) {
    return { over: true, winner: null, reason: 'material', legal, check };
  }
  return { over: false, winner: null, reason: null, legal, check };
}

/** Запись хода в нотации SAN. */
function moveToSan(state, move, legalMoves) {
  const piece = state.board[move.from];
  const capture = !!state.board[move.to] || move.ep;
  let san;

  if (move.castle === 'K') san = 'O-O';
  else if (move.castle === 'Q') san = 'O-O-O';
  else if (piece.t === 'p') {
    san = (capture ? FILES[fileOf(move.from)] + 'x' : '') + sqName(move.to);
    if (move.promo) san += '=' + move.promo.toUpperCase();
  } else {
    let disambiguation = '';
    const rivals = legalMoves.filter((m) => m !== move
      && state.board[m.from]
      && state.board[m.from].t === piece.t
      && state.board[m.from].c === piece.c
      && m.to === move.to);
    if (rivals.length) {
      const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
      const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) disambiguation = FILES[fileOf(move.from)];
      else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
      else disambiguation = sqName(move.from);
    }
    san = piece.t.toUpperCase() + disambiguation + (capture ? 'x' : '') + sqName(move.to);
  }

  const undo = applyMove(state, move);
  const opponent = state.turn;
  const opponentMoves = generateLegal(state);
  if (inCheck(state, opponent)) san += opponentMoves.length ? '+' : '#';
  undoMove(state, undo);
  return san;
}

/** Число позиций на глубине — для проверки правил. */
function perft(state, depth) {
  if (depth === 0) return 1;
  const legal = generateLegal(state);
  if (depth === 1) return legal.length;
  let total = 0;
  for (const move of legal) {
    const undo = applyMove(state, move);
    total += perft(state, depth - 1);
    undoMove(state, undo);
  }
  return total;
}

/* ─────────────────────────── 2. СЕТЬ (ntfy) ────────────────────────── */

/* Транспорт — публичная служба ntfy.sh.
   Почему не MQTT и не WebRTC: в этой сети TLS-канал пропускает только
   текстовые кадры WebSocket, а бинарные молча теряются. MQTT бинарный, поэтому
   до брокера доходит только CONNECT; ntfy общается JSON-текстом и работает.
   Подписка — WebSocket, отправка — обычный POST на тот же адрес. */

const RELAY_HTTP = 'https://ntfy.sh/';
const RELAY_WS = 'wss://ntfy.sh/';
const TOPIC_PREFIX = 'daymixchess-v1-';

/** Канал комнаты по коду из пяти цифр. */
const topicFor = (code) => TOPIC_PREFIX + code;

/** Случайный идентификатор партии: отсекает старые сообщения из кэша. */
function randomSid() {
  return Math.random().toString(36).slice(2, 10);
}

class Relay {
  constructor() {
    this.ws = null;
    this.topic = '';
    this.onMessage = null;
    this.onClose = null;
    this.closed = false;
  }

  connect(code) {
    this.topic = topicFor(code);
    this.closed = false;
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
        if (!this.closed && this.onClose) this.onClose();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('ошибка соединения'));
      };
    });
  }

  /** Отправка хода или служебного сообщения на канал комнаты. */
  publish(payload) {
    if (!this.topic) return Promise.resolve();
    const body = JSON.stringify(payload);
    return fetch(RELAY_HTTP + this.topic, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
    }).catch(() => { /* сеть моргнула: сообщение не ушло, его можно повторить */ });
  }

  close() {
    this.closed = true;
    try { if (this.ws) this.ws.close(); } catch (error) { /* уже закрыт */ }
    this.ws = null;
  }
}

/** Отправить сообщение сопернику. */
function netPublish(payload) {
  if (!ui.online || !ui.online.relay) return;
  payload.app = 'daymix-chess';
  payload.v = 1;
  // sender, а не from: поле from у хода занято клеткой-источником.
  payload.sender = ui.online.role;
  payload.sid = ui.online.sid || null;
  payload.mid = Math.random().toString(36).slice(2, 10);
  payload.ts = Date.now();
  payload.seen = undefined;
  ui.online.relay.publish(payload);
}


/* ─────────────────────────── 3. ИНТЕРФЕЙС ──────────────────────────── */

const TIME_GROUPS = [
  {
    title: 'Блиц',
    items: [
      { label: '30 секунд', ms: 30 * 1000 },
      { label: '1 минута', ms: 60 * 1000 },
      { label: '3 минуты', ms: 3 * 60 * 1000 },
    ],
  },
  {
    title: 'Рапид',
    items: [
      { label: '5 минут', ms: 5 * 60 * 1000 },
      { label: '10 минут', ms: 10 * 60 * 1000 },
      { label: '20 минут', ms: 20 * 60 * 1000 },
      { label: '30 минут', ms: 30 * 60 * 1000 },
    ],
  },
  {
    title: 'Долгие',
    items: [
      { label: '45 минут', ms: 45 * 60 * 1000 },
      { label: '60 минут', ms: 60 * 60 * 1000 },
    ],
  },
  {
    title: 'Без ограничений',
    items: [{ label: '6 часов', ms: 6 * 60 * 60 * 1000 }],
  },
];

const GLYPHS = {
  w: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const ui = {
  screen: 'home',
  mode: null,          // 'local' | 'online'
  time: null,          // {label, ms}
  state: null,
  status: null,
  legal: [],
  orientation: 'w',
  selected: -1,
  flip: true,
  clocks: { w: 0, b: 0 },
  running: false,
  lastTick: 0,
  result: null,
  myColor: 'w',        // для сети: за кого играем
  opponentColor: 'b',
  online: null,        // { code, role, relay, sid, started, paused }
  pieceEls: new Map(),
  squareSize: 64,
  requestDrawSent: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  screens: ['home', 'time', 'online', 'game'].reduce((acc, name) => {
    acc[name] = $('screen-' + name);
    return acc;
  }, {}),
  topMode: $('topMode'),
  timeGroups: $('timeGroups'),
  timeTitle: $('timeTitle'),
  timeMode: $('timeMode'),
  roomCode: $('roomCode'),
  createStatus: $('createStatus'),
  joinCode: $('joinCode'),
  joinStatus: $('joinStatus'),
  board: $('board'),
  squares: $('squares'),
  pieces: $('pieces'),
  hints: $('hints'),
  coordFiles: $('coordFiles'),
  coordRanks: $('coordRanks'),
  promo: $('promo'),
  promoRow: $('promoRow'),
  topName: $('topName'),
  topRole: $('topRole'),
  bottomName: $('bottomName'),
  bottomRole: $('bottomRole'),
  topCaptured: $('topCaptured'),
  bottomCaptured: $('bottomCaptured'),
  topClock: $('topClock'),
  bottomClock: $('bottomClock'),
  barTop: $('barTop'),
  barBottom: $('barBottom'),
  gameStatus: $('gameStatus'),
  gameInfo: $('gameInfo'),
  moves: $('moves'),
  flipToggle: $('flipToggle'),
  result: $('result'),
  resultTitle: $('resultTitle'),
  resultSub: $('resultSub'),
  toast: $('toast'),
};

/* ── вспомогательное ─────────────────────────────────────────────────── */

function showScreen(name) {
  ui.screen = name;
  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.toggle('active', key === name);
  }
  if (name === 'home') el.topMode.textContent = '';
  else if (name === 'time') el.topMode.textContent = '';
  else if (name === 'online') el.topMode.textContent = 'Партия по сети';
  if (name === 'game') layoutBoard();
}

let toastTimer = 0;
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function formatClock(ms) {
  const clamped = Math.max(0, ms);
  if (clamped >= 60000) {
    const total = Math.floor(clamped / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return (clamped / 1000).toFixed(1);
}

function labelForRole(role) {
  return role === 'w' ? 'белые' : 'чёрные';
}

/* ── размеры доски ───────────────────────────────────────────────────── */

/* Ширина доски задаётся вёрсткой (100% колонки, не больше 640px), а размер
   клетки считается по ней. Поэтому --sq не влияет на ширину и петли нет. */
function layoutBoard() {
  if (!el.board) return;
  const wrap = el.board.parentElement;
  if (!wrap) return;
  const width = wrap.clientWidth;
  if (!width) return;
  const size = Math.max(24, (width - 32) / 8);
  if (Math.abs(size - ui.squareSize) < 0.1) return;
  ui.squareSize = size;
  document.documentElement.style.setProperty('--sq', size + 'px');
  if (ui.state) {
    renderPieces(false);
    renderHints();
  }
}

if (typeof ResizeObserver !== 'undefined') {
  const wrapObserver = new ResizeObserver(() => {
    if (ui.screen === 'game') layoutBoard();
  });
  wrapObserver.observe(el.board.parentElement);
}

window.addEventListener('resize', () => {
  if (ui.screen === 'game') layoutBoard();
});

/* ── экран выбора времени ────────────────────────────────────────────── */

function renderTimeScreen(mode) {
  ui.mode = mode;
  el.timeTitle.textContent = mode === 'online' ? 'Контроль времени для партии по сети' : 'Контроль времени';
  el.timeMode.textContent = mode === 'online' ? 'Игра по сети' : 'Игра с другом здесь же';
  el.timeGroups.innerHTML = '';
  for (const group of TIME_GROUPS) {
    const wrap = document.createElement('div');
    wrap.className = 'time-group';
    const title = document.createElement('div');
    title.className = 'time-group-title';
    title.textContent = group.title;
    const row = document.createElement('div');
    row.className = 'time-row';
    for (const item of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'time-btn';
      const minutes = item.ms / 60000;
      button.innerHTML = `${item.label}<small>${formatControlNote(minutes)}</small>`;
      button.addEventListener('click', () => chooseTime(item));
      row.appendChild(button);
    }
    wrap.appendChild(title);
    wrap.appendChild(row);
    el.timeGroups.appendChild(wrap);
  }
  showScreen('time');
}

function formatControlNote(minutes) {
  if (minutes < 1) return 'на всю партию';
  if (minutes >= 60) return `${Math.round(minutes / 60)} ч на игрока`;
  return `${minutes} мин на игрока`;
}

function chooseTime(item) {
  ui.time = item;
  if (ui.mode === 'local') {
    startGame({ mode: 'local' });
  } else {
    showScreen('online');
    el.createStatus.textContent = '';
    el.joinStatus.textContent = '';
  }
}

/* ── партия ──────────────────────────────────────────────────────────── */

function startGame({ mode, fen, clocks, myColor = 'w', online = null, keepOnline = false }) {
  ui.mode = mode;
  ui.state = createState(fen || START_FEN);
  ui.status = gameStatus(ui.state);
  ui.legal = ui.status.legal;
  ui.selected = -1;
  ui.result = null;
  ui.myColor = myColor;
  ui.opponentColor = otherColor(myColor);
  ui.orientation = mode === 'online' ? myColor : 'w';
  ui.clocks = {
    w: clocks ? clocks.w : ui.time.ms,
    b: clocks ? clocks.b : ui.time.ms,
  };
  ui.running = !ui.status.over;
  ui.lastTick = performance.now();
  ui.pieceEls.clear();
  el.pieces.innerHTML = '';
  if (online) ui.online = online;
  else if (!keepOnline) ui.online = null;

  el.result.classList.remove('show');
  el.promo.classList.remove('show');
  el.flipToggle.checked = ui.flip;
  el.flipToggle.disabled = mode === 'online';
  ui.requestDrawSent = false;

  renderAll();
  showScreen('game');
  updateNames();
  updateInfo();
  tickClock(true);
  if (ui.clockTimer) clearInterval(ui.clockTimer);
  ui.clockTimer = setInterval(tickClock, 100);
}

function updateNames() {
  const bottomColor = ui.orientation;
  const topColor = otherColor(bottomColor);

  if (ui.mode === 'online') {
    el.bottomName.textContent = bottomColor === ui.myColor ? 'Вы' : 'Соперник';
    el.topName.textContent = topColor === ui.myColor ? 'Вы' : 'Соперник';
  } else {
    el.bottomName.textContent = bottomColor === 'w' ? 'Белые' : 'Чёрные';
    el.topName.textContent = topColor === 'w' ? 'Белые' : 'Чёрные';
  }
  el.bottomRole.textContent = ui.mode === 'local' ? '' : labelForRole(bottomColor);
  el.topRole.textContent = ui.mode === 'local' ? '' : labelForRole(topColor);
  el.topMode.textContent = ui.mode === 'online' && ui.online
    ? 'Партия по сети · код ' + ui.online.code
    : 'Игра вдвоём за одним экраном';
  el.barTop.classList.toggle('active', ui.state.turn === topColor && !ui.status.over);
  el.barBottom.classList.toggle('active', ui.state.turn === bottomColor && !ui.status.over);
}

function updateInfo() {
  if (!el.gameInfo) return;
  const parts = [];
  if (ui.time) parts.push(ui.time.label);
  if (ui.mode === 'online' && ui.online) parts.push('по сети · ' + ui.online.code);
  if (ui.mode === 'local') parts.push('на одном устройстве');
  el.gameInfo.textContent = parts.join(' · ');
}

/* ── отрисовка доски ─────────────────────────────────────────────────── */

function buildSquares() {
  el.squares.innerHTML = '';
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const file = ui.orientation === 'w' ? col : 7 - col;
      const rank = ui.orientation === 'w' ? 7 - row : row;
      const square = document.createElement('div');
      square.className = 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
      square.dataset.sq = String(idx(file, rank));
      el.squares.appendChild(square);
    }
  }
  renderCoords();
}

/** Буквы файлов и цифры рангов по краям доски. */
function renderCoords() {
  const files = [];
  const ranks = [];
  for (let i = 0; i < 8; i += 1) {
    const file = ui.orientation === 'w' ? i : 7 - i;
    const rank = ui.orientation === 'w' ? 7 - i : i;
    files.push(FILES[file]);
    ranks.push(String(rank + 1));
  }
  el.coordFiles.innerHTML = files.map((text) => `<span>${text}</span>`).join('');
  el.coordRanks.innerHTML = ranks.map((text) => `<span>${text}</span>`).join('');
}

function squareToXY(square) {
  const file = ui.orientation === 'w' ? fileOf(square) : 7 - fileOf(square);
  const rank = ui.orientation === 'w' ? 7 - rankOf(square) : rankOf(square);
  return { x: file * ui.squareSize, y: rank * ui.squareSize };
}

function renderPieces(animate = true) {
  if (!ui.state) return;
  const seen = new Set();
  for (let square = 0; square < 64; square += 1) {
    const piece = ui.state.board[square];
    if (!piece) continue;
    seen.add(piece.id);
    let node = ui.pieceEls.get(piece.id);
    if (!node) {
      node = document.createElement('div');
      node.className = `piece ${piece.c}`;
      node.dataset.id = String(piece.id);
      node.dataset.sq = String(square);
      node.textContent = GLYPHS[piece.c][piece.t];
      if (!animate) {
        node.style.transition = 'none';
        requestAnimationFrame(() => { node.style.transition = ''; });
      }
      el.pieces.appendChild(node);
      ui.pieceEls.set(piece.id, node);
    } else if (node.textContent !== GLYPHS[piece.c][piece.t]) {
      node.textContent = GLYPHS[piece.c][piece.t];
    }
    if (!animate) {
      // без анимации: фигура прыгает сразу, иначе при смене размера доски
      // она «доезжает» из старой раскладки
      node.style.transition = 'none';
      requestAnimationFrame(() => { node.style.transition = ''; });
    }
    const { x, y } = squareToXY(square);
    node.style.transform = `translate(${x}px, ${y}px)`;
    node.dataset.sq = String(square);
  }
  for (const [id, node] of [...ui.pieceEls]) {
    if (seen.has(id)) continue;
    node.classList.add('captured-anim');
    ui.pieceEls.delete(id);
    setTimeout(() => node.remove(), 220);
  }
}

function renderHints() {
  el.hints.innerHTML = '';
  for (const square of el.squares.children) {
    square.classList.remove('selected', 'last', 'check');
  }
  if (!ui.state) return;

  const lastMove = ui.state.history[ui.state.history.length - 1];
  if (lastMove) {
    const { move } = lastMove;
    markSquare(move.from, 'last');
    markSquare(move.to, 'last');
  }

  const kingSquare = findKing(ui.state, ui.state.turn);
  if (ui.status && ui.status.check && kingSquare >= 0) markSquare(kingSquare, 'check');
  if (ui.selected >= 0) markSquare(ui.selected, 'selected');

  if (ui.selected < 0) return;
  for (const move of ui.legal) {
    if (move.from !== ui.selected) continue;
    const { x, y } = squareToXY(move.to);
    const hint = document.createElement('div');
    const isCapture = !!ui.state.board[move.to] || move.ep;
    hint.className = 'hint' + (isCapture ? ' capture' : '');
    hint.style.left = (x + ui.squareSize / 2) + 'px';
    hint.style.top = (y + ui.squareSize / 2) + 'px';
    hint.dataset.to = String(move.to);
    el.hints.appendChild(hint);
  }
}

function markSquare(square, className) {
  if (square < 0) return;
  const node = el.squares.querySelector(`[data-sq="${square}"]`);
  if (node) node.classList.add(className);
}

function findKing(state, color) {
  for (let i = 0; i < 64; i += 1) {
    const piece = state.board[i];
    if (piece && piece.t === 'k' && piece.c === color) return i;
  }
  return -1;
}

function renderMoves() {
  if (!ui.state || !ui.state.sanList.length) {
    el.moves.innerHTML = '<div class="moves-empty">Пока пусто</div>';
    return;
  }
  const rows = [];
  for (let i = 0; i < ui.state.sanList.length; i += 2) {
    const white = ui.state.sanList[i];
    const black = ui.state.sanList[i + 1] || '';
    const lastWhite = i === ui.state.sanList.length - 1;
    const lastBlack = i + 1 === ui.state.sanList.length - 1;
    rows.push(`<tr><td class="num">${i / 2 + 1}.</td>`
      + `<td class="san${lastWhite ? ' last' : ''}">${white}</td>`
      + `<td class="san${lastBlack ? ' last' : ''}">${black}</td></tr>`);
  }
  el.moves.innerHTML = `<table>${rows.join('')}</table>`;
  el.moves.scrollTop = el.moves.scrollHeight;
}

function renderAll(animatePieces = false) {
  buildSquares();
  renderPieces(animatePieces);
  renderHints();
  renderMoves();
  updateClocks();
  updateStatus();
  updateNames();
  updateCaptured();
}

function updateCaptured() {
  if (!ui.state) return;
  const counts = { w: {}, b: {} };
  for (const piece of ui.state.board) {
    if (piece) counts[piece.c][piece.t] = (counts[piece.c][piece.t] || 0) + 1;
  }
  const initial = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const lost = (color) => {
    const parts = [];
    for (const type of ['q', 'r', 'b', 'n', 'p']) {
      const missing = initial[type] - (counts[color][type] || 0);
      for (let i = 0; i < missing; i += 1) parts.push(GLYPHS[color][type]);
    }
    return parts;
  };
  const bottomColor = ui.orientation;
  el.bottomCaptured.textContent = lost(otherColor(bottomColor)).join('');
  el.topCaptured.textContent = lost(bottomColor).join('');
}

function updateStatus() {
  if (!ui.state) return;
  const status = ui.status;
  if (status.over) {
    el.gameStatus.className = 'game-status over';
    el.gameStatus.textContent = resultText(status);
    return;
  }
  el.gameStatus.className = 'game-status' + (status.check ? ' check' : '');
  const side = ui.state.turn === 'w' ? 'Белые' : 'Чёрные';
  const mine = ui.mode === 'online' && ui.state.turn === ui.myColor;
  el.gameStatus.textContent = status.check
    ? `${side}: шах${mine ? ' — ваш король' : ''}`
    : `${side} ходят${mine ? ' — ваш ход' : ''}`;
}

function resultText(status) {
  if (status.reason === 'checkmate') {
    return `Мат — победа ${status.winner === 'w' ? 'белых' : 'чёрных'}`;
  }
  if (status.reason === 'stalemate') return 'Пат — ничья';
  if (status.reason === 'fifty') return 'Правило 50 ходов — ничья';
  if (status.reason === 'repetition') return 'Троекратное повторение — ничья';
  if (status.reason === 'material') return 'Недостаточный материал — ничья';
  if (status.reason === 'timeout') return `Время вышло — победа ${status.winner === 'w' ? 'белых' : 'чёрных'}`;
  if (status.reason === 'resign') return `${status.winner === 'w' ? 'Белые' : 'Чёрные'} победили — соперник сдался`;
  if (status.reason === 'abandon') return 'Соперник отключился';
  if (status.reason === 'agreement') return 'Ничья по договорённости';
  return 'Партия окончена';
}

/* ── часы ────────────────────────────────────────────────────────────── */

function tickClock(force = false) {
  if (!ui.state) return;
  const now = performance.now();
  const delta = now - ui.lastTick;
  ui.lastTick = now;
  if (ui.running && !ui.status.over && !isPaused()) {
    ui.clocks[ui.state.turn] -= force ? 0 : delta;
    if (ui.clocks[ui.state.turn] <= 0) {
      ui.clocks[ui.state.turn] = 0;
      finishGame({ over: true, winner: otherColor(ui.state.turn), reason: 'timeout' });
      return;
    }
  }
  updateClocks();
}

function isPaused() {
  return ui.mode === 'online' && ui.online && ui.online.paused;
}

function updateClocks() {
  if (!ui.state || !ui.clocks) return;
  const bottomColor = ui.orientation;
  const topColor = otherColor(bottomColor);
  el.bottomClock.textContent = formatClock(ui.clocks[bottomColor]);
  el.topClock.textContent = formatClock(ui.clocks[topColor]);
  el.bottomClock.classList.toggle('low', ui.clocks[bottomColor] < 20000);
  el.topClock.classList.toggle('low', ui.clocks[topColor] < 20000);
  el.bottomClock.classList.toggle('flagged', ui.clocks[bottomColor] <= 0);
  el.topClock.classList.toggle('flagged', ui.clocks[topColor] <= 0);
}

/* ── ходы ────────────────────────────────────────────────────────────── */

function canMoveNow() {
  if (!ui.state || ui.status.over) return false;
  if (ui.mode !== 'online') return true;
  return ui.state.turn === ui.myColor && ui.online && ui.online.started && !isPaused();
}

function selectSquare(square) {
  if (!canMoveNow()) return;
  const piece = ui.state.board[square];
  const side = ui.state.turn;
  if (ui.selected >= 0) {
    const target = ui.legal.find((m) => m.from === ui.selected && m.to === square);
    if (target) {
      playMove(ui.selected, square);
      return;
    }
  }
  if (piece && piece.c === side) {
    ui.selected = ui.selected === square ? -1 : square;
  } else {
    ui.selected = -1;
  }
  renderHints();
}

function playMove(from, to) {
  const candidates = ui.legal.filter((m) => m.from === from && m.to === to);
  if (!candidates.length) return;
  if (candidates.length > 1) {
    askPromotion(candidates);
    return;
  }
  commitMove(candidates[0]);
}

function askPromotion(candidates) {
  el.promo.classList.add('show');
  el.promoRow.innerHTML = '';
  const color = candidates[0].color;
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const move = candidates.find((m) => m.promo === promotion);
    if (!move) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promo-btn ' + (color === 'w' ? 'w' : 'b');
    button.textContent = GLYPHS[color][promotion];
    button.addEventListener('click', () => {
      el.promo.classList.remove('show');
      commitMove(move);
    });
    el.promoRow.appendChild(button);
  }
}

function commitMove(move) {
  const san = moveToSan(ui.state, move, ui.legal);
  const capturedPiece = move.ep
    ? ui.state.board[move.to + (move.color === 'w' ? -8 : 8)]
    : ui.state.board[move.to];
  applyMove(ui.state, move);
  ui.state.sanList.push(san);
  ui.state.history.push({ move, san, captured: capturedPiece });

  ui.selected = -1;
  ui.status = gameStatus(ui.state);
  ui.legal = ui.status.legal;

  if (ui.mode === 'online' && ui.online) {
    sendNet({
      t: 'move',
      from: sqName(move.from),
      to: sqName(move.to),
      promo: move.promo || null,
      clock: { w: Math.round(ui.clocks.w), b: Math.round(ui.clocks.b) },
    });
    ui.online.paused = false;
  }

  if (ui.mode === 'local' && ui.flip) {
    ui.orientation = ui.state.turn;
  }

  renderAll(ui.mode === 'local' && ui.flip);
  if (ui.status.over) finishGame(ui.status);
}

/* ── конец партии ────────────────────────────────────────────────────── */

function finishGame(status) {
  ui.status = status;
  ui.running = false;
  renderAll();
  saveHistory(status);

  let title = 'Партия окончена';
  if (status.reason === 'checkmate') title = 'Мат';
  else if (status.reason === 'stalemate') title = 'Пат';
  else if (status.reason === 'timeout') title = 'Время вышло';
  else if (status.reason === 'resign') title = 'Сдача';
  else if (status.reason === 'agreement') title = 'Ничья';
  else if (status.reason === 'repetition') title = 'Ничья';
  else if (status.reason === 'fifty') title = 'Ничья';
  else if (status.reason === 'material') title = 'Ничья';
  else if (status.reason === 'abandon') title = 'Соперник отключился';

  el.resultTitle.textContent = title;
  el.resultSub.textContent = resultText(status);
  el.result.classList.add('show');
}

function saveHistory(status) {
  try {
    const record = {
      date: new Date().toISOString(),
      mode: ui.mode,
      time: ui.time ? ui.time.label : '',
      result: status.reason,
      winner: status.winner,
      moves: ui.state.sanList.slice(),
    };
    const all = JSON.parse(localStorage.getItem('daymix-chess-history') || '[]');
    all.unshift(record);
    localStorage.setItem('daymix-chess-history', JSON.stringify(all.slice(0, 30)));
  } catch (error) {
    /* история не критична */
  }
}

/* ── сеть: лобби и обмен ─────────────────────────────────────────────── */

function randomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function setStatusLine(node, text, kind = '') {
  node.className = 'status-line' + (kind ? ' ' + kind : '');
  node.innerHTML = '';
  if (kind === 'ok' || kind === 'err') {
    const dot = document.createElement('span');
    dot.className = 'dot';
    node.appendChild(dot);
  }
  node.appendChild(document.createTextNode(text));
}

async function createRoom() {
  if (!ui.time) { toast('Сначала выберите время'); return; }
  const code = randomCode();
  const relay = new Relay();
  setStatusLine(el.createStatus, 'Готовим комнату…');
  try {
    await relay.connect(code);
    ui.online = {
      code,
      role: 'host',
      relay,
      sid: randomSid(),
      started: false,
      paused: false,
      seen: new Set(),
    };
    relay.onMessage = (text) => handleNetMessage(text, 'host');
    relay.onClose = () => onSocketClosed('host');
    el.roomCode.textContent = code;
    el.roomCode.classList.remove('hidden');
    $('btnCopyCode').classList.remove('hidden');
    setStatusLine(el.createStatus, 'Ждём друга — код ' + code, 'ok');
    netPublish({ t: 'offer', tc: ui.time.ms, label: ui.time.label });
    ui.offerTimer = setInterval(() => {
      if (!ui.online || ui.online.started) return;
      netPublish({ t: 'offer', tc: ui.time.ms, label: ui.time.label });
    }, 4000);
    history.replaceState(null, '', '?code=' + code);
  } catch (error) {
    setStatusLine(el.createStatus, 'Не удалось открыть комнату: ' + error.message, 'err');
  }
}

async function joinRoom() {
  const code = el.joinCode.value.replace(/\D/g, '').slice(0, 5);
  if (code.length !== 5) { setStatusLine(el.joinStatus, 'Нужен код из пяти цифр', 'err'); return; }
  if (!ui.time) { toast('Сначала выберите время'); return; }
  const relay = new Relay();
  setStatusLine(el.joinStatus, 'Подключаемся…');
  try {
    await relay.connect(code);
    ui.online = {
      code,
      role: 'guest',
      relay,
      sid: null,
      started: false,
      paused: false,
      seen: new Set(),
    };
    relay.onMessage = (text) => handleNetMessage(text, 'guest');
    relay.onClose = () => onSocketClosed('guest');
    setStatusLine(el.joinStatus, 'Ищем игру ' + code + '…');
    netPublish({ t: 'hello', tc: ui.time.ms });
    ui.helloTimer = setInterval(() => {
      if (!ui.online || ui.online.started) return;
      netPublish({ t: 'hello', tc: ui.time.ms });
    }, 2000);
    ui.joinTimer = setTimeout(() => {
      if (ui.online && !ui.online.started) {
        setStatusLine(el.joinStatus, 'Никто не ответил по коду ' + code, 'err');
        leaveOnline();
      }
    }, 12000);
    history.replaceState(null, '', '?code=' + code);
  } catch (error) {
    setStatusLine(el.joinStatus, 'Не удалось подключиться: ' + error.message, 'err');
  }
}

function sendNet(payload) {
  if (!ui.online || !ui.online.started) return;
  netPublish(payload);
}

function handleNetMessage(raw, role) {
  let message;
  try { message = JSON.parse(raw); } catch (error) { return; }
  if (!message || message.sender === role) return;
  if (message.app && message.app !== 'daymix-chess') return;
  if (!ui.online) return;

  // Чужая партия в том же канале или сообщение из кэша службы.
  if (ui.online.sid && message.sid && message.sid !== ui.online.sid) return;
  if (message.ts && Date.now() - message.ts > 120000) return;
  if (message.mid) {
    if (ui.online.seen.has(message.mid)) return;
    ui.online.seen.add(message.mid);
    if (ui.online.seen.size > 300) ui.online.seen.clear();
  }

  if (role === 'host' && message.t === 'hello') {
    if (ui.online.started) {
      netPublish({
        t: 'welcome',
        tc: ui.time.ms,
        label: ui.time.label,
        full: true,
        fen: currentFen(),
        clock: { w: Math.round(ui.clocks.w), b: Math.round(ui.clocks.b) },
      });
      return;
    }
    if (message.ts && Date.now() - message.ts > 60000) return;
    ui.online.started = true;
    clearInterval(ui.offerTimer);
    netPublish({
      t: 'welcome',
      tc: ui.time.ms,
      label: ui.time.label,
      fen: START_FEN,
      clock: { w: ui.time.ms, b: ui.time.ms },
    });
    startGame({ mode: 'online', myColor: 'w', online: ui.online });
    toast('Соперник подключился');
    return;
  }

  if (role === 'guest' && message.t === 'welcome') {
    clearTimeout(ui.joinTimer);
    clearInterval(ui.helloTimer);
    if (!ui.online.sid) ui.online.sid = message.sid || null;
    ui.online.started = true;
    const entry = { mode: 'online', myColor: 'b', online: ui.online };
    if (ui.state && ui.screen === 'game' && message.full) {
      startGame({ ...entry, fen: message.fen, clocks: message.clock });
      toast('Связь восстановлена');
    } else {
      startGame({ ...entry, fen: message.fen || START_FEN, clocks: message.clock });
      toast('Подключено');
    }
    return;
  }

  if (role === 'guest' && message.t === 'offer' && !ui.online.started) {
    // предложение уже видели — просто держим статус
    return;
  }

  if (!ui.online.started) return;


  if (message.t === 'move') {
    applyRemoteMove(message);
    return;
  }

  if (message.t === 'resign') {
    finishGame({ over: true, winner: ui.myColor, reason: 'resign' });
    return;
  }

  if (message.t === 'draw-offer') {
    if (ui.status.over) return;
    if (window.confirm('Соперник предлагает ничью. Согласны?')) {
      sendNet({ t: 'draw-accept' });
      finishGame({ over: true, winner: null, reason: 'agreement' });
    } else {
      sendNet({ t: 'draw-decline' });
    }
    return;
  }

  if (message.t === 'draw-accept') {
    finishGame({ over: true, winner: null, reason: 'agreement' });
    return;
  }

  if (message.t === 'rematch') {
    if (window.confirm('Соперник предлагает новую партию. Сыграем?')) {
      sendNet({ t: 'rematch-yes' });
      startGame({ mode: 'online', myColor: ui.myColor, online: ui.online });
    }
    return;
  }

  if (message.t === 'sync') {
    if (ui.online.role === 'guest') {
      ui.online.paused = false;
      startGame({ mode: 'online', myColor: 'b', online: ui.online, fen: message.fen, clocks: message.clock });
      toast('Связь восстановлена');
    }
    return;
  }
}

function currentFen() {
  let placement = '';
  for (let rank = 7; rank >= 0; rank -= 1) {
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = ui.state.board[idx(file, rank)];
      if (!piece) { empty += 1; continue; }
      if (empty) { placement += empty; empty = 0; }
      placement += piece.c === 'w' ? piece.t.toUpperCase() : piece.t;
    }
    if (empty) placement += empty;
    if (rank) placement += '/';
  }
  const rights = (ui.state.castling.wK ? 'K' : '') + (ui.state.castling.wQ ? 'Q' : '')
    + (ui.state.castling.bK ? 'k' : '') + (ui.state.castling.bQ ? 'q' : '') || '-';
  return `${placement} ${ui.state.turn} ${rights} ${ui.state.ep >= 0 ? sqName(ui.state.ep) : '-'} ${ui.state.halfmove} ${ui.state.fullmove}`;
}

function applyRemoteMove(message) {
  const from = sqFromName(message.from);
  const to = sqFromName(message.to);
  const legal = generateLegal(ui.state);
  const candidates = legal.filter((m) => m.from === from && m.to === to && (m.promo || null) === (message.promo || null));
  if (!candidates.length) {
    toast('Соперник прислал недопустимый ход');
    return;
  }
  const move = candidates[0];
  const san = moveToSan(ui.state, move, legal);
  applyMove(ui.state, move);
  ui.state.sanList.push(san);
  ui.state.history.push({ move, san, captured: null });
  ui.legal = generateLegal(ui.state);
  ui.status = gameStatus(ui.state);
  ui.selected = -1;
  if (message.clock) {
    ui.clocks.w = message.clock.w;
    ui.clocks.b = message.clock.b;
  }
  ui.lastTick = performance.now();
  renderAll();
  if (ui.status.over) finishGame(ui.status);
}

function onSocketClosed(role) {
  if (!ui.online || ui.online.role !== role) return;
  ui.online.paused = true;
  toast('Связь с соперником потеряна — часы остановлены');
  if (!ui.status.over) el.gameStatus.textContent = 'Ожидание связи…';
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!ui.online || ui.reconnectTimer) return;
  ui.reconnectTimer = setTimeout(async () => {
    ui.reconnectTimer = null;
    if (!ui.online) return;
    const relay = new Relay();
    try {
      await relay.connect(ui.online.code);
      relay.onMessage = (text) => handleNetMessage(text, ui.online ? ui.online.role : 'guest');
      relay.onClose = () => onSocketClosed(ui.online ? ui.online.role : 'guest');
      ui.online.relay = relay;
      ui.online.paused = false;
      if (ui.online.role === 'guest') {
        netPublish({ t: 'hello', tc: ui.time.ms, reconnect: true });
      }
      toast('Связь восстановлена');
    } catch (error) {
      scheduleReconnect();
    }
  }, 2500);
}

function leaveOnline() {
  if (ui.online) {
    try { ui.online.relay && ui.online.relay.close(); } catch (error) { /* уже закрыт */ }
    clearInterval(ui.offerTimer);
    clearInterval(ui.helloTimer);
    clearTimeout(ui.joinTimer);
    ui.online = null;
  }
  clearTimeout(ui.reconnectTimer);
  ui.reconnectTimer = null;
}

/* ── взаимодействие с доской ─────────────────────────────────────────── */

function squareFromPoint(clientX, clientY) {
  const rect = el.board.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return -1;
  const col = Math.floor(x / (rect.width / 8));
  const row = Math.floor(y / (rect.height / 8));
  const file = ui.orientation === 'w' ? col : 7 - col;
  const rank = ui.orientation === 'w' ? 7 - row : row;
  return idx(file, rank);
}

let drag = null;

el.board.addEventListener('pointerdown', (event) => {
  if (!canMoveNow()) return;
  const square = squareFromPoint(event.clientX, event.clientY);
  if (square < 0) return;

  // Если фигура уже выбрана — сначала пробуем сходить на это поле.
  if (ui.selected >= 0 && square !== ui.selected) {
    const move = ui.legal.find((m) => m.from === ui.selected && m.to === square);
    if (move) {
      playMove(ui.selected, square);
      event.preventDefault();
      return;
    }
  }

  const piece = ui.state.board[square];
  const own = piece && piece.c === ui.state.turn;

  if (!own) {
    ui.selected = -1;
    renderHints();
    return;
  }

  if (ui.selected === square) {
    ui.selected = -1;
    renderHints();
    return;
  }

  ui.selected = square;
  renderHints();
  const node = ui.pieceEls.get(piece.id);
  drag = { square, node, startX: event.clientX, startY: event.clientY, moved: false };
  if (node) node.classList.add('dragging');
  event.preventDefault();
});

window.addEventListener('pointermove', (event) => {
  if (!drag || !drag.node) return;
  const rect = el.board.getBoundingClientRect();
  const x = event.clientX - rect.left - ui.squareSize / 2;
  const y = event.clientY - rect.top - ui.squareSize / 2;
  drag.node.style.transform = `translate(${x}px, ${y}px)`;
  if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
});

window.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const { square, node, moved } = drag;
  drag = null;
  if (node) node.classList.remove('dragging');

  if (moved) {
    const target = squareFromPoint(event.clientX, event.clientY);
    if (target >= 0 && target !== square) {
      playMove(square, target);
      return;
    }
  }
  // Тап или отменённый перетаск: фигура возвращается, выделение остаётся.
  renderPieces(false);
  renderHints();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    ui.selected = -1;
    el.promo.classList.remove('show');
    renderHints();
  }
});

/* ── кнопки ──────────────────────────────────────────────────────────── */

$('modeOnline').addEventListener('click', () => renderTimeScreen('online'));
$('modeLocal').addEventListener('click', () => renderTimeScreen('local'));
$('timeBack').addEventListener('click', () => showScreen('home'));
$('brandHome').addEventListener('click', (event) => {
  event.preventDefault();
  leaveOnline();
  ui.running = false;
  clearInterval(ui.clockTimer);
  showScreen('home');
});

$('btnCreate').addEventListener('click', createRoom);
$('btnJoin').addEventListener('click', joinRoom);
$('btnCopyCode').addEventListener('click', async () => {
  const code = el.roomCode.textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast('Код скопирован');
  } catch (error) {
    toast('Не удалось скопировать — выделите код вручную');
  }
});

el.joinCode.addEventListener('input', () => {
  el.joinCode.value = el.joinCode.value.replace(/\D/g, '').slice(0, 5);
});

el.flipToggle.addEventListener('change', () => {
  ui.flip = el.flipToggle.checked;
  if (ui.mode === 'local') {
    ui.orientation = ui.flip ? (ui.state ? ui.state.turn : 'w') : 'w';
    renderAll();
  }
});

$('btnResign').addEventListener('click', () => {
  if (!ui.state || ui.status.over) return;
  if (!window.confirm('Сдаться?')) return;
  if (ui.mode === 'online') sendNet({ t: 'resign' });
  finishGame({ over: true, winner: otherColor(ui.myColor), reason: 'resign' });
});

$('btnDraw').addEventListener('click', () => {
  if (!ui.state || ui.status.over) return;
  if (ui.mode === 'online') {
    sendNet({ t: 'draw-offer' });
    ui.requestDrawSent = true;
    toast('Предложение ничьей отправлено');
  } else {
    if (window.confirm('Ничья по договорённости?')) {
      finishGame({ over: true, winner: null, reason: 'agreement' });
    }
  }
});

$('btnNew').addEventListener('click', () => {
  if (ui.mode === 'online') {
    sendNet({ t: 'rematch' });
    toast('Предложение новой партии отправлено');
  } else {
    startGame({ mode: 'local' });
  }
});

$('btnLeave').addEventListener('click', () => {
  leaveOnline();
  ui.running = false;
  clearInterval(ui.clockTimer);
  showScreen('home');
});

$('resultMenu').addEventListener('click', () => {
  leaveOnline();
  ui.running = false;
  clearInterval(ui.clockTimer);
  el.result.classList.remove('show');
  showScreen('home');
});

$('resultAgain').addEventListener('click', () => {
  el.result.classList.remove('show');
  if (ui.mode === 'online' && ui.online) {
    sendNet({ t: 'rematch' });
    toast('Предложение новой партии отправлено');
  } else {
    startGame({ mode: 'local' });
  }
});

/* ── старт ───────────────────────────────────────────────────────────── */

(function boot() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').replace(/\D/g, '').slice(0, 5);
  if (code.length === 5) {
    renderTimeScreen('online');
    el.joinCode.value = code;
    setStatusLine(el.joinStatus, 'Код из ссылки — выберите время и нажмите «Подключиться»');
    history.replaceState(null, '', location.pathname);
  } else {
    showScreen('home');
  }
  layoutBoard();
})();

/* для проверок в браузере */
window.ChessApp = {
  createState, generateLegal, applyMove, undoMove, perft, moveToSan, gameStatus,
  positionKey, currentFen: () => (ui.state ? currentFen() : null),
  ui, startGame, chooseTime, renderAll,
};
