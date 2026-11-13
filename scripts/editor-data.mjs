/**
 * Преобразование данных формы редактора в описание загадки и обратно.
 * Чистые функции без обращений к Foundry, поэтому проверяются обычными тестами.
 *
 * Поля формы (плоский объект):
 *   type, name, description, hints (по одной подсказке в строке),
 *   interactionMode ("ui"|"off"), maxDistance, linkKind ("", "tile", "token"), linkId,
 *   seqSymbols, seqSolution, seqCheckMode, seqErrorMode,
 *   slRows, slCols,
 *   rgRings, rgSectors, rgLabels, rgSolution, rgCheckMode, rgFailOnWrong
 *
 * Решения в форме записываются номерами с единицы:
 *   - последовательность: номера символов из списка в порядке нажатия ("1 3 2");
 *   - кольца: для каждого кольца номер подписи, которая должна оказаться у указателя.
 */

const TOKEN_SPLIT = /[\s,;]+/;
const LABEL_SPLIT = /[,\n]+/;

const tokens = (text) => String(text ?? "").split(TOKEN_SPLIT).map((s) => s.trim()).filter(Boolean);
const toInt = (value) => (String(value ?? "").trim() === "" ? NaN : Number(value));

/** Разбирает форму. Возвращает { input } для engine.createPuzzle или { error: "код" }. */
export function parseEditorForm(values) {
  const type = String(values?.type ?? "");
  const base = {
    type,
    name: String(values?.name ?? "").trim(),
    description: String(values?.description ?? "").trim(),
    hints: String(values?.hints ?? "")
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean),
    interaction: { mode: String(values?.interactionMode ?? "ui"), maxDistance: String(values?.maxDistance ?? "").trim() === "" ? 0 : toInt(values.maxDistance) },
    link: { kind: String(values?.linkKind ?? ""), id: String(values?.linkId ?? "").trim() }
  };

  if (type === "sequence") {
    const labels = String(values.seqSymbols ?? "")
      .split(LABEL_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean);
    const symbols = labels.map((label, i) => ({ id: `s${i + 1}`, label }));
    const solution = tokens(values.seqSolution).map((t) => {
      const n = Number(t);
      return Number.isInteger(n) && n >= 1 && n <= symbols.length ? `s${n}` : `?${t}`;
    });
    return {
      input: {
        ...base,
        config: { symbols, checkMode: values.seqCheckMode, errorMode: values.seqErrorMode },
        solution
      }
    };
  }

  if (type === "sliding") {
    return { input: { ...base, config: { rows: toInt(values.slRows), cols: toInt(values.slCols) } } };
  }

  if (type === "rings") {
    const rings = toInt(values.rgRings);
    const sectors = toInt(values.rgSectors);
    const lines = String(values.rgLabels ?? "")
      .split("\n")
      .map((l) => l.split(LABEL_SPLIT).map((s) => s.trim()).filter(Boolean))
      .filter((l) => l.length);
    let labels = null;
    if (lines.length === 1) labels = lines[0];
    else if (lines.length > 1) labels = lines;
    const solution = tokens(values.rgSolution).map((t) => Number(t) - 1);
    return {
      input: {
        ...base,
        config: {
          rings,
          sectors,
          labels,
          checkMode: values.rgCheckMode,
          failOnWrong: Boolean(values.rgFailOnWrong)
        },
        solution
      }
    };
  }

  return { error: "unknownType" };
}

/** Значения формы для существующей загадки (нужны публичные данные и секрет, то есть только мастеру). */
export function toEditorValues(pub, secret) {
  const values = {
    type: pub.type,
    name: pub.name ?? "",
    description: pub.description ?? "",
    hints: (pub.hints ?? []).join("\n"),
    interactionMode: pub.interaction?.mode === "off" ? "off" : "ui",
    maxDistance: Number(pub.interaction?.maxDistance) > 0 ? Number(pub.interaction.maxDistance) : 0,
    linkKind: pub.link?.kind ?? "",
    linkId: pub.link?.id ?? ""
  };

  if (pub.type === "sequence") {
    const ids = pub.config.symbols.map((s) => s.id);
    values.seqSymbols = pub.config.symbols.map((s) => s.label).join(", ");
    values.seqSolution = (secret?.solution ?? []).map((id) => ids.indexOf(id) + 1).join(" ");
    values.seqCheckMode = pub.config.checkMode;
    values.seqErrorMode = pub.config.errorMode;
  } else if (pub.type === "sliding") {
    values.slRows = pub.config.rows;
    values.slCols = pub.config.cols;
  } else if (pub.type === "rings") {
    const labels = pub.config.labels;
    const same = labels.every((ring) => ring.join("|") === labels[0].join("|"));
    values.rgRings = pub.config.rings;
    values.rgSectors = pub.config.sectors;
    values.rgLabels = same ? labels[0].join(", ") : labels.map((ring) => ring.join(", ")).join("\n");
    values.rgSolution = (secret?.solution ?? []).map((p) => p + 1).join(" ");
    values.rgCheckMode = pub.config.checkMode;
    values.rgFailOnWrong = Boolean(pub.config.failOnWrong);
  }
  return values;
}

/**
 * Решение загадки по-человечески, строками (только мастеру: нужен секрет).
 * Возвращает null, если у загадки нет секретного решения (пятнашки).
 */
export function describeSolution(pub, secret) {
  if (pub.type === "sequence" && Array.isArray(secret?.solution)) {
    const labels = new Map(pub.config.symbols.map((s) => [s.id, s.label]));
    return [secret.solution.map((id) => labels.get(id) ?? "?").join("  →  ")];
  }
  if (pub.type === "rings" && Array.isArray(secret?.solution)) {
    return secret.solution.map((pos, ring) => `${ring + 1}: ${pub.config.labels[ring][pos]}`);
  }
  return null;
}

/** Значения формы для новой загадки заданного типа. */
export function defaultEditorValues(type = "sequence") {
  return {
    type,
    name: "",
    description: "",
    hints: "",
    interactionMode: "ui",
    maxDistance: 0,
    linkKind: "",
    linkId: "",
    seqSymbols: "☀, ☾, ★, ♦",
    seqSolution: "1 3 2",
    seqCheckMode: "step",
    seqErrorMode: "reset",
    slRows: 3,
    slCols: 3,
    rgRings: 3,
    rgSectors: 6,
    rgLabels: "",
    rgSolution: "1 1 1",
    rgCheckMode: "auto",
    rgFailOnWrong: false
  };
}
