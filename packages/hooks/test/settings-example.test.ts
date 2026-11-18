import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = JSON.parse(readFileSync(new URL("../settings.example.json", import.meta.url), "utf8")) as {
  hooks: Record<string, { matcher?: string; hooks: { type: string; url?: string; command?: string; timeout: number }[] }[]>;
};

describe("settings.example.json", () => {
  it("conserva el hook de permisos como comando", () => {
    const h = settings.hooks.PermissionRequest![0]!.hooks[0]!;
    expect(h).toMatchObject({ type: "command", timeout: 86400 });
    expect(h.command).toContain("permission-hook.mjs");
  });

  it("registra los eventos de estado como hooks http hacia /hook/claude con timeout 2", () => {
    for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "Stop", "SessionEnd"]) {
      const entries = settings.hooks[ev];
      expect(entries, ev).toBeDefined();
      expect(entries![0]!.hooks[0], ev).toEqual({ type: "http", url: "http://127.0.0.1:33335/hook/claude", timeout: 2 });
    }
  });
});

describe("settings.example.json (instrucciones, paso 6)", () => {
  it("Stop trae el hook http de estado y, a su lado, el comando de instrucciones con timeout 3600", () => {
    const hooks = settings.hooks.Stop![0]!.hooks;
    expect(hooks).toHaveLength(2);
    expect(hooks[0]).toEqual({ type: "http", url: "http://127.0.0.1:33335/hook/claude", timeout: 2 });
    expect(hooks[1]).toMatchObject({ type: "command", timeout: 3600 });
    expect(hooks[1]!.command).toBe(settings.hooks.PermissionRequest![0]!.hooks[0]!.command);
  });

  it("es el único evento con dos hooks (el comando solo se agrega a Stop)", () => {
    for (const [ev, entries] of Object.entries(settings.hooks)) {
      if (ev === "Stop") continue;
      expect(entries.every((e) => e.hooks.length === 1), ev).toBe(true);
    }
  });
});

describe("settings.example.json (preguntas, paso 4)", () => {
  it("las preguntas van por la entrada * de PermissionRequest: no hay entrada PreToolUse de AskUserQuestion", () => {
    expect(settings.hooks.PermissionRequest![0]!.matcher).toBe("*");
    const entries = settings.hooks.PreToolUse!;
    expect(entries.find((e) => e.matcher === "AskUserQuestion")).toBeUndefined();
    // el PreToolUse que queda es solo el hook http de estado de `*`
    expect(entries).toHaveLength(1);
    expect(entries[0]!.matcher).toBe("*");
    expect(entries[0]!.hooks[0]!.type).toBe("http");
    expect(JSON.stringify(settings)).not.toContain("AskUserQuestion");
  });
});
