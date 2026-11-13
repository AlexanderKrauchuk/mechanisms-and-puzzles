import test from "node:test";
import assert from "node:assert/strict";
import {
  RingsPuzzle as P,
  defaultLabels,
  normalizeLabels,
  ringGeometry,
  ringLabelSize
} from "../scripts/puzzles/rings.mjs";
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

const SOLUTION = [2, 0, 4];

function setup(overrides = {}) {
  const config = { ...P.defaults(), ...overrides };
  assert.deepEqual(P.validate({ config, solution: SOLUTION }), []);
  const built = P.build({ config, solution: SOLUTION });
  return { config: built.config, secret: built.secret, state: built.state };
}

function rotate(ctx, ring, direction) {
  const result = P.applyMove({ ...ctx, move: { action: "rotate", ring, direction } });
  ctx.state = result.state;
  return result;
}
const check = (ctx) => {
  const result = P.applyMove({ ...ctx, move: { action: "check" } });
  ctx.state = result.state;
  return result;
};

test("validate: корректные настройки проходят, ошибки получают коды", () => {
  const ok = P.defaults();
  assert.deepEqual(P.validate({ config: ok, solution: SOLUTION }), []);

  assert.ok(P.validate({ config: { ...ok, rings: 0 }, solution: [] }).includes("ringsCount"));
  assert.ok(P.validate({ config: { ...ok, rings: 6 }, solution: SOLUTION }).includes("ringsCount"));
  assert.ok(P.validate({ config: { ...ok, sectors: 1 }, solution: SOLUTION }).includes("sectorsCount"));
  assert.ok(P.validate({ config: { ...ok, sectors: 13 }, solution: SOLUTION }).includes("sectorsCount"));
  assert.ok(P.validate({ config: { ...ok, rings: 2.5 }, solution: SOLUTION }).includes("ringsCount"));

  for (const bad of [[2, 0], [2, 0, 6], [2, 0, -1], [2, 0, NaN], [2, 0, 1.5], "202", null]) {
    assert.ok(P.validate({ config: ok, solution: bad }).includes("ringsSolution"), JSON.stringify(bad));
  }
  assert.ok(P.validate({ config: { ...ok, checkMode: "x" }, solution: SOLUTION }).includes("ringsCheckMode"));
  assert.ok(P.validate({ config: { ...ok, failOnWrong: true }, solution: SOLUTION }).includes("failAuto"));
  assert.deepEqual(P.validate({ config: { ...ok, checkMode: "confirm", failOnWrong: true }, solution: SOLUTION }), []);
});

test("validate: подписи секторов", () => {
  const ok = P.defaults();
  const labels = ["A", "B", "C", "D", "E", "F"];
  assert.deepEqual(P.validate({ config: { ...ok, labels }, solution: SOLUTION }), []);
  assert.deepEqual(P.validate({ config: { ...ok, labels: [labels, labels, labels] }, solution: SOLUTION }), []);
  assert.ok(P.validate({ config: { ...ok, labels: ["A", "B"] }, solution: SOLUTION }).includes("labelsShape"));
  assert.ok(P.validate({ config: { ...ok, labels: [labels, labels] }, solution: SOLUTION }).includes("labelsShape"));
  assert.ok(P.validate({ config: { ...ok, labels: "ABCDEF" }, solution: SOLUTION }).includes("labelsShape"));
  assert.ok(
    P.validate({ config: { ...ok, labels: ["A", "", "C", "D", "E", "F"] }, solution: SOLUTION }).includes("labelsContent")
  );
  assert.ok(
    P.validate({ config: { ...ok, labels: ["ABCDEFG", "B", "C", "D", "E", "F"] }, solution: SOLUTION }).includes("labelsContent")
  );
});

test("normalizeLabels: форматы подписей", () => {
  assert.deepEqual(normalizeLabels(null, 2, 3), [["1", "2", "3"], ["1", "2", "3"]]);
  assert.deepEqual(normalizeLabels(["a", "b", "c"], 2, 3), [["a", "b", "c"], ["a", "b", "c"]]);
  assert.deepEqual(normalizeLabels([["a", "b", "c"], ["d", "e", "f"]], 2, 3), [["a", "b", "c"], ["d", "e", "f"]]);
  assert.equal(normalizeLabels(["a", "b"], 2, 3), null);
  assert.equal(normalizeLabels("abc", 2, 3), null);
  assert.deepEqual(defaultLabels(1, 4), [["1", "2", "3", "4"]]);
});

test("build: решение не попадает в публичные данные, старт не совпадает с решением", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const config = { ...P.defaults(), rings: 1, sectors: 2 };
    const built = P.build({ config, solution: [1] });
    assert.equal(JSON.stringify({ config: built.config, state: built.state }).includes("solution"), false);
    assert.notDeepEqual(built.state.positions, [1]);
  }
  const { state } = setup();
  assert.equal(state.positions.length, 3);
  assert.ok(state.positions.every((p) => Number.isInteger(p) && p >= 0 && p < 6));
});

test("initialState: детерминированный rng и обход решения", () => {
  const config = { rings: 2, sectors: 3 };
  // rng сначала даёт положения, равные решению, потом другие.
  const values = [0, 0, 0.5, 0.5];
  let i = 0;
  const state = P.initialState(config, { solution: [0, 0] }, () => values[i++] ?? 0.99);
  assert.deepEqual(state.positions, [1, 1]);
  // без секрета берётся первая выборка
  i = 0;
  assert.deepEqual(P.initialState(config, null, () => values[i++]).positions, [0, 0]);
});

test("поворот: влево увеличивает положение, вправо уменьшает, с переходом через край", () => {
  const ctx = setup();
  ctx.state = { positions: [0, 5, 3], moves: 0, attempts: 0 };
  rotate(ctx, 0, -1);
  assert.deepEqual(ctx.state.positions, [5, 5, 3]);
  rotate(ctx, 1, 1);
  assert.deepEqual(ctx.state.positions, [5, 0, 3]);
  rotate(ctx, 2, 1);
  assert.deepEqual(ctx.state.positions, [5, 0, 4]);
  assert.equal(ctx.state.moves, 3);
});

test("auto: комбинация решает загадку сразу после последнего поворота", () => {
  const ctx = setup({ checkMode: "auto" });
  ctx.state = { positions: [2, 0, 3], moves: 7, attempts: 0 };
  const middle = rotate(ctx, 1, 1);
  assert.equal(middle.code, "rotated");
  assert.equal(middle.outcome, null);
  rotate(ctx, 1, -1);
  const last = rotate(ctx, 2, 1);
  assert.equal(last.code, "solved");
  assert.equal(last.outcome, "success");
  assert.equal(last.solved, true);
});

test("auto: действие check недоступно", () => {
  const ctx = setup({ checkMode: "auto" });
  assert.throws(() => P.applyMove({ ...ctx, move: { action: "check" } }), PuzzleMoveError);
});

test("confirm: поворот не решает, проверка решает, счётчик проверок растёт", () => {
  const ctx = setup({ checkMode: "confirm" });
  ctx.state = { positions: [2, 0, 3], moves: 0, attempts: 0 };
  const turn = rotate(ctx, 2, 1);
  assert.equal(turn.code, "rotated");
  assert.equal(turn.solved, false);
  assert.deepEqual(ctx.state.positions, [2, 0, 4]);

  const ok = check(ctx);
  assert.equal(ok.code, "solved");
  assert.equal(ok.outcome, "success");
  assert.equal(ctx.state.attempts, 1);
});

test("confirm: неверная проверка даёт wrong, а при failOnWrong исход failure", () => {
  const soft = setup({ checkMode: "confirm", failOnWrong: false });
  soft.state = { positions: [0, 0, 0], moves: 0, attempts: 0 };
  const wrong = check(soft);
  assert.equal(wrong.code, "wrong");
  assert.equal(wrong.outcome, null);
  assert.equal(soft.state.attempts, 1);

  const hard = setup({ checkMode: "confirm", failOnWrong: true });
  hard.state = { positions: [0, 0, 0], moves: 0, attempts: 0 };
  const failed = check(hard);
  assert.equal(failed.code, "failed");
  assert.equal(failed.outcome, "failure");
  assert.equal(failed.solved, false);
});

test("недопустимые ходы бросают PuzzleMoveError", () => {
  const ctx = setup();
  const bad = [
    { action: "rotate", ring: 3, direction: 1 },
    { action: "rotate", ring: -1, direction: 1 },
    { action: "rotate", ring: 1.5, direction: 1 },
    { action: "rotate", ring: "0", direction: 1 },
    { action: "rotate", ring: 0, direction: 2 },
    { action: "rotate", ring: 0, direction: 0 },
    { action: "rotate", ring: 0, direction: "1" },
    { action: "rotate", ring: 0 },
    { action: "set", ring: 0, position: 2 },
    {},
    null
  ];
  for (const move of bad) {
    assert.throws(() => P.applyMove({ ...ctx, move }), PuzzleMoveError, JSON.stringify(move));
  }
});

test("игрок не может «выставить» кольцо в нужное положение одним ходом", () => {
  const ctx = setup();
  ctx.state = { positions: [0, 3, 1], moves: 0, attempts: 0 };
  const before = [...ctx.state.positions];
  rotate(ctx, 0, 1);
  const changed = ctx.state.positions.filter((p, i) => p !== before[i]).length;
  assert.equal(changed, 1);
  assert.equal(Math.abs(ctx.state.positions[0] - before[0]), 1);
});

test("nearSolved: до решения ровно один поворот первого кольца, и он решает", () => {
  for (const sectors of [2, 3, 6, 12]) {
    const config = { ...P.defaults(), rings: 2, sectors };
    const solution = [sectors - 1, 0];
    const secret = { solution };
    const state = P.nearSolved(config, secret);
    assert.notDeepEqual(state.positions, solution);
    const direction = (state.positions[0] + 1) % sectors === solution[0] ? 1 : -1;
    const result = P.applyMove({ config, state, secret, move: { action: "rotate", ring: 0, direction } });
    assert.equal(result.outcome, "success", `sectors ${sectors}`);
  }
});

test("серия случайных поворотов: положения остаются в допустимых пределах", () => {
  const ctx = setup();
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    rotate(ctx, Math.floor(rng() * 3), rng() < 0.5 ? 1 : -1);
    assert.ok(ctx.state.positions.every((p) => Number.isInteger(p) && p >= 0 && p < 6));
  }
  assert.equal(ctx.state.moves, 500);
});

test("ringGeometry: число секторов, сектор под меткой и подписи", () => {
  const labels = [["A", "B", "C", "D"], ["a", "b", "c", "d"]];
  const geo = ringGeometry({ rings: 2, sectors: 4, labels, positions: [1, 3] });
  assert.equal(geo.length, 2);
  assert.deepEqual(geo[0].sectors.map((s) => s.label), ["B", "C", "D", "A"]);
  assert.deepEqual(geo[1].sectors.map((s) => s.label), ["d", "a", "b", "c"]);
  for (const ring of geo) {
    assert.equal(ring.sectors.filter((s) => s.pointer).length, 1);
    assert.equal(ring.sectors[0].pointer, true);
    for (const s of ring.sectors) {
      assert.match(s.d, /^M [-\d. ]+A [-\d. ]+L [-\d. ]+A [-\d. ]+Z$/);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    }
  }
  // Подпись метки (сектор 0) лежит над центром (x примерно равен центру 150).
  assert.ok(Math.abs(geo[0].sectors[0].x - 150) < 1);
  assert.ok(geo[0].sectors[0].y < 150);
});

test("ringGeometry: внешнее кольцо первое и находится дальше от центра", () => {
  const labels = defaultLabels(3, 6);
  const geo = ringGeometry({ rings: 3, sectors: 6, labels, positions: [0, 0, 0] });
  const dist = (ring) => Math.hypot(geo[ring].sectors[0].x - 150, geo[ring].sectors[0].y - 150);
  assert.ok(dist(0) > dist(1) && dist(1) > dist(2));
});

test("ringLabelSize: в разумных пределах и уменьшается при длинных подписях", () => {
  const short = ringLabelSize({ rings: 3, sectors: 6, labels: defaultLabels(3, 6) });
  assert.ok(short >= 7 && short <= 20);
  const longLabels = Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => "ABCDEF"));
  assert.ok(ringLabelSize({ rings: 3, sectors: 6, labels: longLabels }) <= short);
  assert.ok(ringLabelSize({ rings: 5, sectors: 12, labels: defaultLabels(5, 12) }) >= 7);
});
