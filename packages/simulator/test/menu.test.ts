import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createMenu, reduceMenu, canOpen, mustClose, entryEnabled, ROOT_ENTRIES, NOTIFY_LABEL } from "../public/menu.js";

type Menu = { open: boolean; level: string; cursor: number; rootCursor: number };

const baseView = (extra: Record<string, unknown> = {}) => ({
  sessions: [],
  request: null,
  pendingCount: 0,
  mode: "queue",
  face: { kind: null, mood: "idle", lines: ["x"] },
  detail: null,
  led: "off",
  ...extra,
});
const settings = (over: Record<string, unknown> = {}) => ({ notifyDefault: "important", notifyAck: true, hiddenAgents: [] as string[], ...over });
const withSettings = (over: Record<string, unknown> = {}) => baseView({ settings: settings(over) });
const request = { id: "r1", sessionId: "a", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 };

function run(state: Menu, view: unknown, ...events: object[]) {
  let s = state;
  const messages: unknown[] = [];
  const effects: unknown[] = [];
  for (const e of events) {
    const r = reduceMenu(s, view, e);
    s = r.state;
    messages.push(...r.messages);
    if (r.effect) effects.push(r.effect);
  }
  return { state: s, messages, effects };
}
const open = (view: unknown) => run(createMenu(), view, { type: "open" }).state;
const at = (view: unknown, row: number) => run(open(view), view, ...Array.from({ length: row }, () => ({ type: "move", dy: 1 }))).state;

describe("menu: abrir, cerrar y cursor", () => {
  it("abre arriba, no da la vuelta y vuelve a abrir arriba", () => {
    const v = withSettings();
    let s = open(v);
    expect(s).toEqual({ open: true, level: "root", cursor: 0, rootCursor: 0 });
    s = run(s, v, { type: "move", dy: -1 }).state;
    expect(s.cursor).toBe(0);
    for (let i = 0; i < 8; i++) s = run(s, v, { type: "move", dy: 1 }).state;
    expect(s.cursor).toBe(ROOT_ENTRIES.length - 1);
    expect(run(s, v, { type: "close" }).state).toEqual(createMenu());
    expect(open(v).cursor).toBe(0);
  });

  it("con una tarjeta de permiso a la vista no se abre; si llega con el menú abierto, mustClose lo pide", () => {
    const card = baseView({ request, pendingCount: 1 });
    expect(canOpen(card)).toBe(false);
    expect(run(createMenu(), card, { type: "open" }).state.open).toBe(false);
    const s = open(withSettings());
    expect(mustClose(s, withSettings())).toBe(false);
    expect(mustClose(s, card)).toBe(true);
    expect(mustClose(createMenu(), card)).toBe(false);
  });
});

describe("menu: valores", () => {
  it("avisos por defecto: A o derecha avanzan, izquierda retrocede, da la vuelta", () => {
    const v = withSettings();
    const msg = (view: unknown, dir: number, cycleOnly = false) => run(open(view), view, { type: "activate", dir, cycleOnly }).messages;
    expect(msg(v, 1)).toEqual([{ t: "setting", key: "notifyDefault", value: "end" }]);
    expect(msg(withSettings({ notifyDefault: "silent" }), 1, true)).toEqual([{ t: "setting", key: "notifyDefault", value: "all" }]);
    expect(msg(withSettings({ notifyDefault: "all" }), -1, true)).toEqual([{ t: "setting", key: "notifyDefault", value: "silent" }]);
    expect(msg(v, -1, true)).toEqual([{ t: "setting", key: "notifyDefault", value: "all" }]);
    expect(Object.values(NOTIFY_LABEL)).toEqual(["todo", "lo importante", "solo al terminar", "silencio"]);
  });

  it("pedir Visto alterna", () => {
    const on = withSettings();
    const off = withSettings({ notifyAck: false });
    expect(run(at(on, 1), on, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "notifyAck", value: false }]);
    expect(run(at(off, 1), off, { type: "activate", dir: -1, cycleOnly: true }).messages).toEqual([{ t: "setting", key: "notifyAck", value: true }]);
  });

  it("sonido alterna (ausente en la vista cuenta como activo)", () => {
    const on = withSettings();
    const off = withSettings({ sound: false });
    expect(ROOT_ENTRIES[2]).toBe("sound");
    expect(run(at(on, 2), on, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "sound", value: false }]);
    expect(run(at(off, 2), off, { type: "activate", dir: -1, cycleOnly: true }).messages).toEqual([{ t: "setting", key: "sound", value: true }]);
    expect(run(at(withSettings({ sound: undefined }), 2), withSettings({ sound: undefined }), { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "sound", value: false }]);
  });

  it("preguntas en la 3DS alterna (ausente en la vista cuenta como activo)", () => {
    const on = withSettings();
    const off = withSettings({ questions: false });
    expect(ROOT_ENTRIES[3]).toBe("questions");
    expect(run(at(on, 3), on, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "questions", value: false }]);
    expect(run(at(off, 3), off, { type: "activate", dir: -1, cycleOnly: true }).messages).toEqual([{ t: "setting", key: "questions", value: true }]);
    const unset = withSettings({ questions: undefined });
    expect(run(at(unset, 3), unset, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "questions", value: false }]);
  });

  it("abrir mensajes en: A o izquierda/derecha alternan completo y resumen; sin el campo cuenta como completo", () => {
    expect(ROOT_ENTRIES[4]).toBe("reader");
    const full = withSettings({ readerDefault: "full" });
    const summary = withSettings({ readerDefault: "summary" });
    expect(run(at(full, 4), full, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "readerDefault", value: "summary" }]);
    expect(run(at(summary, 4), summary, { type: "activate", dir: -1, cycleOnly: true }).messages).toEqual([{ t: "setting", key: "readerDefault", value: "full" }]);
    const unset = withSettings({ readerDefault: undefined });
    expect(run(at(unset, 4), unset, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "readerDefault", value: "summary" }]);
  });

  it("agentes: A entra al submenú (izquierda/derecha no), A alterna el agente bajo el cursor y el mensaje trae la lista completa en orden", () => {
    const v = withSettings({ hiddenAgents: ["gemini"] });
    expect(run(at(v, 6), v, { type: "activate", dir: 1, cycleOnly: true }).state.level).toBe("root");
    const sub = run(at(v, 6), v, { type: "activate", dir: 1 }).state;
    expect(sub).toMatchObject({ level: "agents", cursor: 0, rootCursor: 6 });
    expect(run(sub, v, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "hiddenAgents", value: ["claude", "gemini"] }]);
    const second = run(sub, v, { type: "move", dy: 1 }).state;
    expect(run(second, v, { type: "activate", dir: 1, cycleOnly: true }).messages).toEqual([{ t: "setting", key: "hiddenAgents", value: [] }]);
    const last = run(sub, v, ...Array.from({ length: 10 }, () => ({ type: "move", dy: 1 }))).state;
    expect(last.cursor).toBe(4);
    expect(run(last, v, { type: "activate", dir: 1 }).messages).toEqual([{ t: "setting", key: "hiddenAgents", value: ["gemini", "hermes"] }]);
    // B sube a la raíz sobre "Agentes"; otra B cierra
    const back = run(sub, v, { type: "back" });
    expect(back.state).toMatchObject({ level: "root", cursor: 6 });
    const closed = run(back.state, v, { type: "back" });
    expect(closed.state.open).toBe(false);
    expect(closed.effects).toEqual([{ kind: "close" }]);
  });

  it("guía y diagnóstico son efectos locales (solo con A, no con izquierda/derecha)", () => {
    const v = withSettings();
    expect(run(at(v, 7), v, { type: "activate", dir: 1 }).effects).toEqual([{ kind: "guide" }]);
    expect(run(at(v, 8), v, { type: "activate", dir: 1 }).effects).toEqual([{ kind: "diag" }]);
    expect(run(at(v, 7), v, { type: "activate", dir: 1, cycleOnly: true }).effects).toEqual([]);
    expect(run(at(v, 8), v, { type: "activate", dir: -1, cycleOnly: true }).effects).toEqual([]);
  });

  it("tocar una fila la elige y la activa; fuera de rango no hace nada", () => {
    const v = withSettings();
    const r = run(open(v), v, { type: "select", row: 1 });
    expect(r.state.cursor).toBe(1);
    expect(r.messages).toEqual([{ t: "setting", key: "notifyAck", value: false }]);
    expect(run(open(v), v, { type: "select", row: 9 }).messages).toEqual([]);
  });
});

describe("menu: sin conexión", () => {
  it("sin vista con ajustes (puente anterior) las cinco primeras entradas no envían nada y no entran al submenú", () => {
    const v = baseView();
    for (const entry of ["notify", "ack", "sound", "questions", "reader", "instructWait", "agents"]) expect(entryEnabled(entry, v)).toBe(false);
    for (const entry of ["guide", "diag"]) expect(entryEnabled(entry, v)).toBe(true);
    for (let row = 0; row < 7; row++) {
      const r = run(at(v, row), v, { type: "activate", dir: 1 }, { type: "activate", dir: -1, cycleOnly: true });
      expect(r.messages).toEqual([]);
      expect(r.state.level).toBe("root");
    }
    expect(run(at(v, 7), v, { type: "activate", dir: 1 }).effects).toEqual([{ kind: "guide" }]);
    expect(run(at(v, 8), v, { type: "activate", dir: 1 }).effects).toEqual([{ kind: "diag" }]);
  });
});

describe("menu: esperar instrucción hasta (paso 6)", () => {
  it("es la entrada siguiente a abrir mensajes en y cicla 5 -> 10 -> 30 -> 5 con A o izquierda/derecha", () => {
    expect(ROOT_ENTRIES[5]).toBe("instructWait");
    const send = (max: number, over: object) => {
      const v = withSettings({ instructWaitMax: max });
      return run(at(v, 5), v, over).messages;
    };
    expect(send(5, { type: "activate", dir: 1 })).toEqual([{ t: "setting", key: "instructWaitMax", value: 10 }]);
    expect(send(10, { type: "activate", dir: 1 })).toEqual([{ t: "setting", key: "instructWaitMax", value: 30 }]);
    expect(send(30, { type: "activate", dir: 1 })).toEqual([{ t: "setting", key: "instructWaitMax", value: 5 }]);
    expect(send(10, { type: "activate", dir: -1, cycleOnly: true })).toEqual([{ t: "setting", key: "instructWaitMax", value: 5 }]);
    expect(send(5, { type: "activate", dir: -1, cycleOnly: true })).toEqual([{ t: "setting", key: "instructWaitMax", value: 30 }]);
  });

  it("sin settings.instructWaitMax (un puente sin instrucciones) la entrada sale apagada y no envía nada", () => {
    const v = withSettings();
    expect(entryEnabled("instructWait", v)).toBe(false);
    expect(run(at(v, 5), v, { type: "activate", dir: 1 }).messages).toEqual([]);
    expect(entryEnabled("instructWait", withSettings({ instructWaitMax: 10 }))).toBe(true);
    expect(entryEnabled("instructWait", baseView())).toBe(false);
  });
});
