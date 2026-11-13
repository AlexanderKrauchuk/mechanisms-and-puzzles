import { MODULE_ID, t } from "../constants.mjs";
import { PuzzleStore } from "../storage.mjs";
import { PuzzleEngine } from "../engine.mjs";
import { listPuzzleTypes } from "../puzzles/base.mjs";
import { describeSolution } from "../editor-data.mjs";
import { PuzzleWindow } from "./player-app.mjs";
import { PuzzleEditor } from "./puzzle-editor.mjs";
import { describeLink } from "../proximity.mjs";
import { normalizeInteraction } from "../access.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Одна строка о состоянии загадки для списка мастера. */
function summarize(p) {
  const s = p.state ?? {};
  if (p.type === "sequence") {
    return game.i18n.format(`${MODULE_ID}.manager.summary.sequence`, {
      entered: s.entered?.length ?? 0,
      length: p.config.length,
      mistakes: s.mistakes ?? 0
    });
  }
  if (p.type === "sliding") {
    return game.i18n.format(`${MODULE_ID}.manager.summary.sliding`, { moves: s.moves ?? 0 });
  }
  if (p.type === "rings") {
    return game.i18n.format(`${MODULE_ID}.manager.summary.rings`, { moves: s.moves ?? 0, attempts: s.attempts ?? 0 });
  }
  return "";
}

/** Строка о привязке и доступе для списка мастера. */
function accessLine(scene, p) {
  const rules = normalizeInteraction(p.interaction);
  const info = describeLink(scene, p.link);
  const parts = [];
  if (rules.mode === "off") parts.push(t("manager.access.off"));
  if (info.kind) {
    const name = info.found ? info.name : t("manager.access.missing");
    parts.push(`${t(`editor.access.kind.${info.kind}`)}: ${name}`);
  } else {
    parts.push(t("manager.access.noLink"));
  }
  if (rules.maxDistance > 0) {
    parts.push(game.i18n.format(`${MODULE_ID}.manager.access.distance`, { max: rules.maxDistance, units: scene.grid?.units ?? "" }));
  }
  return parts.join(" · ");
}

/**
 * Окно мастера: список загадок текущей сцены, создание, изменение, сброс, удаление,
 * тестовые кнопки и диагностика. Всё, что есть в модуле, проверяется отсюда без макросов.
 */
export class GmManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-manager`,
    classes: ["mechanisms-and-puzzles", "gm-manager"],
    tag: "div",
    window: {
      title: `${MODULE_ID}.manager.title`,
      icon: "fa-solid fa-puzzle-piece",
      resizable: true
    },
    position: { width: 680, height: "auto" },
    actions: {
      create: GmManager.#onCreate,
      open: GmManager.#onOpen,
      edit: GmManager.#onEdit,
      reset: GmManager.#onReset,
      remove: GmManager.#onRemove,
      reveal: GmManager.#onReveal,
      locate: GmManager.#onLocate,
      nearSolve: GmManager.#onNearSolve,
      refresh: GmManager.#onRefresh
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/gm-manager.hbs` }
  };

  /** Открывает окно (одно на клиента). Только для мастера. */
  static open() {
    if (!game.user.isGM) {
      ui.notifications.warn(t("errors.gmOnly"));
      return null;
    }
    GmManager.#instance ??= new GmManager();
    GmManager.#instance.render({ force: true });
    return GmManager.#instance;
  }

  /** Для кнопки в панели инструментов: открыть или закрыть. */
  static toggle() {
    const app = GmManager.#instance;
    if (app?.rendered) return app.close();
    return GmManager.open();
  }

  /** Перерисовывает окно, если оно открыто (при изменении данных сцены). */
  static refresh() {
    const app = GmManager.#instance;
    if (app?.rendered) app.render();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = canvas.scene;
    if (!scene) return { ...context, noScene: true };

    const puzzles = Object.values(PuzzleStore.listPublic(scene))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        typeLabel: t(`types.${p.type}`),
        solved: Boolean(p.solved),
        summary: summarize(p),
        access: accessLine(scene, p),
        hasLink: Boolean(describeLink(scene, p.link).found),
        canReveal: p.type !== "sliding"
      }));

    return {
      ...context,
      noScene: false,
      sceneName: scene.name,
      puzzles,
      empty: puzzles.length === 0,
      createTypes: listPuzzleTypes().map((type) => ({ type, label: t(`types.${type}`) })),
      diagnostics: GmManager.#diagnostics(puzzles.length)
    };
  }

  /** Сведения для проверки настройки. Всё считается на клиенте мастера. */
  static #diagnostics(puzzleCount) {
    const store = PuzzleStore.secretStore;
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    let storeState = "missing";
    if (store) {
      const own = store.ownership ?? {};
      const leaks = Object.entries(own).some(
        ([key, level]) => level > NONE && (key === "default" || !game.users.get(key)?.isGM)
      );
      storeState = leaks ? "bad" : "ok";
    }
    const players = game.users.filter((u) => u.active && !u.isGM).map((u) => u.name);
    return {
      foundry: game.version,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "?",
      activeGM: game.users.activeGM?.name ?? t("manager.diagnostics.none"),
      players: players.length ? `${players.length} (${players.join(", ")})` : t("manager.diagnostics.none"),
      puzzles: puzzleCount,
      storeOk: storeState === "ok",
      storeBad: storeState === "bad",
      storeMissing: storeState === "missing"
    };
  }

  /** Выполняет действие и показывает ошибку мастеру, а не теряет её в консоли. */
  async #run(fn) {
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    }
  }

  static async #onCreate(event, target) {
    PuzzleEditor.open({ type: target.dataset.type });
  }

  static async #onOpen(event, target) {
    PuzzleWindow.open(target.dataset.id, canvas.scene);
  }

  static async #onEdit(event, target) {
    await this.#run(() => PuzzleEditor.open({ puzzleId: target.dataset.id }));
  }

  static async #onReset(event, target) {
    await this.#run(async () => {
      await PuzzleEngine.resetPuzzle(canvas.scene, target.dataset.id);
      ui.notifications.info(t("manager.resetDone"));
    });
  }

  static async #onRemove(event, target) {
    await this.#run(async () => {
      const id = target.dataset.id;
      const name = PuzzleStore.getPublic(id, canvas.scene)?.name ?? "";
      const confirmed = await DialogV2.confirm({
        window: { title: t("manager.confirmDeleteTitle") },
        content: `<p>${escapeHtml(game.i18n.format(`${MODULE_ID}.manager.confirmDelete`, { name }))}</p>`,
        yes: { label: t("manager.yes") },
        no: { label: t("manager.no") }
      });
      if (!confirmed) return;
      await PuzzleEngine.deletePuzzle(canvas.scene, id);
      ui.notifications.info(t("manager.deleted"));
    });
  }

  static async #onReveal(event, target) {
    await this.#run(async () => {
      const { pub, secret } = PuzzleEngine.getForEdit(canvas.scene, target.dataset.id);
      const lines = describeSolution(pub, secret);
      const body = lines
        ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
        : `<p>${escapeHtml(t("manager.noSolution"))}</p>`;
      await DialogV2.prompt({
        window: { title: game.i18n.format(`${MODULE_ID}.manager.solutionTitle`, { name: pub.name }) },
        content: body,
        ok: { label: t("manager.close") }
      });
    });
  }

  /** Показывает привязанный объект на холсте. Методы холста помечены в README как непроверенные. */
  static async #onLocate(event, target) {
    await this.#run(async () => {
      const info = describeLink(canvas.scene, PuzzleStore.getPublic(target.dataset.id, canvas.scene)?.link);
      if (!info.found) {
        ui.notifications.warn(t("manager.access.missing"));
        return;
      }
      await canvas.animatePan?.({ x: info.center.x, y: info.center.y });
      canvas.ping?.(info.center);
    });
  }

  static async #onNearSolve(event, target) {
    await this.#run(async () => {
      await PuzzleEngine.nearSolve(canvas.scene, target.dataset.id);
      ui.notifications.info(t("manager.nearSolved"));
    });
  }

  static async #onRefresh() {
    this.render();
  }
}
