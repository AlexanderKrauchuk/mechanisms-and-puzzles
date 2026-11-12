import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

// Заглушки Foundry должны стоять до загрузки модулей.
const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { PuzzleSocket } = await import("../scripts/socket.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SlidingPuzzle, isAdjacent, isSolvable, isSolved } = await import("../scripts/puzzles/sliding.mjs");

registerPuzzleType(SlidingPuzzle);
PuzzleEngine.register();

const pub = (id) => PuzzleStore.getPublic(id, ctx.scene);
const move = (puzzleId, m) =>
  PuzzleSocket.request("puzzle:move", { sceneId: ctx.scene.id, puzzleId, move: m });
const slide = (puzzleId, index) => move(puzzleId, { action: "move", index });

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.hookCalls.length = 0;
});

test("создание: поле перемешано, решаемо, секретных данных кроме действий нет", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, {
    type: "sliding",
    name: "Плитки",
    config: { rows: 3, cols: 3 }
  });
  const data = pub(id);
  assert.equal(data.type, "sliding");
  assert.deepEqual(data.config, { rows: 3, cols: 3 });
  assert.equal(isSolvable(data.state.tiles, 3, 3), true);
  assert.equal(isSolved(data.state.tiles), false);
  assert.deepEqual(Object.keys(PuzzleStore.getSecret(id)), ["actions"]);
});

test("создание: неверный размер поля отклоняется", async () => {
  await assert.rejects(
    PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding", config: { rows: 1, cols: 3 } }),
    /invalidSetup/
  );
});

test("ходы через сокет: легальный ход, заблокированный ход, решение", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding", config: { rows: 3, cols: 3 } });

  // Легальный ход: берём любую плитку рядом с пустой клеткой.
  const before = pub(id).state.tiles;
  const empty = before.indexOf(0);
  const near = before.findIndex((_, i) => isAdjacent(i, empty, 3));
  const moved = await slide(id, near);
  assert.equal(moved.code, "moved");
  assert.equal(pub(id).state.moves, 1);
  assert.equal(pub(id).state.tiles[empty], before[near]);
  assert.equal(pub(id).state.tiles[near], 0);

  // Сама пустая клетка (теперь она на месте near) не двигается.
  assert.equal((await slide(id, near)).code, "blocked");
  assert.equal(pub(id).state.moves, 1);

  // Ставим поле на один ход до решения и делаем этот ход.
  await PuzzleStore.patchPublic(ctx.scene, id, { state: { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 20 } });
  const last = await slide(id, 8);
  assert.equal(last.code, "solved");
  assert.equal(last.outcome, "success");
  assert.equal(pub(id).solved, true);
  assert.equal(ctx.hookCalls.filter((c) => c.name.endsWith(".outcome") && c.data.outcome === "success").length, 1);

  assert.equal((await slide(id, 7)).code, "alreadySolved");
});

test("недопустимый индекс отклоняется как invalidMove, игрок не может «телепортировать» плитку", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding" });
  await assert.rejects(slide(id, 99), /invalidMove/);
  await assert.rejects(slide(id, -1), /invalidMove/);
  await assert.rejects(move(id, { action: "move", index: "2" }), /invalidMove/);
  await assert.rejects(move(id, { action: "teleport", from: 0, to: 8 }), /invalidMove/);
});

test("сброс даёт новое перемешанное решаемое поле и снимает флаг решённости", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding", config: { rows: 4, cols: 4 } });
  await PuzzleStore.patchPublic(ctx.scene, id, {
    state: { tiles: [...Array(15).keys()].map((i) => i + 1).concat(0), moves: 42 },
    solved: true
  });

  await PuzzleEngine.resetPuzzle(ctx.scene, id);
  const data = pub(id);
  assert.equal(data.solved, false);
  assert.equal(data.state.moves, 0);
  assert.equal(data.state.tiles.length, 16);
  assert.equal(isSolvable(data.state.tiles, 4, 4), true);
  assert.equal(isSolved(data.state.tiles), false);
});

test("одновременные нажатия: второй игрок получает blocked, а не испорченное состояние", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding", config: { rows: 3, cols: 3 } });
  await PuzzleStore.patchPublic(ctx.scene, id, { state: { tiles: [1, 2, 3, 4, 5, 6, 7, 0, 8], moves: 0 } });

  // Оба игрока нажимают на разные плитки рядом с пустой клеткой одновременно.
  const [a, b] = await Promise.all([slide(id, 8), slide(id, 4)]);
  assert.equal(a.code === "solved" || a.code === "moved", true);
  const tiles = pub(id).state.tiles;
  assert.equal(tiles.filter((v) => v === 0).length, 1, "ровно одна пустая клетка");
  assert.deepEqual([...tiles].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(["moved", "blocked", "solved", "alreadySolved"].includes(b.code));
});
