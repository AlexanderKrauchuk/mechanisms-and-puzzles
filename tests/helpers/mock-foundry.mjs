// Минимальная заглушка Foundry для тестов движка в Node.
//
// Ограничение: заглушка повторяет то, КАК Я ПОНИМАЮ работу Document#update
// (вложенные объекты объединяются, массивы и примитивы заменяются, ключ "-=x" удаляет).
// Тесты проверяют логику модуля, но не доказывают поведение настоящего Foundry.

const MODULE_ID = "mechanisms-and-puzzles";
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function mergeInto(target, key, value) {
  if (isPlainObject(value) && isPlainObject(target[key])) {
    for (const [k, v] of Object.entries(value)) mergeInto(target[key], k, v);
  } else {
    target[key] = structuredClone(value);
  }
}

function applyUpdate(doc, update) {
  for (const [path, value] of Object.entries(update)) {
    const parts = path.split(".");
    let node = doc;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part];
    }
    const last = parts.at(-1);
    if (last.startsWith("-=")) delete node[last.slice(2)];
    else mergeInto(node, last, value);
  }
}

function makeDoc(data = {}) {
  return {
    ...structuredClone(data),
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(update) {
      applyUpdate(this, update);
      return this;
    }
  };
}

export function installFoundryMock() {
  const hookCalls = [];
  const journals = [];
  const users = new Map([
    ["gm1", { id: "gm1", active: true, isGM: true }],
    ["p1", { id: "p1", active: true, isGM: false }]
  ]);
  const scene = makeDoc({ id: "scene1", flags: {}, grid: { size: 100, distance: 5, units: "ft" } });
  const makeCollection = () => {
    const map = new Map();
    Object.defineProperty(map, "contents", { get: () => [...map.values()] });
    return map;
  };
  scene.tokens = makeCollection();
  scene.tiles = makeCollection();
  const scenes = new Map([[scene.id, scene]]);

  const game = {
    user: users.get("gm1"),
    users: { get: (id) => users.get(id), activeGM: users.get("gm1") },
    scenes: { get: (id) => scenes.get(id) },
    journal: { find: (fn) => journals.find(fn) },
    i18n: { localize: (key) => key },
    settings: { get: () => false }
  };

  globalThis.game = game;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
  globalThis.foundry = {
    utils: {
      randomID: () => Math.random().toString(36).slice(2, 10),
      deepClone: (v) => structuredClone(v),
      hasProperty: (obj, path) => path.split(".").every((p) => (obj = obj?.[p]) !== undefined)
    }
  };
  globalThis.JournalEntry = {
    create: async (data) => {
      const doc = makeDoc(data);
      journals.push(doc);
      return doc;
    }
  };
  globalThis.Hooks = { callAll: (name, data) => hookCalls.push({ name, data }) };

  return {
    MODULE_ID,
    game,
    scene,
    journals,
    hookCalls,
    /** Токен на сцене. owners: id пользователей-владельцев. x, y в пикселях, width и height в клетках. */
    addToken: ({ id, x = 0, y = 0, width = 1, height = 1, owners = [], name = id }) => {
      const actor = { testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id) };
      scene.tokens.set(id, { id, name, x, y, width, height, actor });
    },
    /** Плитка на сцене. x, y, width, height в пикселях. */
    addTile: ({ id, x = 0, y = 0, width = 100, height = 100 }) => {
      scene.tiles.set(id, { id, x, y, width, height });
    },
    clearObjects: () => {
      scene.tokens.clear();
      scene.tiles.clear();
    },
    setUser: (id) => {
      game.user = users.get(id);
    }
  };
}
