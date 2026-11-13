import { PuzzleMoveError } from "./base.mjs";

export const CHECK_MODES = Object.freeze(["auto", "confirm"]);

const MIN_RINGS = 1;
const MAX_RINGS = 5;
const MIN_SECTORS = 2;
const MAX_SECTORS = 12;
const MAX_LABEL_LENGTH = 6;

/**
 * Поворотные кольца.
 *
 * Модель. У каждого кольца sectors секторов. Сверху (у «указателя») виден один сектор.
 * Положение кольца это целое число 0..sectors-1: какая подпись сейчас у указателя.
 * Подпись сектора j (j = 0 это сектор у указателя, дальше по часовой стрелке)
 * равна labels[(j + положение) % sectors].
 *
 * Поворот влево (против часовой стрелки) увеличивает положение на 1, вправо уменьшает на 1.
 *
 * Настройки (публичные):
 *   rings        число колец;
 *   sectors      число секторов в каждом кольце;
 *   labels       подписи секторов для каждого кольца (массив массивов длиной sectors);
 *   checkMode    "auto": комбинация проверяется после каждого поворота;
 *                "confirm": игрок нажимает «Проверить»;
 *   failOnWrong  только для "confirm": неверная проверка засчитывается как провал.
 *
 * Секрет: solution, массив положений колец (по одному числу на кольцо).
 * Состояние: positions, moves (повороты) и attempts (число проверок, только для "confirm").
 *
 * Замечание о раскрытии решения. В режиме "auto" игрок узнаёт только то, что комбинация
 * подошла, но при малом числе вариантов её можно подобрать перебором. Решение не раскрывается
 * частично: промежуточной обратной связи нет. Для защиты от перебора используйте "confirm"
 * с failOnWrong.
 */
export const RingsPuzzle = {
  type: "rings",

  defaults() {
    return { rings: 3, sectors: 6, labels: null, checkMode: "auto", failOnWrong: false };
  },

  validate({ config, solution } = {}) {
    const errors = [];
    const rings = config?.rings;
    const sectors = config?.sectors;
    const ringsOk = Number.isInteger(rings) && rings >= MIN_RINGS && rings <= MAX_RINGS;
    const sectorsOk = Number.isInteger(sectors) && sectors >= MIN_SECTORS && sectors <= MAX_SECTORS;
    if (!ringsOk) errors.push("ringsCount");
    if (!sectorsOk) errors.push("sectorsCount");

    if (ringsOk && sectorsOk && config.labels != null) {
      const labels = normalizeLabels(config.labels, rings, sectors);
      if (!labels) errors.push("labelsShape");
      else if (labels.some((ring) => ring.some((l) => !l || l.length > MAX_LABEL_LENGTH))) {
        errors.push("labelsContent");
      }
    }

    if (ringsOk && sectorsOk) {
      const valid =
        Array.isArray(solution) &&
        solution.length === rings &&
        solution.every((p) => Number.isInteger(p) && p >= 0 && p < sectors);
      if (!valid) errors.push("ringsSolution");
    }

    if (!CHECK_MODES.includes(config?.checkMode)) errors.push("ringsCheckMode");
    if (config?.failOnWrong && config?.checkMode === "auto") errors.push("failAuto");
    return errors;
  },

  build({ config, solution }) {
    const labels = normalizeLabels(config.labels, config.rings, config.sectors) ?? defaultLabels(config.rings, config.sectors);
    const publicConfig = {
      rings: config.rings,
      sectors: config.sectors,
      labels,
      checkMode: config.checkMode,
      failOnWrong: Boolean(config.failOnWrong)
    };
    const secret = { solution: [...solution] };
    return { config: publicConfig, state: RingsPuzzle.initialState(publicConfig, secret), secret };
  },

  /**
   * Случайные положения колец, не совпадающие с решением.
   * Без секрета (решение неизвестно) просто случайные. rng нужен тестам.
   */
  initialState(config, secret, rng = Math.random) {
    const solution = secret?.solution;
    let positions;
    do {
      positions = Array.from({ length: config.rings }, () => Math.floor(rng() * config.sectors));
    } while (solution && sameArray(positions, solution));
    return { positions, moves: 0, attempts: 0 };
  },

  /** Тестовая подготовка для мастера: все кольца на месте, кроме первого (он сдвинут на один сектор). */
  nearSolved(config, secret) {
    const positions = [...secret.solution];
    positions[0] = (positions[0] + 1) % config.sectors;
    return { positions, moves: 0, attempts: 0 };
  },

  applyMove({ config, state, secret, move }) {
    const solution = secret?.solution;
    if (!Array.isArray(solution)) throw new PuzzleMoveError("NO_SOLUTION");
    const positions = [...state.positions];
    const base = { moves: state.moves ?? 0, attempts: state.attempts ?? 0 };

    if (move?.action === "rotate") {
      if (!Number.isInteger(move.ring) || move.ring < 0 || move.ring >= config.rings) {
        throw new PuzzleMoveError("BAD_RING");
      }
      if (move.direction !== 1 && move.direction !== -1) throw new PuzzleMoveError("BAD_DIRECTION");
      positions[move.ring] = (positions[move.ring] + move.direction + config.sectors) % config.sectors;
      const next = { positions, moves: base.moves + 1, attempts: base.attempts };
      if (config.checkMode === "auto" && sameArray(positions, solution)) {
        return { state: next, code: "solved", outcome: "success", solved: true };
      }
      return { state: next, code: "rotated", outcome: null, solved: false };
    }

    if (move?.action === "check") {
      if (config.checkMode !== "confirm") throw new PuzzleMoveError("NO_CONFIRM");
      const next = { positions, moves: base.moves, attempts: base.attempts + 1 };
      if (sameArray(positions, solution)) return { state: next, code: "solved", outcome: "success", solved: true };
      if (config.failOnWrong) return { state: next, code: "failed", outcome: "failure", solved: false };
      return { state: next, code: "wrong", outcome: null, solved: false };
    }

    throw new PuzzleMoveError("UNKNOWN_ACTION");
  }
};

function sameArray(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Подписи по умолчанию: числа 1..sectors на каждом кольце. */
export function defaultLabels(rings, sectors) {
  return Array.from({ length: rings }, () => Array.from({ length: sectors }, (_, i) => String(i + 1)));
}

/**
 * Приводит подписи к виду «массив массивов строк» (rings × sectors).
 * Принимает null (подписи по умолчанию), один массив строк (общий для всех колец)
 * или массив массивов (свой для каждого кольца). Неверная форма даёт null.
 */
export function normalizeLabels(labels, rings, sectors) {
  if (labels == null) return defaultLabels(rings, sectors);
  if (!Array.isArray(labels)) return null;
  const clean = (arr) => arr.map((l) => String(l ?? "").trim());
  if (labels.every((l) => !Array.isArray(l))) {
    return labels.length === sectors ? Array.from({ length: rings }, () => clean(labels)) : null;
  }
  if (labels.length === rings && labels.every((r) => Array.isArray(r) && r.length === sectors)) {
    return labels.map(clean);
  }
  return null;
}

/**
 * Размер шрифта подписей (в единицах SVG), чтобы подписи помещались в секторы
 * самого внутреннего кольца. Очень длинные подписи при большом числе колец и секторов
 * всё равно могут не поместиться: в таком случае уменьшите число секторов или колец.
 */
export function ringLabelSize({ rings, sectors, labels }, { size = 300, hole = 0.18 } = {}) {
  const outer = size / 2 - 4;
  const inner = outer * hole;
  const band = (outer - inner) / rings;
  const innerMid = inner + band / 2;
  const arc = ((Math.PI * 2 * innerMid) / sectors) * 0.9;
  const longest = Math.max(1, ...labels.flat().map((l) => l.length));
  const fit = Math.min(band * 0.55, arc / (longest * 0.62));
  return Math.round(Math.max(7, Math.min(20, fit)) * 10) / 10;
}

/**
 * Геометрия для отрисовки колец в SVG (чистая функция, чтобы её можно было проверить без Foundry).
 *
 * Возвращает кольца от внешнего к внутреннему. У каждого кольца список секторов:
 * путь контура (d), позиция подписи (x, y) и признак сектора под указателем (pointer).
 * Сектор 0 расположен сверху, остальные идут по часовой стрелке.
 */
export function ringGeometry({ rings, sectors, labels, positions }, { size = 300, hole = 0.18, gap = 0.012 } = {}) {
  const center = size / 2;
  const outer = size / 2 - 4;
  const inner = outer * hole;
  const band = (outer - inner) / rings;
  const step = (Math.PI * 2) / sectors;
  const point = (r, a) => [center + r * Math.cos(a), center + r * Math.sin(a)];
  const fmt = (n) => Math.round(n * 100) / 100;

  return Array.from({ length: rings }, (_, ring) => {
    const rOuter = outer - ring * band - 1;
    const rInner = outer - (ring + 1) * band + 1;
    const rMid = (rOuter + rInner) / 2;
    const sectorsData = Array.from({ length: sectors }, (_, j) => {
      const mid = -Math.PI / 2 + j * step;
      const a0 = mid - step / 2 + gap;
      const a1 = mid + step / 2 - gap;
      const [x0, y0] = point(rOuter, a0);
      const [x1, y1] = point(rOuter, a1);
      const [x2, y2] = point(rInner, a1);
      const [x3, y3] = point(rInner, a0);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d =
        `M ${fmt(x0)} ${fmt(y0)} A ${fmt(rOuter)} ${fmt(rOuter)} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)} ` +
        `L ${fmt(x2)} ${fmt(y2)} A ${fmt(rInner)} ${fmt(rInner)} 0 ${large} 0 ${fmt(x3)} ${fmt(y3)} Z`;
      const [lx, ly] = point(rMid, mid);
      return {
        d,
        x: fmt(lx),
        y: fmt(ly),
        label: labels[ring][(j + positions[ring]) % sectors],
        pointer: j === 0
      };
    });
    return { ring, sectors: sectorsData };
  });
}
