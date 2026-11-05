const MODULE_ID = "mechanisms-and-puzzles";

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

/**
 * Этап 1: окно управления и диагностика.
 * Конфигурация и ответы загадок пока не хранятся.
 */
class PuzzleManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mechanisms-and-puzzles-manager",
    tag: "section",
    classes: ["map-puzzles", "map-puzzles-manager"],

    window: {
      title: "MAP.Manager.Title",
      icon: "fas fa-puzzle-piece",
      resizable: true
    },

    position: {
      width: 680,
      height: 520
    },

    actions: {
      refresh: PuzzleManager.onRefresh
    }
  };

  static PARTS = {
    main: {
      template:
        "modules/mechanisms-and-puzzles/templates/gm-manager.hbs"
    }
  };

  /**
   * Проверка выполняется и при каждом рендере:
   * скрытие кнопки само по себе не является контролем доступа.
   */
  async _prepareContext(options) {
    if (!game.user?.isGM) {
      throw new Error(
        game.i18n.localize("MAP.Errors.GMOnly")
      );
    }

    const context = await super._prepareContext(options);

    return {
      ...context,

      moduleVersion:
        game.modules.get(MODULE_ID)?.version ?? "—",

      foundryVersion: game.version,
      systemTitle: game.system?.title ?? "—",
      sceneName:
        canvas.scene?.name ??
        game.i18n.localize("MAP.Manager.NoScene"),

      activeGMNames: game.users.contents
        .filter(user => user.active && user.isGM)
        .map(user => user.name)
        .join(", ")
    };
  }

  static onRefresh() {
    this.render({ force: true });
  }
}

let manager;

/**
 * Публичная точка открытия окна.
 * Она не предоставляет игрокам привилегий мастера.
 */
function openManager() {
  if (!game.user?.isGM) {
    ui.notifications.warn(
      game.i18n.localize("MAP.Errors.GMOnly")
    );
    return;
  }

  manager ??= new PuzzleManager();
  manager.render({ force: true });
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "MAP.Settings.ManagerName",
    label: "MAP.Settings.ManagerLabel",
    hint: "MAP.Settings.ManagerHint",
    icon: "fas fa-puzzle-piece",
    type: PuzzleManager,
    restricted: true
  });

  const module = game.modules.get(MODULE_ID);

  module.api = Object.freeze({
    openManager
  });

  console.info(`${MODULE_ID} | Инициализация завершена.`);
});

Hooks.once("ready", () => {
  console.info(
    `${MODULE_ID} | Готово. Foundry ${game.version}; система ${game.system.id}.`
  );
});
