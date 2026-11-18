import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createNav, reduce, itemCount, visibleKinds, KINDS } from "../public/nav.js";

type Nav = { level: string; kind: string | null; sessionId: string | null; cursor: number };

const session = (id: string, kind: string) => ({ id, kind, title: id, project: "p", model: "m", state: "idle", activity: "" });
const baseView = (extra: Record<string, unknown> = {}) => ({
  sessions: [session("a", "claude"), session("b", "claude"), session("c", "claude"), session("g", "gemini")],
  request: null,
  pendingCount: 0,
  mode: "queue",
  face: { kind: null, mood: "idle", lines: ["x"] },
  detail: null,
  led: "off",
  ...extra,
});

function run(state: Nav, v: unknown, ...actions: object[]) {
  let s = state;
  const messages: unknown[] = [];
  for (const a of actions) {
    const r = reduce(s, v, a);
    s = r.state;
    messages.push(...r.messages);
  }
  return { state: s, messages };
}

const settings = (hiddenAgents: string[]) => ({ notifyDefault: "important", notifyAck: true, hiddenAgents });
const hidden = (...kinds: string[]) => baseView({ settings: settings(kinds) });

describe("nav: agentes ocultos en la configuración", () => {
  it("la lista de agentes cuenta y numera solo los visibles", () => {
    const v = hidden("claude", "codex");
    expect(visibleKinds(v)).toEqual(["gemini", "cursor", "hermes"]);
    expect(itemCount(createNav(), v)).toBe(3);
    expect(itemCount(createNav(), baseView())).toBe(KINDS.length); // sin ajustes: todos
    // el índice 0 es Gemini (no Claude)
    expect(run(createNav(), v, { type: "enter", index: 0 }).state).toEqual({ level: "sessions", kind: "gemini", sessionId: null, cursor: 0 });
    // fuera de lo visible no entra
    expect(run(createNav(), v, { type: "enter", index: 3 }).state).toEqual(createNav());
    // el cursor tiene tope en los visibles
    const right = { type: "move", dx: 1, dy: 0 };
    expect(run(createNav(), v, right, right, right).state.cursor).toBe(2);
    // volver de las sesiones cae sobre el agente en la lista visible
    expect(run(createNav(), v, { type: "enter", index: 1 }, { type: "back" }).state.cursor).toBe(1);
  });

  it("todos ocultos: nada que recorrer ni elegir", () => {
    const v = hidden(...KINDS);
    expect(itemCount(createNav(), v)).toBe(0);
    expect(run(createNav(), v, { type: "move", dx: 1, dy: 0 }, { type: "enter" }).state).toEqual(createNav());
  });

  it("si el agente de la pantalla se oculta, vuelve a la lista de agentes (y suelta el enfoque si estaba en el detalle)", () => {
    const sessionsState = { level: "sessions", kind: "claude", sessionId: null, cursor: 1 };
    const a = reduce(sessionsState, hidden("claude"), { type: "sync" });
    expect(a.state).toEqual({ level: "agents", kind: null, sessionId: null, cursor: 0 });
    expect(a.messages).toEqual([]);
    const detailState = { level: "detail", kind: "claude", sessionId: "a", cursor: 0 };
    const b = reduce(detailState, hidden("claude"), { type: "sync" });
    expect(b.state.level).toBe("agents");
    expect(b.messages).toEqual([{ t: "focus", sessionId: null }]);
    // otro agente oculto no molesta
    expect(reduce(sessionsState, hidden("gemini"), { type: "sync" }).state).toEqual(sessionsState);
  });
});
