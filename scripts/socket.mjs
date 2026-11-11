import { MODULE_ID, SOCKET_NAME, log } from "./constants.mjs";

const REQUEST_TIMEOUT_MS = 10000;

/** Обработчики запросов игроков. Выполняются ТОЛЬКО на клиенте активного мастера. */
const handlers = new Map();
/** Ожидающие ответа запросы на клиенте игрока. */
const pending = new Map();

/**
 * Обмен «игрок → мастер».
 *
 * Игрок отправляет запрос, активный мастер выполняет проверку и применяет результат,
 * затем отвечает. В ответ мастер кладёт только публичные данные.
 *
 * Важно: сообщения сокета получают все клиенты, а не только адресат, поэтому
 * в ответах не должно быть секретов. Поле userId в запросе не подтверждено сервером,
 * его нужно считать подсказкой, а не доказательством личности.
 */
export class PuzzleSocket {
  static register() {
    game.socket.on(SOCKET_NAME, (message) => PuzzleSocket.#onMessage(message));
  }

  /** Регистрирует обработчик типа запроса (работает на клиенте мастера). */
  static handle(type, fn) {
    handlers.set(type, fn);
  }

  /** Отправляет запрос мастеру. Если запрос делает сам мастер, выполняется локально. */
  static async request(type, payload = {}) {
    if (game.user.isGM) return PuzzleSocket.#dispatch(type, payload, game.user.id);

    if (!game.users.activeGM) {
      throw new Error(game.i18n.localize(`${MODULE_ID}.errors.noGM`));
    }

    const requestId = foundry.utils.randomID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(game.i18n.localize(`${MODULE_ID}.errors.timeout`)));
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, reject, timer });
      game.socket.emit(SOCKET_NAME, {
        kind: "request",
        requestId,
        type,
        payload,
        userId: game.user.id
      });
    });
  }

  static async #dispatch(type, payload, userId) {
    const fn = handlers.get(type);
    if (!fn) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.unknownRequest`));
    return fn(payload, userId);
  }

  static async #onMessage(message) {
    log("socket", message);

    if (message?.kind === "request") {
      // Обрабатывает только один мастер, иначе при нескольких мастерах действия задвоятся.
      if (game.user !== game.users.activeGM) return;
      let reply;
      try {
        const result = await PuzzleSocket.#dispatch(message.type, message.payload, message.userId);
        reply = { ok: true, result };
      } catch (err) {
        reply = { ok: false, error: err.message };
      }
      game.socket.emit(SOCKET_NAME, {
        kind: "response",
        requestId: message.requestId,
        targetUserId: message.userId,
        ...reply
      });
      return;
    }

    if (message?.kind === "response") {
      if (message.targetUserId !== game.user.id) return;
      const entry = pending.get(message.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error));
    }
  }
}
