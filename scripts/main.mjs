import { MODULE_ID } from "./constants.mjs";
import { PuzzleStore } from "./storage.mjs";
import { PuzzleSocket } from "./socket.mjs";
import { PuzzleEngine } from "./engine.mjs";
import { PuzzleWindow } from "./apps/player-app.mjs";
import { registerPuzzleType, listPuzzleTypes } from "./puzzles/base.mjs";
import { SequencePuzzle } from "./puzzles/sequence.mjs";
import { SlidingPuzzle } from "./puzzles/sliding.mjs";

Hooks.once("init", () => {
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
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) PuzzleWindow.refreshScene(scene.id);
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
    /** Публичный список загадок текущей сцены (без решений). */
    listPuzzles: () => Object.values(PuzzleStore.listPublic(canvas.scene)),
    types: listPuzzleTypes,
    verifySecrecy: () => PuzzleStore.verifySecrecy()
  };
});
