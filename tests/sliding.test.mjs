import test from "node:test";
import assert from "node:assert/strict";
import {
  SlidingPuzzle as P,
  goalTiles,
  isSolved,
  isSolvable,
  isAdjacent,
  shuffledTiles
} from "../scripts/puzzles/sliding.mjs";
import { PuzzleMoveError } from "../scripts/puzzles/base.mjs";

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neighbors(index, rows, cols) {
  const r = Math.floor(index / cols);
  const c = index % cols;
  const result = [];
  if (r > 0) result.push(index - cols);
  if (r < rows - 1) result.push(index + cols);
  if (c > 0) result.push(index - 1);
  if (c < cols - 1) result.push(index + 1);
  return result;
}

/** Все расположения, достижимые из решённого поля обычными ходами. */
function reachableFromGoal(rows, cols) {
  const start = goalTiles(rows, cols);
  const seen = new Set([start.join(",")]);
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    const empty = current.indexOf(0);
    for (const nb of neighbors(empty, rows, cols)) {
      const next = [...current];
      [next[empty], next[nb]] = [next[nb], next[empty]];
      const key = next.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        stack.push(next);
      }
    }
  }
  return seen;
}

function* permutations(items) {
  const a = [...items];
  const c = new Array(a.length).fill(0);
  yield [...a];
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [a[k], a[i]] = [a[i], a[k]];
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

for (const [rows, cols] of [[2, 2], [2, 3], [3, 2], [2, 4], [3, 3]]) {
  test(`isSolvable ${rows}x${cols}: формула совпадает с полным перебором достижимых состояний`, () => {
    const reachable = reachableFromGoal(rows, cols);
    const n = rows * cols;
    assert.equal(reachable.size, factorial(n) / 2, "достижима ровно половина всех перестановок");

    let solvableCount = 0;
    for (const perm of permutations(goalTiles(rows, cols))) {
      const solvable = isSolvable(perm, rows, cols);
      if (solvable) solvableCount++;
      assert.equal(solvable, reachable.has(perm.join(",")), `расхождение для ${perm.join(",")}`);
    }
    assert.equal(solvableCount, reachable.size);
  });
}

test("shuffledTiles: всегда перестановка, решаемая и не решённая (разные размеры и зёрна)", () => {
  for (const [rows, cols] of [[2, 2], [3, 3], [4, 4], [3, 5], [5, 3], [6, 6], [2, 6]]) {
    for (let seed = 1; seed <= 150; seed++) {
      const tiles = shuffledTiles(rows, cols, mulberry32(seed * 7919 + rows * 31 + cols));
      assert.deepEqual([...tiles].sort((a, b) => a - b), goalTiles(rows, cols).sort((a, b) => a - b));
      assert.equal(isSolvable(tiles, rows, cols), true, `${rows}x${cols}, seed ${seed}`);
      assert.equal(isSolved(tiles), false, `${rows}x${cols}, seed ${seed}`);
    }
  }
});

test("shuffledTiles: поле 2x2 даёт все 11 нерешённых решаемых расположений", () => {
  const seen = new Set();
  const rng = mulberry32(2026);
  for (let i = 0; i < 2000; i++) seen.add(shuffledTiles(2, 2, rng).join(","));
  assert.equal(seen.size, 11);
});

test("перемешанное поле действительно решается ходами (поиск в ширину на 2x3 и 3x3)", () => {
  for (const [rows, cols] of [[2, 3], [3, 3]]) {
    const reachable = reachableFromGoal(rows, cols);
    for (let seed = 1; seed <= 25; seed++) {
      assert.ok(reachable.has(shuffledTiles(rows, cols, mulberry32(seed)).join(",")));
    }
  }
});

test("validate: размер поля от 2 до 6, только целые числа", () => {
  assert.deepEqual(P.validate({ config: { rows: 3, cols: 3 } }), []);
  assert.deepEqual(P.validate({ config: { rows: 2, cols: 6 } }), []);
  for (const bad of [{ rows: 1, cols: 3 }, { rows: 3, cols: 7 }, { rows: 3.5, cols: 3 }, { rows: "3", cols: 3 }, {}]) {
    assert.deepEqual(P.validate({ config: bad }), ["boardSize"]);
  }
});

test("build: нет секретных данных, состояние решаемо и не решено", () => {
  const built = P.build({ config: { rows: 4, cols: 4 } });
  assert.deepEqual(built.config, { rows: 4, cols: 4 });
  assert.deepEqual(built.secret, {});
  assert.equal(built.state.moves, 0);
  assert.equal(isSolvable(built.state.tiles, 4, 4), true);
  assert.equal(isSolved(built.state.tiles), false);
});

test("isAdjacent: только соседи по стороне, края строк не склеиваются", () => {
  assert.equal(isAdjacent(0, 1, 3), true);
  assert.equal(isAdjacent(0, 3, 3), true);
  assert.equal(isAdjacent(0, 4, 3), false, "диагональ");
  assert.equal(isAdjacent(2, 3, 3), false, "конец строки и начало следующей");
  assert.equal(isAdjacent(4, 4, 3), false, "сама клетка");
});

const config = { rows: 3, cols: 3 };
const move = (state, index) => P.applyMove({ config, state, move: { action: "move", index } });

test("ход: плитка рядом с пустой клеткой сдвигается, счётчик растёт", () => {
  const state = { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 3 };
  const result = move(state, 8);
  assert.deepEqual(result.state.tiles, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.equal(result.state.moves, 4);
  assert.deepEqual(state.tiles, [1, 2, 3, 4, 5, 6, 7, 0, 8], "исходное состояние не изменяется");
});

test("ход: дальняя плитка и сама пустая клетка не двигаются", () => {
  // Пустая клетка на индексе 7 (нижняя строка, середина). Её соседи: 4 (сверху), 6 (слева), 8 (справа).
  const state = { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 0 };
  for (const index of [0, 1, 2, 3, 5, 7]) {
    const result = move(state, index);
    assert.equal(result.code, "blocked", `index ${index}`);
    assert.equal(result.state, state, "состояние не меняется");
    assert.equal(result.outcome, null);
    assert.equal(result.solved, false);
  }
  for (const index of [4, 6]) {
    assert.equal(move(state, index).code, "moved", `index ${index}`);
  }
  // Ход плитки 8 влево на пустую клетку собирает решённое поле.
  assert.equal(move(state, 8).code, "solved");
});

test("ход: решение определяется последним ходом, исход success", () => {
  const nearlySolved = { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 9 };
  const result = move(nearlySolved, 8);
  assert.equal(result.code, "solved");
  assert.equal(result.outcome, "success");
  assert.equal(result.solved, true);

  const mid = move({ tiles: [1, 2, 3, 4, 5, 6, 0, 7, 8], moves: 0 }, 7);
  assert.equal(mid.code, "moved");
  assert.equal(mid.outcome, null);
});

test("ход: недопустимый индекс и действие бросают PuzzleMoveError", () => {
  const state = { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 0 };
  for (const bad of [-1, 9, 1.5, "3", null, undefined, NaN]) {
    assert.throws(() => move(state, bad), PuzzleMoveError, `index ${bad}`);
  }
  for (const m of [{ action: "press", index: 8 }, {}, null]) {
    assert.throws(() => P.applyMove({ config, state, move: m }), PuzzleMoveError);
  }
});

test("серия ходов из случайного поля к решению: каждый ход легален, состояние остаётся решаемым", () => {
  let state = { tiles: shuffledTiles(3, 3, mulberry32(5)), moves: 0 };
  const rng = mulberry32(99);
  for (let step = 0; step < 300; step++) {
    const empty = state.tiles.indexOf(0);
    const options = neighbors(empty, 3, 3);
    const result = move(state, options[Math.floor(rng() * options.length)]);
    assert.notEqual(result.code, "blocked");
    state = result.state;
    assert.equal(isSolvable(state.tiles, 3, 3), true);
  }
  assert.equal(state.moves, 300);
});
