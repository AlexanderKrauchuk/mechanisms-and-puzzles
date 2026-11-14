import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { PuzzleSocket } = await import("../scripts/socket.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");

registerPuzzleType(SequencePuzzle);

const SEQ = {
  type: "sequence",
  name: "Руны",
  config: { symbols: [{ id: "a", label: "A" }, { id: "b", label: "B" }], checkMode: "step", errorMode: "fail" },
  solution: ["a", "b"]
};

const make = () => PuzzleEngine.createPuzzle(ctx.scene, SEQ);
const move = (id, symbolId) =>
  PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: { action: "press", symbolId } }, "p1", { local: false });

const notified = [];
PuzzleSocket.onBroadcast("notify", (payload) => notified.push(payload));

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.clearObjects();
  ctx.resetLogs();
  notified.length = 0;
});

const ALL = {
  success: [
    { type: "message", text: "Дверь открылась" },
    { type: "chat", text: "Щёлк <b>", audience: "all" },
    { type: "chat", text: "Секрет", audience: "gm" },
    { type: "tile", tileId: "t1", mode: "show" },
    { type: "door", wallId: "w1", state: "open" },
    { type: "sound", src: "sounds/ok.ogg", volume: 0.5 }
  ],
  failure: [{ type: "message", text: "Неверно" }]
};

test("setActions и getActions: сохраняются, читаются, игроку не уходят", async () => {
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, ALL);
  assert.deepEqual(PuzzleEngine.getActions(ctx.scene, id), ALL);
  assert.equal(JSON.stringify(PuzzleStore.getPublic(id, ctx.scene)).includes("Дверь открылась"), false, "публичные данные без действий");
});

test("setActions: ошибка проверки ничего не меняет, игрок не может менять действия", async () => {
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, ALL);
  await assert.rejects(
    PuzzleEngine.setActions(ctx.scene, id, { success: [{ type: "message", text: "" }], failure: [] }),
    /invalidActions/
  );
  assert.deepEqual(PuzzleEngine.getActions(ctx.scene, id), ALL);
  ctx.setUser("p1");
  await assert.rejects(PuzzleEngine.setActions(ctx.scene, id, ALL), /gmOnly/);
  await assert.rejects(PuzzleEngine.testActions(ctx.scene, id, "success"), /gmOnly/);
  assert.throws(() => PuzzleEngine.getActions(ctx.scene, id), /gmOnly/);
});

test("успех: все действия выполняются по порядку", async () => {
  ctx.addTile({ id: "t1", hidden: true });
  ctx.addWall({ id: "w1", door: 1, ds: 2 });
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, ALL);

  assert.equal((await move(id, "a")).code, "progress");
  assert.equal(notified.length, 0, "до успеха действия не запускаются");
  const result = await move(id, "b");
  assert.equal(result.outcome, "success");

  assert.deepEqual(notified, [{ text: "Дверь открылась", level: "info" }]);
  assert.deepEqual(ctx.socketEmits[0].message, { kind: "broadcast", type: "notify", payload: { text: "Дверь открылась", level: "info" } });
  assert.equal(ctx.chatMessages.length, 2);
  assert.equal(ctx.chatMessages[0].content, "Щёлк &lt;b&gt;", "текст экранируется");
  assert.equal(ctx.chatMessages[0].whisper, undefined);
  assert.deepEqual(ctx.chatMessages[0].speaker, { alias: "Руны" });
  assert.deepEqual(ctx.chatMessages[1].whisper, ["gm1"]);
  assert.equal(ctx.scene.tiles.get("t1").hidden, false);
  assert.equal(ctx.scene.walls.get("w1").ds, 1);
  assert.deepEqual(ctx.sounds, [{ data: { src: "sounds/ok.ogg", volume: 0.5, autoplay: true, loop: false }, push: true }]);
  assert.equal(ctx.notifications.length, 0, "ошибок нет");
});

test("провал запускает только действия провала, и каждый раз", async () => {
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, ALL);
  const first = await move(id, "b"); // errorMode fail: неверный первый символ
  assert.equal(first.outcome, "failure");
  assert.deepEqual(notified, [{ text: "Неверно", level: "info" }]);
  await move(id, "b");
  assert.equal(notified.length, 2);
  assert.equal(ctx.chatMessages.length, 0);
});

test("режимы плитки и состояния двери", async () => {
  ctx.addTile({ id: "t1", hidden: false });
  ctx.addWall({ id: "w1", door: 2, ds: 0 });
  const id = await make();
  const run = async (action) => {
    await PuzzleEngine.setActions(ctx.scene, id, { success: [action], failure: [] });
    return PuzzleEngine.testActions(ctx.scene, id, "success");
  };

  await run({ type: "tile", tileId: "t1", mode: "hide" });
  assert.equal(ctx.scene.tiles.get("t1").hidden, true);
  await run({ type: "tile", tileId: "t1", mode: "toggle" });
  assert.equal(ctx.scene.tiles.get("t1").hidden, false);
  await run({ type: "tile", tileId: "t1", mode: "toggle" });
  assert.equal(ctx.scene.tiles.get("t1").hidden, true);

  for (const [state, ds] of [["lock", 2], ["open", 1], ["unlock", 0], ["open", 1], ["close", 0]]) {
    await run({ type: "door", wallId: "w1", state });
    assert.equal(ctx.scene.walls.get("w1").ds, ds, state);
  }
});

test("сбой действия не ломает ход, остальные действия выполняются, мастер видит причину", async () => {
  ctx.addWall({ id: "plain", door: 0 });
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, {
    success: [
      { type: "tile", tileId: "нет", mode: "show" },
      { type: "door", wallId: "plain", state: "open" },
      { type: "door", wallId: "нет", state: "open" },
      { type: "message", text: "всё равно" }
    ],
    failure: []
  });
  await move(id, "a");
  const result = await move(id, "b");
  assert.equal(result.code, "solved");
  assert.equal(result.solved, true);
  assert.deepEqual(notified, [{ text: "всё равно", level: "info" }]);
  const reasons = ctx.notifications.map((n) => n.m);
  assert.equal(reasons.length, 3);
  assert.ok(reasons[0].includes("actions.reason.tileMissing") && reasons[0].includes('"n":1'));
  assert.ok(reasons[1].includes("actions.reason.notADoor") && reasons[1].includes('"n":2'));
  assert.ok(reasons[2].includes("actions.reason.wallMissing"));
});

test("testActions: запускает действия без изменения состояния, пустой список ничего не делает", async () => {
  const id = await make();
  assert.deepEqual(await PuzzleEngine.testActions(ctx.scene, id, "success"), []);
  await PuzzleEngine.setActions(ctx.scene, id, ALL);
  const before = JSON.stringify(PuzzleStore.getPublic(id, ctx.scene).state);
  const results = await PuzzleEngine.testActions(ctx.scene, id, "failure");
  assert.deepEqual(results, [{ index: 0, type: "message", ok: true }]);
  assert.equal(JSON.stringify(PuzzleStore.getPublic(id, ctx.scene).state), before);
  assert.equal(PuzzleStore.getPublic(id, ctx.scene).solved, false);
  await assert.rejects(PuzzleEngine.testActions(ctx.scene, id, "zzz"), /unknownRequest/);
});

test("изменение и сброс загадки сохраняют действия", async () => {
  const id = await make();
  await PuzzleEngine.setActions(ctx.scene, id, ALL);
  await PuzzleEngine.updatePuzzle(ctx.scene, id, { ...SEQ, name: "Новое имя" });
  assert.deepEqual(PuzzleEngine.getActions(ctx.scene, id), ALL);
  await PuzzleEngine.resetPuzzle(ctx.scene, id);
  assert.deepEqual(PuzzleEngine.getActions(ctx.scene, id), ALL);
});

test("загадка без действий и со старыми данными решается как раньше", async () => {
  const id = await make();
  await PuzzleStore.setSecret(id, { ...PuzzleStore.getSecret(id), actions: undefined });
  await move(id, "a");
  const result = await move(id, "b");
  assert.equal(result.outcome, "success");
  assert.equal(ctx.notifications.length, 0);
});
