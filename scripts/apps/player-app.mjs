import { MODULE_ID, t } from "../constants.mjs";
import { PuzzleStore } from "../storage.mjs";
import { PuzzleSocket } from "../socket.mjs";
import { isAdjacent } from "../puzzles/sliding.mjs";
import { ringGeometry, ringLabelSize } from "../puzzles/rings.mjs";
import { evaluateAccess } from "../proximity.mjs";
import { accessText } from "../access-text.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Тип уведомления по коду результата. Коды без записи показываются без уведомления. */
const NOTIFY_LEVEL = {
  wrong: "warn",
  failed: "warn",
  solved: "info",
  alreadySolved: "info",
  off: "warn",
  tooFar: "warn",
  noToken: "warn",
  noObject: "warn"
};

/**
 * Окно загадки для игрока. Показывает только публичные данные.
 * Ходы уходят мастеру через сокет, окно обновляется, когда мастер запишет новое состояние.
 */
export class PuzzleWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static #open = new Map();
  #busy = false;

  static DEFAULT_OPTIONS = {
    classes: ["mechanisms-and-puzzles", "puzzle-window"],
    tag: "div",
    window: {
      title: `${MODULE_ID}.title`,
      icon: "fa-solid fa-puzzle-piece",
      resizable: true
    },
    position: { width: 420, height: "auto" },
    actions: {
      press: PuzzleWindow.#onPress,
      clear: PuzzleWindow.#onClear,
      slide: PuzzleWindow.#onSlide,
      rotate: PuzzleWindow.#onRotate,
      check: PuzzleWindow.#onCheck
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/puzzle-player.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId;
    this.puzzleId = options.puzzleId;
  }

  /** Открывает окно загадки на сцене (одно окно на загадку). */
  static open(puzzleId, scene = canvas.scene) {
    if (!scene) return null;
    const key = `${scene.id}:${puzzleId}`;
    let app = PuzzleWindow.#open.get(key);
    if (!app) {
      app = new PuzzleWindow({
        id: `${MODULE_ID}-puzzle-${puzzleId}`,
        sceneId: scene.id,
        puzzleId
      });
      PuzzleWindow.#open.set(key, app);
    }
    app.render({ force: true });
    return app;
  }

  /** Перерисовывает открытые окна сцены (вызывается при изменении данных сцены). */
  static refreshScene(sceneId) {
    for (const app of PuzzleWindow.#open.values()) {
      if (app.sceneId === sceneId && app.rendered) app.render();
    }
  }

  get title() {
    const puzzle = this.#puzzle();
    return puzzle?.name || t("title");
  }

  #puzzle() {
    const scene = game.scenes.get(this.sceneId);
    return scene ? PuzzleStore.getPublic(this.puzzleId, scene) : null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const puzzle = this.#puzzle();
    if (!puzzle) return { ...context, missing: true };

    const solved = Boolean(puzzle.solved);
    // Подсказка игроку. Решает всё равно мастер при каждом ходе, эта проверка только для показа.
    const scene = game.scenes.get(this.sceneId);
    const access = game.user.isGM ? { code: "ok" } : evaluateAccess(scene, puzzle, game.user);
    const result = {
      ...context,
      missing: false,
      accessNote: access.code === "ok" ? "" : accessText(access, scene),
      puzzle,
      solved,
      hints: puzzle.hints ?? [],
      sequence: null,
      sliding: null,
      rings: null
    };

    if (puzzle.type === "sequence") {
      const labels = new Map(puzzle.config.symbols.map((s) => [s.id, s.label]));
      const entered = puzzle.state.entered ?? [];
      result.sequence = {
        entered: entered.length,
        length: puzzle.config.length,
        mistakes: puzzle.state.mistakes ?? 0,
        slots: Array.from({ length: puzzle.config.length }, (_, i) => ({
          filled: i < entered.length,
          label: i < entered.length ? labels.get(entered[i]) : ""
        })),
        symbols: puzzle.config.symbols.map((s) => ({ id: s.id, label: s.label, disabled: solved }))
      };
    }
    if (puzzle.type === "sliding") {
      const { rows, cols } = puzzle.config;
      const tiles = puzzle.state.tiles;
      const empty = tiles.indexOf(0);
      result.sliding = {
        rows,
        cols,
        moves: puzzle.state.moves ?? 0,
        cells: tiles.map((value, index) => ({
          index,
          value,
          empty: value === 0,
          disabled: solved,
          // Подсветка плиток, которые можно сдвинуть. Считается из публичных данных.
          movable: !solved && value !== 0 && isAdjacent(index, empty, cols)
        }))
      };
    }
    if (puzzle.type === "rings") {
      const { rings, sectors, labels, checkMode } = puzzle.config;
      const positions = puzzle.state.positions;
      const geometry = ringGeometry({ rings, sectors, labels, positions });
      result.rings = {
        confirm: checkMode === "confirm",
        moves: puzzle.state.moves ?? 0,
        attempts: puzzle.state.attempts ?? 0,
        fontSize: ringLabelSize({ rings, sectors, labels }),
        rings: geometry.map((g) => ({
          ring: g.ring,
          number: g.ring + 1,
          sectors: g.sectors,
          current: g.sectors[0].label,
          disabled: solved
        }))
      };
    }
    return result;
  }

  async _onClose(options) {
    PuzzleWindow.#open.delete(`${this.sceneId}:${this.puzzleId}`);
    return super._onClose(options);
  }

  async #send(move) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const result = await PuzzleSocket.request("puzzle:move", {
        sceneId: this.sceneId,
        puzzleId: this.puzzleId,
        move
      });
      const text = t(`messages.${result.code}`);
      const level = NOTIFY_LEVEL[result.code];
      if (level && text) ui.notifications[level](text);
    } catch (err) {
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
    }
  }

  static async #onPress(event, target) {
    await this.#send({ action: "press", symbolId: target.dataset.symbol });
  }

  static async #onClear() {
    await this.#send({ action: "clear" });
  }

  static async #onSlide(event, target) {
    await this.#send({ action: "move", index: Number(target.dataset.index) });
  }

  /** direction: 1 поворот влево (против часовой стрелки), -1 вправо. */
  static async #onRotate(event, target) {
    await this.#send({
      action: "rotate",
      ring: Number(target.dataset.ring),
      direction: Number(target.dataset.direction)
    });
  }

  static async #onCheck() {
    await this.#send({ action: "check" });
  }
}
