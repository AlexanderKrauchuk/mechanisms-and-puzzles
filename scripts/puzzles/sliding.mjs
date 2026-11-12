import { PuzzleMoveError } from "./base.mjs";

const MIN_SIDE = 2;
const MAX_SIDE = 6;

/**
 * Пятнашки.
 *
 * Настройки (публичные): rows и cols, размер поля от 2 до 6 по каждой стороне.
 * Цель всегда одна: плитки 1..N-1 по порядку, пустая клетка (0) в правом нижнем углу.
 * Цель не секретна: игрок и так видит, как должно выглядеть решённое поле,
 * поэтому секретных данных у этого типа нет.
 *
 * Состояние: tiles (массив значений по клеткам слева направо и сверху вниз, 0 это пустая клетка)
 * и moves (число сделанных ходов).
 *
 * Правило хода: плитку можно сдвинуть, только если она граничит по стороне с пустой клеткой.
 * У этой головоломки нет исхода "failure": проиграть в неё нельзя.
 */
export const SlidingPuzzle = {
  type: "sliding",

  defaults() {
    return { rows: 3, cols: 3 };
  },

  validate({ config } = {}) {
    const isSide = (v) => Number.isInteger(v) && v >= MIN_SIDE && v <= MAX_SIDE;
    return isSide(config?.rows) && isSide(config?.cols) ? [] : ["boardSize"];
  },

  build({ config }) {
    const publicConfig = { rows: config.rows, cols: config.cols };
    return { config: publicConfig, state: SlidingPuzzle.initialState(publicConfig), secret: {} };
  },

  /** Новое перемешанное решаемое поле. rng нужен только тестам (по умолчанию Math.random). */
  initialState(config, rng = Math.random) {
    return { tiles: shuffledTiles(config.rows, config.cols, rng), moves: 0 };
  },

  applyMove({ config, state, move }) {
    if (move?.action !== "move") throw new PuzzleMoveError("UNKNOWN_ACTION");

    const tiles = [...state.tiles];
    const index = move.index;
    if (!Number.isInteger(index) || index < 0 || index >= tiles.length) {
      throw new PuzzleMoveError("BAD_INDEX");
    }

    const empty = tiles.indexOf(0);
    // Плитка не рядом с пустой клеткой (или нажата сама пустая клетка): ход не выполняется.
    // Это не ошибка: так бывает при одновременных нажатиях разных игроков.
    if (!isAdjacent(index, empty, config.cols)) {
      return { state, code: "blocked", outcome: null, solved: false };
    }

    [tiles[index], tiles[empty]] = [tiles[empty], tiles[index]];
    const next = { tiles, moves: (state.moves ?? 0) + 1 };
    const solved = isSolved(tiles);
    return {
      state: next,
      code: solved ? "solved" : "moved",
      outcome: solved ? "success" : null,
      solved
    };
  }
};

/** Решённое поле: 1, 2, ..., N-1, 0. */
export function goalTiles(rows, cols) {
  const n = rows * cols;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 0 : i + 1));
}

export function isSolved(tiles) {
  return tiles.every((value, i) => value === (i === tiles.length - 1 ? 0 : i + 1));
}

/** Соседние ли клетки (по стороне, не по диагонали). */
export function isAdjacent(a, b, cols) {
  const distance = Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs((a % cols) - (b % cols));
  return distance === 1;
}

/** Число инверсий среди плиток (пустая клетка не считается). */
export function countInversions(tiles) {
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === 0) continue;
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[j] !== 0 && tiles[i] > tiles[j]) count++;
    }
  }
  return count;
}

/**
 * Можно ли из этого расположения прийти к решённому полю.
 *
 * Горизонтальный сдвиг пустой клетки не меняет порядок плиток. Вертикальный сдвиг переносит
 * плитку через (cols - 1) других плиток. Поэтому:
 *  - при нечётной ширине чётность числа инверсий не меняется: решаемо, если инверсий чётное число;
 *  - при чётной ширине каждый вертикальный сдвиг меняет чётность инверсий, как и номер строки
 *    пустой клетки: решаемо, если (инверсии + номер строки пустой клетки снизу, считая с 1) нечётно.
 */
export function isSolvable(tiles, rows, cols) {
  const inversions = countInversions(tiles);
  if (cols % 2 === 1) return inversions % 2 === 0;
  const blankRow = Math.floor(tiles.indexOf(0) / cols);
  return (inversions + (rows - blankRow)) % 2 === 1;
}

/**
 * Случайное решаемое и не решённое поле.
 * Перемешиваем случайно (Фишер-Йетс). Если расположение нерешаемо, меняем местами первые две
 * плитки (не пустую клетку): одна перестановка меняет чётность инверсий и не трогает пустую клетку,
 * то есть превращает нерешаемое поле в решаемое. Это взаимно однозначное соответствие,
 * поэтому все решаемые расположения равновероятны.
 */
export function shuffledTiles(rows, cols, rng = Math.random) {
  let tiles;
  do {
    tiles = goalTiles(rows, cols);
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    if (!isSolvable(tiles, rows, cols)) {
      const a = tiles.findIndex((v) => v !== 0);
      const b = tiles.findIndex((v, i) => v !== 0 && i !== a);
      [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
    }
  } while (isSolved(tiles));
  return tiles;
}
