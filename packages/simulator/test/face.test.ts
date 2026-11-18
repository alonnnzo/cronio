import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { drawFace, createLocalState, bubbleBox, mouthBox, eyesBox, boxesOverlap, AGENT_STYLES, SCREEN_W, SCREEN_H } from "../public/face.js";

const KINDS = ["claude", "gemini", "codex", "cursor", "hermes", null] as const;
const MOODS = ["idle", "working", "ask", "done", "error"] as const;
const LONG = "x".repeat(38);

// Contexto 2D falso: registra cada llamada a método y acepta cualquier propiedad.
function fakeContext() {
  const calls: string[] = [];
  const fills: string[] = [];
  const texts: { text: string; font: string }[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        if (prop === "fillRect") fills.push(String(t.fillStyle));
        if (prop === "fillText") texts.push({ text: String(args[0]), font: String(t.font) });
        return undefined;
      };
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  });
  return { ctx, calls, fills, texts };
}

const face = (kind: (typeof KINDS)[number], mood: (typeof MOODS)[number], lines: string[]) => ({ kind, mood, lines });

describe("drawFace", () => {
  for (const kind of KINDS) {
    for (const mood of MOODS) {
      for (const lines of [["Todo tranquilo"], ["Claude necesita permiso", "npm install sharp · mi-portal"], [LONG, LONG], ["Claude espera tu respuesta", LONG, LONG, LONG]]) {
        it(`${kind} / ${mood} / ${lines.length} línea(s) de hasta ${Math.max(...lines.map((l) => l.length))} dibuja sin lanzar`, () => {
          const { ctx, calls } = fakeContext();
          const local = createLocalState();
          expect(() => drawFace(ctx, face(kind, mood, lines), 1234, local)).not.toThrow();
          expect(() => drawFace(ctx, face(kind, mood, lines), 1250, local)).not.toThrow();
          expect(calls).toContain("fillRect");
          expect(calls).toContain("fillText");
        });
      }
    }
  }

  it("en movimiento reducido también dibuja todos los ánimos", () => {
    for (const mood of MOODS) {
      const { ctx, calls } = fakeContext();
      const local = createLocalState();
      local.reducedMotion = true;
      expect(() => drawFace(ctx, face("claude", mood, ["Hola", "mundo"]), 5000, local)).not.toThrow();
      expect(calls).toContain("fillText");
    }
  });

  it("en movimiento reducido la cara no cambia con el tiempo (salvo flotar y mirar)", () => {
    const run = (mood: (typeof MOODS)[number], t: number) => {
      const { ctx, calls } = fakeContext();
      const local = createLocalState();
      local.reducedMotion = true;
      drawFace(ctx, face("claude", mood, ["Hola"]), t, local);
      return calls.length;
    };
    // sin parpadeo ni salto: mismo número de operaciones en cualquier instante
    for (const mood of MOODS) expect(run(mood, 3500)).toBe(run(mood, 3590));
  });

  it("el color hace transición suave y no salta al cambiar de agente", () => {
    const { ctx } = fakeContext();
    const local = createLocalState();
    drawFace(ctx, face("claude", "working", ["a"]), 0, local);
    const start = [...local.color];
    drawFace(ctx, face("gemini", "working", ["a"]), 16, local);
    const mid = [...local.color];
    expect(mid).not.toEqual(start);
    // sigue lejos del destino tras un cuadro, y se acerca con el tiempo
    const target = [0x5b, 0x8c, 0xff];
    const dist = (c: number[]) => Math.hypot(...c.map((v, i) => v - target[i]!));
    expect(dist(mid)).toBeLessThan(dist(start));
    expect(dist(mid)).toBeGreaterThan(dist(start) * 0.5);
    for (let t = 32; t < 3000; t += 16) drawFace(ctx, face("gemini", "working", ["a"]), t, local);
    expect(dist(local.color)).toBeLessThan(2);
  });

  it("la primera vez no hay transición y sin agente el fondo es gris neutro", () => {
    const { ctx, fills } = fakeContext();
    const local = createLocalState();
    drawFace(ctx, face(null, "working", ["a"]), 0, local);
    expect(local.color.map(Math.round)).toEqual([0x3a, 0x3d, 0x52]);
    expect(fills[0]).toBe("rgb(58,61,82)");
  });

  it("idle atenúa el color", () => {
    const a = fakeContext();
    const b = fakeContext();
    drawFace(a.ctx, face("claude", "idle", ["a"]), 0, createLocalState());
    drawFace(b.ctx, face("claude", "working", ["a"]), 0, createLocalState());
    expect(a.fills[0]).not.toBe(b.fills[0]);
    expect(a.fills[0]).toBe("rgb(131,64,39)"); // 0xee,0x74,0x46 x 0.55
  });

  it("un tiempo que retrocede o salta no rompe la transición", () => {
    const { ctx } = fakeContext();
    const local = createLocalState();
    drawFace(ctx, face("claude", "idle", ["a"]), 10000, local);
    expect(() => drawFace(ctx, face("codex", "idle", ["a"]), 5, local)).not.toThrow();
    expect(() => drawFace(ctx, face("codex", "idle", ["a"]), 900000, local)).not.toThrow();
    expect(local.color.every((v: number) => Number.isFinite(v))).toBe(true);
  });

  it("la animación del globo reinicia solo cuando cambia el texto", () => {
    const { ctx } = fakeContext();
    const local = createLocalState();
    drawFace(ctx, face("claude", "ask", ["uno"]), 1000, local);
    expect(local.bubbleSince).toBe(1000);
    drawFace(ctx, face("claude", "ask", ["uno"]), 1100, local);
    expect(local.bubbleSince).toBe(1000);
    drawFace(ctx, face("claude", "ask", ["uno", "dos"]), 1200, local);
    expect(local.bubbleSince).toBe(1200);
  });

  it("el texto de 38 caracteres cabe: la fuente se reduce lo necesario", () => {
    const { ctx, texts } = fakeContext();
    drawFace(ctx, face("claude", "working", [LONG]), 0, createLocalState());
    const size = Number(/(\d+)px/.exec(texts[0]!.font)![1]);
    expect(size * 0.6 * LONG.length).toBeLessThanOrEqual(340);
    expect(size).toBeGreaterThanOrEqual(11);
  });

  it("una cara defectuosa no lanza", () => {
    const { ctx } = fakeContext();
    const local = createLocalState();
    // @ts-expect-error entrada inválida a propósito
    expect(() => drawFace(ctx, undefined, 0, local)).not.toThrow();
    // @ts-expect-error entrada inválida a propósito
    expect(() => drawFace(ctx, { kind: "otro", mood: "raro", lines: [] }, 0, local)).not.toThrow();
  });
});

describe("cajas de la cara", () => {
  it("el globo y la boca no se solapan", () => {
    expect(boxesOverlap(bubbleBox(), mouthBox())).toBe(false);
  });

  it("el globo no tapa los ojos y la boca no toca los ojos", () => {
    expect(boxesOverlap(bubbleBox(), eyesBox())).toBe(false);
    expect(boxesOverlap(mouthBox(), eyesBox())).toBe(false);
  });

  it("todo cabe en la pantalla de 400x240", () => {
    for (const b of [bubbleBox(), mouthBox(), eyesBox()]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(SCREEN_W);
      expect(b.y + b.h).toBeLessThanOrEqual(SCREEN_H);
    }
  });

  it("el globo de 3 y 4 líneas (la pregunta) crece hacia arriba sin tapar la boca ni los ojos y cabe en pantalla", () => {
    for (const n of [1, 2, 3, 4]) {
      const b = bubbleBox(n);
      expect(boxesOverlap(b, mouthBox()), `boca con ${n} líneas`).toBe(false);
      expect(boxesOverlap(b, eyesBox()), `ojos con ${n} líneas`).toBe(false);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(SCREEN_H);
    }
    expect(bubbleBox(4).h).toBeGreaterThan(bubbleBox(3).h);
    expect(bubbleBox(3).h).toBeGreaterThan(bubbleBox(2).h);
    expect(bubbleBox()).toEqual(bubbleBox(2));
  });

  it("con título + 3 líneas de pregunta dibuja las 4 líneas, cada una en su renglón", () => {
    const { ctx, texts } = fakeContext();
    drawFace(ctx, face("claude", "ask", ["Claude espera tu respuesta", "uno", "dos", "tres"]), 5000, createLocalState());
    expect(texts.map((t) => t.text)).toEqual(["Claude espera tu respuesta", "uno", "dos", "tres"]);
  });

  it("boxesOverlap detecta solapes", () => {
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("los cinco agentes tienen color y nombre", () => {
    for (const k of ["claude", "gemini", "codex", "cursor", "hermes"]) {
      expect(AGENT_STYLES[k].color).toMatch(/^#[0-9a-f]{6}$/);
      expect(AGENT_STYLES[k].name.length).toBeGreaterThan(0);
    }
  });
});
