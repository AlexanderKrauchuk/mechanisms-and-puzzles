import { MODULE_ID } from "./constants.mjs";
import { PuzzleStore } from "./storage.mjs";
import { PuzzleSocket } from "./socket.mjs";
import { PuzzleEngine } from "./engine.mjs";
import { PuzzleWindow } from "./apps/player-app.mjs";
import { registerPuzzleType, listPuzzleTypes } from "./puzzles/base.mjs";
import { SequencePuzzle } from "./puzzles/sequence.mjs";
import { SlidingPuzzle } from "./puzzles/sliding.mjs";
import { RingsPuzzle } from "./puzzles/rings.mjs";
import { GmManager } from "./apps/gm-manager.mjs";
import { PuzzleList } from "./apps/puzzle-list.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * Заглушка для пункта в настройках модуля: при «открытии» показывает окно управления.
 * Сама ничего не рисует. Если в вашей версии Foundry пункт настроек не открывает окно,
 * используйте кнопку в панели инструментов или api.openManager().
 */
class ManagerMenu extends ApplicationV2 {
  async render() {
    GmManager.open();
    return this;
  }
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "managerMenu", {
    name: `${MODULE_ID}.settings.managerMenu.name`,
    label: `${MODULE_ID}.settings.managerMenu.label`,
    hint: `${MODULE_ID}.settings.managerMenu.hint`,
    icon: "fa-solid fa-puzzle-piece",
    type: ManagerMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, "allowMacros", {
    name: `${MODULE_ID}.settings.allowMacros.name`,
    hint: `${MODULE_ID}.settings.allowMacros.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false
  });

  game.settings.register(MODULE_ID, "debug", {
    name: `${MODULE_ID}.settings.debug.name`,
    hint: `${MODULE_ID}.settings.debug.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
});

// Окна игроков обновляются, когда мастер записал новое состояние загадки во flags сцены.
Hooks.on("updateScene", (scene, changes) => {
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
  PuzzleWindow.refreshScene(scene.id);
  if (scene.id === canvas.scene?.id) {
    GmManager.refresh();
    PuzzleList.refresh();
  }
});

// Расстояние до привязанного объекта зависит от положения токенов и объектов,
// поэтому при их перемещении окна игрока и список пересчитываются.
function refreshAccess(document, changes) {
  if (!("x" in changes || "y" in changes || "width" in changes || "height" in changes)) return;
  const sceneId = document.parent?.id;
  if (!sceneId) return;
  PuzzleWindow.refreshScene(sceneId);
  if (sceneId === canvas.scene?.id) {
    GmManager.refresh();
    PuzzleList.refresh();
  }
}
Hooks.on("updateToken", refreshAccess);
Hooks.on("updateTile", refreshAccess);

// Окно мастера показывает загадки текущей сцены, поэтому обновляется при смене сцены.
Hooks.on("canvasReady", () => {
  GmManager.refresh();
  PuzzleList.refresh();
});

// Кнопки в панели инструментов слева (группа «Токены»): окно управления у мастера,
// список «Загадки рядом» у игроков. В v13 аргумент controls это объект, ключи которого названия групп.
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.tokens ?? Object.values(controls)[0];
  if (!group?.tools) return;
  const isGM = game.user.isGM;
  const name = isGM ? `${MODULE_ID}-manager` : `${MODULE_ID}-list`;
  group.tools[name] = {
    name,
    title: isGM ? `${MODULE_ID}.manager.title` : `${MODULE_ID}.list.title`,
    icon: "fa-solid fa-puzzle-piece",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: () => (isGM ? GmManager.toggle() : PuzzleList.toggle())
  };
});

/** Открывает окно загадки текущей сцены по id или по названию. */
function openPuzzle(idOrName) {
  const scene = canvas.scene;
  if (!scene) return null;
  const puzzles = PuzzleStore.listPublic(scene);
  const match = puzzles[idOrName] ?? Object.values(puzzles).find((p) => p.name === idOrName);
  if (!match) {
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.errors.noPuzzle`));
    return null;
  }
  return PuzzleWindow.open(match.id, scene);
}

Hooks.once("ready", async () => {
  registerPuzzleType(SequencePuzzle);
  registerPuzzleType(SlidingPuzzle);
  registerPuzzleType(RingsPuzzle);
  PuzzleSocket.register();
  PuzzleEngine.register();

  // Проверочный запрос, чтобы убедиться, что канал игрок → мастер работает.
  PuzzleSocket.handle("ping", async (_payload, userId) => ({
    pong: true,
    from: userId,
    at: Date.now()
  }));

  // Скрытое хранилище создаёт только активный мастер, чтобы не было гонки.
  if (game.user === game.users.activeGM) {
    await PuzzleStore.ensureSecretStore();
  }

  // Публичный API модуля (для отладки и макросов мастера).
  game.modules.get(MODULE_ID).api = {
    store: PuzzleStore,
    socket: PuzzleSocket,
    engine: PuzzleEngine,
    openPuzzle,
    openManager: () => GmManager.open(),
    openList: () => PuzzleList.open(),
    /** Публичный список загадок текущей сцены (без решений). */
    listPuzzles: () => Object.values(PuzzleStore.listPublic(canvas.scene)),
    types: listPuzzleTypes,
    verifySecrecy: () => PuzzleStore.verifySecrecy()
  };
});
