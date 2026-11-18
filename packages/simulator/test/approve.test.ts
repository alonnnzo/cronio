import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createApproval, approveReduce, approveReady, holdProgress, holdIsAlways, requestKey, HOLD_MS } from "../public/approve.js";

type Req = { id: string; risk: string; owner: string; lines: string[]; always?: string };
const X: Req = { id: "x", risk: "high", owner: "Claude · uno", lines: ["rm -rf a"] };
const Y: Req = { id: "y", risk: "normal", owner: "Claude · dos", lines: ["ls"] };

// Pequeño arnés: aplica eventos y junta las aprobaciones emitidas.
function rig() {
  let state = createApproval();
  const emitted: { requestId: string; decision: string }[] = [];
  const send = (ev: object) => {
    const r = approveReduce(state, ev);
    state = r.state;
    if (r.emit) emitted.push(r.emit);
    return r.emit;
  };
  return { send, emitted, get state() { return state; } };
}
const ready = (req: Req | null, at = 0, connected = true) => {
  const r = rig();
  r.send({ type: "connection", connected });
  r.send({ type: "view", now: at, request: req });
  return r;
};

describe("approve: escenario de la revisión", () => {
  it("pulsar sobre X (alto), el foco pasa a Y a los 300 ms y se suelta a los 1200 ms: no aprueba Y", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "pointer" });
    r.send({ type: "tick", now: 900 });
    r.send({ type: "view", now: 900, request: Y });          // cambia lo mostrado a mitad del gesto
    r.send({ type: "tick", now: 1500 });
    r.send({ type: "up", now: 1800, source: "pointer" });
    expect(r.emitted).toEqual([]);
    // y se puede volver a pulsar sobre Y una vez cumplida su guarda
    r.send({ type: "down", now: 1000, source: "pointer" });
    r.send({ type: "up", now: 1100, source: "pointer" });
    expect(r.emitted).toEqual([]);                           // Y apareció a los 900: aún dentro de la guarda
    r.send({ type: "down", now: 1400, source: "pointer" });
    r.send({ type: "up", now: 1500, source: "pointer" });
    expect(r.emitted).toEqual([{ requestId: "y", decision: "allow" }]);
  });

  it("lo mismo con el teclado", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "view", now: 900, request: Y });
    r.send({ type: "up", now: 1800, source: "key" });
    expect(r.emitted).toEqual([]);
  });
});

describe("approve: riesgo normal", () => {
  it("una pulsación corta aprueba al soltar, una sola vez", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    expect(r.emitted).toEqual([]);
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([{ requestId: "y", decision: "allow" }]);
    r.send({ type: "down", now: 800, source: "key" });
    r.send({ type: "up", now: 900, source: "key" });
    expect(r.emitted).toHaveLength(1);                       // ya respondida
  });

  it("empezar dentro de los 500 ms no aprueba aunque se suelte después", () => {
    const r = ready(Y, 1000);
    r.send({ type: "down", now: 1300, source: "pointer" });
    r.send({ type: "up", now: 2500, source: "pointer" });
    expect(r.emitted).toEqual([]);
  });

  it("empezar justo a los 500 ms sí cuenta", () => {
    const r = ready(Y, 1000);
    r.send({ type: "down", now: 1500, source: "pointer" });
    r.send({ type: "up", now: 1520, source: "pointer" });
    expect(r.emitted).toHaveLength(1);
  });

  it("mantener la tecla en la guarda y seguir con repeticiones no reinicia ni aprueba", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 300, source: "key" });
    r.send({ type: "down", now: 700, source: "key", repeat: true });
    r.send({ type: "down", now: 800, source: "key", repeat: true });
    r.send({ type: "up", now: 900, source: "key" });
    expect(r.emitted).toEqual([]);
  });

  it("cambiar de solicitud con el botón pulsado anula el gesto", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "view", now: 650, request: { ...Y, id: "z" } });
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([]);
  });

  it("si la solicitud desaparece durante el gesto no se aprueba", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "view", now: 650, request: null });
    r.send({ type: "view", now: 660, request: Y });
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([]);
  });

  it("una vista repetida con lo mismo no reinicia la guarda ni anula el gesto", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "view", now: 650, request: { ...Y } });
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toHaveLength(1);
  });
});

describe("approve: riesgo alto (retención de 1 s)", () => {
  it("soltar antes de 1 s no aprueba", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "tick", now: 1200 });
    expect(holdProgress(r.state, 1200)).toBeCloseTo(0.6);
    r.send({ type: "up", now: 1500, source: "key" });
    expect(r.emitted).toEqual([]);
    expect(holdProgress(r.state, 1500)).toBe(0);
  });

  it("completar 1 s aprueba una vez, sin esperar a soltar", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "pointer" });
    r.send({ type: "tick", now: 600 + HOLD_MS - 1 });
    expect(r.emitted).toEqual([]);
    r.send({ type: "tick", now: 600 + HOLD_MS });
    expect(r.emitted).toEqual([{ requestId: "x", decision: "allow" }]);
    r.send({ type: "tick", now: 5000 });
    r.send({ type: "up", now: 5100, source: "pointer" });
    expect(r.emitted).toHaveLength(1);
  });

  it("cambio de id a mitad de la retención la cancela aunque se siga pulsando", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "tick", now: 1000 });
    r.send({ type: "view", now: 1100, request: { ...X, id: "x2" } });
    r.send({ type: "tick", now: 3000 });
    expect(r.emitted).toEqual([]);
    expect(holdProgress(r.state, 3000)).toBe(0);
    r.send({ type: "up", now: 3100, source: "key" });
    expect(r.emitted).toEqual([]);
  });

  it("cambia el dueño o las líneas con el mismo id: es otra solicitud y cancela el gesto", () => {
    for (const changed of [{ ...X, owner: "Claude · otro" }, { ...X, lines: ["rm -rf b"] }]) {
      const r = ready(X, 0);
      r.send({ type: "down", now: 600, source: "key" });
      r.send({ type: "view", now: 700, request: changed });
      r.send({ type: "tick", now: 2000 });
      expect(r.emitted).toEqual([]);
      // la guarda de 500 ms se reinició
      r.send({ type: "up", now: 2100, source: "key" });
      r.send({ type: "down", now: 900, source: "key" });
      expect(approveReady(r.state, 900)).toBe(false);
      expect(approveReady(r.state, 1200)).toBe(true);
    }
  });

  it("empezar dentro de la guarda no acumula retención", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 100, source: "key" });
    r.send({ type: "tick", now: 2000 });
    expect(r.emitted).toEqual([]);
  });

  it("cancel (blur o salir del botón) reinicia la retención", () => {
    const r = ready(X, 0);
    r.send({ type: "down", now: 600, source: "pointer" });
    r.send({ type: "cancel" });
    r.send({ type: "tick", now: 3000 });
    expect(r.emitted).toEqual([]);
  });
});

describe("approve: conexión y otras vías", () => {
  it("sin conexión no se emite", () => {
    const r = ready(Y, 0, false);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([]);
    expect(approveReady(r.state, 700)).toBe(false);
  });

  it("perder la conexión durante el gesto lo anula", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "connection", connected: false });
    r.send({ type: "connection", connected: true });
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([]);
  });

  it("rechazar (decided) impide aprobar después la misma solicitud", () => {
    const r = ready(Y, 0);
    r.send({ type: "decided", id: "y" });
    r.send({ type: "down", now: 700, source: "key" });
    r.send({ type: "up", now: 800, source: "key" });
    expect(r.emitted).toEqual([]);
    expect(approveReady(r.state, 800)).toBe(false);
  });

  it("soltar otra fuente no termina el gesto", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "up", now: 650, source: "pointer" });
    expect(r.emitted).toEqual([]);
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toHaveLength(1);
  });

  it("approveReady respeta la guarda de 500 ms y requestKey distingue id, riesgo, dueño y líneas", () => {
    const r = ready(Y, 1000);
    expect(approveReady(r.state, 1499)).toBe(false);
    expect(approveReady(r.state, 1500)).toBe(true);
    const keys = [Y, { ...Y, id: "q" }, { ...Y, risk: "high" }, { ...Y, owner: "o" }, { ...Y, lines: ["l"] }].map(requestKey);
    expect(new Set(keys).size).toBe(5);
  });
});

describe("approve: sí, no volver a preguntar (always)", () => {
  const XA: Req = { ...X, always: "Bash(rm -rf a)" };
  const YA: Req = { ...Y, always: "Bash(ls)" };

  it("riesgo normal: se emite allow_always al soltar, una sola vez", () => {
    const r = ready(YA, 0);
    r.send({ type: "down", now: 600, source: "key", always: true });
    expect(holdIsAlways(r.state)).toBe(true);
    r.send({ type: "up", now: 700, source: "key", always: true });
    expect(r.emitted).toEqual([{ requestId: "y", decision: "allow_always" }]);
    r.send({ type: "down", now: 800, source: "key", always: true });
    r.send({ type: "up", now: 900, source: "key", always: true });
    r.send({ type: "down", now: 1000, source: "key" });
    r.send({ type: "up", now: 1100, source: "key" });
    expect(r.emitted).toHaveLength(1);
  });

  it("respeta la guarda de 500 ms y la conexión", () => {
    const r = ready(YA, 1000);
    r.send({ type: "down", now: 1400, source: "key", always: true });
    r.send({ type: "up", now: 1450, source: "key", always: true });
    expect(r.emitted).toEqual([]);
    const off = ready(YA, 0, false);
    off.send({ type: "down", now: 600, source: "key", always: true });
    off.send({ type: "up", now: 700, source: "key", always: true });
    expect(off.emitted).toEqual([]);
  });

  it("riesgo alto: solo con la retención de 1 s, con la bandera", () => {
    const r = ready(XA, 0);
    r.send({ type: "down", now: 600, source: "key", always: true });
    expect(holdProgress(r.state, 1100)).toBeCloseTo(0.5, 1);
    r.send({ type: "tick", now: 1100 });
    r.send({ type: "up", now: 1200, source: "key", always: true });
    expect(r.emitted).toEqual([]);
    r.send({ type: "down", now: 2000, source: "key", always: true });
    r.send({ type: "tick", now: 2000 + HOLD_MS - 1 });
    expect(r.emitted).toEqual([]);
    r.send({ type: "tick", now: 2000 + HOLD_MS });
    expect(r.emitted).toEqual([{ requestId: "x", decision: "allow_always" }]);
    r.send({ type: "up", now: 3100, source: "key", always: true });
    expect(r.emitted).toHaveLength(1);
  });

  it("si la tarjeta no la ofrece, el gesto de always no hace nada", () => {
    const r = ready(Y, 0);
    r.send({ type: "down", now: 600, source: "key", always: true });
    r.send({ type: "up", now: 700, source: "key", always: true });
    expect(r.emitted).toEqual([]);
    const hi = ready(X, 0);
    hi.send({ type: "down", now: 600, source: "key", always: true });
    hi.send({ type: "tick", now: 2000 });
    expect(hi.emitted).toEqual([]);
  });

  it("un up del otro botón no termina el gesto en curso", () => {
    const r = ready(YA, 0);
    r.send({ type: "down", now: 600, source: "key" });
    r.send({ type: "down", now: 610, source: "key", always: true }); // segundo gesto: ignorado
    r.send({ type: "up", now: 650, source: "key", always: true });
    expect(r.emitted).toEqual([]);
    r.send({ type: "up", now: 700, source: "key" });
    expect(r.emitted).toEqual([{ requestId: "y", decision: "allow" }]);
    const r2 = ready(YA, 0);
    r2.send({ type: "down", now: 600, source: "key", always: true });
    r2.send({ type: "up", now: 650, source: "key" });
    expect(r2.emitted).toEqual([]);
    r2.send({ type: "up", now: 700, source: "key", always: true });
    expect(r2.emitted).toEqual([{ requestId: "y", decision: "allow_always" }]);
  });

  it("cambiar la tarjeta a mitad del gesto lo anula (otra etiqueta, sin etiqueta u otra solicitud)", () => {
    for (const next of [{ ...YA, always: "Bash(rm -rf x)" }, Y, XA]) {
      const r = ready(YA, 0);
      r.send({ type: "down", now: 600, source: "pointer", always: true });
      r.send({ type: "view", now: 650, request: next });
      r.send({ type: "up", now: 1800, source: "pointer", always: true });
      expect(r.emitted, JSON.stringify(next)).toEqual([]);
    }
  });

  it("requestKey incluye la etiqueta solo si la hay", () => {
    expect(requestKey(Y)).toBe(requestKey({ ...Y, always: undefined }));
    expect(requestKey(YA)).not.toBe(requestKey(Y));
    expect(requestKey(YA)).not.toBe(requestKey({ ...YA, always: "otra" }));
  });
});
