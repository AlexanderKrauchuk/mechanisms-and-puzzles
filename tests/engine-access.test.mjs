import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

const ctx = installFoundryMock();
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");
const { parseEditorForm, toEditorValues, defaultEditorValues } = await import("../scripts/editor-data.mjs");
const { evaluateAccess, describeLink } = await import("../scripts/proximity.mjs");

registerPuzzleType(SequencePuzzle);

const SEQ = {
  type: "sequence",
  name: "Руны",
  config: { symbols: [{ id: "a", label: "A" }, { id: "b", label: "B" }], checkMode: "step", errorMode: "reset" },
  solution: ["a", "b"]
};
const make = (extra = {}) => PuzzleEngine.createPuzzle(ctx.scene, { ...SEQ, ...extra });
const pub = (id) => PuzzleStore.getPublic(id, ctx.scene);
const press = (id, userId, local = false) =>
  PuzzleEngine.handleMove({ sceneId: ctx.scene.id, puzzleId: id, move: { action: "press", symbolId: "a" } }, userId, { local });

test.beforeEach(() => {
  ctx.setUser("gm1");
  ctx.clearObjects();
});

test("создание: по умолчанию доступна всем, без привязки", async () => {
  const id = await make();
  assert.deepEqual(pub(id).interaction, { mode: "ui", maxDistance: 0 });
  assert.deepEqual(pub(id).link, { kind: "", id: "" });
  assert.equal("linkedUuid" in pub(id), false);
});

test("создание: привязка и расстояние сохраняются, ошибки отклоняются", async () => {
  const id = await make({ interaction: { mode: "ui", maxDistance: 10 }, link: { kind: "tile", id: "t1" } });
  assert.deepEqual(pub(id).interaction, { mode: "ui", maxDistance: 10 });
  assert.deepEqual(pub(id).link, { kind: "tile", id: "t1" });

  await assert.rejects(make({ interaction: { mode: "ui", maxDistance: 10 } }), /invalidSetup/);
  await assert.rejects(make({ interaction: { mode: "ui", maxDistance: -1 }, link: { kind: "tile", id: "t1" } }), /invalidSetup/);
  await assert.rejects(make({ link: { kind: "tile", id: "" } }), /invalidSetup/);
});

test("игрок рядом с объектом проходит, далеко получает tooFar и состояние не меняется", async () => {
  ctx.addTile({ id: "t1", x: 1000, y: 1000 });
  ctx.addToken({ id: "pc", x: 700, y: 1000, owners: ["p1"] }); // зазор 200 px = 10 ед.
  const id = await make({ interaction: { mode: "ui", maxDistance: 10 }, link: { kind: "tile", id: "t1" } });

  assert.equal((await press(id, "p1")).code, "progress");

  ctx.scene.tokens.get("pc").x = 500; // зазор 400 px = 20 ед.
  const far = await press(id, "p1");
  assert.deepEqual(far, { code: "tooFar", outcome: null, solved: false });
  assert.deepEqual(pub(id).state.entered, ["a"], "отклонённый ход не меняет состояние");
});

test("чужой токен не считается, без своего токена расстояние не определить", async () => {
  ctx.addTile({ id: "t1", x: 0, y: 0 });
  ctx.addToken({ id: "other", x: 0, y: 0, owners: ["gm1"] });
  const id = await make({ interaction: { mode: "ui", maxDistance: 10 }, link: { kind: "tile", id: "t1" } });
  assert.equal((await press(id, "p1")).code, "noToken");
});

test("привязка к токену, удалённый объект даёт noObject", async () => {
  ctx.addToken({ id: "lever", x: 0, y: 0 });
  ctx.addToken({ id: "pc", x: 100, y: 0, owners: ["p1"] });
  const id = await make({ interaction: { mode: "ui", maxDistance: 5 }, link: { kind: "token", id: "lever" } });
  assert.equal((await press(id, "p1")).code, "progress");

  ctx.scene.tokens.delete("lever");
  assert.equal((await press(id, "p1")).code, "noObject");
});

test("режим off закрывает загадку для игроков, мастер локально проходит", async () => {
  const id = await make({ interaction: { mode: "off", maxDistance: 0 } });
  assert.equal((await press(id, "p1")).code, "off");
  assert.equal((await press(id, "gm1", true)).code, "progress");
});

test("мастер локально не ограничен расстоянием, а чужой userId мастера по сокету не даёт обхода", async () => {
  ctx.addTile({ id: "t1", x: 5000, y: 5000 });
  const id = await make({ interaction: { mode: "ui", maxDistance: 5 }, link: { kind: "tile", id: "t1" } });
  assert.equal((await press(id, "gm1", true)).code, "progress");
  // тот же userId, но запрос пришёл по сокету (local: false): обхода нет
  assert.equal((await press(id, "gm1", false)).code, "noToken");
});

test("изменение: привязка меняется, если передана, и сохраняется, если не передана", async () => {
  const id = await make({ interaction: { mode: "ui", maxDistance: 5 }, link: { kind: "token", id: "x" } });
  const input = { ...SEQ };

  await PuzzleEngine.updatePuzzle(ctx.scene, id, input);
  assert.deepEqual(pub(id).link, { kind: "token", id: "x" });
  assert.equal(pub(id).interaction.maxDistance, 5);

  await PuzzleEngine.updatePuzzle(ctx.scene, id, { ...input, interaction: { mode: "off", maxDistance: 0 }, link: { kind: "", id: "" } });
  assert.deepEqual(pub(id).link, { kind: "", id: "" });
  assert.deepEqual(pub(id).interaction, { mode: "off", maxDistance: 0 });

  await assert.rejects(
    PuzzleEngine.updatePuzzle(ctx.scene, id, { ...input, interaction: { mode: "ui", maxDistance: 3 }, link: { kind: "", id: "" } }),
    /invalidSetup/
  );
  assert.deepEqual(pub(id).interaction, { mode: "off", maxDistance: 0 }, "неудачное изменение ничего не портит");
});

test("старые данные без link и с прежним interaction не ломают проверку", async () => {
  const id = await make();
  await PuzzleStore.patchPublic(ctx.scene, id, { interaction: { mode: "tile", maxDistance: 0 }, linkedUuid: "Scene.x.Tile.y" });
  const p = pub(id);
  delete p.link;
  assert.equal(evaluateAccess(ctx.scene, p, ctx.game.users.get("p1")).code, "ok");
});

test("describeLink: найден, не найден, нет привязки", () => {
  ctx.addToken({ id: "lever", x: 100, y: 200, name: "Рычаг" });
  ctx.addTile({ id: "t1", x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(describeLink(ctx.scene, { kind: "token", id: "lever" }), {
    kind: "token", found: true, name: "Рычаг", center: { x: 150, y: 250 }
  });
  assert.equal(describeLink(ctx.scene, { kind: "tile", id: "t1" }).center.x, 100);
  assert.equal(describeLink(ctx.scene, { kind: "tile", id: "zzz" }).found, false);
  assert.equal(describeLink(ctx.scene, undefined).kind, "");
});

test("форма редактора: доступ разбирается и возвращается обратно", async () => {
  const values = { ...defaultEditorValues("sequence"), interactionMode: "off", maxDistance: "15", linkKind: "token", linkId: " abc " };
  const { input } = parseEditorForm(values);
  assert.deepEqual(input.interaction, { mode: "off", maxDistance: 15 });
  assert.deepEqual(input.link, { kind: "token", id: "abc" });

  const empty = parseEditorForm({ ...values, maxDistance: "" }).input;
  assert.equal(empty.interaction.maxDistance, 0);
  assert.ok(Number.isNaN(parseEditorForm({ ...values, maxDistance: "abc" }).input.interaction.maxDistance));

  const id = await make({ interaction: input.interaction, link: input.link });
  const back = toEditorValues(pub(id), PuzzleStore.getSecret(id));
  assert.equal(back.interactionMode, "off");
  assert.equal(back.maxDistance, 15);
  assert.equal(back.linkKind, "token");
  assert.equal(back.linkId, "abc");
});
