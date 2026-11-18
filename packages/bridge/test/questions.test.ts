import { describe, expect, it } from "vitest";
import { MAX_QUESTION_LINES, MAX_TEXT, QuestionViewSchema } from "@companion/protocol";
import { buildAnswers, cleanOther, parseQuestions, questionToView, splitRecommended, type QuestionSpec } from "../src/questions.ts";

const q = (over: Partial<QuestionSpec> = {}): QuestionSpec => ({
  question: "¿Qué fondo uso en el hero?",
  header: "Fondo",
  options: [
    { label: "Video (Recommended)", description: "Pesa más pero se ve mejor" },
    { label: "Gradiente", description: "Liviano" },
    { label: "Imagen", description: "" },
  ],
  multiSelect: false,
  ...over,
});

describe("parseQuestions", () => {
  it("acepta de 1 a 4 preguntas con 2 a 4 opciones", () => {
    expect(parseQuestions({ questions: [q()] })).toHaveLength(1);
    const four = ["a", "b", "c", "d"].map((t) => q({ question: `¿${t}?` }));
    expect(parseQuestions({ questions: four })).toHaveLength(4);
    const four4 = q({ options: Array.from({ length: 4 }, (_, i) => ({ label: `o${i}`, description: "d" })) });
    expect(parseQuestions({ questions: [four4] })![0]!.options).toHaveLength(4);
  });

  it("rechaza lo que no cumple", () => {
    const bad: unknown[] = [
      null,
      "x",
      {},
      { questions: [] },
      { questions: "x" },
      { questions: ["a", "b", "c", "d", "e"].map((t) => q({ question: t })) },
      { questions: [q({ options: [{ label: "una", description: "" }] })] },
      { questions: [q({ options: Array.from({ length: 5 }, (_, i) => ({ label: `o${i}`, description: "" })) })] },
      { questions: [q({ question: "" })] },
      { questions: [q({ options: [{ label: "", description: "" }, { label: "b", description: "" }] })] },
      { questions: [{ ...q(), multiSelect: "si" }] },
      { questions: [{ ...q(), options: [{ label: 5 }, { label: 6 }] }] },
      { questions: [q({ question: "x".repeat(2001) })] },
      { questions: [q({ question: "igual" }), q({ question: "igual" })] }, // el texto indexa las respuestas
    ];
    for (const b of bad) expect(parseQuestions(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
  });

  it("header, description y multiSelect faltantes toman un valor por defecto", () => {
    const r = parseQuestions({ questions: [{ question: "¿a?", options: [{ label: "x" }, { label: "y" }] }] });
    expect(r).toEqual([{ question: "¿a?", header: "", options: [{ label: "x", description: "" }, { label: "y", description: "" }], multiSelect: false }]);
  });
});

describe("(Recommended)", () => {
  it("se quita de lo que se muestra y se marca aparte; también en español", () => {
    expect(splitRecommended("Video (Recommended)")).toEqual({ label: "Video", recommended: true });
    expect(splitRecommended("Video (recomendado)")).toEqual({ label: "Video", recommended: true });
    expect(splitRecommended("Opción (Recomendada)  ")).toEqual({ label: "Opción", recommended: true });
    expect(splitRecommended("Video")).toEqual({ label: "Video", recommended: false });
    expect(splitRecommended("(Recommended) al inicio")).toEqual({ label: "(Recommended) al inicio", recommended: false });
    expect(splitRecommended("(Recommended)")).toEqual({ label: "(Recommended)", recommended: false }); // no queda vacía
  });

  it("la vista la quita pero la respuesta conserva la etiqueta completa", () => {
    const v = questionToView(q());
    expect(v.options[0]).toEqual({ label: "Video", desc: ["Pesa más pero se ve mejor"], recommended: true });
    expect(v.options[1]).toEqual({ label: "Gradiente", desc: ["Liviano"], recommended: false });
    expect(v.options[2]).toEqual({ label: "Imagen", desc: [], recommended: false });
    expect(buildAnswers([q()], [{ choose: [0] }])).toEqual({ "¿Qué fondo uso en el hero?": "Video (Recommended)" });
  });
});

describe("questionToView", () => {
  it("recorta a los límites de la vista y cumple el esquema", () => {
    const long = "palabra ".repeat(80);
    const v = questionToView(
      q({ question: long, header: "h".repeat(100), options: [{ label: "L".repeat(100), description: long }, { label: "b", description: "x" }] }),
    );
    expect(QuestionViewSchema.safeParse(v).success).toBe(true);
    expect(v.header.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(v.text).toHaveLength(MAX_QUESTION_LINES);
    expect(v.options[0]!.desc).toHaveLength(2);
    expect(v.options[0]!.label.length).toBeLessThanOrEqual(MAX_TEXT);
  });
});

describe("buildAnswers", () => {
  const two = [
    q(),
    q({
      question: "¿Qué secciones?",
      multiSelect: true,
      options: [
        { label: "Hero", description: "" },
        { label: "Footer", description: "" },
        { label: "Menú", description: "" },
      ],
    }),
  ];

  it("una pregunta, varias, multiSelect unido con coma y espacio, y 'Otra' con el texto", () => {
    expect(buildAnswers([q()], [{ choose: [1] }])).toEqual({ "¿Qué fondo uso en el hero?": "Gradiente" });
    expect(buildAnswers(two, [{ choose: [2] }, { choose: [2, 0] }])).toEqual({
      "¿Qué fondo uso en el hero?": "Imagen",
      "¿Qué secciones?": "Hero, Menú", // en el orden de la pregunta
    });
    expect(buildAnswers(two, [{ other: "  otro fondo\ncon \u0001 ñ  " }, { choose: [1] }])).toEqual({
      "¿Qué fondo uso en el hero?": "otro fondo con � ñ",
      "¿Qué secciones?": "Footer",
    });
  });

  it("no cuadra: cantidad, índices, varias en una sola o texto vacío", () => {
    expect(buildAnswers(two, [{ choose: [0] }])).toBeNull();
    expect(buildAnswers([q()], [{ choose: [0] }, { choose: [0] }])).toBeNull();
    expect(buildAnswers([q()], [{ choose: [3] }])).toBeNull(); // la pregunta solo tiene 3 opciones
    expect(buildAnswers([q()], [{ choose: [0, 1] }])).toBeNull(); // no es multiSelect
    expect(buildAnswers([q()], [{ other: "  \n " }])).toBeNull();
    expect(cleanOther(" \n ")).toBe("");
  });
});
