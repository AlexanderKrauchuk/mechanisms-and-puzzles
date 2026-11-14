import { PuzzleStore } from "./storage.mjs";

/**
 * Самопроверка прав. Чистая функция auditPermissions получает снимок данных и возвращает
 * список проверок [{ id, status: "ok"|"warn"|"fail", names? }]. Данные для неё собирает
 * collectAuditInput на клиенте мастера.
 *
 * Что проверяется:
 *   secretStore      скрытое хранилище решений существует;
 *   storeOwnership   игрокам и «всем по умолчанию» оно не доступно;
 *   publicClean      в публичных данных загадок нет полей решения и действий;
 *   scenePermissions игроки не владельцы сцены (иначе они правят flags в обход проверок мастера);
 *   secretsComplete  у каждой загадки есть секретная часть;
 *   activeGM         мастер в сети (без него игроки не могут ходить);
 *   macros           запуск макросов выключен.
 * Проверка не заменяет ручную проверку вторым браузером (см. README): она видит данные
 * мастера, а не то, что фактически получил игрок.
 */

export const FORBIDDEN_PUBLIC_KEYS = Object.freeze(["solution", "actions", "secret", "secrets"]);

/** Ищет запрещённые ключи в публичных данных на любой глубине. Возвращает найденные пути. */
export function findForbiddenKeys(value, path = "") {
  const found = [];
  if (value === null || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PUBLIC_KEYS.includes(key)) found.push(here);
    found.push(...findForbiddenKeys(child, here));
  }
  return found;
}

/**
 * input: {
 *   storeOwnership: object|null   ownership скрытого журнала (null, если журнала нет),
 *   NONE: number                  значение CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
 *   users: [{ id, name, isGM, ownsScene }],
 *   puzzles: [публичные данные загадок сцены],
 *   secretIds: [id загадок, у которых есть секрет],
 *   hasActiveGM: boolean,
 *   allowMacros: boolean
 * }
 */
export function auditPermissions(input) {
  const results = [];
  const add = (id, status, names) => results.push(names?.length ? { id, status, names } : { id, status });
  const users = input.users ?? [];
  const byId = new Map(users.map((u) => [u.id, u]));

  add("secretStore", input.storeOwnership ? "ok" : "fail");

  if (input.storeOwnership) {
    const leaks = [];
    for (const [key, level] of Object.entries(input.storeOwnership)) {
      if (!(level > input.NONE)) continue;
      if (key === "default") leaks.push("default");
      else if (!byId.get(key)?.isGM) leaks.push(byId.get(key)?.name ?? key);
    }
    add("storeOwnership", leaks.length ? "fail" : "ok", leaks);
  }

  const dirty = (input.puzzles ?? []).flatMap((p) => findForbiddenKeys(p).map((path) => `${p.name ?? p.id}: ${path}`));
  add("publicClean", dirty.length ? "fail" : "ok", dirty);

  const owners = users.filter((u) => !u.isGM && u.ownsScene).map((u) => u.name);
  add("scenePermissions", owners.length ? "fail" : "ok", owners);

  const have = new Set(input.secretIds ?? []);
  const missing = (input.puzzles ?? []).filter((p) => !have.has(p.id)).map((p) => p.name ?? p.id);
  add("secretsComplete", missing.length ? "warn" : "ok", missing);

  add("activeGM", input.hasActiveGM ? "ok" : "warn");
  add("macros", input.allowMacros ? "warn" : "ok");
  return results;
}

/**
 * Снимок данных с клиента мастера. Не проверено на живом Foundry (см. README):
 * Document#testUserPermission(user, OWNER) для сцены и ownership скрытого журнала.
 */
export function collectAuditInput(scene) {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const store = PuzzleStore.secretStore;
  const puzzles = Object.values(PuzzleStore.listPublic(scene));
  return {
    storeOwnership: store ? { ...(store.ownership ?? {}) } : null,
    NONE: levels.NONE,
    users: game.users.map((u) => ({
      id: u.id,
      name: u.name,
      isGM: u.isGM,
      ownsScene: !u.isGM && Boolean(scene.testUserPermission(u, levels.OWNER))
    })),
    puzzles,
    secretIds: puzzles.filter((p) => PuzzleStore.getSecret(p.id)).map((p) => p.id),
    hasActiveGM: Boolean(game.users.activeGM),
    allowMacros: Boolean(game.settings.get("mechanisms-and-puzzles", "allowMacros"))
  };
}
