import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { APPROVE_GUARD_MS, canApprove } from "../public/approve-guard.js";

describe("canApprove", () => {
  it("el lapso es de 500 ms", () => {
    expect(APPROVE_GUARD_MS).toBe(500);
  });

  it("ignora aprobar antes de 500 ms desde que apareció la solicitud", () => {
    expect(canApprove(1000, 1000)).toBe(false);
    expect(canApprove(1499, 1000)).toBe(false);
  });

  it("permite aprobar desde los 500 ms", () => {
    expect(canApprove(1500, 1000)).toBe(true);
    expect(canApprove(9000, 1000)).toBe(true);
  });

  it("sin solicitud (sin instante de aparición) no se aprueba", () => {
    expect(canApprove(1000, null)).toBe(false);
    expect(canApprove(1000, undefined)).toBe(false);
  });

  it("una solicitud nueva reinicia el lapso", () => {
    const shownFirst = 0;
    expect(canApprove(2000, shownFirst)).toBe(true);
    const shownSecond = 2000; // cambia request.id
    expect(canApprove(2100, shownSecond)).toBe(false);
    expect(canApprove(2500, shownSecond)).toBe(true);
  });
});
