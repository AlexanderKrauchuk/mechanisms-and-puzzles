import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultAction,
  emptyActions,
  MAX_ACTIONS,
  moveAction,
  normalizeActions,
  parseActionsForm,
  validateActions,
  volumeToPercent
} from "../scripts/actions.mjs";

const valid = () => ({
  success: [
    { type: "message", text: "Дверь открылась" },
    { type: "chat", text: "Щёлк", audience: "gm" },
    { type: "tile", tileId: "t1", mode: "hide" },
    { type: "door", wallId: "w1", state: "unlock" },
    { type: "sound", src: "sounds/click.ogg", volume: 0.5 }
  ],
  failure: []
});

test("validate: корректный набор проходит, пустой тоже", () => {
  assert.deepEqual(validateActions(valid()), []);
  assert.deepEqual(validateActions(emptyActions()), []);
});

test("validate: все коды ошибок указывают исход и номер действия", () => {
  const bad = {
    success: [
      { type: "message", text: " " },
      { type: "chat", text: "x".repeat(2001), audience: "all" },
      { type: "chat", text: "ok", audience: "bad" },
      { type: "tile", tileId: "", mode: "x" },
      { type: "door", wallId: "", state: "x" },
      { type: "sound", src: "a<b", volume: 2 },
      { type: "macro" },
      null
    ],
    failure: "oops"
  };
  const codes = validateActions(bad).map((e) => `${e.outcome}.${e.index}.${e.code}`);
  assert.deepEqual(codes, [
    "success.0.messageText",
    "success.1.chatText",
    "success.2.chatAudience",
    "success.3.tileId",
    "success.3.tileMode",
    "success.4.wallId",
    "success.4.doorState",
    "success.5.soundSrc",
    "success.5.soundVolume",
    "success.6.unknownType",
    "success.7.unknownType",
    "failure.-1.actionsShape"
  ]);
});

test("validate: лимит числа действий и громкость NaN", () => {
  const many = { success: Array.from({ length: MAX_ACTIONS + 1 }, () => ({ type: "message", text: "a" })), failure: [] };
  assert.deepEqual(validateActions(many), [{ outcome: "success", index: -1, code: "tooMany" }]);
  const nan = { success: [{ type: "sound", src: "a.ogg", volume: NaN }], failure: [] };
  assert.equal(validateActions(nan)[0].code, "soundVolume");
});

test("normalize: старые и неполные данные, лишние поля, неизвестные типы", () => {
  assert.deepEqual(normalizeActions(undefined), emptyActions());
  const n = normalizeActions({
    success: [{ type: "chat" }, { type: "macro", id: 1 }, { type: "tile", tileId: " a ", mode: "x", extra: 1 }, null],
    failure: [{ type: "sound", src: "s.ogg", volume: "bad" }]
  });
  assert.deepEqual(n.success, [
    { type: "chat", text: "", audience: "all" },
    { type: "tile", tileId: "a", mode: "show" }
  ]);
  assert.deepEqual(n.failure, [{ type: "sound", src: "s.ogg", volume: 0.8 }]);
});

test("defaultAction: все типы, неизвестный даёт null", () => {
  for (const t of ["message", "chat", "tile", "door", "sound"]) assert.equal(defaultAction(t).type, t);
  assert.equal(defaultAction("macro"), null);
});

test("parseActionsForm: порядок по номеру, проценты в доли, лишние поля и чужие ключи игнорируются", () => {
  const values = {
    name: "игнор",
    "success.10.type": "message",
    "success.10.text": "последнее",
    "success.2.type": "sound",
    "success.2.src": "a.ogg",
    "success.2.volume": "50",
    "success.2.text": "лишнее",
    "failure.0.type": "door",
    "failure.0.wallId": "w1",
    "failure.0.state": "lock",
    "failure.1.type": "zzz",
    "success.3.text": "без типа"
  };
  const parsed = parseActionsForm(values);
  assert.deepEqual(parsed.success, [
    { type: "sound", src: "a.ogg", volume: 0.5 },
    { type: "message", text: "последнее" }
  ]);
  assert.deepEqual(parsed.failure, [{ type: "door", wallId: "w1", state: "lock" }]);
});

test("parseActionsForm: пустая громкость даёт NaN и проверка её отклоняет, неверный ввод не теряется", () => {
  const parsed = parseActionsForm({ "success.0.type": "sound", "success.0.src": "a.ogg", "success.0.volume": "" });
  assert.ok(Number.isNaN(parsed.success[0].volume));
  assert.equal(validateActions(parsed)[0].code, "soundVolume");
  assert.deepEqual(parseActionsForm(undefined), emptyActions());
});

test("round trip: форма → действия → проверка → нормализация", () => {
  const parsed = parseActionsForm({
    "success.0.type": "chat",
    "success.0.text": "Привет",
    "success.0.audience": "gm"
  });
  assert.deepEqual(validateActions(parsed), []);
  assert.deepEqual(normalizeActions(parsed), parsed);
});

test("moveAction и volumeToPercent", () => {
  assert.deepEqual(moveAction([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(moveAction([1, 2, 3], 0, -1), [1, 2, 3]);
  assert.deepEqual(moveAction([1, 2, 3], 2, 1), [1, 2, 3]);
  assert.deepEqual(moveAction([1, 2, 3], 5, -1), [1, 2, 3]);
  assert.equal(volumeToPercent(0.8), 80);
  assert.equal(volumeToPercent(NaN), 80);
});
