/**
 * Привязка загадки к объекту сцены, режим взаимодействия и проверка расстояния.
 * Чистые функции без обращений к Foundry, проверяются обычными тестами.
 *
 * Данные в публичных flags загадки:
 *   interaction: { mode: "ui" | "off", maxDistance: число >= 0 }
 *   link:        { kind: "" | "tile" | "token", id: "" | id объекта на той же сцене }
 *
 * mode "ui"  - игрок открывает загадку из окна «Загадки рядом» (или командой api.openPuzzle);
 * mode "off" - игрокам загадка недоступна (мастер может включить её позже).
 * maxDistance - наибольшее расстояние в единицах сцены (футы, метры) между краем токена
 *               игрока и краем привязанного объекта. 0 значит «без ограничения».
 *
 * Расстояние считается по прямой между краями прямоугольников. Правила диагоналей
 * сетки и препятствия (стены) не учитываются.
 */

export const INTERACTION_MODES = Object.freeze(["ui", "off"]);
export const LINK_KINDS = Object.freeze(["tile", "token"]);
export const MAX_DISTANCE_LIMIT = 1000;

const EPSILON = 1e-6;

export const defaultInteraction = () => ({ mode: "ui", maxDistance: 0 });
export const defaultLink = () => ({ kind: "", id: "" });

/** Приводит сохранённые данные к рабочему виду (старые и неполные данные не ломают проверку). */
export function normalizeInteraction(raw) {
  const mode = raw?.mode === "off" ? "off" : "ui";
  const distance = Number(raw?.maxDistance);
  return { mode, maxDistance: Number.isFinite(distance) && distance > 0 ? distance : 0 };
}

export function normalizeLink(raw) {
  const kind = LINK_KINDS.includes(raw?.kind) ? raw.kind : "";
  const id = kind && typeof raw?.id === "string" ? raw.id : "";
  return kind && id ? { kind, id } : defaultLink();
}

/** Проверка данных, которые вводит мастер. Возвращает список кодов ошибок (errors.setup.*). */
export function validateAccess({ interaction, link }) {
  const errors = [];
  if (!INTERACTION_MODES.includes(interaction?.mode)) errors.push("interactionMode");

  const distance = interaction?.maxDistance;
  const distanceOk = typeof distance === "number" && Number.isFinite(distance) && distance >= 0 && distance <= MAX_DISTANCE_LIMIT;
  if (!distanceOk) errors.push("maxDistance");

  const kind = link?.kind ?? "";
  if (kind !== "" && !LINK_KINDS.includes(kind)) errors.push("linkKind");
  else if (kind !== "" && !String(link?.id ?? "").trim()) errors.push("linkId");

  if (distanceOk && distance > 0 && kind === "") errors.push("distanceNeedsLink");
  return errors;
}

/** Расстояние между двумя прямоугольниками {x, y, w, h} в пикселях. Пересекающиеся дают 0. */
export function rectGap(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.hypot(dx, dy);
}

/** Центр прямоугольника (куда смотреть и где «пинговать» объект). */
export const rectCenter = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Решает, может ли пользователь действовать с загадкой.
 *
 * params:
 *   interaction, link  - данные загадки (как хранятся);
 *   objectRect         - прямоугольник привязанного объекта или null, если его нет на сцене;
 *   userRects          - прямоугольники токенов пользователя;
 *   grid               - { size, distance }: пикселей на клетку и единиц на клетку;
 *   bypass             - true для мастера на своём клиенте (мастер не ограничен).
 *
 * Возвращает { code, distance, max }:
 *   code: "ok" | "off" | "noObject" | "noToken" | "tooFar";
 *   distance и max в единицах сцены (null, если расстояние не считалось).
 */
export function checkAccess({ interaction, link, objectRect, userRects, grid, bypass = false }) {
  const rules = normalizeInteraction(interaction);
  const bound = normalizeLink(link);
  const max = rules.maxDistance;

  if (bypass) return { code: "ok", distance: null, max };
  if (rules.mode === "off") return { code: "off", distance: null, max };
  if (max === 0 || bound.kind === "") return { code: "ok", distance: null, max };

  if (!objectRect) return { code: "noObject", distance: null, max };
  if (!userRects?.length) return { code: "noToken", distance: null, max };

  const unitsPerPixel = grid.distance / grid.size;
  const distance = Math.min(...userRects.map((r) => rectGap(r, objectRect))) * unitsPerPixel;
  return { code: distance <= max + EPSILON ? "ok" : "tooFar", distance, max };
}
