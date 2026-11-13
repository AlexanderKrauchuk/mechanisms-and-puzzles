import test from "node:test";
import assert from "node:assert/strict";
import { parseEditorForm, toEditorValues, defaultEditorValues, describeSolution } from "../scripts/editor-data.mjs";
import { SequencePuzzle } from "../scripts/puzzles/sequence.mjs";
import { SlidingPuzzle } from "../scripts/puzzles/sliding.mjs";
import { RingsPuzzle } from "../scripts/puzzles/rings.mjs";

const TYPES = { sequence: SequencePuzzle, sliding: SlidingPuzzle, rings: RingsPuzzle };

/** Форма -> input -> валидация -> build, как делает движок. */
function pipeline(values) {
  const parsed = parseEditorForm(values);
  if (parsed.error) return parsed;
  const impl = TYPES[parsed.input.type];
  const config = { ...impl.defaults(), ...parsed.input.config };
  const errors = impl.validate({ config, solution: parsed.input.solution });
  return { parsed, impl, config, errors, built: errors.length ? null : impl.build({ config, solution: parsed.input.solution }) };
}

test("значения формы по умолчанию проходят валидацию для всех типов", () => {
  for (const type of Object.keys(TYPES)) {
    const result = pipeline(defaultEditorValues(type));
    assert.deepEqual(result.errors, [], type);
  }
});

test("последовательность: символы и порядок разбираются из текста", () => {
  const values = { ...defaultEditorValues("sequence"), seqSymbols: "А, Б,В\nГ", seqSolution: "3, 1;4 2" };
  const { parsed, errors } = pipeline(values);
  assert.deepEqual(errors, []);
  assert.deepEqual(parsed.input.config.symbols.map((s) => s.label), ["А", "Б", "В", "Г"]);
  assert.deepEqual(parsed.input.solution, ["s3", "s1", "s4", "s2"]);
});

test("последовательность: неверный номер в решении даёт ошибку, а не молчаливый пропуск", () => {
  for (const solution of ["1 9", "0", "a b", "1.5"]) {
    const { errors } = pipeline({ ...defaultEditorValues("sequence"), seqSolution: solution });
    assert.ok(errors.includes("solutionUnknown"), solution);
  }
  const { errors } = pipeline({ ...defaultEditorValues("sequence"), seqSolution: "" });
  assert.ok(errors.includes("solutionLength"));
});

test("пятнашки: размеры из формы, пустое поле даёт ошибку размера", () => {
  const ok = pipeline({ ...defaultEditorValues("sliding"), slRows: 3, slCols: "4" });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.built.config, { rows: 3, cols: 4 });
  for (const bad of ["", "abc", 1, 7]) {
    assert.deepEqual(pipeline({ ...defaultEditorValues("sliding"), slRows: bad }).errors, ["boardSize"], String(bad));
  }
});

test("кольца: решение с единицы переводится в положения с нуля", () => {
  const values = { ...defaultEditorValues("rings"), rgRings: 3, rgSectors: 6, rgSolution: "3 1 6" };
  const { parsed, errors } = pipeline(values);
  assert.deepEqual(errors, []);
  assert.deepEqual(parsed.input.solution, [2, 0, 5]);
});

test("кольца: подписи общие и свои на каждое кольцо", () => {
  const shared = pipeline({ ...defaultEditorValues("rings"), rgRings: 2, rgSectors: 3, rgLabels: "А, Б, В", rgSolution: "1 1" });
  assert.deepEqual(shared.errors, []);
  assert.deepEqual(shared.built.config.labels, [["А", "Б", "В"], ["А", "Б", "В"]]);

  const own = pipeline({
    ...defaultEditorValues("rings"),
    rgRings: 2,
    rgSectors: 3,
    rgLabels: "А, Б, В\n1, 2, 3",
    rgSolution: "1 1"
  });
  assert.deepEqual(own.errors, []);
  assert.deepEqual(own.built.config.labels, [["А", "Б", "В"], ["1", "2", "3"]]);

  const wrong = pipeline({ ...defaultEditorValues("rings"), rgRings: 2, rgSectors: 3, rgLabels: "А, Б", rgSolution: "1 1" });
  assert.ok(wrong.errors.includes("labelsShape"));
});

test("кольца: ошибки в решении и настройках", () => {
  const base = { ...defaultEditorValues("rings"), rgRings: 3, rgSectors: 6 };
  for (const solution of ["1 1", "1 1 7", "1 1 0", "a b c", ""]) {
    assert.ok(pipeline({ ...base, rgSolution: solution }).errors.includes("ringsSolution"), solution);
  }
  assert.ok(pipeline({ ...base, rgSolution: "1 1 1", rgRings: "" }).errors.includes("ringsCount"));
  assert.ok(pipeline({ ...base, rgSolution: "1 1 1", rgFailOnWrong: true }).errors.includes("failAuto"));
  assert.deepEqual(pipeline({ ...base, rgSolution: "1 1 1", rgFailOnWrong: true, rgCheckMode: "confirm" }).errors, []);
});

test("неизвестный тип, подсказки и название", () => {
  assert.deepEqual(parseEditorForm({ type: "dance" }), { error: "unknownType" });
  const { input } = parseEditorForm({
    ...defaultEditorValues("sliding"),
    name: "  Плитки  ",
    description: " Описание ",
    hints: "первая\n\n  вторая  \n"
  });
  assert.equal(input.name, "Плитки");
  assert.equal(input.description, "Описание");
  assert.deepEqual(input.hints, ["первая", "вторая"]);
});

test("toEditorValues: форма изменения возвращает то, что было введено (круговой обход)", () => {
  const forms = [
    { ...defaultEditorValues("sequence"), name: "Руны", seqSymbols: "А, Б, В, Г", seqSolution: "2 4 1", seqCheckMode: "final", seqErrorMode: "fail", hints: "раз\nдва" },
    { ...defaultEditorValues("sliding"), name: "Плитки", slRows: 2, slCols: 5 },
    { ...defaultEditorValues("rings"), name: "Диски", rgRings: 2, rgSectors: 4, rgLabels: "А, Б, В, Г\n1, 2, 3, 4", rgSolution: "4 2", rgCheckMode: "confirm", rgFailOnWrong: true }
  ];
  for (const form of forms) {
    const first = pipeline(form);
    assert.deepEqual(first.errors, [], form.type);
    const pub = { type: form.type, name: form.name, description: form.description, hints: first.parsed.input.hints, config: first.built.config };
    const values = toEditorValues(pub, first.built.secret);
    const second = pipeline(values);
    assert.deepEqual(second.errors, [], form.type);
    assert.deepEqual(second.parsed.input.solution, first.parsed.input.solution, form.type);
    assert.deepEqual(second.built.config, first.built.config, form.type);
  }
});

test("describeSolution: человекочитаемое решение, у пятнашек его нет", () => {
  const seq = pipeline({ ...defaultEditorValues("sequence"), seqSymbols: "А, Б, В", seqSolution: "3 1" });
  assert.deepEqual(describeSolution({ type: "sequence", config: seq.built.config }, seq.built.secret), ["В  →  А"]);

  const rings = pipeline({ ...defaultEditorValues("rings"), rgRings: 2, rgSectors: 3, rgLabels: "А, Б, В", rgSolution: "2 3" });
  assert.deepEqual(describeSolution({ type: "rings", config: rings.built.config }, rings.built.secret), ["1: Б", "2: В"]);

  assert.equal(describeSolution({ type: "sliding", config: {} }, {}), null);
  assert.equal(describeSolution({ type: "sequence", config: { symbols: [] } }, null), null);
});
