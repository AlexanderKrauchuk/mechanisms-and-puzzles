import { MODULE_ID, FLAGS } from "./constants.mjs";

/**
 * Хранилище загадок.
 *
 * Публичные данные (название, описание, подсказки, тип, размеры, текущее состояние)
 * лежат во flags сцены: их получают все клиенты, они нужны для отрисовки.
 *
 * Секретные данные (правильное решение, действия при успехе и провале) лежат
 * во flags отдельного журнала с правами NONE для игроков. Рассчитываем, что сервер
 * не отдаёт игрокам документы без прав, но это нужно проверить (см. verifySecrecy()).
 *
 * Все изменения делает только клиент мастера.
 */
export class PuzzleStore {
  static #assertGM() {
    if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));
  }

  // ---------- Публичные данные ----------

  static listPublic(scene = canvas.scene) {
    return foundry.utils.deepClone(scene?.getFlag(MODULE_ID, FLAGS.PUBLIC) ?? {});
  }

  static getPublic(puzzleId, scene = canvas.scene) {
    return this.listPublic(scene)[puzzleId] ?? null;
  }

  static async setPublic(scene, puzzleId, data) {
    this.#assertGM();
    // update() объединяет вложенные объекты с существующими. Поэтому схема данных
    // не должна полагаться на удаление ключей внутри объектов (массивы заменяются целиком).
    return scene.update({ [`flags.${MODULE_ID}.${FLAGS.PUBLIC}.${puzzleId}`]: data });
  }

  static async deletePublic(scene, puzzleId) {
    this.#assertGM();
    return scene.update({ [`flags.${MODULE_ID}.${FLAGS.PUBLIC}.-=${puzzleId}`]: null });
  }

  // ---------- Секретные данные ----------

  static get secretStore() {
    return game.journal.find((j) => j.getFlag(MODULE_ID, FLAGS.SECRET_STORE)) ?? null;
  }

  /** Создаёт скрытый журнал, если его ещё нет. Вызывается мастером при загрузке мира. */
  static async ensureSecretStore() {
    this.#assertGM();
    if (this.secretStore) return this.secretStore;
    return JournalEntry.create({
      name: "[Механизмы и загадки] Служебное хранилище",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { [FLAGS.SECRET_STORE]: true, [FLAGS.SECRETS]: {} } }
    });
  }

  static getSecret(puzzleId) {
    this.#assertGM();
    return foundry.utils.deepClone(
      this.secretStore?.getFlag(MODULE_ID, FLAGS.SECRETS)?.[puzzleId] ?? null
    );
  }

  static async setSecret(puzzleId, data) {
    this.#assertGM();
    const store = await this.ensureSecretStore();
    return store.update({ [`flags.${MODULE_ID}.${FLAGS.SECRETS}.${puzzleId}`]: data });
  }

  static async deleteSecret(puzzleId) {
    this.#assertGM();
    const store = this.secretStore;
    if (!store) return;
    return store.update({ [`flags.${MODULE_ID}.${FLAGS.SECRETS}.-=${puzzleId}`]: null });
  }

  // ---------- Высокоуровневые операции ----------

  /** Создаёт загадку: публичная часть идёт на сцену, секретная в скрытый журнал. */
  static async create(scene, { publicData, secretData }) {
    this.#assertGM();
    const id = foundry.utils.randomID();
    await this.setSecret(id, secretData);
    await this.setPublic(scene, id, { ...publicData, id });
    return id;
  }

  static async remove(scene, puzzleId) {
    this.#assertGM();
    await this.deletePublic(scene, puzzleId);
    await this.deleteSecret(puzzleId);
  }

  /**
   * Диагностика для мастера. Запустите на клиенте ИГРОКА в консоли:
   *   game.modules.get("mechanisms-and-puzzles").api.verifySecrecy()
   * Если вернулось true, игрок видит документ с секретами, и решение утекает.
   */
  static verifySecrecy() {
    const store = game.journal.find((j) => j.getFlag(MODULE_ID, FLAGS.SECRET_STORE));
    return Boolean(store);
  }
}
