import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

// Заглушки Foundry должны стоять до загрузки модулей.
const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { PuzzleSocket } = await import("../scripts/socket.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");

registerPuzzleType(SequencePuzzle);
PuzzleEngine.register();

const ID = ctx.MODULE_ID;
const SOLUTION = ["s1", "s3", "s2"];

const create = (extra = {}) =>
  PuzzleEngine.createPuzzle(ctx.scene, {
    type: "sequence",
    name: "Руны",
    hints: ["Начните с солнца"],
    solution: SOLUTION,
    ...extra
  });

const move = (puzzleId, m) =>
  PuzzleSocket.request("puzzle:move", { sceneId: ctx.scene.id, puzzleId, move: m });
const press = (puzzleId, symbolId) => move(puzzleId, { action: "press", symbolId });
const pub = (id) => PuzzleStore.getPublic(id, ctx.scene);

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.hookCalls.length = 0;
});

test("создание: решение хранится только в скрытом журнале с правами NONE", async () => {
  const id = await create();

  const publicJson = JSON.stringify(ctx.scene.flags);
  assert.equal(publicJson.includes("solution"), false, "в flags сцены не должно быть решения");
  assert.equal(pub(id).name, "Руны");
  assert.equal(pub(id).solved, false);

  assert.deepEqual(PuzzleStore.getSecret(id).solution, SOLUTION);
  assert.equal(PuzzleStore.secretStore.ownership.default, 0);
});

test("создание: неверные настройки отклоняются", async () => {
  await assert.rejects(create({ solution: [] }), /invalidSetup/);
  await assert.rejects(create({ type: "unknown" }), /unknownType/);
});

test("создание, сброс и запись доступны только мастеру", async () => {
  const id = await create();
  ctx.setUser("p1");
  await assert.rejects(create(), /gmOnly/);
  await assert.rejects(PuzzleEngine.resetPuzzle(ctx.scene, id), /gmOnly/);
  await assert.rejects(PuzzleStore.patchPublic(ctx.scene, id, { solved: true }), /gmOnly/);
  assert.throws(() => PuzzleStore.getSecret(id), /gmOnly/);
});

test("ход: ошибка, затем верная последовательность и исход success", async () => {
  const id = await create();

  assert.equal((await press(id, "s1")).code, "progress");
  assert.deepEqual(pub(id).state, { entered: ["s1"], mistakes: 0 });

  assert.equal((await press(id, "s4")).code, "wrong");
  assert.deepEqual(pub(id).state, { entered: [], mistakes: 1 });

  await press(id, "s1");
  await press(id, "s3");
  const last = await press(id, "s2");
  assert.equal(last.code, "solved");
  assert.equal(last.outcome, "success");
  assert.equal(pub(id).solved, true);

  const calls = ctx.hookCalls.filter((c) => c.name === `${ID}.outcome`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.outcome, "success");

  assert.equal((await press(id, "s1")).code, "alreadySolved");
});

test("ответ игроку не содержит решения", async () => {
  const id = await create();
  const response = await press(id, "s1");
  assert.deepEqual(Object.keys(response).sort(), ["code", "outcome", "solved"]);
});

test("режим fail запускает исход failure", async () => {
  const id = await create({ config: { errorMode: "fail" } });
  const result = await press(id, "s4");
  assert.equal(result.outcome, "failure");
  assert.equal(ctx.hookCalls.at(-1).data.outcome, "failure");
  assert.equal(pub(id).solved, false);
});

test("сброс возвращает начальное состояние", async () => {
  const id = await create();
  await press(id, "s1");
  await press(id, "s3");
  await press(id, "s2");
  assert.equal(pub(id).solved, true);

  await PuzzleEngine.resetPuzzle(ctx.scene, id);
  assert.equal(pub(id).solved, false);
  assert.deepEqual(pub(id).state, { entered: [], mistakes: 0 });
});

test("недопустимые запросы отклоняются", async () => {
  const id = await create();
  await assert.rejects(press(id, "нет-такого"), /invalidMove/);
  await assert.rejects(move(id, { action: "dance" }), /invalidMove/);
  await assert.rejects(move(id, null), /invalidMove/);
  await assert.rejects(press("missing", "s1"), /noPuzzle/);
  await assert.rejects(
    PuzzleSocket.request("puzzle:move", { sceneId: "none", puzzleId: id, move: { action: "clear" } }),
    /noPuzzle/
  );
  await assert.rejects(PuzzleSocket.request("unknown:type", {}), /unknownRequest/);
});

test("одновременные ходы выполняются по очереди", async () => {
  const id = await create();
  const results = await Promise.all([press(id, "s1"), press(id, "s3"), press(id, "s2")]);
  assert.deepEqual(results.map((r) => r.code), ["progress", "progress", "solved"]);
  assert.equal(pub(id).solved, true);
});

test("удаление убирает и публичные, и секретные данные", async () => {
  const id = await create();
  await PuzzleStore.remove(ctx.scene, id);
  assert.equal(pub(id), null);
  assert.equal(PuzzleStore.getSecret(id), null);
});
