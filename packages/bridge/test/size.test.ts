import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DETAIL_LINES,
  MAX_FACE_LINES,
  MAX_ID,
  MAX_LINES,
  MAX_PAYLOAD,
  MAX_QUESTION_LINES,
  MAX_SESSIONS,
  TAG_LENGTH,
  parseBridgeMessage,
  type ViewModel,
} from "@companion/protocol";
import { BridgeStore } from "../src/store.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { clip, wrapLines } from "../src/text.ts";

const BUDGET = MAX_PAYLOAD - TAG_LENGTH;
/** Margen exigido sobre el peor caso realista. */
const MARGIN = 3000;

// Peor caso realista: todo el texto pasó por el saneado del puente. Quedan, como máximo, 3 bytes por carácter en
// UTF-8 (`€`, el marcador `�` que sustituye a controles y a mitades de pares sustitutos, `…`) y comillas o barras
// que JSON escapa con 2 bytes.
const CHARS: [string, string][] = [
  ["€ (3 bytes)", "€"],
  ["comillas (se escapan: 2 bytes)", '"'],
  ["barras (se escapan: 2 bytes)", "\\"],
  ["controles, que pasan a � (3 bytes)", "\u0001"],
  ["emoji (4 bytes por 2 unidades)", "\u{1f600}"],
  ["mitad suelta de un par, que pasa a � (3 bytes)", "\ud83d"],
  ["ASCII", "x"],
];

/** Texto ya saneado y cortado como lo deja el puente: 38 caracteres. */
const clean = (ch: string) => clip(ch.repeat(100));

/** La vista máxima según el esquema: 12 sesiones, tarjeta de 6 líneas, cara de 2, detalle de 4 y ids de 48. */
function biggestView(ch: string): ViewModel {
  const t = clean(ch);
  const id = (n: number) => (String(n) + "i".repeat(MAX_ID)).slice(0, MAX_ID);
  return {
    sessions: Array.from({ length: MAX_SESSIONS }, (_, i) => ({
      id: id(i),
      kind: "hermes" as const,
      title: t,
      project: t,
      model: t,
      state: "working" as const,
      activity: t,
    })),
    request: {
      id: id(99),
      sessionId: id(1),
      title: t,
      lines: wrapLines(ch.repeat(2000), 38, MAX_LINES),
      risk: "normal",
      expiresInS: 99999,
      position: 12,
      total: 12,
    },
    pendingCount: 12,
    mode: "manual",
    face: { kind: "hermes", mood: "working", lines: Array(MAX_FACE_LINES).fill(t) },
    detail: { sessionId: id(1), lastMessage: wrapLines(ch.repeat(2000), 38, MAX_DETAIL_LINES), question: wrapLines(ch.repeat(2000), 38, MAX_QUESTION_LINES), notify: "important", instructions: { count: 5, first: t }, waitForMe: true },
    led: "working",
  };
}

const sizeOf = (view: ViewModel) => Buffer.byteLength(JSON.stringify({ t: "view", rev: 4294967295, view }));

describe("tamaño máximo de la vista", () => {
  for (const [name, ch] of CHARS) {
    it(`la vista máxima cabe en MAX_PAYLOAD - TAG_LENGTH con margen: ${name}`, () => {
      const view = biggestView(ch);
      expect(view.request!.lines).toHaveLength(MAX_LINES);
      expect(view.detail!.lastMessage).toHaveLength(MAX_DETAIL_LINES);
      expect(view.detail!.question).toHaveLength(MAX_QUESTION_LINES);
      expect(view.face.lines).toHaveLength(MAX_FACE_LINES);
      expect(() => parseBridgeMessage({ t: "view", rev: 1, view })).not.toThrow();
      const size = sizeOf(view);
      expect(size).toBeLessThanOrEqual(BUDGET - MARGIN);
    });
  }

  it("el peor caso medido (el mayor de los anteriores)", () => {
    const worst = Math.max(...CHARS.map(([, ch]) => sizeOf(biggestView(ch))));
    console.log(`vista máxima: ${worst} bytes de ${BUDGET} (MAX_PAYLOAD ${MAX_PAYLOAD} - etiqueta ${TAG_LENGTH}); margen ${BUDGET - worst}`);
    expect(BUDGET - worst).toBeGreaterThanOrEqual(MARGIN);
  });
});

describe("tamaño de la vista real armada por el puente", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const [name, ch] of CHARS) {
    it(`20 sesiones con textos hostiles, 12 permisos y detalle abierto: ${name}`, () => {
      const store = new BridgeStore();
      const face = new FaceController(store);
      store.setConsoleConnected(true);
      for (let i = 0; i < 20; i++) {
        const id = `s${i}`.padEnd(MAX_ID, "i");
        store.upsertSession({ sessionId: id, kind: "hermes", project: ch.repeat(100), model: ch.repeat(100), title: ch.repeat(100) });
        store.setActivity(id, ch.repeat(100));
        store.setLastMessage(id, ch.repeat(2000));
        store.setSessionState(id, "working");
        if (i < 12) void store.requestPermission({ sessionId: id, toolName: "Bash", toolInput: { command: ch.repeat(2000) } });
      }
      store.focus(`s3`.padEnd(MAX_ID, "i"));
      const view = buildView(store, face);
      expect(view.sessions).toHaveLength(MAX_SESSIONS);
      expect(view.request).not.toBeNull();
      expect(view.detail).not.toBeNull();
      expect(() => parseBridgeMessage({ t: "view", rev: 1, view })).not.toThrow();
      expect(sizeOf(view)).toBeLessThanOrEqual(BUDGET - MARGIN);
      store.dispose();
      face.dispose();
    });
  }
});

describe("tamaño de la vista con una pregunta de 4 preguntas por 4 opciones (paso 4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const [name, ch] of CHARS) {
    it(`12 sesiones con textos hostiles y la pregunta más grande: ${name}`, () => {
      const store = new BridgeStore();
      const face = new FaceController(store);
      store.setConsoleConnected(true);
      for (let i = 0; i < 20; i++) {
        const id = `s${i}`.padEnd(MAX_ID, "i");
        store.upsertSession({ sessionId: id, kind: "hermes", project: ch.repeat(100), model: ch.repeat(100), title: ch.repeat(100) });
        store.setActivity(id, ch.repeat(100));
        store.setLastMessage(id, ch.repeat(2000));
        store.setSessionState(id, "working");
      }
      const questions = Array.from({ length: 4 }, (_, q) => ({
        question: `${q}${ch.repeat(2000)}`.slice(0, 2000),
        header: ch.repeat(100),
        options: Array.from({ length: 4 }, (_, o) => ({ label: `${o}${ch.repeat(100)}`, description: ch.repeat(1000) })),
        multiSelect: true,
      }));
      void store.requestQuestion({ sessionId: `s3`.padEnd(MAX_ID, "i"), toolInput: { questions }, questions });
      store.focus(`s3`.padEnd(MAX_ID, "i"));
      const view = buildView(store, face);
      expect(view.request!.kind).toBe("question");
      expect(view.request!.questions).toHaveLength(4);
      // si hubo que achicar, solo cae lo accesorio: las cuatro opciones de cada pregunta quedan con su etiqueta
      for (const qv of view.request!.questions!) {
        expect(qv.options).toHaveLength(4);
        for (const o of qv.options) expect(o.label.length).toBeGreaterThan(0);
      }
      expect(view.sessions).toHaveLength(MAX_SESSIONS);
      expect(() => parseBridgeMessage({ t: "view", rev: 1, view })).not.toThrow();
      const size = sizeOf(view);
      console.log(`vista con pregunta máxima (${name}): ${size} bytes de ${BUDGET}; margen ${BUDGET - size}`);
      expect(size).toBeLessThanOrEqual(BUDGET - MARGIN);
      store.dispose();
      face.dispose();
    });
  }

  it("una pregunta de tamaño normal conserva sus descripciones completas", () => {
    const store = new BridgeStore();
    const face = new FaceController(store);
    store.setConsoleConnected(true);
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "demo" });
    const questions = [
      {
        question: "¿Qué fondo uso?",
        header: "Fondo",
        options: [
          { label: "Video", description: "Pesa más, se ve mejor en pantallas grandes y no carga en el celular" },
          { label: "Gradiente", description: "Liviano" },
        ],
        multiSelect: false,
      },
    ];
    void store.requestQuestion({ sessionId: "s1", toolInput: { questions }, questions });
    const view = buildView(store, face);
    expect(view.request!.questions![0]!.options[0]!.desc).toHaveLength(2);
    store.dispose();
    face.dispose();
  });
});
