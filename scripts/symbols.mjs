/**
 * Палитра особых символов для редактора: готовые группы для вставки по одному
 * и наборы, которые заполняют поле целиком. Чистые функции, проверяются обычными тестами.
 *
 * Только символы из основных блоков Юникода (без составных эмодзи): они хранятся
 * как обычный текст и не ломают подсчёт длины подписи. Отрисовка зависит от шрифтов
 * системы игрока; если символ показывается квадратиком, замените его другим.
 */

export const SYMBOL_GROUPS = Object.freeze([
  { id: "sky", symbols: ["☀", "☾", "★", "☆", "✦", "✧", "☄", "☁", "⚡", "❄", "☂", "☽"] },
  { id: "planets", symbols: ["☉", "☽", "☿", "♀", "♁", "♂", "♃", "♄", "♅", "♆", "♇"] },
  { id: "zodiac", symbols: ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"] },
  { id: "runes", symbols: ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ", "ᚺ", "ᚾ", "ᛁ", "ᛃ", "ᛇ", "ᛈ", "ᛉ", "ᛊ", "ᛏ", "ᛒ", "ᛖ", "ᛗ", "ᛚ", "ᛜ", "ᛞ", "ᛟ"] },
  { id: "cards", symbols: ["♠", "♥", "♦", "♣", "♤", "♡", "♢", "♧", "♔", "♕", "♖", "♗", "♘", "♙"] },
  { id: "shapes", symbols: ["●", "○", "■", "□", "▲", "△", "▼", "▽", "◆", "◇", "◉", "◎", "✚", "✖"] },
  { id: "arrows", symbols: ["←", "↑", "→", "↓", "↖", "↗", "↘", "↙", "⟲", "⟳", "⇐", "⇑", "⇒", "⇓"] },
  { id: "magic", symbols: ["⚔", "⚒", "⚓", "⚖", "⚗", "⚜", "☠", "☥", "☯", "☮", "☸", "⚛", "⚕", "✝"] },
  { id: "roman", symbols: ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"] },
  { id: "circled", symbols: ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"] },
  { id: "greek", symbols: ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω"] }
]);

/** Наборы: заполняют поле целиком. Размер не больше 12, чтобы подходили и кольцам. */
export const SYMBOL_PRESETS = Object.freeze([
  { id: "sky8", symbols: ["☀", "☾", "★", "☄", "☁", "⚡", "❄", "✦"] },
  { id: "suits4", symbols: ["♠", "♥", "♦", "♣"] },
  { id: "shapes6", symbols: ["●", "■", "▲", "◆", "★", "✚"] },
  { id: "arrows4", symbols: ["↑", "→", "↓", "←"] },
  { id: "planets7", symbols: ["☉", "☽", "☿", "♀", "♂", "♃", "♄"] },
  { id: "runes8", symbols: ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ"] },
  { id: "greek8", symbols: ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ"] },
  { id: "zodiac12", symbols: ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"] },
  { id: "roman12", symbols: ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"] },
  { id: "circled12", symbols: ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"] }
]);

/** Текст набора для поля: символы через запятую. */
export const presetText = (preset) => preset.symbols.join(", ");

const startsWithBreak = (s) => /^[\s]*[,\n]/.test(s);
const endsWithBreak = (s) => /[,\n][ \t]*$/.test(s);

/**
 * Вставляет символ в текст на место выделения [start, end).
 * Между подписями сам ставит запятую. Возвращает { text, caret }.
 */
export function insertSymbol(text, start, end, symbol) {
  const value = String(text ?? "");
  const from = clamp(start, value.length);
  const to = clamp(end, value.length, from);
  const before = value.slice(0, from);
  const after = value.slice(to);

  const left = before.trim() === "" || endsWithBreak(before) ? "" : ", ";
  const right = after.trim() === "" || startsWithBreak(after) ? "" : ", ";
  const insertion = `${left}${symbol}${right}`;
  return { text: before + insertion + after, caret: before.length + left.length + symbol.length + right.length };
}

/** Вставляет перевод строки (новое кольцо в подписях колец), убирая «висящую» запятую перед ним. */
export function insertLineBreak(text, start, end) {
  const value = String(text ?? "");
  const from = clamp(start, value.length);
  const to = clamp(end, value.length, from);
  const before = value.slice(0, from).replace(/[,\s]+$/, "");
  const after = value.slice(to).replace(/^[,\s]+/, "");
  if (before === "") return { text: value, caret: from };
  return { text: `${before}\n${after}`, caret: before.length + 1 };
}

function clamp(n, max, min = 0) {
  const v = Number.isFinite(n) ? n : max;
  return Math.min(Math.max(v, min), max);
}
