/**
 * Действия при успехе и провале загадки. Чистая логика без обращений к Foundry:
 * описание действий, нормализация, проверка и разбор формы редактора.
 *
 * Хранение: в секретах загадки (flags скрытого журнала), потому что текст сообщений
 * и цели действий могут выдать решение. Формат:
 *   actions: { success: [Action, ...], failure: [Action, ...] }
 *
 * Типы действий:
 *   message { text }                          всплывающее сообщение всем игрокам и мастеру
 *   chat    { text, audience: "all"|"gm" }    сообщение в чат (всем или только мастеру)
 *   tile    { tileId, mode: "show"|"hide"|"toggle" }   показать, скрыть, переключить плитку
 *   door    { wallId, state: "open"|"close"|"lock"|"unlock" }  состояние двери (стены-двери)
 *   sound   { src, volume: 0..1 }             звук для всех
 * Запуск макросов в этом этапе не реализован.
 */

export const OUTCOMES = Object.freeze(["success", "failure"]);
export const ACTION_TYPES = Object.freeze(["message", "chat", "tile", "door", "sound"]);
export const TILE_MODES = Object.freeze(["show", "hide", "toggle"]);
export const DOOR_STATES = Object.freeze(["open", "close", "lock", "unlock"]);
export const CHAT_AUDIENCES = Object.freeze(["all", "gm"]);
export const MAX_ACTIONS = 10;
export const MAX_MESSAGE = 500;
export const MAX_CHAT = 2000;
export const MAX_SRC = 500;
export const DEFAULT_VOLUME = 0.8;

export const emptyActions = () => ({ success: [], failure: [] });

/** Новое действие заданного типа с значениями по умолчанию. */
export function defaultAction(type) {
  switch (type) {
    case "message":
      return { type, text: "" };
    case "chat":
      return { type, text: "", audience: "all" };
    case "tile":
      return { type, tileId: "", mode: "show" };
    case "door":
      return { type, wallId: "", state: "open" };
    case "sound":
      return { type, src: "", volume: DEFAULT_VOLUME };
    default:
      return null;
  }
}

const str = (v) => String(v ?? "").trim();
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Приводит одно действие к рабочему виду. Неизвестный тип даёт null. Лишние поля отбрасываются. */
function normalizeAction(raw) {
  const type = raw?.type;
  const base = defaultAction(type);
  if (!base) return null;
  switch (type) {
    case "message":
      return { type, text: str(raw.text) };
    case "chat":
      return { type, text: str(raw.text), audience: pick(raw.audience, CHAT_AUDIENCES, "all") };
    case "tile":
      return { type, tileId: str(raw.tileId), mode: pick(raw.mode, TILE_MODES, "show") };
    case "door":
      return { type, wallId: str(raw.wallId), state: pick(raw.state, DOOR_STATES, "open") };
    case "sound": {
      const volume = Number(raw.volume);
      return { type, src: str(raw.src), volume: Number.isFinite(volume) ? volume : DEFAULT_VOLUME };
    }
  }
  return null;
}

/** Читает сохранённые данные (в том числе старые и неполные), неизвестные действия отбрасывает. */
export function normalizeActions(raw) {
  const result = emptyActions();
  for (const outcome of OUTCOMES) {
    const list = Array.isArray(raw?.[outcome]) ? raw[outcome] : [];
    result[outcome] = list.map(normalizeAction).filter(Boolean);
  }
  return result;
}

/**
 * Проверка действий, которые ввёл мастер. Возвращает список { outcome, index, code }.
 * index с нуля (для показа прибавляйте единицу), для общей ошибки index равен -1.
 */
export function validateActions(actions) {
  const errors = [];
  for (const outcome of OUTCOMES) {
    const list = actions?.[outcome];
    if (!Array.isArray(list)) {
      errors.push({ outcome, index: -1, code: "actionsShape" });
      continue;
    }
    if (list.length > MAX_ACTIONS) errors.push({ outcome, index: -1, code: "tooMany" });
    list.forEach((action, index) => {
      const add = (code) => errors.push({ outcome, index, code });
      if (!ACTION_TYPES.includes(action?.type)) return add("unknownType");
      switch (action.type) {
        case "message":
          if (!str(action.text) || str(action.text).length > MAX_MESSAGE) add("messageText");
          break;
        case "chat":
          if (!str(action.text) || str(action.text).length > MAX_CHAT) add("chatText");
          if (!CHAT_AUDIENCES.includes(action.audience)) add("chatAudience");
          break;
        case "tile":
          if (!str(action.tileId)) add("tileId");
          if (!TILE_MODES.includes(action.mode)) add("tileMode");
          break;
        case "door":
          if (!str(action.wallId)) add("wallId");
          if (!DOOR_STATES.includes(action.state)) add("doorState");
          break;
        case "sound": {
          const src = str(action.src);
          if (!src || src.length > MAX_SRC || /[<>"]/.test(src)) add("soundSrc");
          const v = action.volume;
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) add("soundVolume");
          break;
        }
      }
    });
  }
  return errors;
}

/**
 * Разбор формы редактора действий. Поля называются «success.0.text», «failure.2.volume».
 * Разбор мягкий, без проверки (проверка отдельно): он нужен и для сохранения, и чтобы не терять
 * введённое при добавлении или удалении строки. Громкость в форме в процентах (0-100).
 */
export function parseActionsForm(values) {
  const groups = { success: new Map(), failure: new Map() };
  for (const [key, value] of Object.entries(values ?? {})) {
    const m = /^(success|failure)\.(\d+)\.(\w+)$/.exec(key);
    if (!m) continue;
    const [, outcome, index, field] = m;
    const row = groups[outcome].get(Number(index)) ?? {};
    row[field] = value;
    groups[outcome].set(Number(index), row);
  }

  const result = emptyActions();
  for (const outcome of OUTCOMES) {
    const rows = [...groups[outcome].entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    result[outcome] = rows
      .map((row) => {
        if (!ACTION_TYPES.includes(row.type)) return null;
        const action = { ...defaultAction(row.type) };
        for (const field of Object.keys(action)) {
          if (field === "type" || row[field] === undefined) continue;
          if (field === "volume") {
            const text = String(row.volume).trim();
            action.volume = text === "" ? NaN : Number(text) / 100;
          } else {
            action[field] = String(row[field]);
          }
        }
        return action;
      })
      .filter(Boolean);
  }
  return result;
}

/** Перемещает действие внутри списка на шаг вверх (-1) или вниз (+1). Возвращает новый список. */
export function moveAction(list, index, step) {
  const to = index + step;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/** Громкость для формы: доли в проценты. */
export const volumeToPercent = (volume) => Math.round((Number.isFinite(volume) ? volume : DEFAULT_VOLUME) * 100);
