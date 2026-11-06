import {
  MODULE_ID,
  PuzzleStorage,
  registerStorage
} from "./storage.js";

import { PuzzleEditor } from "./ui/puzzle-editor.js";

const {
  ApplicationV2,
  HandlebarsApplicationMixin,
  DialogV2
} = foundry.applications.api;

function reportError(error) {
  console.error(`${MODULE_ID} |`, error);
  ui.notifications.error(error.message ?? String(error));
}

function requireGM() {
  if (!game.user?.isGM) {
    throw new Error(game.i18n.localize("MAP.Errors.GMOnly"));
  }
}

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
      width: 760,
      height: 650
    },

    actions: {
      refresh: PuzzleManager.onRefresh,
      create: PuzzleManager.onCreate,
      edit: PuzzleManager.onEdit,
      reset: PuzzleManager.onReset,
      delete: PuzzleManager.onDelete
    }
  };

  static PARTS = {
    main: {
      template:
        "modules/mechanisms-and-puzzles/templates/gm-manager.hbs"
    }
  };

  async _prepareContext(options) {
    requireGM();

    const context = await super._prepareContext(options);

    let puzzles = [];
    let storageError = "";

    try {
      puzzles = await PuzzleStorage.list();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      storageError = error.message ?? String(error);
    }

    const typeLabels = {
      sliding: "MAP.Types.Sliding",
      rings: "MAP.Types.Rings",
      sequence: "MAP.Types.Sequence"
    };

    return {
      ...context,

      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "—",
      foundryVersion: game.version,
      systemTitle: game.system?.title ?? "—",

      sceneName:
        canvas.scene?.name ??
        game.i18n.localize("MAP.Manager.NoScene"),

      activeGMNames: game.users.contents
        .filter(user => user.active && user.isGM)
        .map(user => user.name)
        .join(", "),

      storageError,

      puzzles: puzzles.map(puzzle => ({
        id: puzzle.id,
        name: puzzle.name,
        description: puzzle.description,
        typeLabel: game.i18n.localize(
          typeLabels[puzzle.type] ?? "MAP.Types.Unknown"
        ),
        statusLabel: game.i18n.localize(
          puzzle.state?.status === "solved"
            ? "MAP.Status.Solved"
            : "MAP.Status.Idle"
        )
      }))
    };
  }

  static onRefresh() {
    this.render({ force: true });
  }

  static onCreate() {
    try {
      requireGM();

      new PuzzleEditor(
        null,
        () => this.render({ force: true })
      ).render({ force: true });
    } catch (error) {
      reportError(error);
    }
  }

  static async onEdit(event, target) {
    try {
      requireGM();

      const puzzle = await PuzzleStorage.get(target.dataset.puzzleId);

      if (!puzzle) {
        throw new Error(game.i18n.localize("MAP.Errors.PuzzleMissing"));
      }

      new PuzzleEditor(
        puzzle,
        () => this.render({ force: true })
      ).render({ force: true });
    } catch (error) {
      reportError(error);
    }
  }

  static async onReset(event, target) {
    try {
      requireGM();

      const confirmed = await DialogV2.confirm({
        window: {
          title: game.i18n.localize("MAP.Confirm.ResetTitle")
        },
        content: `<p>${game.i18n.localize("MAP.Confirm.ResetText")}</p>`,
        rejectClose: false
      });

      if (!confirmed) return;

      await PuzzleStorage.reset(target.dataset.puzzleId);

      ui.notifications.info(
        game.i18n.localize("MAP.Notifications.Reset")
      );

      await this.render({ force: true });
    } catch (error) {
      reportError(error);
    }
  }

  static async onDelete(event, target) {
    try {
      requireGM();

      const confirmed = await DialogV2.confirm({
        window: {
          title: game.i18n.localize("MAP.Confirm.DeleteTitle")
        },
        content: `<p>${game.i18n.localize("MAP.Confirm.DeleteText")}</p>`,
        rejectClose: false
      });

      if (!confirmed) return;

      await PuzzleStorage.remove(target.dataset.puzzleId);

      ui.notifications.info(
        game.i18n.localize("MAP.Notifications.Deleted")
      );

      await this.render({ force: true });
    } catch (error) {
      reportError(error);
    }
  }
}

let manager;

function openManager() {
  try {
    requireGM();

    manager ??= new PuzzleManager();
    manager.render({ force: true });
  } catch (error) {
    reportError(error);
  }
}

Hooks.once("init", () => {
  registerStorage();

  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "MAP.Settings.ManagerName",
    label: "MAP.Settings.ManagerLabel",
    hint: "MAP.Settings.ManagerHint",
    icon: "fas fa-puzzle-piece",
    type: PuzzleManager,
    restricted: true
  });

  game.modules.get(MODULE_ID).api = Object.freeze({
    openManager
  });

  console.info(`${MODULE_ID} | Инициализация завершена.`);
});

Hooks.once("ready", () => {
  console.info(
    `${MODULE_ID} | Готово. Foundry ${game.version}; система ${game.system.id}.`
  );
});
