import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SYMBOL_GROUPS, SYMBOL_PRESETS, presetText, insertSymbol, insertLineBreak } from "../scripts/symbols.mjs";
import { parseEditorForm, previewEditor, defaultEditorValues } from "../scripts/editor-data.mjs";
import { RingsPuzzle } from "../scripts/puzzles/rings.mjs";
import { SequencePuzzle } from "../scripts/puzzles/sequence.mjs";

const lang = JSON.parse(readFileSync(new URL("../lang/ru.json", import.meta.url), "utf8"))["mechanisms-and-puzzles"];

test("insertSymbol: пустое поле, конец, середина, выделение", () => {
  assert.deepEqual(insertSymbol("", 0, 0, "☀"), { text: "☀", caret: 1 });
  assert.deepEqual(insertSymbol("☀", 1, 1, "☾"), { text: "☀, ☾", caret: 4 });
  assert.deepEqual(insertSymbol("☀, ☾", 1, 1, "★"), { text: "☀, ★, ☾", caret: 4 });
  // курсор встаёт после вставленной запятой, готовый к следующему символу
  assert.deepEqual(insertSymbol("☀, ☾, ♦", 3, 6, "★"), { text: "☀, ★, ♦", caret: 6 });
  // после запятой лишнюю не добавляет
  assert.deepEqual(insertSymbol("☀, ", 3, 3, "☾"), { text: "☀, ☾", caret: 4 });
  // после перевода строки (новое кольцо) запятая не нужна
  assert.deepEqual(insertSymbol("☀, ☾\n", 5, 5, "★"), { text: "☀, ☾\n★", caret: 6 });
});

test("insertSymbol: курсор вне текста и мусор в позиции не ломают вставку", () => {
  assert.equal(insertSymbol("☀", 99, 99, "☾").text, "☀, ☾");
  assert.equal(insertSymbol("☀", null, null, "☾").text, "☀, ☾");
  assert.equal(insertSymbol(undefined, 0, 0, "☾").text, "☾");
});

test("insertLineBreak: убирает висящую запятую, в начале ничего не делает", () => {
  assert.deepEqual(insertLineBreak("☀, ☾, ", 6, 6), { text: "☀, ☾\n", caret: 5 });
  assert.deepEqual(insertLineBreak("☀, ☾", 1, 1), { text: "☀\n☾", caret: 2 });
  assert.deepEqual(insertLineBreak("", 0, 0), { text: "", caret: 0 });
});

test("палитра: символы непустые, короткие, без повторов, id уникальны, есть переводы", () => {
  const ids = new Set();
  for (const group of SYMBOL_GROUPS) {
    assert.ok(!ids.has(group.id));
    ids.add(group.id);
    assert.ok(lang.editor.symbols.groups[group.id], `перевод группы ${group.id}`);
    assert.equal(new Set(group.symbols).size, group.symbols.length, group.id);
    for (const s of group.symbols) assert.ok(s.length >= 1 && s.length <= 2, `${group.id}: ${s}`);
  }
  const presetIds = new Set();
  for (const preset of SYMBOL_PRESETS) {
    assert.ok(!presetIds.has(preset.id));
    presetIds.add(preset.id);
    assert.ok(lang.editor.symbols.presetNames[preset.id], `перевод набора ${preset.id}`);
    assert.ok(preset.symbols.length >= 2 && preset.symbols.length <= 12, preset.id);
    assert.equal(new Set(preset.symbols).size, preset.symbols.length, preset.id);
  }
});

test("каждый набор подходит и последовательности, и кольцам (проходит проверку загадок)", () => {
  for (const preset of SYMBOL_PRESETS) {
    const n = preset.symbols.length;

    const seq = parseEditorForm({
      ...defaultEditorValues("sequence"),
      seqSymbols: presetText(preset),
      seqSolution: "1 2"
    }).input;
    assert.deepEqual(SequencePuzzle.validate({ config: { ...SequencePuzzle.defaults(), ...seq.config }, solution: seq.solution }), [], preset.id);

    const ring = parseEditorForm({
      ...defaultEditorValues("rings"),
      rgRings: 2,
      rgSectors: n,
      rgLabels: presetText(preset),
      rgSolution: "1 2"
    }).input;
    assert.deepEqual(RingsPuzzle.validate({ config: { ...RingsPuzzle.defaults(), ...ring.config }, solution: ring.solution }), [], preset.id);
  }
});

test("previewEditor: последовательность показывает нумерацию и решение", () => {
  const p = previewEditor({ ...defaultEditorValues("sequence"), seqSymbols: "☀, ☾, ★", seqSolution: "3 1 9" });
  assert.equal(p.numbering, "1=☀   2=☾   3=★");
  assert.equal(p.solution, "★  →  ☀  →  ?");
});

test("previewEditor: кольца, общие подписи, свои подписи и неполный ввод", () => {
  const same = previewEditor({ ...defaultEditorValues("rings"), rgRings: 2, rgSectors: 3, rgLabels: "ᚠ, ᚢ, ᚦ", rgSolution: "3 1" });
  assert.equal(same.numbering, "1=ᚠ   2=ᚢ   3=ᚦ");
  assert.equal(same.solution, "1: ᚦ   2: ᚠ");

  const own = previewEditor({ ...defaultEditorValues("rings"), rgRings: 2, rgSectors: 2, rgLabels: "a, b\nc, d", rgSolution: "2 1" });
  assert.equal(own.numbering, "");
  assert.equal(own.solution, "1: b   2: c");

  const defaults = previewEditor({ ...defaultEditorValues("rings"), rgRings: 1, rgSectors: 3, rgLabels: "", rgSolution: "2" });
  assert.equal(defaults.solution, "1: 2");

  const broken = previewEditor({ ...defaultEditorValues("rings"), rgRings: "", rgSectors: "x", rgLabels: "a" });
  assert.deepEqual(broken, { numbering: "", solution: "" });
  assert.deepEqual(previewEditor({ type: "sliding" }), { numbering: "", solution: "" });
  assert.deepEqual(previewEditor({ type: "zzz" }), { numbering: "", solution: "" });
});
