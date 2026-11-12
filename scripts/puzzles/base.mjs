/**
 * Контракт типа головоломки.
 *
 * Файлы в scripts/puzzles/ не должны обращаться к глобальным объектам Foundry
 * (game, canvas, ui и т.д.): так логику можно проверять обычными тестами Node.
 * Все обращения к Foundry делает движок (engine.mjs) и окна.
 *
 * Тип головоломки это объект со следующими членами:
 *
 *   type: string
 *     Уникальный идентификатор типа, например "sequence".
 *
 *   defaults(): object
 *     Настройки по умолчанию (публичная часть конфигурации).
 *
 *   validate({ config, solution }): string[]
 *     Возвращает список кодов ошибок настройки. Пустой список значит «всё верно».
 *     Коды переводятся через lang/ru.json, раздел errors.setup.
 *
 *   build({ config, solution }): { config, state, secret }
 *     config  публичная конфигурация (уходит всем игрокам, без решения);
 *     state   начальное публичное состояние;
 *     secret  секретные данные (решение), остаются только у мастера.
 *
 *   initialState(config): object
 *     Начальное публичное состояние (нужно для сброса загадки).
 *
 *   applyMove({ config, state, secret, move }): { state, code, outcome, solved }
 *     Применяет ход игрока. Вызывается только на клиенте мастера.
 *     outcome: "success", "failure" или null. code: короткий код для сообщения игроку.
 *     Недопустимый ход: бросает PuzzleMoveError.
 */

/** Ошибка недопустимого хода (неверный формат, неизвестный символ и т.п.). */
export class PuzzleMoveError extends Error {
  constructor(code = "INVALID_MOVE") {
    super(code);
    this.name = "PuzzleMoveError";
    this.code = code;
  }
}

const REQUIRED_MEMBERS = ["type", "defaults", "validate", "build", "initialState", "applyMove"];
const registry = new Map();

export function registerPuzzleType(impl) {
  for (const key of REQUIRED_MEMBERS) {
    if (!(key in impl)) {
      throw new Error(`Тип головоломки "${impl?.type}" не содержит обязательного члена "${key}"`);
    }
  }
  registry.set(impl.type, impl);
}

export function getPuzzleType(type) {
  return registry.get(type) ?? null;
}

export function listPuzzleTypes() {
  return [...registry.keys()];
}
