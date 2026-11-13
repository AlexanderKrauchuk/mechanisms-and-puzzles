import { PuzzleMoveError } from "./base.mjs";

export const CHECK_MODES = Object.freeze(["step", "final"]);
export const ERROR_MODES = Object.freeze(["reset", "ignore", "fail"]);

const MAX_SYMBOLS = 16;
const MAX_LENGTH = 32;

/**
 * Последовательность символов.
 *
 * Настройки (публичные):
 *   symbols    список символов { id, label }, которые игрок может нажимать;
 *   length     длина решения (вычисляется из решения);
 *   checkMode  "step": каждое нажатие проверяется сразу;
 *              "final": проверка после ввода всех символов;
 *   errorMode  что делать при ошибке:
 *              "reset"  сбросить введённое;
 *              "ignore" проигнорировать неверное нажатие, прогресс сохраняется
 *                       (только для checkMode "step");
 *              "fail"   засчитать провал (запустятся действия при провале) и сбросить ввод.
 *
 * Секрет: solution, массив id символов в правильном порядке.
 * Состояние: entered (введённые id) и mistakes (число ошибок).
 *
 * Замечание о раскрытии решения: в режиме "step" игрок видит, что нажатие верное,
 * поэтому перебором может подобрать порядок. Это свойство режима, а не ошибка защиты.
 * Если нужно, чтобы перебор был бесполезен, используйте "final" и errorMode "fail".
 */
export const SequencePuzzle = {
  type: "sequence",

  defaults() {
    return {
      symbols: ["☀", "☾", "★", "♦"].map((label, i) => ({ id: `s${i + 1}`, label })),
      checkMode: "step",
      errorMode: "reset"
    };
  },

  validate({ config, solution } = {}) {
    const errors = [];
    const symbols = config?.symbols;
    let ids = [];

    if (!Array.isArray(symbols) || symbols.length < 2 || symbols.length > MAX_SYMBOLS) {
      errors.push("symbolsCount");
    } else {
      ids = symbols.map((s) => String(s?.id ?? "").trim());
      const labels = symbols.map((s) => String(s?.label ?? "").trim());
      if (ids.some((id) => !id) || labels.some((l) => !l)) errors.push("symbolsEmpty");
      if (new Set(ids).size !== ids.length) errors.push("symbolsDuplicate");
    }

    if (!Array.isArray(solution) || solution.length < 1 || solution.length > MAX_LENGTH) {
      errors.push("solutionLength");
    } else if (ids.length && solution.some((id) => !ids.includes(id))) {
      errors.push("solutionUnknown");
    }

    if (!CHECK_MODES.includes(config?.checkMode)) errors.push("checkMode");
    if (!ERROR_MODES.includes(config?.errorMode)) errors.push("errorMode");
    if (config?.checkMode === "final" && config?.errorMode === "ignore") errors.push("finalIgnore");

    return errors;
  },

  build({ config, solution }) {
    const publicConfig = {
      symbols: config.symbols.map((s) => ({ id: String(s.id).trim(), label: String(s.label).trim() })),
      length: solution.length,
      checkMode: config.checkMode,
      errorMode: config.errorMode
    };
    return {
      config: publicConfig,
      state: SequencePuzzle.initialState(publicConfig),
      secret: { solution: [...solution] }
    };
  },

  initialState() {
    return { entered: [], mistakes: 0 };
  },

  /** Тестовая подготовка для мастера: введено всё, кроме последнего символа. */
  nearSolved(_config, secret) {
    return { entered: secret.solution.slice(0, -1), mistakes: 0 };
  },

  applyMove({ config, state, secret, move }) {
    const entered = [...(state?.entered ?? [])];
    const mistakes = state?.mistakes ?? 0;
    const solution = secret?.solution;
    if (!Array.isArray(solution)) throw new PuzzleMoveError("NO_SOLUTION");

    if (move?.action === "clear") {
      return done({ entered: [], mistakes }, "cleared", null);
    }

    if (move?.action !== "press") throw new PuzzleMoveError("UNKNOWN_ACTION");
    if (!config.symbols.some((s) => s.id === move.symbolId)) throw new PuzzleMoveError("UNKNOWN_SYMBOL");

    if (config.checkMode === "step") {
      if (move.symbolId === solution[entered.length]) {
        entered.push(move.symbolId);
        if (entered.length === solution.length) return done({ entered, mistakes }, "solved", "success");
        return done({ entered, mistakes }, "progress", null);
      }
      return mistake({ entered, mistakes }, config.errorMode);
    }

    // Режим "final": проверяем, когда введены все символы.
    entered.push(move.symbolId);
    if (entered.length < solution.length) return done({ entered, mistakes }, "progress", null);
    if (entered.every((id, i) => id === solution[i])) {
      return done({ entered, mistakes }, "solved", "success");
    }
    return mistake({ entered, mistakes }, config.errorMode);
  }
};

function mistake({ entered, mistakes }, errorMode) {
  const next = { entered, mistakes: mistakes + 1 };
  if (errorMode === "ignore") return done(next, "wrong", null);
  next.entered = [];
  if (errorMode === "fail") return done(next, "failed", "failure");
  return done(next, "wrong", null);
}

function done(state, code, outcome) {
  return { state, code, outcome, solved: outcome === "success" };
}
