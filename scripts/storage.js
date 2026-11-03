const MODULE_ID = "mechanisms-and-riddles";
const DATA_FLAG = "puzzleJSON";
const TYPES = new Set(["sliding", "rings", "sequence"]);

export class PuzzleStorage {
  static #requireGM() {
    if (!game.user?.isGM) {
      throw new Error("Управлять загадками может только мастер.");
    }
  }

  static #read(entry) {
    const json = entry.getFlag(MODULE_ID, DATA_FLAG);

    if (typeof json === "string") {
      try {
        const puzzle = JSON.parse(json);

        if (!puzzle || typeof puzzle !== "object" || Array.isArray(puzzle)) {
          throw new Error("Ожидался объект загадки.");
        }

        return puzzle;
      } catch (error) {
        console.error(
          `${MODULE_ID} | Повреждены данные записи ${entry.id}`,
          error
        );
        return null;
      }
    }

    // Совместимость с записями предыдущего этапа.
    const legacy = entry.getFlag(MODULE_ID, "puzzle");

    return legacy && typeof legacy === "object"
      ? foundry.utils.deepClone(legacy)
      : null;
  }

  static #validate(puzzle) {
    if (typeof puzzle.name !== "string" || !puzzle.name.trim()) {
      throw new Error("У загадки должно быть название.");
    }

    if (!TYPES.has(puzzle.type)) {
      throw new Error("Неизвестный тип загадки.");
    }

    if (typeof puzzle.description !== "string") {
      throw new Error("Описание должно быть строкой.");
    }

    if (!puzzle.config || typeof puzzle.config !== "object"
        || Array.isArray(puzzle.config)) {
      throw new Error("Некорректная конфигурация загадки.");
    }

    puzzle.name = puzzle.name.trim();
  }

  static list() {
    this.#requireGM();

    return game.journal.contents
      .map((entry) => {
        const puzzle = this.#read(entry);
        return puzzle ? { ...puzzle, id: entry.id } : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
  }

  static get(id) {
    this.#requireGM();

    const entry = game.journal.get(id);
    if (!entry) return null;

    const puzzle = this.#read(entry);
    return puzzle ? { ...puzzle, id: entry.id } : null;
  }

  static async create({ name, type, description = "" }) {
    this.#requireGM();

    const puzzle = {
      schemaVersion: 1,
      name,
      type,
      description,
      hints: [],
      config: {},
      state: {
        solved: false,
        data: {}
      },
      actions: {
        success: [],
        failure: []
      },
      createdAt: new Date().toISOString()
    };

    this.#validate(puzzle);

    const entry = await JournalEntry.create({
      name: puzzle.name,
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
      },
      flags: {
        [MODULE_ID]: {
          [DATA_FLAG]: JSON.stringify(puzzle)
        }
      }
    });

    return { ...puzzle, id: entry.id };
  }

  static async update(id, changes) {
    this.#requireGM();

    const entry = game.journal.get(id);
    const current = entry ? this.#read(entry) : null;

    if (!entry || !current) {
      throw new Error("Загадка не найдена.");
    }

    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new Error("Некорректные изменения.");
    }

    // Вложенные поля заменяются целиком, а не сливаются.
    const next = {
      ...current,
      ...foundry.utils.deepClone(changes)
    };

    delete next.id;
    this.#validate(next);

    const update = {
      name: next.name,
      [`flags.${MODULE_ID}.${DATA_FLAG}`]: JSON.stringify(next)
    };

    // Удаляем старую копию данных при первом сохранении.
    if (entry.getFlag(MODULE_ID, "puzzle") !== undefined) {
      update[`flags.${MODULE_ID}.-=puzzle`] = null;
    }

    await entry.update(update);

    return { ...next, id: entry.id };
  }

  static async reset(id) {
    return this.update(id, {
      state: {
        solved: false,
        data: {}
      }
    });
  }

  static async delete(id) {
    this.#requireGM();

    const entry = game.journal.get(id);

    if (!entry || !this.#read(entry)) {
      throw new Error("Загадка не найдена.");
    }

    await entry.delete();
  }
}
