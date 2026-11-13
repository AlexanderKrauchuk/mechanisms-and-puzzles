import { checkAccess, normalizeLink, rectCenter } from "./access.mjs";

/**
 * Связка чистой логики доступа с документами Foundry: находит привязанный объект
 * и токены пользователя на сцене. Работает с документами сцены (scene.tokens, scene.tiles),
 * поэтому не требует, чтобы сцена была открыта на холсте.
 *
 * Не проверено на живом Foundry (см. README): Actor#testUserPermission(user, "OWNER")
 * для определения «токен принадлежит игроку» и scene.grid.size / scene.grid.distance.
 */

const gridOf = (scene) => ({
  size: Number(scene.grid?.size) || 100,
  distance: Number(scene.grid?.distance) || 1
});

const docs = (collection) => collection?.contents ?? [];

const tokenRect = (doc, size) => ({ x: doc.x, y: doc.y, w: doc.width * size, h: doc.height * size });
const tileRect = (doc) => ({ x: doc.x, y: doc.y, w: doc.width, h: doc.height });

/** Прямоугольник привязанного объекта в пикселях сцены или null, если привязки нет или объект удалён. */
export function linkedRect(scene, link) {
  const { kind, id } = normalizeLink(link);
  if (!kind) return null;
  if (kind === "tile") {
    const doc = scene.tiles?.get(id);
    return doc ? tileRect(doc) : null;
  }
  const doc = scene.tokens?.get(id);
  return doc ? tokenRect(doc, gridOf(scene).size) : null;
}

/** Прямоугольники токенов, которыми владеет пользователь. */
export function userTokenRects(scene, user) {
  const { size } = gridOf(scene);
  return docs(scene.tokens)
    .filter((doc) => doc.actor?.testUserPermission?.(user, "OWNER"))
    .map((doc) => tokenRect(doc, size));
}

/**
 * Доступ пользователя к загадке. { local: true } только для мастера на его же клиенте.
 * Возвращает { code, distance, max } (см. access.mjs).
 */
export function evaluateAccess(scene, puzzle, user, { local = false } = {}) {
  const bypass = Boolean(local && user?.isGM);
  const needDistance = Number(puzzle.interaction?.maxDistance) > 0;
  return checkAccess({
    interaction: puzzle.interaction,
    link: puzzle.link,
    objectRect: needDistance && !bypass ? linkedRect(scene, puzzle.link) : null,
    userRects: needDistance && !bypass ? userTokenRects(scene, user) : [],
    grid: gridOf(scene),
    bypass
  });
}

/** Описание привязки для окон: { kind, found, name, center }. kind пустой, если привязки нет. */
export function describeLink(scene, link) {
  const { kind, id } = normalizeLink(link);
  if (!kind) return { kind: "", found: false, name: "", center: null };
  const doc = kind === "tile" ? scene.tiles?.get(id) : scene.tokens?.get(id);
  if (!doc) return { kind, found: false, name: "", center: null };
  const rect = kind === "tile" ? tileRect(doc) : tokenRect(doc, gridOf(scene).size);
  return { kind, found: true, name: kind === "token" ? doc.name || id : id, center: rectCenter(rect) };
}
