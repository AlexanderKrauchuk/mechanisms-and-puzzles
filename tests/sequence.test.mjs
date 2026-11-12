import test from "node:test";
import assert from "node:assert/strict";
import { SequencePuzzle as P } from "../scripts/puzzles/sequence.mjs";
import { PuzzleMoveError } from "../scripts/puzzles/base.mjs";

const SOLUTION = ["s1", "s3", "s2"];

function setup(overrides = {}) {
  const config = { ...P.defaults(), ...overrides };
  assert.deepEqual(P.validate({ config, solution: SOLUTION }), []);
  const built = P.build({ config, solution: SOLUTION });
  return { config: built.config, secret: built.secret, state: built.state };
}

function press(ctx, symbolId) {
  const result = P.applyMove({ ...ctx, move: { action: "press", symbolId } });
  ctx.state = result.state;
  return result;
}

test("validate: корректные настройки проходят, ошибки получают коды", () => {
  const ok = P.defaults();
  assert.deepEqual(P.validate({ config: ok, solution: SOLUTION }), []);

  assert.ok(P.validate({ config: { ...ok, symbols: [ok.symbols[0]] }, solution: ["s1"] }).includes("symbolsCount"));
  assert.ok(P.validate({ config: ok, solution: [] }).includes("solutionLength"));
  assert.ok(P.validate({ config: ok, solution: ["zzz"] }).includes("solutionUnknown"));
  assert.ok(P.validate({ config: { ...ok, checkMode: "x" }, solution: SOLUTION }).includes("checkMode"));
  assert.ok(P.validate({ config: { ...ok, errorMode: "x" }, solution: SOLUTION }).includes("errorMode"));
  assert.ok(
    P.validate({ config: { ...ok, checkMode: "final", errorMode: "ignore" }, solution: SOLUTION }).includes("finalIgnore")
  );
  const dup = [{ id: "a", label: "A" }, { id: "a", label: "B" }];
  assert.ok(P.validate({ config: { ...ok, symbols: dup }, solution: ["a"] }).includes("symbolsDuplicate"));
  const empty = [{ id: "a", label: "" }, { id: "b", label: "B" }];
  assert.ok(P.validate({ config: { ...ok, symbols: empty }, solution: ["a"] }).includes("symbolsEmpty"));
});

test("build: решение не попадает в публичную конфигурацию и состояние", () => {
  const { config, state, secret } = setup();
  assert.equal(config.length, 3);
  assert.deepEqual(secret.solution, SOLUTION);
  assert.equal(JSON.stringify({ config, state }).includes("solution"), false);
  assert.deepEqual(state, { entered: [], mistakes: 0 });
});

test("step: верная последовательность решает загадку", () => {
  const ctx = setup();
  assert.equal(press(ctx, "s1").code, "progress");
  assert.equal(press(ctx, "s3").code, "progress");
  const last = press(ctx, "s2");
  assert.equal(last.code, "solved");
  assert.equal(last.outcome, "success");
  assert.equal(last.solved, true);
});

test("step + reset: ошибка сбрасывает ввод и считает ошибку", () => {
  const ctx = setup({ errorMode: "reset" });
  press(ctx, "s1");
  const bad = press(ctx, "s4");
  assert.equal(bad.code, "wrong");
  assert.equal(bad.outcome, null);
  assert.deepEqual(ctx.state, { entered: [], mistakes: 1 });
});

test("step + ignore: ошибка не сбрасывает прогресс", () => {
  const ctx = setup({ errorMode: "ignore" });
  press(ctx, "s1");
  const bad = press(ctx, "s4");
  assert.equal(bad.code, "wrong");
  assert.deepEqual(ctx.state, { entered: ["s1"], mistakes: 1 });
});

test("step + fail: ошибка даёт исход failure и сбрасывает ввод", () => {
  const ctx = setup({ errorMode: "fail" });
  press(ctx, "s1");
  const bad = press(ctx, "s2");
  assert.equal(bad.code, "failed");
  assert.equal(bad.outcome, "failure");
  assert.equal(bad.solved, false);
  assert.deepEqual(ctx.state.entered, []);
});

test("final: проверка только после ввода всех символов", () => {
  const ctx = setup({ checkMode: "final", errorMode: "reset" });
  assert.equal(press(ctx, "s4").code, "progress");
  assert.equal(press(ctx, "s4").code, "progress");
  const bad = press(ctx, "s4");
  assert.equal(bad.code, "wrong");
  assert.deepEqual(ctx.state, { entered: [], mistakes: 1 });

  press(ctx, "s1");
  press(ctx, "s3");
  assert.equal(press(ctx, "s2").outcome, "success");
});

test("final + fail: неверная комбинация даёт failure", () => {
  const ctx = setup({ checkMode: "final", errorMode: "fail" });
  press(ctx, "s1");
  press(ctx, "s1");
  assert.equal(press(ctx, "s1").outcome, "failure");
});

test("clear: сбрасывает ввод, но не ошибки", () => {
  const ctx = setup();
  press(ctx, "s1");
  press(ctx, "s4");
  press(ctx, "s1");
  const result = P.applyMove({ ...ctx, move: { action: "clear" } });
  assert.equal(result.code, "cleared");
  assert.deepEqual(result.state, { entered: [], mistakes: 1 });
});

test("недопустимые ходы бросают PuzzleMoveError", () => {
  const ctx = setup();
  for (const move of [{ action: "press", symbolId: "nope" }, { action: "dance" }, {}, null]) {
    assert.throws(() => P.applyMove({ ...ctx, move }), PuzzleMoveError);
  }
});
