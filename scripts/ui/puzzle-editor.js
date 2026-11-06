import { PuzzleStorage } from "../storage.js";

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

function reportError(error) {
  console.error("mechanisms-and-puzzles |", error);
  ui.notifications.error(error.message ?? String(error));
}

export class PuzzleEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(puzzle = null, onSaved = null) {
    super();

    this.puzzle = puzzle
      ? foundry.utils.deepClone(puzzle)
      : null;

    this.onSaved = onSaved;
    this.saving = false;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["map-puzzles", "map-puzzle-editor"],

    window: {
      title: "MAP.Editor.Title",
      icon: "fas fa-puzzle-piece",
      resizable: true
    },

    position: {
      width: 720,
      height: 740
    },

    form: {
      handler: PuzzleEditor.onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    }
  };

  static PARTS = {
    main: {
      template:
        "modules/mechanisms-and-puzzles/templates/puzzle-editor.hbs"
    }
  };

  async _prepareContext(options) {
    if (!game.user?.isGM) {
      throw new Error(game.i18n.localize("MAP.Errors.GMOnly"));
    }

    const context = await super._prepareContext(options);
    const puzzle = this.puzzle;
    const type = puzzle?.type ?? "sliding";

    return {
      ...context,
      name: puzzle?.name ?? "",
      description: puzzle?.description ?? "",
      hintsText: puzzle?.hints?.join("\n") ?? "",

      typeOptions: [
        {
          value: "sliding",
          label: game.i18n.localize("MAP.Types.Sliding"),
          selected: type === "sliding"
        },
        {
          value: "rings",
          label: game.i18n.localize("MAP.Types.Rings"),
          selected: type === "rings"
        },
        {
          value: "sequence",
          label: game.i18n.localize("MAP.Types.Sequence"),
          selected: type === "sequence"
        }
      ],

      slidingSize: type === "sliding" ? puzzle?.config.size ?? 3 : 3,

      ringCount: type === "rings" ? puzzle.config.count : 3,
      ringSectors: type === "rings" ? puzzle.config.sectors : 8,
      ringTargets: type === "rings"
        ? puzzle.config.targets.join(", ")
        : "0, 0, 0",

      symbolsText: type === "sequence"
        ? puzzle.config.symbols.join("\n")
        : "Солнце\nЛуна\nЗвезда",

      solutionText: type === "sequence"
        ? puzzle.config.solution.map(index => index + 1).join(", ")
        : "1, 2, 3",

      behaviorOptions: [
        {
          value: "reset",
          label: game.i18n.localize("MAP.Editor.BehaviorReset"),
          selected: (puzzle?.config.errorBehavior ?? "reset") === "reset"
        },
        {
          value: "ignore",
          label: game.i18n.localize("MAP.Editor.BehaviorIgnore"),
          selected: puzzle?.config.errorBehavior === "ignore"
        },
        {
          value: "fail-reset",
          label: game.i18n.localize("MAP.Editor.BehaviorFailReset"),
          selected: puzzle?.config.errorBehavior === "fail-reset"
        }
      ]
    };
  }

  static async onSubmit(event, form, formData) {
    if (this.saving) return;

    this.saving = true;

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      if (!game.user?.isGM) {
        throw new Error(game.i18n.localize("MAP.Errors.GMOnly"));
      }

      const value = name => form.elements.namedItem(name)?.value ?? "";

      const lines = input =>
        input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

      const numbers = input => {
        const trimmed = input.trim();

        return trimmed
          ? trimmed.split(/[\s,;]+/).map(Number)
          : [];
      };

      const type = value("type");
      let config;

      if (type === "sliding") {
        config = {
          size: Number(value("slidingSize"))
        };
      } else if (type === "rings") {
        config = {
          count: Number(value("ringCount")),
          sectors: Number(value("ringSectors")),
          targets: numbers(value("ringTargets"))
        };
      } else {
        config = {
          symbols: lines(value("symbols")),
          solution: numbers(value("solution")).map(number => number - 1),
          errorBehavior: value("errorBehavior")
        };
      }

      const saved = await PuzzleStorage.save(
        {
          name: value("name"),
          description: value("description"),
          hints: lines(value("hints")),
          type,
          config
        },
        this.puzzle?.id ?? null,
        this.puzzle?.revision ?? null
      );

      // Сначала фиксируем успешное сохранение в самом редакторе.
      this.puzzle = saved;

      ui.notifications.info(
        game.i18n.localize("MAP.Notifications.Saved")
      );

      await this.close();

      if (this.onSaved) {
        await this.onSaved(saved);
      }
    } catch (error) {
      reportError(error);
    } finally {
      this.saving = false;
      if (submitButton) submitButton.disabled = false;
    }
  }
}
