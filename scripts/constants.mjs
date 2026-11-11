export const MODULE_ID = "mechanisms-and-puzzles";

// Имя канала сокета для модуля. Формат "module.<id>" требуется Foundry,
// а в module.json должно стоять "socket": true.
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const PUZZLE_TYPES = Object.freeze({
  SLIDING: "sliding",
  RINGS: "rings",
  SEQUENCE: "sequence"
});

export const FLAGS = Object.freeze({
  // Публичные данные загадок лежат во flags сцены.
  PUBLIC: "puzzles",
  // Секреты (решение, действия) лежат во flags скрытого журнала.
  SECRETS: "secrets",
  SECRET_STORE: "isSecretStore"
});

export function log(...args) {
  if (game.settings?.get(MODULE_ID, "debug")) console.log(`${MODULE_ID} |`, ...args);
}
