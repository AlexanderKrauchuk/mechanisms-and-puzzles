import { PuzzleSocket } from "./socket.mjs";

/**
 * Выполнение действий при успехе и провале. Работает на клиенте мастера.
 * Каждое действие выполняется отдельно: ошибка одного не мешает остальным.
 *
 * Результат: [{ index, type, ok, code? }], code: "tileMissing", "wallMissing", "notADoor", "failed".
 *
 * Не проверено на живом Foundry (см. README): TileDocument#hidden, WallDocument#ds и door,
 * ChatMessage.getWhisperRecipients("GM"), AudioHelper.play(data, true).
 * Подтверждено документацией v13: CONST.WALL_DOOR_STATES (CLOSED 0, OPEN 1, LOCKED 2),
 * CONST.WALL_DOOR_TYPES (NONE 0, DOOR 1, SECRET 2), AudioHelper.play(data, socketOptions).
 */

class ActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const DOOR_STATE_VALUE = {
  open: () => CONST.WALL_DOOR_STATES?.OPEN ?? 1,
  close: () => CONST.WALL_DOOR_STATES?.CLOSED ?? 0,
  lock: () => CONST.WALL_DOOR_STATES?.LOCKED ?? 2,
  unlock: () => CONST.WALL_DOOR_STATES?.CLOSED ?? 0
};

const HANDLERS = {
  async message(action) {
    PuzzleSocket.broadcast("notify", { text: action.text, level: "info" });
  },

  async chat(action, { puzzle }) {
    const data = {
      content: escapeHtml(action.text).replace(/\n/g, "<br>"),
      speaker: { alias: puzzle?.name || "" }
    };
    if (action.audience === "gm") {
      // Документация v13 противоречит себе: возвращает «id пользователей» или «пользователей». Берём и то и другое.
      data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => (typeof u === "string" ? u : u.id));
    }
    await ChatMessage.create(data);
  },

  async tile(action, { scene }) {
    const tile = scene.tiles?.get(action.tileId);
    if (!tile) throw new ActionError("tileMissing");
    const hidden = action.mode === "toggle" ? !tile.hidden : action.mode === "hide";
    await tile.update({ hidden });
  },

  async door(action, { scene }) {
    const wall = scene.walls?.get(action.wallId);
    if (!wall) throw new ActionError("wallMissing");
    if (wall.door === (CONST.WALL_DOOR_TYPES?.NONE ?? 0)) throw new ActionError("notADoor");
    await wall.update({ ds: DOOR_STATE_VALUE[action.state]() });
  },

  async sound(action) {
    // true: проиграть у всех остальных клиентов. У себя звук идёт обычным путём.
    foundry.audio.AudioHelper.play({ src: action.src, volume: action.volume, autoplay: true, loop: false }, true);
  }
};

/**
 * Выполняет список действий по порядку.
 * context: { scene, puzzle } (puzzle нужен для подписи отправителя в чате).
 */
export async function runActions(actions, context) {
  const results = [];
  for (const [index, action] of actions.entries()) {
    const handler = HANDLERS[action?.type];
    try {
      if (!handler) throw new ActionError("failed");
      await handler(action, context);
      results.push({ index, type: action.type, ok: true });
    } catch (err) {
      const code = err instanceof ActionError ? err.code : "failed";
      if (!(err instanceof ActionError)) console.error("mechanisms-and-puzzles | action failed", err);
      results.push({ index, type: action?.type, ok: false, code });
    }
  }
  return results;
}
