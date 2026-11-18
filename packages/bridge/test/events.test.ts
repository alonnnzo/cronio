import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventLog } from "../src/events.ts";
import { BridgeStore } from "../src/store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bridge-events-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (p: string) =>
  readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("EventLog", () => {
  it("escribe JSONL, creando carpetas", () => {
    const path = join(dir, "sub", "events.jsonl");
    const log = new EventLog(path);
    log.log("agent_seen", { sessionId: "s1" });
    log.log("console_connected");
    const lines = read(path);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "agent_seen", sessionId: "s1" });
    expect(typeof lines[0]!.ts).toBe("string");
    expect(lines[1]!.type).toBe("console_connected");
  });

  it("no lanza si la ruta es inválida", () => {
    expect(() => new EventLog(join(dir, "\0bad")).log("state")).not.toThrow();
  });

  it("el store registra eventos", async () => {
    const path = join(dir, "events.jsonl");
    const store = new BridgeStore({ events: new EventLog(path) });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "p" });
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" } });
    store.decide(store.focusedRequest!.id, "allow");
    await p;
    store.setConsoleConnected(false);
    const types = read(path).map((e) => e.type);
    expect(types).toEqual([
      "agent_seen",
      "console_connected",
      "request",
      "state",
      "notice", // el permiso también suena (chime) con el modo de aviso por defecto
      "decision",
      "state",
      "console_disconnected",
    ]);
  });
});
