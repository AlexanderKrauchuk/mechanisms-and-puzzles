import { MODULE_ID } from "./constants.mjs";
import { PuzzleStore } from "./storage.mjs";
import { PuzzleSocket } from "./socket.mjs";

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

Hooks.once("ready", async () => {
  PuzzleSocket.register();

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
    verifySecrecy: () => PuzzleStore.verifySecrecy()
  };
});
