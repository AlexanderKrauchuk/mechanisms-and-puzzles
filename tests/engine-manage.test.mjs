import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { PuzzleSocket } = await import("../scripts/socket.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");
const { SlidingPuzzle, isSolvable, isSolved } = await import("../scripts/puzzles/sliding.mjs");
const { RingsPuzzle } = await import("../scripts/puzzles/rings.mjs");

registerPuzzleType(SequencePuzzle);
registerPuzzleType(SlidingPuzzle);
registerPuzzleType(RingsPuzzle);
PuzzleEngine.register();

const pub = (id) => PuzzleStore.getPublic(id, ctx.scene);
const move = (id, m) => PuzzleSocket.request("puzzle:move", { sceneId: ctx.scene.id, puzzleId: id, move: m });
const rotate = (id, ring, direction) => move(id, { action: "rotate", ring, direction });

const makeRings = (extra = {}) =>
  PuzzleEngine.createPuzzle(ctx.scene, {
    type: "rings",
    name: "Диски",
    config: { rings: 3, sectors: 6, checkMode: "auto" },
    solution: [2, 0, 4],
    ...extra
  });

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.hookCalls.length = 0;
});

test("кольца: создание кладёт решение только в секреты", async () => {
  const id = await makeRings();
  const data = pub(id);
  assert.equal(data.type, "rings");
  assert.equal(data.config.rings, 3);
  assert.deepEqual(data.config.labels[0], ["1", "2", "3", "4", "5", "6"]);
  assert.equal(data.state.positions.length, 3);
  assert.notDeepEqual(data.state.positions, [2, 0, 4]);
  assert.equal(JSON.stringify(ctx.scene.flags).includes("solution"), false);
  assert.deepEqual(PuzzleStore.getSecret(id).solution, [2, 0, 4]);
});

test("кольца: ходы через сокет приводят к решению и исходу success", async () => {
  const id = await makeRings();
  await PuzzleStore.patchPublic(ctx.scene, id, { state: { positions: [0, 1, 3], moves: 0, attempts: 0 } });

  assert.equal((await rotate(id, 0, 1)).code, "rotated");
  assert.equal((await rotate(id, 0, 1)).code, "rotated");
  assert.equal((await rotate(id, 1, -1)).code, "rotated");
  const last = await rotate(id, 2, 1);
  assert.equal(last.code, "solved");
  assert.equal(last.outcome, "success");
  assert.deepEqual(Object.keys(last).sort(), ["code", "outcome", "solved"]);
  assert.equal(pub(id).solved, true);
  assert.equal((await rotate(id, 0, 1)).code, "alreadySolved");
  assert.equal(ctx.hookCalls.filter((c) => c.data.outcome === "success").length, 1);
});

test("кольца: confirm + failOnWrong, неверная проверка даёт failure без решения в ответе", async () => {
  const id = await makeRings({ config: { rings: 3, sectors: 6, checkMode: "confirm", failOnWrong: true } });
  await PuzzleStore.patchPublic(ctx.scene, id, { state: { positions: [0, 0, 0], moves: 0, attempts: 0 } });
  const result = await move(id, { action: "check" });
  assert.equal(result.code, "failed");
  assert.equal(result.outcome, "failure");
  assert.equal(ctx.hookCalls.at(-1).data.outcome, "failure");
  assert.equal(pub(id).state.attempts, 1);
});

test("кольца: недопустимые ходы игрока отклоняются", async () => {
  const id = await makeRings();
  await assert.rejects(rotate(id, 9, 1), /invalidMove/);
  await assert.rejects(rotate(id, 0, 5), /invalidMove/);
  await assert.rejects(move(id, { action: "set", ring: 0, position: 2 }), /invalidMove/);
  await assert.rejects(move(id, { action: "check" }), /invalidMove/, "check недоступен в режиме auto");
});

test("nearSolve: все три типа доводятся до последнего хода, и этот ход решает загадку", async () => {
  const seq = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sequence", solution: ["s1", "s3", "s2"] });
  await PuzzleEngine.nearSolve(ctx.scene, seq);
  assert.deepEqual(pub(seq).state.entered, ["s1", "s3"]);
  assert.equal((await move(seq, { action: "press", symbolId: "s2" })).outcome, "success");

  const sl = await PuzzleEngine.createPuzzle(ctx.scene, { type: "sliding", config: { rows: 3, cols: 3 } });
  await PuzzleEngine.nearSolve(ctx.scene, sl);
  assert.equal(isSolved(pub(sl).state.tiles), false);
  assert.equal(isSolvable(pub(sl).state.tiles, 3, 3), true);
  assert.equal((await move(sl, { action: "move", index: 8 })).outcome, "success");

  const rg = await makeRings();
  await PuzzleEngine.nearSolve(ctx.scene, rg);
  assert.equal((await rotate(rg, 0, -1)).outcome, "success");
});

test("nearSolve: снимает флаг решённости", async () => {
  const id = await makeRings();
  await PuzzleEngine.nearSolve(ctx.scene, id);
  await rotate(id, 0, -1);
  assert.equal(pub(id).solved, true);
  await PuzzleEngine.nearSolve(ctx.scene, id);
  assert.equal(pub(id).solved, false);
});

test("сброс колец: новое состояние не совпадает с решением", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, {
    type: "rings",
    config: { rings: 1, sectors: 2 },
    solution: [1]
  });
  for (let i = 0; i < 50; i++) {
    await PuzzleEngine.resetPuzzle(ctx.scene, id);
    assert.notDeepEqual(pub(id).state.positions, [1]);
    assert.equal(pub(id).solved, false);
  }
});

test("изменение: новые настройки и решение, привязка и действия сохраняются, состояние сбрасывается", async () => {
  const id = await makeRings();
  await PuzzleStore.patchPublic(ctx.scene, id, { link: { kind: "tile", id: "tile1" }, interaction: { mode: "off", maxDistance: 3 } });
  await PuzzleStore.setSecret(id, { ...PuzzleStore.getSecret(id), actions: { success: [{ type: "chat" }], failure: [] } });
  await rotate(id, 0, 1);

  await PuzzleEngine.updatePuzzle(ctx.scene, id, {
    type: "rings",
    name: "Новые диски",
    description: "Описание",
    hints: ["подсказка"],
    config: { rings: 2, sectors: 4, checkMode: "confirm" },
    solution: [3, 1]
  });

  const data = pub(id);
  assert.equal(data.name, "Новые диски");
  assert.equal(data.config.rings, 2);
  assert.equal(data.state.positions.length, 2);
  assert.equal(data.state.moves, 0);
  assert.equal(data.solved, false);
  assert.deepEqual(data.link, { kind: "tile", id: "tile1" });
  assert.deepEqual(data.interaction, { mode: "off", maxDistance: 3 });
  assert.deepEqual(PuzzleStore.getSecret(id).solution, [3, 1]);
  assert.deepEqual(PuzzleStore.getSecret(id).actions.success, [{ type: "chat" }]);
});

test("изменение: тип менять нельзя, неверные настройки отклоняются и ничего не портят", async () => {
  const id = await makeRings();
  const before = JSON.stringify(pub(id));
  await assert.rejects(
    PuzzleEngine.updatePuzzle(ctx.scene, id, { type: "sequence", solution: ["s1"] }),
    /typeLocked/
  );
  await assert.rejects(
    PuzzleEngine.updatePuzzle(ctx.scene, id, { type: "rings", config: { rings: 9, sectors: 6 }, solution: [0] }),
    /invalidSetup/
  );
  assert.equal(JSON.stringify(pub(id)), before);
  assert.deepEqual(PuzzleStore.getSecret(id).solution, [2, 0, 4]);
});

test("удаление убирает загадку, повторное удаление и ход по ней дают noPuzzle", async () => {
  const id = await makeRings();
  await PuzzleEngine.deletePuzzle(ctx.scene, id);
  assert.equal(pub(id), null);
  assert.equal(PuzzleStore.getSecret(id), null);
  await assert.rejects(rotate(id, 0, 1), /noPuzzle/);
  await assert.rejects(PuzzleEngine.resetPuzzle(ctx.scene, id), /noPuzzle/);
  await assert.rejects(PuzzleEngine.nearSolve(ctx.scene, id), /noPuzzle/);
  await assert.rejects(PuzzleEngine.updatePuzzle(ctx.scene, id, { type: "rings" }), /noPuzzle/);
});

test("getForEdit отдаёт публичную часть и секрет только мастеру", async () => {
  const id = await makeRings();
  const { pub: p, secret } = PuzzleEngine.getForEdit(ctx.scene, id);
  assert.equal(p.id, id);
  assert.deepEqual(secret.solution, [2, 0, 4]);
  assert.throws(() => PuzzleEngine.getForEdit(ctx.scene, "missing"), /noPuzzle/);

  ctx.setUser("p1");
  assert.throws(() => PuzzleEngine.getForEdit(ctx.scene, id), /gmOnly/);
});

test("игрок не может создавать, менять, удалять, сбрасывать и подготавливать загадки", async () => {
  const id = await makeRings();
  ctx.setUser("p1");
  await assert.rejects(makeRings(), /gmOnly/);
  await assert.rejects(PuzzleEngine.updatePuzzle(ctx.scene, id, { type: "rings" }), /gmOnly/);
  await assert.rejects(PuzzleEngine.deletePuzzle(ctx.scene, id), /gmOnly/);
  await assert.rejects(PuzzleEngine.resetPuzzle(ctx.scene, id), /gmOnly/);
  await assert.rejects(PuzzleEngine.nearSolve(ctx.scene, id), /gmOnly/);
  assert.ok(pub(id), "загадка осталась на месте");
});

test("игрок через сокет не может вызвать служебные запросы мастера", async () => {
  // Единственный зарегистрированный запрос движка, доступный игроку, это puzzle:move.
  for (const type of ["puzzle:reset", "puzzle:delete", "puzzle:update", "puzzle:nearSolve", "puzzle:create"]) {
    await assert.rejects(PuzzleSocket.request(type, {}), /unknownRequest/, type);
  }
});
