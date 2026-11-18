import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { UPDATE_ONLY_CONSOLE, updateLines, updateShown } from "../public/update.js";

const base = { sessions: [], request: null, pendingCount: 0, mode: "queue", face: { kind: null, mood: "idle", lines: ["x"] }, detail: null, led: "off" };
const update = { version: "0.3.0", url: "http://192.168.0.20:33337/agent-companion.cia", size: 370000, sha256: "ab".repeat(32) };
const request = { id: "r1", sessionId: "s", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 };
const notice = { id: "n1", sessionId: "s", kind: "done", agent: "Claude", project: "p", title: "Terminó", lines: ["x"], position: 1, total: 1 };

describe("tarjeta de versión nueva (solo aviso)", () => {
  it("aparece solo con `update` y nada más pidiendo atención", () => {
    expect(updateShown({ ...base, update })).toBe(true);
    expect(updateShown(base)).toBe(false);
    expect(updateShown(null)).toBe(false);
  });
  it("las solicitudes y los avisos con Visto van antes", () => {
    expect(updateShown({ ...base, update, request })).toBe(false);
    expect(updateShown({ ...base, update, notice })).toBe(false);
    expect(updateShown({ ...base, update, request: { ...request, kind: "question" } })).toBe(false);
    expect(updateShown({ ...base, update, request: { ...request, kind: "instruction" } })).toBe(false);
  });
  it("«Ahora no» la oculta", () => {
    expect(updateShown({ ...base, update }, true)).toBe(false);
  });
  it("dice la versión y que se actualiza desde la consola", () => {
    const lines = updateLines({ ...base, update });
    expect(lines[0]).toBe("Hay una versión nueva de Cronio (0.3.0).");
    expect(lines[1]).toContain("consola");
    expect(updateLines(base)).toEqual([]);
    expect(UPDATE_ONLY_CONSOLE).toBe("Solo en la consola");
  });
});
