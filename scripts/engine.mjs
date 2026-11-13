import { MODULE_ID, t } from "./constants.mjs";
import { PuzzleStore } from "./storage.mjs";
import { PuzzleSocket } from "./socket.mjs";
import { getPuzzleType, PuzzleMoveError } from "./puzzles/base.mjs";
import { defaultInteraction, defaultLink, normalizeInteraction, normalizeLink, validateAccess } from "./access.mjs";
import { evaluateAccess } from "./proximity.mjs";

/**
 * Движок загадок. Вся проверка и все изменения состояния происходят здесь,
 * на клиенте активного мастера. Игрок присылает только свой ход.
 */
export class PuzzleEngine {
  static #queue = Promise.resolve();

  /** Ходы выполняются строго по очереди, чтобы два игрока не затёрли состояние друг друга. */
  static #serialize(fn) {
    const run = PuzzleEngine.#queue.then(fn);
    PuzzleEngine.#queue = run.catch(() => {});
    return run;
  }

  /** Подключает обработчики запросов игроков. Вызывается один раз при загрузке. */
  static register() {
    PuzzleSocket.handle("puzzle:move", (payload, userId, meta) => PuzzleEngine.handleMove(payload, userId, meta));
  }

  /**
   * Создаёт загадку на сцене (только мастер).
   * input: { type, name, description, hints, config, solution, interaction?, link? }
   * interaction: { mode: "ui"|"off", maxDistance }, link: { kind: "tile"|"token", id } (см. access.mjs).
   * Возвращает id загадки.
   */
  static async createPuzzle(scene, input) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));

    const impl = getPuzzleType(input?.type);
    if (!impl) throw new Error(t("errors.unknownType"));

    const config = { ...impl.defaults(), ...(input.config ?? {}) };
    const errors = impl.validate({ config, solution: input.solution });
    if (errors.length) {
      const details = errors.map((code) => t(`errors.setup.${code}`)).join("; ");
      throw new Error(`${t("errors.invalidSetup")}: ${details}`);
    }

    const access = PuzzleEngine.#accessInput(input, defaultInteraction(), defaultLink());
    const built = impl.build({ config, solution: input.solution });
    // Пустые значения ("" и 0) вместо null: null внутри flags может удалить ключ.
    const publicData = {
      type: impl.type,
      name: String(input.name ?? "").trim() || t(`types.${impl.type}`),
      description: String(input.description ?? ""),
      hints: Array.isArray(input.hints) ? input.hints.map(String) : [],
      interaction: access.interaction,
      link: access.link,
      config: built.config,
      state: built.state,
      solved: false
    };
    const secretData = { ...built.secret, actions: { success: [], failure: [] } };

    return PuzzleStore.create(scene, { publicData, secretData });
  }

  /** Данные доступа из ввода мастера (или прежние/по умолчанию, если не переданы) с проверкой. */
  static #accessInput(input, fallbackInteraction, fallbackLink) {
    const interaction = input?.interaction ?? fallbackInteraction;
    const link = input?.link ?? fallbackLink;
    const errors = validateAccess({ interaction, link });
    if (errors.length) {
      const details = errors.map((code) => t(`errors.setup.${code}`)).join("; ");
      throw new Error(`${t("errors.invalidSetup")}: ${details}`);
    }
    return {
      interaction: { mode: interaction.mode, maxDistance: interaction.maxDistance },
      link: { kind: link.kind ?? "", id: link.kind ? String(link.id).trim() : "" }
    };
  }

  /**
   * Изменяет загадку (только мастер). Тип менять нельзя. Состояние сбрасывается,
   * действия при исходах сохраняются, а привязка и режим взаимодействия меняются,
   * только если переданы в input.
   */
  static async updatePuzzle(scene, puzzleId, input) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));
    return PuzzleEngine.#serialize(async () => {
      const pub = PuzzleStore.getPublic(puzzleId, scene);
      const secret = PuzzleStore.getSecret(puzzleId);
      if (!pub || !secret) throw new Error(t("errors.noPuzzle"));
      if (input?.type !== pub.type) throw new Error(t("errors.typeLocked"));

      const impl = getPuzzleType(pub.type);
      if (!impl) throw new Error(t("errors.unknownType"));
      const config = { ...impl.defaults(), ...(input.config ?? {}) };
      const errors = impl.validate({ config, solution: input.solution });
      if (errors.length) {
        const details = errors.map((code) => t(`errors.setup.${code}`)).join("; ");
        throw new Error(`${t("errors.invalidSetup")}: ${details}`);
      }

      const access = PuzzleEngine.#accessInput(
        input,
        normalizeInteraction(pub.interaction),
        normalizeLink(pub.link)
      );
      const built = impl.build({ config, solution: input.solution });
      await PuzzleStore.setSecret(puzzleId, { ...built.secret, actions: secret.actions ?? { success: [], failure: [] } });
      await PuzzleStore.patchPublic(scene, puzzleId, {
        name: String(input.name ?? "").trim() || t(`types.${impl.type}`),
        description: String(input.description ?? ""),
        hints: Array.isArray(input.hints) ? input.hints.map(String) : [],
        interaction: access.interaction,
        link: access.link,
        config: built.config,
        state: built.state,
        solved: false
      });
    });
  }

  /** Удаляет загадку (только мастер). */
  static async deletePuzzle(scene, puzzleId) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));
    return PuzzleEngine.#serialize(() => PuzzleStore.remove(scene, puzzleId));
  }

  /** Данные для формы редактирования (только мастер): публичная часть и секрет. */
  static getForEdit(scene, puzzleId) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));
    const pub = PuzzleStore.getPublic(puzzleId, scene);
    const secret = PuzzleStore.getSecret(puzzleId);
    if (!pub || !secret) throw new Error(t("errors.noPuzzle"));
    return { pub, secret };
  }

  /**
   * Тестовая подготовка (только мастер): до решения остаётся один ход.
   * Позволяет проверить успех, не решая загадку целиком.
   */
  static async nearSolve(scene, puzzleId) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));
    return PuzzleEngine.#serialize(async () => {
      const pub = PuzzleStore.getPublic(puzzleId, scene);
      const secret = PuzzleStore.getSecret(puzzleId);
      if (!pub || !secret) throw new Error(t("errors.noPuzzle"));
      const impl = getPuzzleType(pub.type);
      if (!impl?.nearSolved) throw new Error(t("errors.noTestSetup"));
      await PuzzleStore.patchPublic(scene, puzzleId, {
        state: impl.nearSolved(pub.config, secret),
        solved: false
      });
    });
  }

  /** Сбрасывает состояние загадки (только мастер). */
  static async resetPuzzle(scene, puzzleId) {
    if (!game.user.isGM) throw new Error(t("errors.gmOnly"));
    return PuzzleEngine.#serialize(async () => {
      const pub = PuzzleStore.getPublic(puzzleId, scene);
      if (!pub) throw new Error(t("errors.noPuzzle"));
      const impl = getPuzzleType(pub.type);
      if (!impl) throw new Error(t("errors.unknownType"));
      await PuzzleStore.patchPublic(scene, puzzleId, {
        state: impl.initialState(pub.config, PuzzleStore.getSecret(puzzleId)),
        solved: false
      });
    });
  }

  /**
   * Ход игрока. meta.local = true, если запрос сделан на клиенте мастера (не по сокету).
   * Публичный метод нужен тестам и макросам; игрок до него доходит только через сокет.
   */
  static async handleMove(payload, userId, meta = {}) {
    const { sceneId, puzzleId, move } = payload ?? {};
    if (
      typeof sceneId !== "string" ||
      typeof puzzleId !== "string" ||
      typeof move !== "object" ||
      move === null
    ) {
      throw new Error(t("errors.invalidMove"));
    }
    // userId присылает клиент, сервер его не подтверждает. Проверка только отсекает мусор.
    const user = game.users.get(userId);
    if (!user?.active) throw new Error(t("errors.unknownRequest"));

    return PuzzleEngine.#serialize(async () => {
      const scene = game.scenes.get(sceneId);
      const pub = scene ? PuzzleStore.getPublic(puzzleId, scene) : null;
      const secret = pub ? PuzzleStore.getSecret(puzzleId) : null;
      if (!pub || !secret) throw new Error(t("errors.noPuzzle"));

      // Режим взаимодействия и расстояние до привязанного объекта. Код возвращается игроку как есть.
      const access = evaluateAccess(scene, pub, user, { local: meta.local === true });
      if (access.code !== "ok") return { code: access.code, outcome: null, solved: Boolean(pub.solved) };

      if (pub.solved) return { code: "alreadySolved", outcome: null, solved: true };

      const impl = getPuzzleType(pub.type);
      if (!impl) throw new Error(t("errors.unknownType"));

      let result;
      try {
        result = impl.applyMove({ config: pub.config, state: pub.state, secret, move });
      } catch (err) {
        if (err instanceof PuzzleMoveError) throw new Error(t("errors.invalidMove"));
        throw err;
      }

      await PuzzleStore.patchPublic(scene, puzzleId, { state: result.state, solved: result.solved });

      if (result.outcome) {
        // Собственное событие модуля. На этапе 6 на него повесятся действия при успехе и провале.
        Hooks.callAll(`${MODULE_ID}.outcome`, {
          scene,
          puzzleId,
          outcome: result.outcome,
          userId
        });
      }

      // Игроку уходит только код результата, без решения и без секретных данных.
      return { code: result.code, outcome: result.outcome, solved: result.solved };
    });
  }
}
