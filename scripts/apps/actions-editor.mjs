import { MODULE_ID, t } from "../constants.mjs";
import { PuzzleEngine } from "../engine.mjs";
import { PuzzleStore } from "../storage.mjs";
import {
  ACTION_TYPES,
  CHAT_AUDIENCES,
  DOOR_STATES,
  OUTCOMES,
  TILE_MODES,
  defaultAction,
  moveAction,
  parseActionsForm,
  volumeToPercent
} from "../actions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const choices = (values, labelKey, current) =>
  values.map((value) => ({ value, label: t(`${labelKey}.${value}`), selected: value === current }));

/**
 * Окно действий загадки (только мастер): что произойдёт при успехе и при провале.
 * Список можно менять (добавить, удалить, переставить), введённое при этом не теряется.
 */
export class ActionsEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static #open = new Map();

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mechanisms-and-puzzles", "actions-editor"],
    window: { icon: "fa-solid fa-bolt", resizable: true },
    position: { width: 600, height: "auto" },
    form: { handler: ActionsEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      cancel: ActionsEditor.#onCancel,
      addAction: ActionsEditor.#onAdd,
      removeAction: ActionsEditor.#onRemove,
      moveAction: ActionsEditor.#onMove,
      takeTile: ActionsEditor.#onTakeTile,
      takeWall: ActionsEditor.#onTakeWall,
      pickSound: ActionsEditor.#onPickSound
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actions-editor.hbs` }
  };

  static open(puzzleId, scene = canvas.scene) {
    if (!game.user.isGM) return null;
    if (!scene) {
      ui.notifications.warn(t("errors.noScene"));
      return null;
    }
    const key = `${scene.id}:${puzzleId}`;
    let app = ActionsEditor.#open.get(key);
    if (!app) {
      app = new ActionsEditor({ id: `${MODULE_ID}-actions-${scene.id}-${puzzleId}`, sceneId: scene.id, puzzleId });
      app.#key = key;
      ActionsEditor.#open.set(key, app);
    }
    app.render({ force: true });
    return app;
  }

  #key = null;
  /** Редактируемый черновик: { success: [...], failure: [...] }. Появляется при первом показе. */
  #draft = null;

  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId;
    this.puzzleId = options.puzzleId;
  }

  get title() {
    const scene = game.scenes.get(this.sceneId);
    const name = (scene && PuzzleStore.getPublic(this.puzzleId, scene)?.name) ?? "";
    return game.i18n.format(`${MODULE_ID}.actions.title`, { name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = game.scenes.get(this.sceneId);
    this.#draft ??= PuzzleEngine.getActions(scene, this.puzzleId);

    const outcomes = OUTCOMES.map((outcome) => {
      const list = this.#draft[outcome];
      return {
        id: outcome,
        title: t(`actions.outcome.${outcome}`),
        hint: t(`actions.outcomeHint.${outcome}`),
        rows: list.map((a, index) => ({
          outcome,
          index,
          n: index + 1,
          name: `${outcome}.${index}`,
          first: index === 0,
          last: index === list.length - 1,
          type: a.type,
          typeLabel: t(`actions.types.${a.type}`),
          isMessage: a.type === "message",
          isChat: a.type === "chat",
          isTile: a.type === "tile",
          isDoor: a.type === "door",
          isSound: a.type === "sound",
          text: a.text ?? "",
          audiences: choices(CHAT_AUDIENCES, "actions.audience", a.audience),
          tileId: a.tileId ?? "",
          tileModes: choices(TILE_MODES, "actions.tileMode", a.mode),
          tileStatus: ActionsEditor.#status(scene?.tiles, a.tileId),
          wallId: a.wallId ?? "",
          doorStates: choices(DOOR_STATES, "actions.doorState", a.state),
          wallStatus: ActionsEditor.#status(scene?.walls, a.wallId),
          src: a.src ?? "",
          volume: volumeToPercent(a.volume)
        }))
      };
    });

    return {
      ...context,
      outcomes,
      types: ACTION_TYPES.map((value) => ({ value, label: t(`actions.types.${value}`) })),
      macrosNote: t("actions.macrosNote")
    };
  }

  /** «найдена» / «не найдена» для привязанных id плитки и стены. */
  static #status(collection, id) {
    if (!id) return "";
    return collection?.get(id) ? t("actions.found") : t("actions.notFound");
  }

  async _onClose(options) {
    if (this.#key) ActionsEditor.#open.delete(this.#key);
    return super._onClose(options);
  }

  /** Читает форму в черновик, чтобы добавление и удаление строк не стирали набранное. */
  #capture() {
    this.#draft = parseActionsForm(Object.fromEntries(new FormData(this.element)));
  }

  static async #onAdd(event, target) {
    const outcome = target.dataset.outcome;
    const select = this.element.querySelector(`select[data-add-for="${outcome}"]`);
    const action = defaultAction(select?.value);
    if (!action) return;
    this.#capture();
    this.#draft[outcome].push(action);
    this.render();
  }

  static async #onRemove(event, target) {
    const { outcome, index } = target.dataset;
    this.#capture();
    this.#draft[outcome].splice(Number(index), 1);
    this.render();
  }

  static async #onMove(event, target) {
    const { outcome, index, step } = target.dataset;
    this.#capture();
    this.#draft[outcome] = moveAction(this.#draft[outcome], Number(index), Number(step));
    this.render();
  }

  #field(target, name) {
    const { outcome, index } = target.dataset;
    return this.element.querySelector(`[name="${outcome}.${index}.${name}"]`);
  }

  /** Берёт выбранный на холсте объект. Привязка только к объектам сцены, открытой сейчас. */
  #takeSelected(target, layer, field, label) {
    if (this.sceneId !== canvas.scene?.id) {
      ui.notifications.warn(t("editor.access.otherScene"));
      return null;
    }
    const selected = layer?.controlled ?? [];
    if (selected.length !== 1) {
      ui.notifications.warn(t(`actions.select.${field}`));
      return null;
    }
    const doc = selected[0].document;
    const input = this.#field(target, field);
    if (input) input.value = doc.id;
    const status = target.closest(".map-action-row")?.querySelector(`[data-role="${label}"]`);
    if (status) status.textContent = t("actions.found");
    return doc;
  }

  static async #onTakeTile(event, target) {
    this.#takeSelected(target, canvas.tiles, "tileId", "tile-status");
  }

  static async #onTakeWall(event, target) {
    const doc = this.#takeSelected(target, canvas.walls, "wallId", "wall-status");
    if (doc && doc.door === (CONST.WALL_DOOR_TYPES?.NONE ?? 0)) ui.notifications.warn(t("actions.notADoor"));
  }

  /** Окно выбора файла. Если оно недоступно, путь можно ввести руками. */
  static async #onPickSound(event, target) {
    const input = this.#field(target, "src");
    try {
      const Picker = foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
      new Picker({ type: "audio", current: input?.value ?? "", callback: (path) => input && (input.value = path) }).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.warn(t("actions.pickerUnavailable"));
    }
  }

  static async #onSubmit(event, form, formData) {
    const actions = parseActionsForm(formData.object);
    const scene = game.scenes.get(this.sceneId);
    try {
      await PuzzleEngine.setActions(scene, this.puzzleId, actions);
      ui.notifications.info(t("actions.saved"));
      await this.close();
    } catch (err) {
      // Окно остаётся открытым, введённое не теряется.
      this.#draft = actions;
      ui.notifications.error(err.message);
    }
  }

  static async #onCancel() {
    await this.close();
  }
}
