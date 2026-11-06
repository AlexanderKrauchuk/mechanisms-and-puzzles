export const MODULE_ID = "mechanisms-and-puzzles";

const STORAGE_SETTING = "storageJournalId";
const STORAGE_FLAG = "puzzleStore";
const SCHEMA_VERSION = 1;

let writeQueue = Promise.resolve();

function requireGM() {
  if (!game.user?.isGM) {
    throw new Error(game.i18n.localize("MAP.Errors.GMOnly"));
  }
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function emptyStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    puzzles: []
  };
}

function readStore(document) {
  const value = document.getFlag(MODULE_ID, STORAGE_FLAG);

  if (!value) return emptyStore();

  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(value.puzzles)
  ) {
    throw new Error(game.i18n.localize("MAP.Errors.StorageSchema"));
  }

  return clone(value);
}

function findStorageDocument() {
  const id = game.settings.get(MODULE_ID, STORAGE_SETTING);

  if (id) {
    const document = game.journal.get(id);

    // Не создаём новое пустое хранилище молча, если старое пропало.
    if (!document) {
      throw new Error(game.i18n.localize("MAP.Errors.StorageMissing"));
    }

    return document;
  }

  const matches = game.journal.contents.filter(
    document => document.getFlag(MODULE_ID, STORAGE_FLAG) !== undefined
  );

  if (matches.length > 1) {
    throw new Error(game.i18n.localize("MAP.Errors.MultipleStores"));
  }

  return matches[0] ?? null;
}

function assertPrivate(document) {
  const ownership = document.ownership ?? {};
  const none = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;

  if (
    Object.entries(ownership).some(
      ([, level]) => Number(level) > none
    )
  ) {
    throw new Error(game.i18n.localize("MAP.Errors.StorageNotPrivate"));
  }
}

async function ensureStorageDocument() {
  let document = findStorageDocument();

  if (!document) {
    document = await JournalEntry.create({
      name: game.i18n.localize("MAP.Storage.Name"),
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
      },
      flags: {
        [MODULE_ID]: {
          [STORAGE_FLAG]: emptyStore()
        }
      }
    });

    if (!document) {
      throw new Error(game.i18n.localize("MAP.Errors.StorageCreate"));
    }
  }

  assertPrivate(document);

  if (game.settings.get(MODULE_ID, STORAGE_SETTING) !== document.id) {
    await game.settings.set(
      MODULE_ID,
      STORAGE_SETTING,
      document.id
    );
  }

  return document;
}

function enqueueWrite(operation) {
  const result = writeQueue.then(operation);

  // Ошибка одной операции не должна блокировать последующие.
  writeQueue = result.catch(() => {});

  return result;
}

function timestamp() {
  return new Date().toISOString();
}

function integer(value, min, max, label) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}: требуется целое число от ${min} до ${max}.`);
  }

  return number;
}

function text(value, maxLength, label, required = false) {
  const result = String(value ?? "").trim();

  if (required && !result) {
    throw new Error(`${label}: значение обязательно.`);
  }

  if (result.length > maxLength) {
    throw new Error(`${label}: максимум ${maxLength} символов.`);
  }

  return result;
}

/**
 * Проверяем настройки независимо от HTML-ограничений формы.
 */
function normalizeDraft(draft) {
  const name = text(draft.name, 120, "Название", true);
  const description = text(draft.description, 10000, "Описание");

  const hints = (Array.isArray(draft.hints) ? draft.hints : [])
    .map(value => text(value, 1000, "Подсказка"))
    .filter(Boolean);

  if (hints.length > 20) {
    throw new Error("Допускается не более 20 подсказок.");
  }

  const source = draft.config ?? {};
  let config;

  switch (draft.type) {
    case "sliding": {
      config = {
        size: integer(source.size, 3, 6, "Размер поля")
      };
      break;
    }

    case "rings": {
      const count = integer(source.count, 1, 12, "Количество колец");
      const sectors = integer(source.sectors, 2, 24, "Количество секторов");

      if (
        !Array.isArray(source.targets) ||
        source.targets.length !== count
      ) {
        throw new Error("Укажите правильное положение каждого кольца.");
      }

      config = {
        count,
        sectors,
        targets: source.targets.map(value =>
          integer(value, 0, sectors - 1, "Положение кольца")
        )
      };
      break;
    }

    case "sequence": {
      const symbols = (Array.isArray(source.symbols) ? source.symbols : [])
        .map(value => text(value, 40, "Символ", true));

      if (symbols.length < 2 || symbols.length > 24) {
        throw new Error("Требуется от 2 до 24 символов.");
      }

      if (new Set(symbols).size !== symbols.length) {
        throw new Error("Названия символов должны быть разными.");
      }

      if (
        !Array.isArray(source.solution) ||
        source.solution.length < 1 ||
        source.solution.length > 100
      ) {
        throw new Error("Длина последовательности должна быть от 1 до 100.");
      }

      const errorBehavior = source.errorBehavior;

      if (!["reset", "ignore", "fail-reset"].includes(errorBehavior)) {
        throw new Error("Неизвестное поведение при ошибке.");
      }

      config = {
        symbols,
        solution: source.solution.map(value =>
          integer(value, 0, symbols.length - 1, "Индекс символа")
        ),
        errorBehavior
      };
      break;
    }

    default:
      throw new Error("Неизвестный тип загадки.");
  }

  return {
    name,
    description,
    hints,
    type: draft.type,
    config,
    interaction: {
      mode: "module-list"
    }
  };
}

function slidingSolved(tiles) {
  return tiles.every((value, index) =>
    value === (index + 1) % tiles.length
  );
}

/**
 * Перемешивание только допустимыми ходами из решённого положения.
 * Это гарантирует решаемость, но не равномерную случайную выборку.
 */
function shuffledSliding(size) {
  const tiles = Array.from(
    { length: size * size },
    (_, index) => (index + 1) % (size * size)
  );

  let blank = tiles.length - 1;
  let previousBlank = -1;

  function move() {
    const row = Math.floor(blank / size);
    const col = blank % size;
    const neighbors = [];

    if (row > 0) neighbors.push(blank - size);
    if (row < size - 1) neighbors.push(blank + size);
    if (col > 0) neighbors.push(blank - 1);
    if (col < size - 1) neighbors.push(blank + 1);

    const candidates = neighbors.filter(
      position => position !== previousBlank
    );

    const next = candidates[
      Math.floor(Math.random() * candidates.length)
    ];

    const oldBlank = blank;

    [tiles[blank], tiles[next]] = [tiles[next], tiles[blank]];

    blank = next;
    previousBlank = oldBlank;
  }

  for (let step = 0; step < size * size * 40; step++) {
    move();
  }

  // Начальное поле не должно уже быть решённым.
  if (slidingSolved(tiles)) move();

  return tiles;
}

function initialState(puzzle) {
  const common = {
    status: "idle",
    moves: 0,
    failures: 0,
    solvedAt: null
  };

  switch (puzzle.type) {
    case "sliding":
      return {
        ...common,
        tiles: shuffledSliding(puzzle.config.size)
      };

    case "rings": {
      const positions = Array(puzzle.config.count).fill(0);

      // Если правильная комбинация — все нули,
      // смещаем первое кольцо, чтобы загадка не начиналась решённой.
      if (
        positions.every(
          (value, index) => value === puzzle.config.targets[index]
        )
      ) {
        positions[0] = 1;
      }

      return { ...common, positions };
    }

    case "sequence":
      return {
        ...common,
        progress: 0
      };

    default:
      throw new Error("Неизвестный тип загадки.");
  }
}

export function registerStorage() {
  game.settings.register(MODULE_ID, STORAGE_SETTING, {
    name: "Puzzle storage journal ID",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

export class PuzzleStorage {
  static async list() {
    requireGM();

    const document = findStorageDocument();

    if (!document) return [];

    assertPrivate(document);

    return readStore(document).puzzles;
  }

  static async get(id) {
    const puzzles = await this.list();
    return puzzles.find(puzzle => puzzle.id === id) ?? null;
  }

  static save(draft, id = null, expectedRevision = null) {
    requireGM();

    return enqueueWrite(async () => {
      requireGM();

      const normalized = normalizeDraft(draft);
      const document = await ensureStorageDocument();
      const store = readStore(document);
      const index = store.puzzles.findIndex(puzzle => puzzle.id === id);
      const previous = index >= 0 ? store.puzzles[index] : null;

      if (id && !previous) {
        throw new Error(game.i18n.localize("MAP.Errors.PuzzleMissing"));
      }

      if (
        previous &&
        previous.revision !== expectedRevision
      ) {
        throw new Error(game.i18n.localize("MAP.Errors.EditConflict"));
      }

      const mechanicsChanged = !previous ||
        previous.type !== normalized.type ||
        JSON.stringify(previous.config) !== JSON.stringify(normalized.config);

      const now = timestamp();

      const puzzle = {
        id: previous?.id ?? foundry.utils.randomID(),
        ...normalized,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        state: mechanicsChanged
          ? initialState(normalized)
          : clone(previous.state)
      };

      if (previous) {
        store.puzzles[index] = puzzle;
      } else {
        store.puzzles.push(puzzle);
      }

      store.revision += 1;

      await document.setFlag(MODULE_ID, STORAGE_FLAG, store);

      return clone(puzzle);
    });
  }

  static reset(id) {
    requireGM();

    return enqueueWrite(async () => {
      requireGM();

      const document = await ensureStorageDocument();
      const store = readStore(document);
      const puzzle = store.puzzles.find(entry => entry.id === id);

      if (!puzzle) {
        throw new Error(game.i18n.localize("MAP.Errors.PuzzleMissing"));
      }

      puzzle.state = initialState(puzzle);
      puzzle.revision += 1;
      puzzle.updatedAt = timestamp();
      store.revision += 1;

      await document.setFlag(MODULE_ID, STORAGE_FLAG, store);
    });
  }

  static remove(id) {
    requireGM();

    return enqueueWrite(async () => {
      requireGM();

      const document = await ensureStorageDocument();
      const store = readStore(document);
      const index = store.puzzles.findIndex(entry => entry.id === id);

      if (index < 0) {
        throw new Error(game.i18n.localize("MAP.Errors.PuzzleMissing"));
      }

      store.puzzles.splice(index, 1);
      store.revision += 1;

      await document.setFlag(MODULE_ID, STORAGE_FLAG, store);
    });
  }
}
