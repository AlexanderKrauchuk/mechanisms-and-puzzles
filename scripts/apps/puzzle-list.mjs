import { MODULE_ID, t } from "../constants.mjs";
import { PuzzleStore } from "../storage.mjs";
import { evaluateAccess } from "../proximity.mjs";
import { accessText } from "../access-text.mjs";
import { PuzzleWindow } from "./player-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Окно «Загадки рядом» для игрока: загадки текущей сцены, которые мастер не выключил,
 * и доступны ли они сейчас по расстоянию. Решает всё равно мастер при каждом ходе,
 * здесь только подсказка, чтобы игрок не открывал недоступную загадку вслепую.
 */
export class PuzzleList extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-list`,
    classes: ["mechanisms-and-puzzles", "puzzle-list"],
    tag: "div",
    window: { title: `${MODULE_ID}.list.title`, icon: "fa-solid fa-puzzle-piece", resizable: true },
    position: { width: 420, height: "auto" },
    actions: { open: PuzzleList.#onOpen }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/puzzle-list.hbs` }
  };

  static open() {
    PuzzleList.#instance ??= new PuzzleList();
    PuzzleList.#instance.render({ force: true });
    return PuzzleList.#instance;
  }

  static toggle() {
    const app = PuzzleList.#instance;
    if (app?.rendered) return app.close();
    return PuzzleList.open();
  }

  /** Перерисовывает окно, если оно открыто (сцена или токены изменились). */
  static refresh() {
    const app = PuzzleList.#instance;
    if (app?.rendered) app.render();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = canvas.scene;
    if (!scene) return { ...context, noScene: true };

    const puzzles = Object.values(PuzzleStore.listPublic(scene))
      .filter((p) => p.interaction?.mode !== "off")
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"))
      .map((p) => {
        const access = evaluateAccess(scene, p, game.user);
        return {
          id: p.id,
          name: p.name,
          typeLabel: t(`types.${p.type}`),
          solved: Boolean(p.solved),
          canOpen: access.code === "ok",
          note: access.code === "ok" ? "" : accessText(access, scene)
        };
      });
    return { ...context, noScene: false, puzzles, empty: puzzles.length === 0 };
  }

  static async #onOpen(event, target) {
    PuzzleWindow.open(target.dataset.id, canvas.scene);
  }
}
