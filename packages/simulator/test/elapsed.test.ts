import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { MAX_SINCE_S, elapsedLabel, elapsedTotalS } from "../public/elapsed.js";

describe("elapsedLabel", () => {
  it.each([
    [0, "ahora"],
    [4, "ahora"],
    [5, "hace 5 s"],
    [59, "hace 59 s"],
    [60, "hace 1 min"],
    [179, "hace 2 min"],
    [180, "hace 3 min"],
    [3599, "hace 59 min"],
    [3600, "hace 1 h"],
    [7200, "hace 2 h"],
    [86399, "hace 23 h"],
    [86400, "hace 1 d"],
    [3 * 86400 + 5, "hace 3 d"],
    [MAX_SINCE_S, "hace 99 d"],
  ])("%i s -> %s", (secs, texto) => {
    expect(elapsedLabel(secs)).toBe(texto);
  });
});

describe("elapsedTotalS", () => {
  it("suma al sinceS lo que pasó en el reloj local desde que llegó la vista", () => {
    expect(elapsedTotalS(30, 1000, 1000)).toBe(30);
    expect(elapsedTotalS(30, 1000, 1999)).toBe(30);
    expect(elapsedTotalS(30, 1000, 6000)).toBe(35);
    expect(elapsedTotalS(0, 0, 125000)).toBe(125);
  });
  it("un reloj que va hacia atrás no resta", () => {
    expect(elapsedTotalS(30, 5000, 4000)).toBe(30);
  });
  it("150 s del puente y un minuto local son 3 minutos", () => {
    expect(elapsedLabel(elapsedTotalS(150, 10000, 70000))).toBe("hace 3 min");
  });
});
