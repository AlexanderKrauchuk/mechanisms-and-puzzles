import { MODULE_ID, t } from "./constants.mjs";
import { PuzzleStore } from "./storage.mjs";
import { PuzzleSocket } from "./socket.mjs";
import { getPuzzleType, PuzzleMoveError } from "./puzzles/base.mjs";

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
    PuzzleSocket.handle("puzzle:move", (payload, userId) => PuzzleEngine.#handleMove(payload, userId));
  }

  /**
   * Создаёт загадку на сцене (только мастер).
   * input: { type, name, description, hints, config, solution }
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

    const built = impl.build({ config, solution: input.solution });
    // Пустые значения ("" и 0) вместо null: null внутри flags может удалить ключ.
    const publicData = {
      type: impl.type,
      name: String(input.name ?? "").trim() || t(`types.${impl.type}`),
      description: String(input.description ?? ""),
      hints: Array.isArray(input.hints) ? input.hints.map(String) : [],
      interaction: { mode: "ui", maxDistance: 0 },
      linkedUuid: "",
      config: built.config,
      state: built.state,
      solved: false
    };
    const secretData = { ...built.secret, actions: { success: [], failure: [] } };

    return PuzzleStore.create(scene, { publicData, secretData });
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
        state: impl.initialState(pub.config),
        solved: false
      });
    });
  }

  static async #handleMove(payload, userId) {
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
    if (!game.users.get(userId)?.active) throw new Error(t("errors.unknownRequest"));

    return PuzzleEngine.#serialize(async () => {
      const scene = game.scenes.get(sceneId);
      const pub = scene ? PuzzleStore.getPublic(puzzleId, scene) : null;
      const secret = pub ? PuzzleStore.getSecret(puzzleId) : null;
      if (!pub || !secret) throw new Error(t("errors.noPuzzle"));

      // Точка расширения для этапа 5: проверка расстояния и режима взаимодействия.
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
