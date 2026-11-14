import { MODULE_ID, t } from "../constants.mjs";
import { PuzzleEngine } from "../engine.mjs";
import { PuzzleStore } from "../storage.mjs";
import { parseEditorForm, toEditorValues, defaultEditorValues, previewEditor } from "../editor-data.mjs";
import { SYMBOL_GROUPS, SYMBOL_PRESETS, presetText, insertSymbol, insertLineBreak } from "../symbols.mjs";
import { describeLink } from "../proximity.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const opt = (value, label, current) => ({ value, label: t(label), selected: value === current });

/**
 * Окно создания и изменения загадки (только мастер).
 * Тип выбирается при создании и потом не меняется, поэтому в форме показываются поля одного типа.
 */
export class PuzzleEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static #open = new Map();

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mechanisms-and-puzzles", "puzzle-editor"],
    window: { icon: "fa-solid fa-pen-to-square", resizable: true },
    position: { width: 540, height: "auto" },
    form: {
      handler: PuzzleEditor.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      cancel: PuzzleEditor.#onCancel,
      linkToken: PuzzleEditor.#onLinkToken,
      linkTile: PuzzleEditor.#onLinkTile,
      linkClear: PuzzleEditor.#onLinkClear,
      insertSymbol: PuzzleEditor.#onInsertSymbol,
      preset: PuzzleEditor.#onPreset,
      newRingLine: PuzzleEditor.#onNewRingLine
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/puzzle-editor.hbs` }
  };

  /** options: { sceneId, type } для новой загадки или { sceneId, puzzleId } для изменения. */
  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId;
    this.puzzleId = options.puzzleId ?? null;
    this.type = options.type ?? null;
  }

  static open({ type, puzzleId } = {}, scene = canvas.scene) {
    if (!game.user.isGM) return null;
    if (!scene) {
      ui.notifications.warn(t("errors.noScene"));
      return null;
    }
    const key = puzzleId ? `edit:${scene.id}:${puzzleId}` : `new:${scene.id}:${type}`;
    let app = PuzzleEditor.#open.get(key);
    if (!app) {
      app = new PuzzleEditor({
        id: `${MODULE_ID}-editor-${key.replaceAll(":", "-")}`,
        sceneId: scene.id,
        puzzleId,
        type
      });
      app.#key = key;
      PuzzleEditor.#open.set(key, app);
    }
    app.render({ force: true });
    return app;
  }

  #key = null;

  get title() {
    if (this.puzzleId) {
      const scene = game.scenes.get(this.sceneId);
      const pub = scene ? PuzzleStore.getPublic(this.puzzleId, scene) : null;
      return game.i18n.format(`${MODULE_ID}.editor.editTitle`, { name: pub?.name ?? "" });
    }
    return game.i18n.format(`${MODULE_ID}.editor.createTitle`, { type: t(`types.${this.type}`) });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = game.scenes.get(this.sceneId);
    let values;
    let type = this.type;
    if (this.puzzleId) {
      const { pub, secret } = PuzzleEngine.getForEdit(scene, this.puzzleId);
      values = toEditorValues(pub, secret);
      type = pub.type;
      this.type = type;
    } else {
      values = defaultEditorValues(type);
    }

    return {
      ...context,
      showPalette: type === "sequence" || type === "rings",
      preview: previewEditor({ ...values, type }),
      groups: SYMBOL_GROUPS.map((g) => ({ id: g.id, label: t(`editor.symbols.groups.${g.id}`), symbols: g.symbols })),
      presets: SYMBOL_PRESETS.map((p) => ({
        id: p.id,
        label: t(`editor.symbols.presetNames.${p.id}`),
        count: p.symbols.length,
        text: presetText(p)
      })),
      linkLabel: PuzzleEditor.#linkLabel(scene, values.linkKind, values.linkId),
      distanceUnits: scene?.grid?.units || t("editor.access.unitsDefault"),
      interactionModes: [
        opt("ui", "editor.access.modeUi", values.interactionMode),
        opt("off", "editor.access.modeOff", values.interactionMode)
      ],
      editing: Boolean(this.puzzleId),
      isSequence: type === "sequence",
      isSliding: type === "sliding",
      isRings: type === "rings",
      v: values,
      seqCheckModes: [
        opt("step", "editor.sequence.checkStep", values.seqCheckMode),
        opt("final", "editor.sequence.checkFinal", values.seqCheckMode)
      ],
      seqErrorModes: [
        opt("reset", "editor.sequence.errorReset", values.seqErrorMode),
        opt("ignore", "editor.sequence.errorIgnore", values.seqErrorMode),
        opt("fail", "editor.sequence.errorFail", values.seqErrorMode)
      ],
      rgCheckModes: [
        opt("auto", "editor.rings.checkAuto", values.rgCheckMode),
        opt("confirm", "editor.rings.checkConfirm", values.rgCheckMode)
      ]
    };
  }

  #caret = null;

  /** Поле, в которое палитра вставляет символы: символы последовательности или подписи колец. */
  #symbolField() {
    const name = this.type === "rings" ? "rgLabels" : "seqSymbols";
    return this.element.querySelector(`[name="${name}"]`);
  }

  /** Пересчитывает подсказки под полями (нумерация символов и решение по-человечески). */
  #updatePreview() {
    const form = this.element;
    const values = { ...Object.fromEntries(new FormData(form)), type: this.type };
    const preview = previewEditor(values);
    for (const role of ["numbering", "solution"]) {
      const node = form.querySelector(`[data-role="${role}"]`);
      if (node) node.textContent = preview[role];
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element;
    // Присваивание, а не addEventListener: окно перерисовывается, обработчик не должен копиться.
    form.oninput = () => this.#updatePreview();
    const field = this.#symbolField();
    if (field) {
      field.onblur = () => {
        this.#caret = { start: field.selectionStart, end: field.selectionEnd };
      };
    }
  }

  /** Записывает результат вставки в поле, возвращает в него курсор и обновляет подсказки. */
  #applyEdit(field, { text, caret }) {
    field.value = text;
    field.focus();
    field.setSelectionRange(caret, caret);
    this.#caret = { start: caret, end: caret };
    this.#updatePreview();
  }

  static async #onInsertSymbol(event, target) {
    const field = this.#symbolField();
    if (!field) return;
    const end = field.value.length;
    const { start = end, end: to = end } = this.#caret ?? {};
    this.#applyEdit(field, insertSymbol(field.value, start, to, target.dataset.symbol));
  }

  static async #onNewRingLine() {
    const field = this.#symbolField();
    if (!field) return;
    const end = field.value.length;
    const { start = end, end: to = end } = this.#caret ?? {};
    this.#applyEdit(field, insertLineBreak(field.value, start, to));
  }

  /** Набор заменяет содержимое поля целиком. У колец число секторов подгоняется под набор. */
  static async #onPreset(event, target) {
    const preset = SYMBOL_PRESETS.find((p) => p.id === target.dataset.preset);
    const field = this.#symbolField();
    if (!preset || !field) return;
    if (this.type === "rings") {
      const sectors = this.element.querySelector('[name="rgSectors"]');
      if (sectors) sectors.value = preset.symbols.length;
    }
    this.#applyEdit(field, { text: presetText(preset), caret: presetText(preset).length });
    ui.notifications.info(t("editor.symbols.presetApplied"));
  }

  /** Подпись привязки для формы: «Токен: Имя», «Плитка: id», «не привязана», «объект не найден». */
  static #linkLabel(scene, kind, id) {
    if (!kind || !id) return t("editor.access.noLink");
    const info = describeLink(scene, { kind, id });
    const name = info.found ? info.name : t("editor.access.linkMissing");
    return `${t(`editor.access.kind.${kind}`)}: ${name}`;
  }

  /** Записывает привязку прямо в поля формы, не перерисовывая окно (введённое не теряется). */
  #setLink(kind, id, label) {
    const form = this.element;
    form.querySelector('input[name="linkKind"]').value = kind;
    form.querySelector('input[name="linkId"]').value = id;
    form.querySelector('[data-role="link-label"]').textContent = label;
  }

  /** Берёт выбранный на холсте объект. Привязка возможна только к объектам текущей сцены. */
  #takeSelected(kind) {
    if (this.sceneId !== canvas.scene?.id) {
      ui.notifications.warn(t("editor.access.otherScene"));
      return;
    }
    const layer = kind === "token" ? canvas.tokens : canvas.tiles;
    const selected = layer?.controlled ?? [];
    if (selected.length !== 1) {
      ui.notifications.warn(t(`editor.access.select.${kind}`));
      return;
    }
    const doc = selected[0].document;
    this.#setLink(kind, doc.id, `${t(`editor.access.kind.${kind}`)}: ${kind === "token" ? doc.name || doc.id : doc.id}`);
  }

  static async #onLinkToken() {
    this.#takeSelected("token");
  }

  static async #onLinkTile() {
    this.#takeSelected("tile");
  }

  static async #onLinkClear() {
    this.#setLink("", "", t("editor.access.noLink"));
  }

  async _onClose(options) {
    if (this.#key) PuzzleEditor.#open.delete(this.#key);
    return super._onClose(options);
  }

  static async #onSubmit(event, form, formData) {
    const parsed = parseEditorForm({ ...formData.object, type: this.type });
    if (parsed.error) {
      ui.notifications.error(t(`errors.${parsed.error}`));
      return;
    }
    const scene = game.scenes.get(this.sceneId);
    try {
      if (this.puzzleId) {
        await PuzzleEngine.updatePuzzle(scene, this.puzzleId, parsed.input);
        ui.notifications.info(t("editor.saved"));
      } else {
        await PuzzleEngine.createPuzzle(scene, parsed.input);
        ui.notifications.info(t("editor.created"));
      }
      await this.close();
    } catch (err) {
      // Окно остаётся открытым, чтобы мастер исправил ошибку и не потерял введённое.
      ui.notifications.error(err.message);
    }
  }

  static async #onCancel() {
    await this.close();
  }
}
