import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAccess,
  normalizeInteraction,
  normalizeLink,
  rectCenter,
  rectGap,
  validateAccess
} from "../scripts/access.mjs";

const grid = { size: 100, distance: 5 };
const box = (x, y, w = 100, h = 100) => ({ x, y, w, h });

test("rectGap: пересечение и касание дают 0, по оси и по диагонали считается зазор", () => {
  assert.equal(rectGap(box(0, 0), box(50, 50)), 0);
  assert.equal(rectGap(box(0, 0), box(100, 0)), 0);
  assert.equal(rectGap(box(0, 0), box(200, 0)), 100);
  assert.equal(rectGap(box(0, 0), box(0, 300)), 200);
  assert.equal(rectGap(box(0, 0), box(200, 200)), Math.hypot(100, 100));
  assert.equal(rectGap(box(200, 200), box(0, 0)), Math.hypot(100, 100));
});

test("rectCenter", () => {
  assert.deepEqual(rectCenter(box(100, 200, 50, 20)), { x: 125, y: 210 });
});

test("normalize: старые и неполные данные приводятся к рабочему виду", () => {
  assert.deepEqual(normalizeInteraction(undefined), { mode: "ui", maxDistance: 0 });
  assert.deepEqual(normalizeInteraction({ mode: "tile", maxDistance: 3 }), { mode: "ui", maxDistance: 3 });
  assert.deepEqual(normalizeInteraction({ mode: "off", maxDistance: -4 }), { mode: "off", maxDistance: 0 });
  assert.deepEqual(normalizeInteraction({ mode: "ui", maxDistance: "abc" }), { mode: "ui", maxDistance: 0 });
  assert.deepEqual(normalizeLink(undefined), { kind: "", id: "" });
  assert.deepEqual(normalizeLink({ kind: "door", id: "x" }), { kind: "", id: "" });
  assert.deepEqual(normalizeLink({ kind: "tile", id: "" }), { kind: "", id: "" });
  assert.deepEqual(normalizeLink({ kind: "token", id: "t1" }), { kind: "token", id: "t1" });
});

test("validate: допустимые данные и все коды ошибок", () => {
  const ok = { interaction: { mode: "ui", maxDistance: 10 }, link: { kind: "token", id: "t1" } };
  assert.deepEqual(validateAccess(ok), []);
  assert.deepEqual(validateAccess({ interaction: { mode: "off", maxDistance: 0 }, link: { kind: "", id: "" } }), []);

  assert.deepEqual(validateAccess({ ...ok, interaction: { mode: "x", maxDistance: 0 } }), ["interactionMode"]);
  for (const bad of [NaN, -1, 1001, "5", null, Infinity]) {
    assert.deepEqual(validateAccess({ ...ok, interaction: { mode: "ui", maxDistance: bad } }), ["maxDistance"], String(bad));
  }
  assert.deepEqual(validateAccess({ ...ok, link: { kind: "wall", id: "w" } }), ["linkKind"]);
  assert.deepEqual(validateAccess({ ...ok, link: { kind: "tile", id: "  " } }), ["linkId"]);
  assert.deepEqual(
    validateAccess({ interaction: { mode: "ui", maxDistance: 5 }, link: { kind: "", id: "" } }),
    ["distanceNeedsLink"]
  );
});

const base = (over = {}) => ({
  interaction: { mode: "ui", maxDistance: 10 },
  link: { kind: "tile", id: "a" },
  objectRect: box(500, 0),
  userRects: [box(0, 0)],
  grid,
  ...over
});

test("checkAccess: расстояние считается в единицах сцены от края до края", () => {
  // зазор 400 px = 4 клетки = 20 ед.
  const far = checkAccess(base());
  assert.equal(far.code, "tooFar");
  assert.equal(far.distance, 20);
  assert.equal(far.max, 10);

  // зазор 200 px = 2 клетки = 10 ед.: ровно на границе проходит
  assert.equal(checkAccess(base({ objectRect: box(300, 0) })).code, "ok");
  assert.equal(checkAccess(base({ objectRect: box(301, 0) })).code, "tooFar");
});

test("checkAccess: берётся ближайший из токенов игрока", () => {
  const rects = [box(0, 0), box(450, 0)];
  assert.equal(checkAccess(base({ userRects: rects })).code, "ok");
});

test("checkAccess: режим off, нет объекта, нет токена, без ограничения, обход мастера", () => {
  assert.equal(checkAccess(base({ interaction: { mode: "off", maxDistance: 10 } })).code, "off");
  assert.equal(checkAccess(base({ objectRect: null })).code, "noObject");
  assert.equal(checkAccess(base({ userRects: [] })).code, "noToken");
  assert.equal(checkAccess(base({ interaction: { mode: "ui", maxDistance: 0 }, userRects: [], objectRect: null })).code, "ok");
  assert.equal(checkAccess(base({ link: { kind: "", id: "" }, userRects: [], objectRect: null })).code, "ok");

  const off = base({ interaction: { mode: "off", maxDistance: 10 }, userRects: [], objectRect: null });
  assert.equal(checkAccess({ ...off, bypass: true }).code, "ok");
});

test("checkAccess: масштаб сетки учитывается", () => {
  const result = checkAccess(base({ grid: { size: 50, distance: 1 }, objectRect: box(300, 0), interaction: { mode: "ui", maxDistance: 4 } }));
  // зазор 200 px при 50 px на единицу = 4 ед.
  assert.equal(result.distance, 4);
  assert.equal(result.code, "ok");
});
