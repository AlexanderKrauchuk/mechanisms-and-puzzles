import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryMock } from "./helpers/mock-foundry.mjs";

const ctx = installFoundryMock();
const { auditPermissions, collectAuditInput, findForbiddenKeys } = await import("../scripts/audit.mjs");
const { PuzzleEngine } = await import("../scripts/engine.mjs");
const { PuzzleStore } = await import("../scripts/storage.mjs");
const { registerPuzzleType } = await import("../scripts/puzzles/base.mjs");
const { SequencePuzzle } = await import("../scripts/puzzles/sequence.mjs");
registerPuzzleType(SequencePuzzle);

const status = (results, id) => results.find((r) => r.id === id)?.status;

const base = () => ({
  storeOwnership: { default: 0, gm1: 3 },
  NONE: 0,
  users: [
    { id: "gm1", name: "Мастер", isGM: true, ownsScene: false },
    { id: "p1", name: "Игрок", isGM: false, ownsScene: false }
  ],
  puzzles: [{ id: "a", name: "Руны", config: {}, state: {} }],
  secretIds: ["a"],
  hasActiveGM: true,
  allowMacros: false
});

test("findForbiddenKeys: ищет на любой глубине", () => {
  assert.deepEqual(findForbiddenKeys({ id: 1, config: { symbols: [] } }), []);
  assert.deepEqual(findForbiddenKeys({ solution: [1], config: { deep: [{ actions: 1 }] } }).sort(), ["config.deep.0.actions", "solution"]);
  assert.deepEqual(findForbiddenKeys(null), []);
  assert.deepEqual(findForbiddenKeys("строка"), []);
});

test("аудит: чистая конфигурация даёт только ok", () => {
  const results = auditPermissions(base());
  assert.deepEqual(results.map((r) => r.id), ["secretStore", "storeOwnership", "publicClean", "scenePermissions", "secretsComplete", "activeGM", "macros"]);
  assert.ok(results.every((r) => r.status === "ok"), JSON.stringify(results));
});

test("аудит: нет хранилища", () => {
  const results = auditPermissions({ ...base(), storeOwnership: null });
  assert.equal(status(results, "secretStore"), "fail");
  assert.equal(status(results, "storeOwnership"), undefined);
});

test("аудит: утечка прав на хранилище по умолчанию и конкретному игроку", () => {
  const leak = auditPermissions({ ...base(), storeOwnership: { default: 2, gm1: 3, p1: 1 } });
  const row = leak.find((r) => r.id === "storeOwnership");
  assert.equal(row.status, "fail");
  assert.deepEqual(row.names, ["default", "Игрок"]);
  // права второго мастера не утечка
  const ok = auditPermissions({ ...base(), storeOwnership: { default: 0, gm1: 3 } });
  assert.equal(status(ok, "storeOwnership"), "ok");
});

test("аудит: решение в публичных данных, игрок владелец сцены, нет секрета, нет мастера, макросы", () => {
  const input = {
    ...base(),
    puzzles: [{ id: "a", name: "Руны", solution: [1] }],
    secretIds: [],
    users: [
      { id: "gm1", name: "Мастер", isGM: true, ownsScene: true },
      { id: "p1", name: "Игрок", isGM: false, ownsScene: true }
    ],
    hasActiveGM: false,
    allowMacros: true
  };
  const results = auditPermissions(input);
  assert.deepEqual(results.find((r) => r.id === "publicClean"), { id: "publicClean", status: "fail", names: ["Руны: solution"] });
  assert.deepEqual(results.find((r) => r.id === "scenePermissions"), { id: "scenePermissions", status: "fail", names: ["Игрок"] });
  assert.deepEqual(results.find((r) => r.id === "secretsComplete"), { id: "secretsComplete", status: "warn", names: ["Руны"] });
  assert.equal(status(results, "activeGM"), "warn");
  assert.equal(status(results, "macros"), "warn");
});

test("collectAuditInput: на настоящих данных модуля проверка проходит, а ручная утечка находится", async () => {
  ctx.setUser("gm1");
  await PuzzleStore.ensureSecretStore();
  const id = await PuzzleEngine.createPuzzle(ctx.scene, {
    type: "sequence",
    name: "Руны",
    config: { symbols: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    solution: ["a", "b"]
  });

  let results = auditPermissions(collectAuditInput(ctx.scene));
  assert.ok(results.every((r) => r.status === "ok"), JSON.stringify(results));

  // игрок стал владельцем сцены
  ctx.setSceneOwner("p1");
  results = auditPermissions(collectAuditInput(ctx.scene));
  assert.equal(status(results, "scenePermissions"), "fail");
  ctx.setSceneOwner("p1", false);

  // кто-то открыл хранилище всем
  PuzzleStore.secretStore.ownership.default = 2;
  results = auditPermissions(collectAuditInput(ctx.scene));
  assert.equal(status(results, "storeOwnership"), "fail");
  PuzzleStore.secretStore.ownership.default = 0;

  // решение попало в публичные данные
  await PuzzleStore.patchPublic(ctx.scene, id, { solution: ["a", "b"] });
  results = auditPermissions(collectAuditInput(ctx.scene));
  assert.equal(status(results, "publicClean"), "fail");
});
