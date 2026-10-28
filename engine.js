'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Daymix's Chess — движок
   Поле произвольного размера W×H, фигуры-объекты, полные правила шахмат
   плюс 17 режимов. Никаких зависимостей: всё считается здесь.
   ══════════════════════════════════════════════════════════════════════════ */

const other = (c) => (c === 'w' ? 'b' : 'w');

let idSeq = 1;
function newPiece(t, c) { return { t, c, id: idSeq++, used: 0 }; }

const PIECE_NAMES = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король', j: 'шут', g: 'пацанчик' };
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0, j: 4, g: 6 };

/* Символы: один набор на все темы, цвет задаётся в CSS. */
const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', j: '🃏', g: '🧢' };

/* Фигуры рисуются собственным SVG: глифы шахмат в системных шрифтах —
   полые контуры, они не слушаются цвета и выглядят грязно. */
const PIECE_SVG = {
  k: `<path class="line" d="M22.5 11.63V6M20 8h5"/><path class="body" d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/><path class="body" d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z"/><path class="line" d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0"/>`,
  q: `<path class="body" d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0"/><path class="body" d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z"/><path class="body" d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path class="line" d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0"/>`,
  r: `<path class="body" d="M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5"/><path class="body" d="m34 14-3 3H14l-3-3"/><path class="body" d="M31 17v12.5H14V17"/><path class="body" d="m31 29.5 1.5 2.5h-20l1.5-2.5"/><path class="line" d="M11 14h23"/>`,
  b: `<path class="body" d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z"/><path class="body" d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path class="body" d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"/><path class="line" d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5"/>`,
  n: `<path class="body" d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path class="body" d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3"/><path class="detail" d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5"/>`,
  p: `<path class="body" d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"/>`,
  j: `<path class="body" d="M14 15 V8.5 H15.8 V4.5 H18.8 V8.5 H20.5 V4.5 H24.5 V8.5 H26.2 V4.5 H29.2 V8.5 H31 V15 Z"/><path class="body" d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z"/><path class="body" d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path class="line" d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5"/>`,
  g: `<path class="body" d="M15.5 10 V4.5 H29.5 V10 Z"/><path class="body" d="M12.5 10 H32.5 V12.5 H12.5 Z"/><path class="body" d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"/>`,
};

/** Разметка фигуры: внутренности SVG без атрибутов цвета — их задаёт CSS. */
function pieceSvg(type, extraClass) {
  const body = PIECE_SVG[type] || PIECE_SVG.p;
  return `<svg viewBox="0 0 45 45" class="pc-svg${extraClass ? ' ' + extraClass : ''}" aria-hidden="true">${body}</svg>`;
}

/* ══════════════════════════════ РЕЖИМЫ ══════════════════════════════════ */

const MODES = [
  {
    id: 'classic', n: 0, name: 'Классика', icon: '♟',
    desc: 'Обычные шахматы 8×8: рокировка, взятие на проходе, превращение, мат, пат, повторение и правило 50 ходов.',
    W: 8, H: 8, flags: { classic: true },
  },
  {
    id: 'threeChecks', n: 1, name: 'Три шаха', icon: '⚡',
    desc: 'Мат не нужен: побеждает тот, кто даст сопернику три шаха. Шахи считаются на доске.',
    W: 8, H: 8, flags: { classic: true, checksToWin: 3 },
  },
  {
    id: 'kingCapture', n: 2, name: 'Съедение короля', icon: '🗡',
    desc: 'Король может идти под бой и стоять под шахом. Проигрывает тот, чей король съеден.',
    W: 8, H: 8, flags: { kingFree: true },
  },
  {
    id: 'kingOnly', n: 3, name: 'Король один', icon: '👑',
    desc: 'Как только у вас не осталось фигур, кроме короля, — вы проиграли.',
    W: 8, H: 8, flags: { classic: true, kingOnlyLose: true },
  },
  {
    id: 'pawnRows', n: 4, name: 'Два ряда пешек', icon: '♟♟',
    desc: 'Пешки стоят в два ряда: по шестнадцать у каждой стороны.',
    W: 8, H: 8, flags: { classic: true, doublePawns: true },
  },
  {
    id: 'kqp', n: 5, name: 'Король, ферзь и пешки', icon: '♛',
    desc: 'Только король, ферзь и восемь пешек. Ни коней, ни слонов, ни ладей.',
    W: 8, H: 8, flags: { classic: true, kqp: true },
  },
  {
    id: 'explode', n: 6, name: 'Взрывы', icon: '💥',
    desc: 'Каждое взятие взрывается: четыре соседние по кресту клетки теряют фигуры. Короли не гибнут.',
    W: 8, H: 8, flags: { classic: true, explode: true },
  },
  {
    id: 'queenPierce', n: 7, name: 'Ферзь-шашки', icon: '♛✳',
    desc: 'Шах объявляется и ферзю. Ферзь сметает все фигуры соперника на своей линии — сквозь свои и чужие.',
    W: 8, H: 8, flags: { queenPierce: true, queenCheck: true },
  },
  {
    id: 'bishopKing', n: 8, name: 'Слон-король', icon: '♝',
    desc: 'Слон может шагнуть на любую соседнюю клетку как король — не больше четырёх раз за партию на фигуру.',
    W: 8, H: 8, flags: { classic: true, bishopKing: 4 },
  },
  {
    id: 'race', n: 9, name: 'Гонка королей', icon: '🏁',
    desc: 'Короли в нижних углах, пешки слева и справа в два ряда. Побеждает тот, кто первым проведёт короля на верхний ряд.',
    W: 8, H: 8, flags: { race: true },
  },
  {
    id: 'wide10', n: 10, name: 'Широкая 10×8', icon: '↔',
    desc: 'Доска 10 на 8: по четыре ладьи, лишние поля по краям и больше простора.',
    W: 10, H: 8, flags: { classic: true },
  },
  {
    id: 'tall10', n: 11, name: 'Высокая 8×10', icon: '↕',
    desc: 'Доска 8 на 10: те же фигуры, но больше вертикали.',
    W: 8, H: 10, flags: { classic: true, tall: true },
  },
  {
    id: 'jester', n: 12, name: 'Шут 12×10', icon: '🃏',
    desc: 'Доска 12×10 и новый Шут: прыгает вперёд через клетку на две, умеет и через три. Всего пять ходов за партию.',
    W: 12, H: 10, flags: { classic: true, jester: true }, square: true,
  },
  {
    id: 'boy', n: 13, name: 'Пацанчики 14×10', icon: '🧢',
    desc: 'Доска 14×10: Шуты рядом со слонами и Пацанчики — ходят как ладья, а на чужой половине проходят сквозь одну фигуру и берут две.',
    W: 14, H: 10, flags: { classic: true, jester: true, boy: true }, square: true,
  },
  {
    id: 'crossCastle', n: 14, name: 'Перекрёстная рокировка', icon: '🔄',
    desc: 'Король меняется местами с любой своей фигурой — до трёх раз за партию.',
    W: 8, H: 8, flags: { classic: true, crossCastle: 3 },
  },
  {
    id: 'fog', n: 15, name: 'Туман войны', icon: '🌫',
    desc: 'Фигуры соперника видны только вплотную к вашим. Всё остальное скрыто туманом.',
    W: 8, H: 8, flags: { classic: true, fog: true },
  },
  {
    id: 'fischer', n: 16, name: 'Фишер', icon: '🎲',
    desc: 'Случайная расстановка: слоны на разных цветах, король между ладьями. Рокировка по правилам 960.',
    W: 8, H: 8, flags: { classic: true, fischerLoose: true },
  },
  {
    id: 'blocks', n: 17, name: 'Случайные блоки', icon: '🚧',
    desc: 'Каждый третий ход с шансом 20% на доске запирается случайная пустая клетка.',
    W: 8, H: 8, flags: { classic: true, blocks: true },
  },
  {
    id: 'queens', n: 18, name: 'Только ферзи', icon: '♛',
    desc: 'По три ферзя и королю у каждой стороны. Поле простреливается насквозь, ошибка стоит ферзя.',
    W: 8, H: 8, flags: { classic: true, only: 'q' },
  },
  {
    id: 'bishops', n: 19, name: 'Только слоны', icon: '♝',
    desc: 'По четыре слона на разных цветах и королю. Диагональная война.',
    W: 8, H: 8, flags: { classic: true, only: 'b' },
  },
  {
    id: 'knights', n: 20, name: 'Только кони', icon: '♞',
    desc: 'По четыре коня и королю. Прыжки через всё поле, никаких линий.',
    W: 8, H: 8, flags: { classic: true, only: 'n' },
  },
  {
    id: 'rooks', n: 21, name: 'Только ладьи', icon: '♜',
    desc: 'По четыре ладьи и королю. Рокировка открывается, как только освободятся линии.',
    W: 8, H: 8, flags: { classic: true, only: 'r' },
  },
  {
    id: 'pawnField', n: 22, name: 'Пешечное поле', icon: '♟',
    desc: 'Поле забито пешками под завязку: по четыре полных ряда у каждой стороны, впереди сплошная стена.',
    W: 8, H: 8, flags: { classic: true, pawnField: true },
  },
  {
    id: 'pawnFieldQ', n: 23, name: 'Пешечное поле с ферзём', icon: '♛♟',
    desc: 'То же море пешек, но у каждого ещё и ферзь — он решает исход прорыва.',
    W: 8, H: 8, flags: { classic: true, pawnField: true, withQueen: true },
  },
  {
    id: 'noPawns', n: 24, name: 'Без пешек', icon: '♜♞',
    desc: 'Полный набор фигур, но ни одной пешки: линии открыты с первого хода.',
    W: 8, H: 8, flags: { classic: true, noPawns: true },
  },
  {
    id: 'center', n: 25, name: 'Центр', icon: '⊕',
    desc: 'Победа — провести короля на любое из четырёх центральных полей: d4, e4, d5, e5. Мат тоже побеждает.',
    W: 8, H: 8, flags: { classic: true, centerWin: true },
  },
  {
    id: 'touchMove', n: 26, name: 'Взялся — ходи', icon: '✋',
    desc: 'Коснулся фигуры с ходами — обязан ходить только ей! Нельзя отменить выбор или передумать.',
    W: 8, H: 8, flags: { classic: true, touchMove: true },
  },
  {
    id: 'openIntent', n: 27, name: 'Открытые намерения', icon: '👁️',
    desc: 'Соперник видит клетку, на которую вы нажали перед ходом. Блефуйте или читайте замысел противника!',
    W: 8, H: 8, flags: { classic: true, openIntent: true },
  },
  {
    id: 'random', n: 0, name: 'Рандомный', icon: '🎲',
    desc: 'Каждый раз новый случайный режим из всех остальных. Судьба выбирает за вас.',
    W: 8, H: 8, flags: { classic: true, randomPick: true },
  },
  {
    id: 'chess960', n: 28, name: 'Шахматы 960', icon: '♜',
    desc: 'Настоящие Фишеровские шахматы: 960 расстановок, слоны на разных цветах, король между ладьями.',
    W: 8, H: 8, flags: { classic: true, chess960: true },
  },
  {
    id: 'swapReplace', n: 29, name: 'Замена фигур', icon: '🔄',
    desc: 'Перед партией у каждого случайно заменяются 1–3 фигуры (кроме короля) на любые другие.',
    W: 8, H: 8, flags: { classic: true, swapReplace: true },
  },
  {
    id: 'vanishEdge', n: 30, name: 'Край бездны', icon: '🕳️',
    desc: 'Пешка, дошедшая до последней горизонтали, не превращается, а безвозвратно исчезает.',
    W: 8, H: 8, flags: { classic: true, vanishEdge: true },
  },
  {
    id: 'pawnRush', n: 31, name: 'Пешки-ракеты', icon: '🚀',
    desc: 'Пешка всегда может пойти на 1, 2 или 3 клетки вперёд — с любой линии, лишь бы путь был свободен.',
    W: 8, H: 8, flags: { classic: true, pawnRush: true },
  },
  {
    id: 'backCapture', n: 32, name: 'Пешка-хищник', icon: '🦷',
    desc: 'Пешка умеет бить назад по диагонали, но ходить назад по-прежнему не может.',
    W: 8, H: 8, flags: { classic: true, backCapture: true },
  },
  {
    id: 'convert20', n: 33, name: 'Перебежчик', icon: '🎖️',
    desc: 'С шансом 20% съеденная фигура не умирает, а переходит на вашу сторону и встаёт на случайное свободное поле.',
    W: 8, H: 8, flags: { classic: true, convert20: true },
  },
  {
    id: 'radiusCheck', n: 34, name: 'Грозовой радиус', icon: '📡',
    desc: 'Шах — это любая вражеская фигура в радиусе 3 клеток от короля. Зона опасности обведена белым контуром.',
    W: 8, H: 8, flags: { classic: true, radiusCheck: true },
  },
  {
    id: 'horde', n: 35, name: 'Орда', icon: '🧟',
    desc: 'У белых только король и три ряда пешек против полной армии чёрных. Задавите массой или выживете.',
    W: 8, H: 8, flags: { horde: true },
  },
  {
    id: 'antichess', n: 36, name: 'Антишахматы', icon: '🔄',
    desc: 'Цель — потерять все свои фигуры. Бить обязательно, короля можно съесть, шаха нет.',
    W: 8, H: 8, flags: { antichess: true, kingFree: true },
  },
  {
    id: 'noQueen7', n: 37, name: 'Семёрка', icon: '7️⃣',
    desc: 'Доска 7×8 без ферзей: короли ровно по центру, только ладьи, кони и слоны.',
    W: 7, H: 8, flags: { classic: true, noQueen7: true },
  },
  {
    id: 'swapRows', n: 38, name: 'Пешки впереди', icon: '🔀',
    desc: 'Ряды перевёрнуты: фигуры стоят на второй линии, а пешки — на первой.',
    W: 8, H: 8, flags: { classic: true, swapRows: true },
  },
  {
    id: 'blackFirst', n: 39, name: 'Чёрные начинают', icon: '⚫',
    desc: 'Первыми ходят чёрные. Всё остальное — классика.',
    W: 8, H: 8, flags: { classic: true, blackFirst: true },
  },
  {
    id: 'inverted', n: 40, name: 'Вверх ногами', icon: '🙃',
    desc: 'Ты играешь как обычно, но белые стоят наверху, а чёрные — внизу.',
    W: 8, H: 8, flags: { classic: true, inverted: true },
  },
  {
    id: 'pawnBack', n: 41, name: 'Пешки назад', icon: '↩️',
    desc: 'Пешки всегда могут ходить назад — и вперёд, и обратно, но не на последнюю линию.',
    W: 8, H: 8, flags: { classic: true, pawnBack: true },
  },
  {
    id: 'kingKnight', n: 42, name: 'Король-конь', icon: '🐴',
    desc: 'Король ходит как конь и ещё на одну клетку вперёд. Шах ему не страшен только на вид.',
    W: 8, H: 8, flags: { classic: true, kingKnight: true },
  },
  {
    id: 'queenLose', n: 43, name: 'Ферзь под защитой', icon: '👑',
    desc: 'Потерять ферзя — сразу поражение. Берегите королеву.',
    W: 8, H: 8, flags: { classic: true, queenLose: true },
  },
  {
    id: 'weakKnights', n: 44, name: 'Слабые кони', icon: '🐌',
    desc: 'Кони ходят только по длинной части буквы Г — половина прыжков недоступна.',
    W: 8, H: 8, flags: { classic: true, weakKnights: true },
  },
  {
    id: 'castleReturn', n: 45, name: 'Рокировка возвращается', icon: '🏰',
    desc: 'Если король вернётся на исходную клетку, право на рокировку восстанавливается.',
    W: 8, H: 8, flags: { classic: true, castleReturn: true },
  },
  {
    id: 'square10', n: 46, name: 'Квадрат 10×10', icon: '🔲',
    desc: 'Большая квадратная доска 10×10 — больше пространства и манёвра.',
    W: 10, H: 10, flags: { classic: true },
  },
  {
    id: 'square12', n: 47, name: 'Квадрат 12×12', icon: '🔳',
    desc: 'Огромная доска 12×12 для настоящих стратегов.',
    W: 12, H: 12, flags: { classic: true },
  },
  {
    id: 'devourAll', n: 49, name: 'Съешь всё', icon: '🍽️',
    desc: 'Короля можно съесть — это не победа. Побеждает тот, кто съест все фигуры соперника.',
    W: 8, H: 8, flags: { classic: true, kingFree: true, captureAll: true },
  },
  {
    id: 'captureRace', n: 50, name: 'Кто больше съел', icon: '⏱️',
    desc: 'Короля можно есть, но победа — по числу съеденных фигур за минуту-две. Время выбирается по контролю.',
    W: 8, H: 8, flags: { classic: true, kingFree: true, captureRace: true },
  },
  {
    id: 'losAlamos', n: 51, name: 'Лос-Аламос', icon: '🧪',
    desc: 'Доска 6×6 без слонов — быстрые шахматы, придуманные в Лос-Аламосе.',
    W: 6, H: 6, flags: { losAlamos: true },
  },
  {
    id: 'berolina', n: 52, name: 'Беролина', icon: '🌽',
    desc: 'Пешки ходят по диагонали вперёд, а бьют прямо. Всё наоборот.',
    W: 8, H: 8, flags: { classic: true, berolina: true },
  },
  {
    id: 'checkless', n: 53, name: 'Без шахов', icon: '🚫',
    desc: 'Давать шах запрещено. Можно только подходить, защищаться и брать.',
    W: 8, H: 8, flags: { classic: true, checkless: true },
  },
  {
    id: 'raceKings', n: 54, name: 'Королевские гонки', icon: '🏁',
    desc: 'Без пешек и шахов: король должен первым добраться до последней линии.',
    W: 8, H: 8, flags: { raceKing: true, kingFree: true },
  },
  {
    id: 'andernach', n: 55, name: 'Андернах', icon: '🎭',
    desc: 'Съевшая фигура меняет цвет. Каждое взятие — маленькая измена.',
    W: 8, H: 8, flags: { classic: true, andernach: true },
  },
  {
    id: 'clashBrawl', n: 58, name: 'Клеш Бравл', icon: '⚔️',
    desc: 'Пародия на мобилки: 50 HP у короля, фиолетовый эликсир, вызов подкреплений из колоды, щиты и отталкивания!',
    W: 8, H: 8, flags: { clashBrawl: true, kingFree: true, customDeploy: true },
  },
  {
    id: 'infernal', n: 48, name: 'Инфернальный', icon: '🔥',
    desc: 'Всё красное, а на значимых ходах звучат теоремы гамбитов, кипяточка и ферзюшки. Дота головного мозга.',
    W: 8, H: 8, flags: { classic: true, infernal: true },
  },
];

const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
const modeById = (id) => MODE_BY_ID[id] || MODES[0];

/* ══════════════════════════ РАССТАНОВКИ ════════════════════════════════ */

const BACK_RANKS = {
  8: 'rnbqkbnr',
  10: 'rrnbqkbnrr',
  12: 'rrnbjqkjbnrr',
  14: 'rrgnjbqkbjngrr',
};

/** Случайная расстановка 960: слоны на разных цветах, король между ладьями. */
function shuffleBackRank() {
  const pieces = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces.join('');
}

function fischerRank() {
  const files = new Array(8).fill(null);
  const free = () => [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !files[i]);
  const pick = (arr) => arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
  files[pick([1, 3, 5, 7])] = 'b';           // светлые поля
  files[pick([0, 2, 4, 6])] = 'b';           // тёмные поля
  files[pick(free())] = 'q';
  files[pick(free())] = 'n';
  files[pick(free())] = 'n';
  const rest = free();
  files[rest[0]] = 'r';
  files[rest[1]] = 'k';
  files[rest[2]] = 'r';
  return files.join('');
}

function blankBoard(W, H) { return new Array(W * H).fill(null); }

/* ═════════════════════════════ СОЗДАНИЕ ════════════════════════════════ */

/**
 * @param {string} modeId
 * @param {{square?:boolean, seed?:number}} opts
 */
function createState(modeId, opts = {}) {
  const mode = modeById(modeId);
  const W = mode.W;
  const H = opts.square && mode.square ? mode.W : mode.H;
  const st = {
    modeId: mode.id,
    mode,
    flags: mode.flags,
    square: !!opts.square,
    W, H,
    board: blankBoard(W, H),
    turn: mode.flags.blackFirst ? 'b' : 'w',
    ep: -1,
    half: 0,
    full: 1,
    castling: { w: { k: null, q: null }, b: { k: null, q: null } },
    blocked: [],
    mv: { w: { checks: 0, cross: 0 }, b: { checks: 0, cross: 0 } },
    pawnStart: { w: [1], b: [H - 2] },
    status: 'play',
    result: null,
    capturedKing: null,
    caps: { w: 0, b: 0 },
    converted: -1,
    check: false,
    seed: opts.seed || Math.floor(Math.random() * 1e9),
  };
  setupBoard(st);
  return st;
}

function setupBoard(st) {
  const { W, H, board, flags } = st;

  if (flags.race) return setupRace(st);
  if (flags.only) return setupOnlyPiece(st, flags.only);
  if (flags.pawnField) return setupPawnField(st, !!flags.withQueen);
  if (flags.noPawns) return setupNoPawns(st);

  if (flags.clashBrawl) {
    board[4] = newPiece('k', 'w');
    board[(H - 1) * W + 4] = newPiece('k', 'b');
    st.pawnStart = { w: [], b: [] };
    st.brawl = { hp: { w: 50, b: 50 }, shieldTurns: { w: 0, b: 0 } };
    return;
  }

  if (flags.losAlamos) {
    const back = 'rnqknr';
    for (let x = 0; x < Math.min(W, back.length); x++) {
      board[x] = newPiece(back[x], 'w');
      board[(H - 1) * W + x] = newPiece(back[x], 'b');
    }
    for (let x = 0; x < W; x++) {
      board[1 * W + x] = newPiece('p', 'w');
      board[(H - 2) * W + x] = newPiece('p', 'b');
    }
    st.pawnStart = { w: [1], b: [H - 2] };
    return;
  }

  if (flags.raceKing) {
    const white = { 0: 'r', 1: 'k', 2: 'q', 3: 'b', 4: 'n', 5: 'b', 6: 'n', 7: 'r' };
    const black = { 0: 'r', 1: 'n', 2: 'b', 3: 'n', 4: 'b', 5: 'q', 6: 'k', 7: 'r' };
    for (let x = 0; x < 8; x++) {
      board[x] = newPiece(white[x], 'w');
      board[(H - 1) * W + x] = newPiece(black[x], 'b');
    }
    st.pawnStart = { w: [], b: [] };
    return;
  }

  if (flags.noQueen7) {
    const back = 'rnbknr';
    for (let x = 0; x < Math.min(W, back.length); x++) {
      board[x] = newPiece(back[x], 'w');
      board[(H - 1) * W + x] = newPiece(back[x], 'b');
    }
  } else if (flags.chess960) {
    const back = fischerRank();
    for (let x = 0; x < 8; x++) {
      board[x] = newPiece(back[x], 'w');
      board[(H - 1) * W + x] = newPiece(back[x], 'b');
    }
  } else if (flags.fischerLoose) {
    const back = shuffleBackRank();
    for (let x = 0; x < 8; x++) {
      board[x] = newPiece(back[x], 'w');
      board[(H - 1) * W + x] = newPiece(back[x], 'b');
    }
  } else if (flags.horde) {
    const back = BACK_RANKS[W] || 'rnbqkbnr';
    for (let x = 0; x < Math.min(W, back.length); x++) board[(H - 1) * W + x] = newPiece(back[x], 'b');
    board[0] = newPiece('k', 'w');
    for (let y = 1; y <= Math.min(3, H - 2); y++) {
      for (let x = 0; x < W; x++) board[y * W + x] = newPiece('p', 'w');
    }
    st.pawnStart = { w: [1, 2, 3], b: [H - 2] };
    for (let x = 0; x < W; x++) board[(H - 2) * W + x] = newPiece('p', 'b');
    initCastling(st);
    return;
  } else if (flags.kqp) {
    board[3] = newPiece('q', 'w');
    board[4] = newPiece('k', 'w');
    board[(H - 1) * W + 3] = newPiece('q', 'b');
    board[(H - 1) * W + 4] = newPiece('k', 'b');
  } else {
    const back = BACK_RANKS[W] || 'rnbqkbnr';
    for (let x = 0; x < Math.min(W, back.length); x++) {
      board[x] = newPiece(back[x], 'w');
      board[(H - 1) * W + x] = newPiece(back[x], 'b');
    }
  }

  const wRows = flags.doublePawns ? [1, 2] : [1];
  const bRows = flags.doublePawns ? [H - 2, H - 3] : [H - 2];
  for (const y of wRows) for (let x = 0; x < W; x++) board[y * W + x] = newPiece('p', 'w');
  for (const y of bRows) for (let x = 0; x < W; x++) board[y * W + x] = newPiece('p', 'b');
  st.pawnStart = { w: wRows.slice(), b: bRows.slice() };

  if (flags.swapRows) {
    for (const color of ['w', 'b']) {
      const backRank = color === 'w' ? 0 : H - 1;
      const pawnRank = color === 'w' ? 1 : H - 2;
      for (let x = 0; x < W; x++) {
        const a = board[backRank * W + x];
        const b = board[pawnRank * W + x];
        board[backRank * W + x] = b;
        board[pawnRank * W + x] = a;
      }
    }
    st.pawnStart = { w: [0], b: [H - 1] };
  }

  if (flags.swapReplace) {
    for (const color of ['w', 'b']) {
      const candidates = [];
      for (let i = 0; i < board.length; i++) {
        const q = board[i];
        if (q && q.c === color && q.t !== 'k') candidates.push(i);
      }
      const count = 1 + Math.floor(Math.random() * 3);
      const pool = ['q', 'r', 'b', 'n'];
      for (let k = 0; k < count && candidates.length; k++) {
        const idx = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
        board[idx] = newPiece(pool[Math.floor(Math.random() * pool.length)], color);
      }
    }
  }

  initCastling(st);
}

function setupRace(st) {
  const { W, H, board } = st;
  board[0] = newPiece('k', 'w');                          // белый король в левом нижнем углу
  board[W - 1] = newPiece('k', 'b');                      // чёрный король в правом нижнем углу
  for (const x of [0, 1]) for (const y of [3, 4]) board[y * W + x] = newPiece('p', 'w');
  for (const x of [W - 2, W - 1]) for (const y of [3, 4]) board[y * W + x] = newPiece('p', 'b');
  st.pawnStart = { w: [3, 4], b: [3, 4] };
  st.castling = { w: { k: null, q: null }, b: { k: null, q: null } };
}

/* ── режимы «только одна фигура»: ферзи, слоны, кони, ладьи ────────────── */

function setupOnlyPiece(st, type) {
  const { W, H, board } = st;
  const kingFile = 4;
  const files = type === 'q' ? [0, 2, 6]
    : type === 'n' ? [0, 1, 6, 7]
      : [0, 2, 5, 7];                        // слоны и ладьи
  board[kingFile] = newPiece('k', 'w');
  board[(H - 1) * W + kingFile] = newPiece('k', 'b');
  for (const f of files) {
    board[f] = newPiece(type, 'w');
    board[(H - 1) * W + f] = newPiece(type, 'b');
  }
  st.pawnStart = { w: [], b: [] };
  initCastling(st);                          // у ладей появляются права на рокировку
}

/* ── пешечное поле: три полных ряда пешек и короли впереди ─────────────── */

function setupPawnField(st, withQueen) {
  const { W, H, board } = st;
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) board[y * W + x] = newPiece('p', 'w');
  }
  for (let y = H / 2; y < H; y++) {
    for (let x = 0; x < W; x++) board[y * W + x] = newPiece('p', 'b');
  }
  board[4] = newPiece('k', 'w');
  board[(H - 1) * W + 4] = newPiece('k', 'b');
  if (withQueen) {
    board[3] = newPiece('q', 'w');
    board[(H - 1) * W + 3] = newPiece('q', 'b');
  }
  st.pawnStart = { w: [1], b: [H - 2] };
  st.castling = { w: { k: null, q: null }, b: { k: null, q: null } };
}

/* ── полный набор фигур без пешек ──────────────────────────────────────── */

function setupNoPawns(st) {
  const { W, H, board } = st;
  const back = BACK_RANKS[W] || 'rnbqkbnr';
  for (let x = 0; x < Math.min(W, back.length); x++) {
    board[x] = newPiece(back[x], 'w');
    board[(H - 1) * W + x] = newPiece(back[x], 'b');
  }
  st.pawnStart = { w: [], b: [] };
  initCastling(st);
}

function initCastling(st) {
  st.castling = { w: { k: null, q: null }, b: { k: null, q: null } };
  for (const color of ['w', 'b']) {
    const rank = color === 'w' ? 0 : st.H - 1;
    let kingFile = -1;
    const rooks = [];
    for (let x = 0; x < st.W; x++) {
      const p = st.board[rank * st.W + x];
      if (!p || p.c !== color) continue;
      if (p.t === 'k') kingFile = x;
      if (p.t === 'r') rooks.push({ x, id: p.id });
    }
    if (kingFile < 0 || !rooks.length) continue;
    const right = rooks.filter((r) => r.x > kingFile).sort((a, b) => b.x - a.x)[0];
    const left = rooks.filter((r) => r.x < kingFile).sort((a, b) => a.x - b.x)[0];
    if (right) st.castling[color].k = right.id;
    if (left) st.castling[color].q = left.id;
  }
}

/* ═════════════════════════════ УТИЛИТЫ ═════════════════════════════════ */

const inside = (st, x, y) => x >= 0 && y >= 0 && x < st.W && y < st.H;
const sqAt = (st, x, y) => y * st.W + x;
const fileOf = (st, sq) => sq % st.W;
const rankOf = (st, sq) => Math.floor(sq / st.W);

function isBlocked(st, sq) { return st.blocked.includes(sq); }

function findKing(st, color) {
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (p && p.c === color && p.t === 'k') return i;
  }
  return -1;
}

function findPiece(st, color, type) {
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (p && p.c === color && p.t === type) return i;
  }
  return -1;
}

function findById(st, id) {
  if (id == null) return -1;
  for (let i = 0; i < st.board.length; i++) if (st.board[i] && st.board[i].id === id) return i;
  return -1;
}

function onlyKing(st, color) {
  for (const p of st.board) if (p && p.c === color && p.t !== 'k') return false;
  return true;
}

function piecesOf(st, color) {
  const out = [];
  for (let i = 0; i < st.board.length; i++) if (st.board[i] && st.board[i].c === color) out.push(i);
  return out;
}

const FILES = 'abcdefghijklmn';
function sqName(st, sq) {
  if (sq == null || sq < 0) return '??';
  return FILES[fileOf(st, sq)] + (rankOf(st, sq) + 1);
}

/* ═════════════════════════════ ХОДЫ: ГЕНЕРАЦИЯ ═════════════════════════ */

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);
const KNIGHT_DIRS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING_DIRS = QUEEN_DIRS;

function genPseudo(st, color) {
  const out = [];
  const { W, H, board } = st;
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (!p || p.c !== color) continue;
    const x = fileOf(st, sq);
    const y = rankOf(st, sq);

    if (p.t === 'p' && st.flags.berolina) {
      const dir = color === 'w' ? 1 : -1;
      const ny = y + dir;
      if (ny < 0 || ny >= H) continue;
      for (const dx of [-1, 1]) {
        const nx = x + dx;
        if (!inside(st, nx, ny)) continue;
        const one = sqAt(st, nx, ny);
        if (isBlocked(st, one) || board[one]) continue;
        pushPawnAdvance(out, st, sq, one, ny);
        const startRows = st.pawnStart[color] || [];
        if (startRows.includes(y)) {
          const ny2 = y + dir * 2;
          if (ny2 >= 0 && ny2 < H) {
            const two = sqAt(st, nx, ny2);
            if (!board[two] && !isBlocked(st, two)) pushPawnAdvance(out, st, sq, two, ny2, { double: true });
          }
        }
      }
      const front = sqAt(st, x, ny);
      if (!isBlocked(st, front) && board[front] && board[front].c !== color) {
        pushPawnAdvance(out, st, sq, front, ny);
      }
      continue;
    }

    if (p.t === 'p') {
      const dir = color === 'w' ? 1 : -1;
      const ny = y + dir;
      if (ny < 0 || ny >= H) continue;
      const one = sqAt(st, x, ny);
      if (!board[one] && !isBlocked(st, one)) {
        pushPawnAdvance(out, st, sq, one, ny);
        const startRows = st.pawnStart[color] || [];
        const maxStep = st.flags.pawnRush ? 3 : 2;
        for (let step = 2; step <= maxStep; step++) {
          if (!st.flags.pawnRush && !startRows.includes(y)) break;
          const nyn = y + dir * step;
          if (nyn < 0 || nyn >= H) break;
          const target = sqAt(st, x, nyn);
          if (board[target] || isBlocked(st, target)) break;
          pushPawnAdvance(out, st, sq, target, nyn, { double: step === 2, triple: step === 3 });
        }
      }
      for (const dx of [-1, 1]) {
        const nx = x + dx;
        if (!inside(st, nx, ny)) continue;
        const t = sqAt(st, nx, ny);
        if (isBlocked(st, t)) continue;
        const q = board[t];
        if (q && q.c !== color) pushPawnAdvance(out, st, sq, t, ny);
        else if (!q && st.ep === t) out.push({ from: sq, to: t, ep: true, capture: sqAt(st, nx, y) });
      }
      if (p.gold) {
        const by = y - dir;
        if (by >= 0 && by < H) {
          const back = sqAt(st, x, by);
          if (!board[back] && !isBlocked(st, back)) out.push({ from: sq, to: back });
        }
        for (const dx of [-1, 1]) {
          const nx = x + dx;
          if (!inside(st, nx, by)) continue;
          const t = sqAt(st, nx, by);
          if (isBlocked(st, t)) continue;
          const q = board[t];
          if (q && q.c !== color) out.push({ from: sq, to: t, capture: t });
        }
      }
      if (st.flags.pawnBack) {
        const by = y - dir;
        if (by >= 0 && by < H) {
          const back = sqAt(st, x, by);
          if (!board[back] && !isBlocked(st, back)) out.push({ from: sq, to: back, backwardMove: true });
        }
      }
      if (st.flags.backCapture) {
        const by = y - dir;
        for (const dx of [-1, 1]) {
          const nx = x + dx;
          if (!inside(st, nx, by)) continue;
          const t = sqAt(st, nx, by);
          if (isBlocked(st, t)) continue;
          const q = board[t];
          if (q && q.c !== color) out.push({ from: sq, to: t, capture: t, backward: true });
        }
      }
      continue;
    }

    if (p.t === 'n') {
      for (const [dx, dy] of KNIGHT_DIRS) {
        if (st.flags.weakKnights && Math.abs(dx) !== 2) continue;
        const nx = x + dx, ny = y + dy;
        if (!inside(st, nx, ny)) continue;
        const t = sqAt(st, nx, ny);
        if (isBlocked(st, t)) continue;
        if (board[t] && board[t].c === color) continue;
        out.push({ from: sq, to: t, capture: board[t] ? t : null });
      }
      continue;
    }

    if (p.t === 'j') {
      if (p.used >= 5) continue;
      const dir = color === 'w' ? 1 : -1;
      const leaps = [[-1, 2], [0, 2], [1, 2], [0, 3]];
      for (const [dx, dy] of leaps) {
        const nx = x + dx, ny = y + dir * dy;
        if (!inside(st, nx, ny)) continue;
        const t = sqAt(st, nx, ny);
        if (isBlocked(st, t)) continue;
        if (board[t] && board[t].c === color) continue;
        out.push({ from: sq, to: t, capture: board[t] ? t : null, leap: true });
      }
      continue;
    }

    if (p.t === 'g') {
      for (const [dx, dy] of ROOK_DIRS) {
        let nx = x + dx, ny = y + dy;
        let passed = null;
        while (inside(st, nx, ny)) {
          const t = sqAt(st, nx, ny);
          if (isBlocked(st, t)) break;
          const q = board[t];
          if (q) {
            if (q.c === color) break;
            if (passed != null) {
              out.push({ from: sq, to: t, capture: t, caps: [passed] });
              break;
            }
            out.push({ from: sq, to: t, capture: t });
            const enemyHalf = color === 'w' ? ny >= Math.ceil(H / 2) : ny < Math.floor(H / 2);
            if (!enemyHalf) break;
            passed = t;
            nx += dx; ny += dy;
            continue;
          }
          out.push(passed != null
            ? { from: sq, to: t, caps: [passed] }
            : { from: sq, to: t });
          nx += dx; ny += dy;
        }
      }
      continue;
    }

    if (p.t === 'b') {
      for (const [dx, dy] of BISHOP_DIRS) {
        let nx = x + dx, ny = y + dy;
        while (inside(st, nx, ny)) {
          const t = sqAt(st, nx, ny);
          if (isBlocked(st, t)) break;
          const q = board[t];
          if (q) {
            if (q.c !== color) out.push({ from: sq, to: t, capture: t });
            break;
          }
          out.push({ from: sq, to: t });
          nx += dx; ny += dy;
        }
      }
      if (st.flags.bishopKing && p.used < st.flags.bishopKing) {
        for (const [dx, dy] of KING_DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!inside(st, nx, ny)) continue;
          const t = sqAt(st, nx, ny);
          if (isBlocked(st, t)) continue;
          const q = board[t];
          if (q && q.c === color) continue;
          out.push({ from: sq, to: t, capture: q ? t : null, kingStep: true });
        }
      }
      continue;
    }

    if (p.t === 'r') {
      for (const [dx, dy] of ROOK_DIRS) {
        let nx = x + dx, ny = y + dy;
        while (inside(st, nx, ny)) {
          const t = sqAt(st, nx, ny);
          if (isBlocked(st, t)) break;
          const q = board[t];
          if (q) {
            if (q.c !== color) out.push({ from: sq, to: t, capture: t });
            break;
          }
          out.push({ from: sq, to: t });
          nx += dx; ny += dy;
        }
      }
      continue;
    }

    if (p.t === 'q') {
      for (const [dx, dy] of QUEEN_DIRS) {
        let nx = x + dx, ny = y + dy;
        const caps = [];
        while (inside(st, nx, ny)) {
          const t = sqAt(st, nx, ny);
          if (isBlocked(st, t)) break;
          const q = board[t];
          if (st.flags.queenPierce) {
            if (q && q.c !== color) {
              if (q.t === 'k') break;           // короля не едим: линия на нём заканчивается
              caps.push(t);
            } else if (!q) {
              out.push({ from: sq, to: t, caps: caps.slice() });
            }
            nx += dx; ny += dy;
            continue;
          }
          if (q) {
            if (q.c !== color) out.push({ from: sq, to: t, capture: t });
            break;
          }
          out.push({ from: sq, to: t });
          nx += dx; ny += dy;
        }
      }
      continue;
    }

    if (p.t === 'k') {
      const kingDirs = st.flags.kingKnight ? [...KING_DIRS, ...KNIGHT_DIRS] : KING_DIRS;
      for (const [dx, dy] of kingDirs) {
        const nx = x + dx, ny = y + dy;
        if (!inside(st, nx, ny)) continue;
        const t = sqAt(st, nx, ny);
        if (isBlocked(st, t)) continue;
        const q = board[t];
        if (q && q.c === color) continue;
        out.push({ from: sq, to: t, capture: q ? t : null, leap: st.flags.kingKnight && Math.abs(dx) + Math.abs(dy) === 3 });
      }
      if (st.flags.kingKnight) {
        const dir = color === 'w' ? 1 : -1;
        const ny = y + dir;
        if (inside(st, x, ny)) {
          const t = sqAt(st, x, ny);
          if (!isBlocked(st, t) && !board[t]) out.push({ from: sq, to: t });
        }
      }
      if (st.flags.classic || st.flags.fischer) addCastling(st, color, out, sq);
      if (st.flags.crossCastle && st.mv[color].cross < st.flags.crossCastle) {
        for (let t = 0; t < board.length; t++) {
          const q = board[t];
          if (!q || q.c !== color || q.t === 'k') continue;
          out.push({ from: sq, to: t, swap: true });
        }
      }
      continue;
    }
  }
  return out;
}

function pushPawnAdvance(out, st, from, to, ny, extra = {}) {
  const last = ny === 0 || ny === st.H - 1;
  if (last) {
    if (st.flags.vanishEdge) {
      out.push({ from, to, vanish: true, capture: st.board[to] ? to : null, ...extra });
      return;
    }
    for (const promo of ['q', 'r', 'b', 'n']) {
      out.push({ from, to, promo, capture: st.board[to] ? to : null, ...extra });
    }
    return;
  }
  out.push({ from, to, capture: st.board[to] ? to : null, ...extra });
}

function addPawnMoves(out, st, from, to, ny) {
  pushPawnAdvance(out, st, from, to, ny);
}

function addCastling(st, color, out, kingSq) {
  const rank = color === 'w' ? 0 : st.H - 1;
  if (rankOf(st, kingSq) !== rank) return;
  for (const side of ['k', 'q']) {
    const rookId = st.castling[color][side];
    if (rookId == null) continue;
    const rookSq = findById(st, rookId);
    if (rookSq < 0 || rankOf(st, rookSq) !== rank) continue;
    const kingFile = fileOf(st, kingSq);
    const rookFile = fileOf(st, rookSq);
    const kTarget = side === 'k' ? st.W - 2 : 2;
    const rTarget = side === 'k' ? st.W - 3 : 3;
    if (kTarget === kingFile && rTarget === rookFile) continue;

    let ok = true;
    for (let f = Math.min(kingFile, kTarget); f <= Math.max(kingFile, kTarget) && ok; f++) {
      const s = rank * st.W + f;
      if (s !== kingSq && s !== rookSq && st.board[s]) ok = false;
    }
    for (let f = Math.min(rookFile, rTarget); f <= Math.max(rookFile, rTarget) && ok; f++) {
      const s = rank * st.W + f;
      if (s !== kingSq && s !== rookSq && st.board[s]) ok = false;
    }
    if (!ok) continue;
    for (let f = Math.min(kingFile, kTarget); f <= Math.max(kingFile, kTarget) && ok; f++) {
      if (attacked(st, rank * st.W + f, other(color))) ok = false;
    }
    if (!ok) continue;
    out.push({
      from: kingSq, to: rank * st.W + kTarget, castle: side,
      rookFrom: rookSq, rookTo: rank * st.W + rTarget,
    });
  }
}

/* ══════════════════════════════ АТАКИ ══════════════════════════════════ */

function attacked(st, sq, by) {
  const { board, W, H } = st;
  const tx = fileOf(st, sq);
  const ty = rankOf(st, sq);

  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p || p.c !== by) continue;
    const x = fileOf(st, i);
    const y = rankOf(st, i);
    const dx = tx - x;
    const dy = ty - y;

    if (p.t === 'p') {
      const dir = by === 'w' ? 1 : -1;
      if (dy === dir && Math.abs(dx) === 1) return true;
      continue;
    }
    if (p.t === 'k') {
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) return true;
      continue;
    }
    if (p.t === 'n') {
      if ((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)) return true;
      continue;
    }
    if (p.t === 'j') {
      if (p.used >= 5) continue;
      const dir = by === 'w' ? 1 : -1;
      const leaps = [[-1, 2], [0, 2], [1, 2], [0, 3]];
      for (const [lx, ly] of leaps) if (dx === lx && dy === dir * ly) return true;
      continue;
    }
    if (p.t === 'q' && st.flags.queenPierce) {
      const diag = Math.abs(dx) === Math.abs(dy) && dx !== 0;
      const ortho = (dx === 0) !== (dy === 0);
      if (diag || ortho) return true;          // ферзь-шашки пробивает линию насквозь
      continue;
    }
    if (p.t === 'b' || p.t === 'r' || p.t === 'q' || p.t === 'g') {
      const diag = Math.abs(dx) === Math.abs(dy) && dx !== 0;
      const ortho = (dx === 0) !== (dy === 0);
      let dirs = null;
      if (p.t === 'b' && diag) dirs = BISHOP_DIRS;
      if (p.t === 'r' && ortho) dirs = ROOK_DIRS;
      if (p.t === 'q' && (diag || ortho)) dirs = QUEEN_DIRS;
      if (p.t === 'g' && ortho) dirs = ROOK_DIRS;
      if (!dirs) continue;
      let nx = x, ny = y;
      const sx = Math.sign(dx), sy = Math.sign(dy);
      nx += sx; ny += sy;
      let blockedBySomething = false;
      while (inside(st, nx, ny)) {
        if (isBlocked(st, nx, ny)) { blockedBySomething = true; break; }
        const q = board[sqAt(st, nx, ny)];
        if (q) {
          if (nx === tx && ny === ty) return true;
          blockedBySomething = true;
          break;
        }
        if (nx === tx && ny === ty) return true;
        nx += sx; ny += sy;
      }
      if (blockedBySomething) continue;
    }
  }
  return false;
}

function inCheck(st, color) {
  if (st.flags.antichess || st.flags.captureAll || st.flags.captureRace || st.flags.raceKing) return false;
  const king = findKing(st, color);
  if (king >= 0 && st.flags.radiusCheck) {
    const kx = fileOf(st, king);
    const ky = rankOf(st, king);
    for (let i = 0; i < st.board.length; i++) {
      const q = st.board[i];
      if (!q || q.c === color) continue;
      const dx = Math.abs(fileOf(st, i) - kx);
      const dy = Math.abs(rankOf(st, i) - ky);
      if (Math.max(dx, dy) <= 3 && !(dx === 0 && dy === 0)) return true;
    }
    return false;
  }
  if (king >= 0 && attacked(st, king, other(color))) return true;
  if (st.flags.queenCheck) {
    const q = findPiece(st, color, 'q');
    if (q >= 0 && attacked(st, q, other(color))) return true;
  }
  return false;
}

/* ═════════════════════════════ ПРИМЕНЕНИЕ ══════════════════════════════ */

function applyMove(st, m) {
  const { board } = st;
  const p = board[m.from];
  const undo = {
    piece: p,
    from: m.from,
    to: m.to,
    removed: [],
    swapPiece: null,
    ep: st.ep,
    half: st.half,
    full: st.full,
    turn: st.turn,
    castling: { w: { ...st.castling.w }, b: { ...st.castling.b } },
    cross: { w: st.mv.w.cross, b: st.mv.b.cross },
    capturedKing: st.capturedKing,
    converted: st.converted,
    exploded: st.exploded,
  };
  st.converted = -1;
  const remove = (sq) => {
    const q = board[sq];
    if (!q) return null;
    undo.removed.push({ sq, piece: q });
    board[sq] = null;
    return q;
  };

  board[m.from] = null;
  let capturedColor = null;

  if (m.swap) {
    const q = board[m.to];
    undo.swapPiece = q;
    board[m.from] = q;
    board[m.to] = p;
    st.mv[p.c].cross++;
  } else if (m.castle) {
    const rook = board[m.rookFrom];
    undo.rook = { from: m.rookFrom, to: m.rookTo, piece: rook };
    board[m.rookFrom] = null;
    board[m.rookTo] = rook;
    board[m.to] = p;
  } else {
    if (m.ep) {
      const victimSq = sqAt(st, fileOf(st, m.to), rankOf(st, m.from));
      const v = remove(victimSq);
      if (v) capturedColor = v.c;
    }
    if (Array.isArray(m.caps)) {
      for (const csq of m.caps) {
        if (csq === m.to) continue;
        const v = remove(csq);
        if (v) capturedColor = v.c;
      }
    }
    if (board[m.to]) {
      const v = remove(m.to);
      if (v) capturedColor = v.c;
    }
    let placed = p;
    if (m.vanish) placed = null;
    else if (m.promo) placed = { ...p, t: m.promo, used: 0 };
    else if ((m.kingStep && st.flags.bishopKing) || p.t === 'j') placed = { ...p, used: p.used + 1 };
    if (placed) board[m.to] = placed;
  }
  const takenNow = undo.removed.filter((r) => r.piece && r.piece.c !== p.c).length;
  undo.capsBefore = { w: st.caps.w, b: st.caps.b };
  if (takenNow) st.caps[p.c] = (st.caps[p.c] || 0) + takenNow;
  if (st.flags.andernach && takenNow && p.t !== 'k' && board[m.to]) {
    board[m.to] = { ...board[m.to], c: other(p.c) };
  }

  /* Взрыв: крест вокруг клетки приземления, короли неуязвимы. */
  let exploded = false;
  if (st.flags.explode && (capturedColor || (m.caps && m.caps.length))) {
    exploded = true;
    const x = fileOf(st, m.to);
    const y = rankOf(st, m.to);
    for (const [dx, dy] of ROOK_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inside(st, nx, ny)) continue;
      const s = sqAt(st, nx, ny);
      const q = board[s];
      if (q && q.t !== 'k') remove(s);
    }
  }

  /* Перебежчик: с шансом 20% съеденная фигура переходит на сторону победителя. */
  if (st.flags.convert20 && undo.removed.length && Math.random() < 0.2) {
    const victim = undo.removed[undo.removed.length - 1].piece;
    if (victim && victim.t !== 'k') {
      const empties = [];
      for (let i = 0; i < board.length; i++) if (!board[i]) empties.push(i);
      if (empties.length) {
        const target = empties[Math.floor(Math.random() * empties.length)];
        board[target] = { ...victim, c: p.c, used: 0 };
        st.converted = target;
        undo.convertedPiece = { sq: target, piece: board[target] };
      }
    }
  }

  /* Права рокировки: король и ладьи. */
  const clearRights = (color, id) => {
    if (!color) return;
    for (const side of ['k', 'q']) if (st.castling[color][side] === id) st.castling[color][side] = null;
  };
  if (p.t === 'k') {
    st.castling[p.c].k = null;
    st.castling[p.c].q = null;
    if (st.flags.castleReturn) {
      const homeRank = p.c === 'w' ? 0 : st.H - 1;
      if (rankOf(st, m.to) === homeRank) {
        const leftRook = board[sqAt(st, 0, homeRank)];
        const rightRook = board[sqAt(st, st.W - 1, homeRank)];
        if (leftRook && leftRook.t === 'r' && leftRook.c === p.c) st.castling[p.c].q = leftRook.id;
        if (rightRook && rightRook.t === 'r' && rightRook.c === p.c) st.castling[p.c].k = rightRook.id;
      }
    }
  }
  if (p.t === 'r') clearRights(p.c, p.id);
  for (const r of undo.removed) {
    if (r.piece.t === 'r') clearRights(r.piece.c, r.piece.id);
    if (r.piece.t === 'k') st.capturedKing = r.piece.c;
  }

  /* Взятие на проходе. */
  if (p.t === 'p' && Math.abs(rankOf(st, m.to) - rankOf(st, m.from)) === 2) {
    st.ep = sqAt(st, fileOf(st, m.from), (rankOf(st, m.from) + rankOf(st, m.to)) / 2);
  } else {
    st.ep = -1;
  }

  st.half = (p.t === 'p' || capturedColor) ? 0 : st.half + 1;
  if (st.turn === 'b') st.full++;
  st.turn = other(st.turn);
  st.exploded = exploded;
  return undo;
}

function undoMove(st, undo) {
  const { board } = st;

  if (undo.convertedPiece) board[undo.convertedPiece.sq] = null;   // убрать перебежчика
  st.converted = undo.converted;
  st.exploded = undo.exploded;
  board[undo.to] = null;                                   // убрать фигуру с места приземления
  if (undo.swapPiece) board[undo.to] = undo.swapPiece;     // вернуть обменянную фигуру
  if (undo.rook) board[undo.rook.to] = null;               // убрать ладью с нового места
  board[undo.from] = undo.piece;                           // король/фигура — домой
  if (undo.rook) board[undo.rook.from] = undo.rook.piece;  // ладья — домой
  for (const r of undo.removed) board[r.sq] = r.piece;     // вернуть съеденное
  st.mv.w.cross = undo.cross.w;
  st.mv.b.cross = undo.cross.b;

  st.ep = undo.ep;
  st.half = undo.half;
  st.full = undo.full;
  st.turn = undo.turn;
  st.castling = { w: { ...undo.castling.w }, b: { ...undo.castling.b } };
  st.capturedKing = undo.capturedKing;
  if (undo.capsBefore) st.caps = { ...undo.capsBefore };
}

/* ═════════════════════════════ ЛЕГАЛЬНОСТЬ ═════════════════════════════ */

function legalMoves(st, color = st.turn) {
  let pseudo = genPseudo(st, color);
  if (st.flags.antichess) {
    const caps = pseudo.filter((m) => m.capture != null || m.ep || (m.caps && m.caps.length));
    if (caps.length) pseudo = caps;
    return pseudo;
  }
  if (st.flags.kingFree || st.flags.race) return pseudo;
  const out = [];
  for (const m of pseudo) {
    const undo = applyMove(st, m);
    const bad = inCheck(st, color);
    undoMove(st, undo);
    if (!bad) out.push(m);
  }
  if (st.flags.checkless) {
    const safe = [];
    for (const m of out) {
      const undo = applyMove(st, m);
      const givesCheck = inCheck(st, other(color));
      undoMove(st, undo);
      if (!givesCheck) safe.push(m);
    }
    if (safe.length) return safe;
  }
  return out;
}

/* ══════════════════════════════ СТАТУС ═════════════════════════════════ */

function positionKey(st) {
  let s = '';
  for (const p of st.board) s += p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.';
  s += '|' + st.turn;
  s += '|' + (st.castling.w.k || '') + (st.castling.w.q || '') + (st.castling.b.k || '') + (st.castling.b.q || '');
  s += '|' + st.ep;
  s += '|' + st.blocked.join(',');
  return s;
}

function insufficient(st) {
  const w = [];
  const b = [];
  for (const p of st.board) {
    if (!p) continue;
    (p.c === 'w' ? w : b).push(p.t);
  }
  const others = (arr) => arr.filter((t) => t !== 'k').length;
  const minors = (arr) => arr.filter((t) => t === 'b' || t === 'n').length;
  if (others(w) === 0 && others(b) === 0) return true;
  if (others(w) === 0 && others(b) === 1 && minors(b) === 1) return true;
  if (others(b) === 0 && others(w) === 1 && minors(w) === 1) return true;
  return false;
}

function updateStatus(st) {
  const countPieces = (color) => st.board.filter((q) => q && q.c === color).length;
  if (st.flags.captureAll) {
    const wLeft = countPieces('w');
    const bLeft = countPieces('b');
    if (wLeft === 0 || bLeft === 0) {
      st.status = 'over';
      st.result = { winner: wLeft === 0 ? 'b' : 'w', reason: 'devoured' };
      return st.result;
    }
    return null;
  }
  if (st.flags.captureRace) return null;
  if (st.flags.clashBrawl) {
    if (st.brawl && (st.brawl.hp.w <= 0 || st.brawl.hp.b <= 0)) {
      st.status = 'over';
      st.result = { winner: st.brawl.hp.w <= 0 ? 'b' : 'w', reason: 'brawl' };
      return st.result;
    }
    return null;
  }
  if (st.flags.raceKing) {
    const wk = findKing(st, 'w');
    const bk = findKing(st, 'b');
    if (wk >= 0 && rankOf(st, wk) === st.H - 1) {
      st.status = 'over';
      st.result = { winner: 'w', reason: 'raceKing' };
      return st.result;
    }
    if (bk >= 0 && rankOf(st, bk) === 0) {
      st.status = 'over';
      st.result = { winner: 'b', reason: 'raceKing' };
      return st.result;
    }
    return null;
  }
  if (st.capturedKing) {
    st.status = 'over';
    st.result = { winner: other(st.capturedKing), reason: 'king' };
    return st.result;
  }
  if (st.flags.antichess) {
    const count = (color) => st.board.filter((q) => q && q.c === color).length;
    const wLeft = count('w');
    const bLeft = count('b');
    if (wLeft === 0 || bLeft === 0) {
      st.status = 'over';
      st.result = { winner: wLeft === 0 ? 'w' : 'b', reason: 'antichess' };
      return st.result;
    }
    const moves = legalMoves(st, st.turn);
    if (!moves.length) {
      st.status = 'over';
      st.result = { winner: st.turn, reason: 'antichess' };
      return st.result;
    }
    st.check = false;
    st.status = 'play';
    st.result = null;
    return null;
  }
  if (st.flags.race) {
    for (const c of ['w', 'b']) {
      const k = findKing(st, c);
      if (k >= 0 && rankOf(st, k) === st.H - 1) {
        st.status = 'over';
        st.result = { winner: c, reason: 'race' };
        return st.result;
      }
    }
  }
  if (st.flags.centerWin) {
    const cells = centerCells(st);
    for (const c of ['w', 'b']) {
      const k = findKing(st, c);
      if (k >= 0 && cells.includes(k)) {
        st.status = 'over';
        st.result = { winner: c, reason: 'center' };
        return st.result;
      }
    }
  }

  if (st.flags.queenLose) {
    for (const c of ['w', 'b']) {
      if (findPiece(st, c, 'q') < 0) {
        st.status = 'over';
        st.result = { winner: other(c), reason: 'queenLost' };
        return st.result;
      }
    }
  }

  const color = st.turn;
  const moves = legalMoves(st, color);
  const check = inCheck(st, color);
  st.check = check;

  if (!moves.length) {
    st.status = 'over';
    st.result = check
      ? { winner: other(color), reason: 'mate' }
      : { winner: null, reason: 'stalemate' };
    return st.result;
  }

  if (st.flags.kingOnlyLose && onlyKing(st, color)) {
    st.status = 'over';
    st.result = { winner: other(color), reason: 'kingOnly' };
    return st.result;
  }

  if (!st.flags.race && st.flags.classic) {
    if (st.half >= 100) {
      st.status = 'over';
      st.result = { winner: null, reason: 'fifty' };
      return st.result;
    }
    if (insufficient(st)) {
      st.status = 'over';
      st.result = { winner: null, reason: 'material' };
      return st.result;
    }
  }

  st.status = 'play';
  st.result = null;
  return null;
}

/* ══════════════════════════════ ВИДИМОСТЬ ══════════════════════════════ */

function visSet(st, color) {
  const vis = new Set();
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p || p.c !== color) continue;
    const x = fileOf(st, i);
    const y = rankOf(st, i);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy;
        if (inside(st, nx, ny)) vis.add(sqAt(st, nx, ny));
      }
    }
  }
  return vis;
}

/* ═══════════════════════════════ SAN ═══════════════════════════════════ */

function moveToSan(st, m, legal) {
  if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
  const p = st.board[m.from];
  const letter = p.t === 'p' ? '' : p.t.toUpperCase();
  if (m.swap) {
    const q = st.board[m.to];
    return `K↔${q.t.toUpperCase()}`;
  }
  let san = letter;
  const capture = m.capture != null || m.ep || (m.caps && m.caps.length);
  if (p.t !== 'p' && p.t !== 'k') {
    const rivals = legal.filter((x) => {
      if (x === m) return false;
      const q = st.board[x.from];
      return q && q.t === p.t && x.to === m.to;
    });
    if (rivals.length) {
      const sameFile = rivals.some((x) => fileOf(st, x.from) === fileOf(st, m.from));
      const sameRank = rivals.some((x) => rankOf(st, x.from) === rankOf(st, m.from));
      if (!sameFile) san += FILES[fileOf(st, m.from)];
      else if (!sameRank) san += rankOf(st, m.from) + 1;
      else san += sqName(st, m.from);
    }
  }
  if (p.t === 'p' && capture) san += FILES[fileOf(st, m.from)];
  if (capture) san += 'x';
  san += sqName(st, m.to);
  if (m.promo) san += '=' + m.promo.toUpperCase();
  if (m.ep) san += ' e.p.';

  /* шах и мат */
  const undo = applyMove(st, m);
  const enemy = st.turn;
  const enemyMoves = legalMoves(st, enemy);
  const check = inCheck(st, enemy);
  undoMove(st, undo);
  if (check) san += enemyMoves.length ? '+' : '#';
  return san;
}

/* ══════════════════════════════ БЛОКИ ═════════════════════════════════ */

function maybeBlock(st, rng = Math.random) {
  if (!st.flags.blocks) return -1;
  if (st.full % 3 !== 0) return -1;
  if (rng() > 0.2) return -1;
  const empty = [];
  for (let i = 0; i < st.board.length; i++) if (!st.board[i] && !isBlocked(st, i)) empty.push(i);
  if (!empty.length) return -1;
  const sq = empty[Math.floor(rng() * empty.length)];
  st.blocked.push(sq);
  return sq;
}

/* ══════════════════════════════ ПРОЧЕЕ ═════════════════════════════════ */

function materialOf(st, color) {
  let sum = 0;
  for (const p of st.board) if (p && p.c === color && p.t !== 'k') sum += PIECE_VALUE[p.t] || 0;
  return sum;
}

function perft(st, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(st, st.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const undo = applyMove(st, m);
    nodes += perft(st, depth - 1);
    undoMove(st, undo);
  }
  return nodes;
}


/* ══════════════════════════════ ЦЕНТР ══════════════════════════════════ */

/** Четыре центральные клетки поля (для режима «Центр»). */
function centerCells(st) {
  const cx = Math.floor(st.W / 2);
  const cy = Math.floor(st.H / 2);
  const out = [];
  for (const x of [cx - 1, cx]) {
    for (const y of [cy - 1, cy]) {
      if (inside(st, x, y)) out.push(sqAt(st, x, y));
    }
  }
  return out;
}

/* ═══════════════════════════ ПОДСКАЗКА ХОДА ════════════════════════════ */

/** Оценка позиции с точки зрения белых: материал плюс тяга к центру. */
function evaluateWhite(st) {
  let score = 0;
  for (let i = 0; i < st.board.length; i++) {
    const p = st.board[i];
    if (!p) continue;
    let v = PIECE_VALUE[p.t] || 0;
    const x = fileOf(st, i);
    const y = rankOf(st, i);
    const dx = Math.abs(x - (st.W - 1) / 2);
    const dy = Math.abs(y - (st.H - 1) / 2);
    v += Math.max(0, 3 - (dx + dy)) * 0.06;
    score += p.c === 'w' ? v : -v;
  }
  return score;
}

function negamax(st, depth, alpha, beta) {
  const color = st.turn;
  if (depth === 0) return (color === 'w' ? 1 : -1) * evaluateWhite(st);
  const moves = legalMoves(st, color);
  if (!moves.length) return inCheck(st, color) ? -90000 + (4 - depth) : 0;
  moves.sort((a, b) => (b.capture ? 1 : 0) - (a.capture ? 1 : 0));
  let best = -Infinity;
  for (const m of moves) {
    const undo = applyMove(st, m);
    const score = -negamax(st, depth - 1, -beta, -alpha);
    undoMove(st, undo);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Все ходы с оценками, от лучшего к худшему. */
function rankMoves(st, depth = 2) {
  const color = st.turn;
  const moves = legalMoves(st, color);
  if (!moves.length) return [];
  moves.sort((a, b) => (b.capture ? 1 : 0) - (a.capture ? 1 : 0));
  const scored = [];
  for (const m of moves) {
    const undo = applyMove(st, m);
    const score = -negamax(st, depth - 1, -Infinity, Infinity);
    undoMove(st, undo);
    scored.push({ move: m, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Лучший ход по оценке на пару полуходов вперёд. */
function bestMove(st, depth = 2) {
  const ranked = rankMoves(st, depth);
  return ranked.length ? ranked[0] : null;
}
function cloneState(st) {
  const copy = {
    ...st,
    board: st.board.map((p) => (p ? { ...p } : null)),
    castling: { w: { ...st.castling.w }, b: { ...st.castling.b } },
    blocked: st.blocked.slice(),
    mv: { w: { ...st.mv.w }, b: { ...st.mv.b } },
    pawnStart: { w: st.pawnStart.w.slice(), b: st.pawnStart.b.slice() },
  };
  return copy;
}
