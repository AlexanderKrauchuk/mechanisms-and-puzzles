const MODULE_ID = "mechanisms-and-riddles";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

export class PuzzleActions {
  static async run(actions, context = {}) {
    if (!game.user?.isGM) {
      throw new Error("Действия загадки может выполнять только мастер.");
    }

    if (!Array.isArray(actions)) {
      throw new Error("Список действий должен быть массивом.");
    }

    const results = [];

    for (const action of actions) {
      try {
        await this.#runOne(action, context);
        results.push({ type: action.type, ok: true });
      } catch (error) {
        console.error(`${MODULE_ID} | Ошибка действия`, action, error);

        results.push({
          type: action?.type ?? "unknown",
          ok: false,
          error: error.message ?? String(error)
        });
      }
    }

    return results;
  }

  static async #runOne(action, context) {
    if (!action || typeof action !== "object") {
      throw new Error("Некорректное действие.");
    }

    switch (action.type) {
      case "chat":
        return this.#chat(action, context);

      case "tile":
        return this.#tile(action);

      case "door":
        return this.#door(action);

      case "sound":
        return this.#sound(action);

      case "macro":
        return this.#macro(action, context);

      default:
        throw new Error(`Неизвестный тип действия: ${action.type}`);
    }
  }

  static async #chat(action, context) {
    if (typeof action.content !== "string") {
      throw new Error("Текст сообщения должен быть строкой.");
    }

    const text = action.content
      .replaceAll("{puzzleName}", String(context.puzzleName ?? ""))
      .replaceAll("{outcome}", String(context.outcome ?? ""));

    if (!text.trim()) {
      throw new Error("Сообщение пустое.");
    }

    return ChatMessage.create({
      content: `<p>${escapeHTML(text).replace(/\r?\n/g, "<br>")}</p>`,
      speaker: ChatMessage.getSpeaker()
    });
  }

  static async #resolve(uuid, documentName) {
    if (typeof uuid !== "string" || !uuid.trim()) {
      throw new Error("Не указан UUID документа.");
    }

    const document = await fromUuid(uuid);

    if (!document || document.documentName !== documentName) {
      throw new Error(`UUID должен указывать на документ ${documentName}.`);
    }

    return document;
  }

  static async #tile(action) {
    if (typeof action.visible !== "boolean") {
      throw new Error("Укажите visible: true или false.");
    }

    const tile = await this.#resolve(action.uuid, "Tile");
    await tile.update({ hidden: !action.visible });
  }

  static async #door(action) {
    const wall = await this.#resolve(action.uuid, "Wall");

    if (wall.door === CONST.WALL_DOOR_TYPES.NONE) {
      throw new Error("Указанная стена не является дверью.");
    }

    if (typeof action.open !== "boolean") {
      throw new Error("Укажите open: true или false.");
    }

    // Прямое изменение мастером, а не имитация щелчка игрока.
    // Открытие таким способом также снимает состояние LOCKED.
    const state = action.open
      ? CONST.WALL_DOOR_STATES.OPEN
      : CONST.WALL_DOOR_STATES.CLOSED;

    await wall.update({ ds: state });
  }

  static async #sound(action) {
    if (typeof action.src !== "string" || !action.src.trim()) {
      throw new Error("Не указан путь к звуку.");
    }

    const volume = action.volume ?? 0.8;

    if (
      typeof volume !== "number"
      || !Number.isFinite(volume)
      || volume < 0
      || volume > 1
    ) {
      throw new Error("Громкость должна быть числом от 0 до 1.");
    }

    const helper = foundry.audio?.AudioHelper;

    if (typeof helper?.play !== "function") {
      throw new Error("API воспроизведения звука недоступно.");
    }

    await helper.play(
      {
        src: action.src,
        volume,
        autoplay: true,
        loop: false
      },
      true
    );
  }

  static async #macro(action, context) {
    if (!game.settings.get(MODULE_ID, "allowMacroActions")) {
      throw new Error("Выполнение макросов отключено в настройках.");
    }

    const macro = await this.#resolve(action.uuid, "Macro");

    // Не запускаем напрямую макросы из компендиумов.
    if (macro.pack) {
      throw new Error("Сначала импортируйте макрос в мир.");
    }

    if (macro.type !== "script") {
      throw new Error("Для этого действия требуется скриптовый макрос.");
    }

    return macro.execute({
      puzzleId: String(context.puzzleId ?? ""),
      puzzleName: String(context.puzzleName ?? ""),
      outcome: String(context.outcome ?? "")
    });
  }
}
      .replaceAll("{puzzleName}", String(context.puzzleName ?? ""))
      .replaceAll("{outcome}", String(context.outcome ?? ""));
  }
}
