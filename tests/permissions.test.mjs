import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");
const { SlidingPuzzle } = await import("../scripts/puzzles/sliding.mjs");
const { RingsPuzzle } = await import("../scripts/puzzles/rings.mjs");
const { findForbiddenKeys } = await import("../scripts/audit.mjs");

for (const type of [SequencePuzzle, SlidingPuzzle, RingsPuzzle]) registerPuzzleType(type);

const INPUTS = {
  sequence: {
    type: "sequence",
    name: "Руны",
    config: { symbols: [{ id: "x1", label: "Ж" }, { id: "x2", label: "Щ" }, { id: "x3", label: "Ъ" }], checkMode: "final", errorMode: "reset" },
    solution: ["x3", "x1", "x2"]
  },
  sliding: { type: "sliding", name: "Плитки", config: { rows: 3, cols: 3 } },
  rings: { type: "rings", name: "Кольца", config: { rings: 2, sectors: 6, checkMode: "auto" }, solution: [4, 2] }
};

const remote = (id, move, userId = "p1") =>
  PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move }, userId, { local: false });

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.clearObjects();
  ctx.resetLogs();
  PuzzleEngine.resetRateLimit();
  ctx.game.users.get("p1").viewedScene = undefined;
});

test("игрок не может вызвать ни одного изменяющего метода движка и хранилища", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, INPUTS.sequence);
  ctx.setUser("p1");
  const scene = ctx.scene;
  const calls = {
    "engine.createPuzzle": () => PuzzleEngine.createPuzzle(scene, INPUTS.sequence),
    "engine.updatePuzzle": () => PuzzleEngine.updatePuzzle(scene, id, INPUTS.sequence),
    "engine.deletePuzzle": () => PuzzleEngine.deletePuzzle(scene, id),
    "engine.resetPuzzle": () => PuzzleEngine.resetPuzzle(scene, id),
    "engine.nearSolve": () => PuzzleEngine.nearSolve(scene, id),
    "engine.setActions": () => PuzzleEngine.setActions(scene, id, { success: [], failure: [] }),
    "engine.testActions": () => PuzzleEngine.testActions(scene, id, "success"),
    "engine.getActions": () => PuzzleEngine.getActions(scene, id),
    "engine.getForEdit": () => PuzzleEngine.getForEdit(scene, id),
    "store.setPublic": () => PuzzleStore.setPublic(scene, id, { id }),
    "store.patchPublic": () => PuzzleStore.patchPublic(scene, id, { solved: true }),
    "store.deletePublic": () => PuzzleStore.deletePublic(scene, id),
    "store.ensureSecretStore": () => PuzzleStore.ensureSecretStore(),
    "store.getSecret": () => PuzzleStore.getSecret(id),
    "store.setSecret": () => PuzzleStore.setSecret(id, {}),
    "store.deleteSecret": () => PuzzleStore.deleteSecret(id),
    "store.create": () => PuzzleStore.create(scene, { publicData: { id: "z" }, secretData: {} }),
    "store.remove": () => PuzzleStore.remove(scene, id)
  };
  for (const [name, call] of Object.entries(calls)) {
    await assert.rejects(async () => call(), /gmOnly/, name);
  }
  // Ничего не изменилось.
  ctx.setUser("gm1");
  assert.ok(PuzzleStore.getPublic(id, scene));
  assert.ok(PuzzleStore.getSecret(id));
});

test("плохие запросы отклоняются до обращения к данным", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, INPUTS.sequence);
  const long = "я".repeat(65);
  const bad = [
    undefined,
    null,
    {},
    { sceneId: ctx.scene.id, puzzleId: id },
    { sceneId: ctx.scene.id, puzzleId: id, move: [] },
    { sceneId: ctx.scene.id, puzzleId: id, move: "press" },
    { sceneId: ctx.scene.id, puzzleId: id, move: {} },
    { sceneId: ctx.scene.id, puzzleId: id, move: { action: 5 } },
    { sceneId: ctx.scene.id, puzzleId: id, move: { action: "a".repeat(33) } },
    { sceneId: long, puzzleId: id, move: { action: "press" } },
    { sceneId: ctx.scene.id, puzzleId: long, move: { action: "press" } },
    { sceneId: "", puzzleId: id, move: { action: "press" } },
    { sceneId: 1, puzzleId: id, move: { action: "press" } }
  ];
  for (const payload of bad) {
    await assert.rejects(PuzzleEngine.handleMove(payload, "p1", { local: false }), /invalidMove/, JSON.stringify(payload));
  }
  await assert.rejects(
    PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: { action: "press", symbolId: "x1" } }, "nobody", { local: false }),
    /unknownRequest/
  );
  await assert.rejects(remote("нет-такой", { action: "press", symbolId: "x1" }), /noPuzzle/);
  assert.deepEqual(PuzzleStore.getPublic(id, ctx.scene).state.entered, [], "состояние не тронуто");
});

test("сцена игрока: чужая или пустая сцена запрещена, своя разрешена, мастер локально не ограничен", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, INPUTS.sequence);
  const press = { action: "press", symbolId: "x1" };
  const p1 = ctx.game.users.get("p1");

  p1.viewedScene = "other-scene";
  assert.deepEqual(await remote(id, press), { code: "otherScene", outcome: null, solved: false });
  p1.viewedScene = null;
  assert.equal((await remote(id, press)).code, "otherScene");
  assert.deepEqual(PuzzleStore.getPublic(id, ctx.scene).state.entered, []);

  p1.viewedScene = ctx.scene.id;
  assert.equal((await remote(id, press)).code, "progress");

  ctx.game.users.get("gm1").viewedScene = "other-scene";
  const local = await PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: { action: "press", symbolId: "x2" } }, "gm1", { local: true });
  assert.equal(local.code, "progress");
  // тот же userId мастера, но запрос пришёл по сокету: поблажек нет
  const spoof = await PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: { action: "press", symbolId: "x2" } }, "gm1", { local: false });
  assert.equal(spoof.code, "otherScene");
  ctx.game.users.get("gm1").viewedScene = undefined;
});

test("частота ходов: после 30 за 5 секунд игроку отказ, мастер локально без лимита", async () => {
  const id = await PuzzleEngine.createPuzzle(ctx.scene, INPUTS.rings);
  const rotate = { action: "rotate", ring: 0, direction: 1 };
  for (let i = 0; i < 30; i++) {
    const r = await remote(id, rotate);
    assert.notEqual(r.code, "tooFast", `ход ${i + 1}`);
  }
  assert.deepEqual(await remote(id, rotate), { code: "tooFast", outcome: null, solved: false });
  // мастер на своём клиенте лимитом не ограничен
  for (let i = 0; i < 40; i++) {
    const r = await PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: rotate }, "gm1", { local: true });
    assert.notEqual(r.code, "tooFast");
  }
});

test("утечки: ответы игроку и публичные данные не содержат решения и действий для всех типов", async () => {
  for (const [kind, input] of Object.entries(INPUTS)) {
    PuzzleEngine.resetRateLimit();
    const id = await PuzzleEngine.createPuzzle(ctx.scene, input);
    await PuzzleEngine.setActions(ctx.scene, id, {
      success: [{ type: "message", text: "СЕКРЕТНЫЙ-ТЕКСТ-УСПЕХА" }],
      failure: [{ type: "message", text: "СЕКРЕТНЫЙ-ТЕКСТ-ПРОВАЛА" }]
    });
    const secretJson = JSON.stringify(PuzzleStore.getSecret(id));
    assert.ok(secretJson.includes("СЕКРЕТНЫЙ-ТЕКСТ-УСПЕХА"), `${kind}: секрет на месте`);

    const moves =
      kind === "sequence"
        ? ["x1", "x1", "x3", "x1", "x2"].map((symbolId) => ({ action: "press", symbolId }))
        : kind === "rings"
          ? [0, 0, 1, 1, 1].map((ring) => ({ action: "rotate", ring, direction: 1 }))
          : [{ action: "move", index: 0 }, { action: "move", index: 4 }, { action: "move", index: 8 }];

    const responses = [];
    for (const move of moves) {
      try {
        responses.push(await remote(id, move));
      } catch {
        // недопустимый ход тоже не должен ничего раскрывать
      }
    }
    for (const r of responses) {
      assert.deepEqual(Object.keys(r).sort(), ["code", "outcome", "solved"], `${kind}: поля ответа`);
    }
    const everything = JSON.stringify(responses) + JSON.stringify(PuzzleStore.listPublic(ctx.scene)[id]);
    assert.equal(everything.includes("СЕКРЕТНЫЙ"), false, `${kind}: тексты действий`);
    assert.deepEqual(findForbiddenKeys(PuzzleStore.listPublic(ctx.scene)[id]), [], `${kind}: запрещённые ключи`);
  }
  // решение последовательности нигде в открытых данных
  const publicJson = JSON.stringify(PuzzleStore.listPublic(ctx.scene));
  assert.equal(publicJson.includes('"solution"'), false);
});
