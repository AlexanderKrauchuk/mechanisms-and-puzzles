import { PuzzleManager } from "./manager.js";
import { PuzzleStorage } from "./storage.js";
import { PuzzleEngine } from "./puzzles/engine.js";
import { PuzzleActions } from "./actions.js";

const MODULE_ID = "mechanisms-and-riddles";
const VERSION = "0.4.1";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "allowMacroActions", {
    name: "Разрешить выполнение макросов",
    hint:
      "Опасная возможность: настроенные мастером скриптовые макросы "
      + "выполняются с его полномочиями. Включайте только для проверенных макросов.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  console.info(`${MODULE_ID} | Инициализация ${VERSION}`);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  const api = {
    version: VERSION,
    ready: true,
    openManager: () => PuzzleManager.open()
  };

  // Это сокращает публичную поверхность API, но само по себе
  // не является защитой от изменённого клиентского кода.
  if (game.user.isGM) {
    Object.assign(api, {
      PuzzleManager,
      PuzzleStorage,
      PuzzleEngine,
      PuzzleActions
    });
  }

  module.api = Object.freeze(api);

  console.info(
    `${MODULE_ID} | Готов. Интерактивная сетевая игра ещё не подключена.`
  );
});
