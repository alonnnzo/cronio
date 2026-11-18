import { describe, expect, it } from "vitest";
import {
  entradasNuestras,
  estadoHooks,
  esNuestro,
  fusionarSettings,
  HOOK_EVENTOS,
  HOOK_URL,
  leerSettings,
  nombreRespaldo,
  quitarDeSettings,
  rutaDeComando,
  serializarSettings,
} from "../src/setup/settings.ts";

const SCRIPT = "C:/Users/x/AppData/Roaming/agent-companion/hooks/permission-hook.mjs";
const AJENO = { matcher: "Bash", hooks: [{ type: "command", command: "echo hola", timeout: 5 }] };

describe("fusionarSettings", () => {
  it("parte de {} y agrega todos los eventos", () => {
    const r = fusionarSettings({}, SCRIPT) as { hooks: Record<string, unknown[]> };
    expect(Object.keys(r.hooks)).toEqual(HOOK_EVENTOS.map((e) => e.evento));
    expect(r.hooks.PermissionRequest).toEqual(entradasNuestras(SCRIPT).PermissionRequest);
  });

  it("es idempotente", () => {
    const una = fusionarSettings({ model: "x", hooks: { PreToolUse: [AJENO] } }, SCRIPT);
    const dos = fusionarSettings(una, SCRIPT);
    expect(dos).toEqual(una);
    expect(serializarSettings(dos)).toBe(serializarSettings(una));
  });

  it("conserva hooks ajenos y otras claves", () => {
    const r = fusionarSettings({ theme: "dark", hooks: { PreToolUse: [AJENO], Otro: [AJENO] } }, SCRIPT) as {
      theme: string;
      hooks: Record<string, unknown[]>;
    };
    expect(r.theme).toBe("dark");
    expect(r.hooks.Otro).toEqual([AJENO]);
    expect(r.hooks.PreToolUse?.[0]).toEqual(AJENO);
    expect(r.hooks.PreToolUse).toHaveLength(2);
  });

  it("reemplaza nuestras entradas viejas (otra ruta) sin duplicar", () => {
    const vieja = fusionarSettings({}, "C:/repo/packages/hooks/permission-hook.mjs");
    const nueva = fusionarSettings(vieja, SCRIPT);
    expect(nueva).toEqual(fusionarSettings({}, SCRIPT));
    expect(JSON.stringify(nueva)).not.toContain("C:/repo");
  });

  it("quita nuestro hook de un grupo compartido con uno ajeno y deja el ajeno", () => {
    const mixto = { hooks: { Stop: [{ hooks: [{ type: "http", url: HOOK_URL }, { type: "command", command: "echo x" }] }] } };
    const r = fusionarSettings(mixto, SCRIPT) as { hooks: { Stop: { hooks: unknown[] }[] } };
    expect(r.hooks.Stop[0]?.hooks).toEqual([{ type: "command", command: "echo x" }]);
    expect(r.hooks.Stop).toHaveLength(2);
  });

  it("no modifica el objeto recibido", () => {
    const entrada = { hooks: { PreToolUse: [AJENO] } };
    const copia = JSON.stringify(entrada);
    fusionarSettings(entrada, SCRIPT);
    expect(JSON.stringify(entrada)).toBe(copia);
  });

  it("ignora un campo hooks con forma rara en un evento", () => {
    const r = fusionarSettings({ hooks: { Raro: "texto" } }, SCRIPT) as { hooks: Record<string, unknown> };
    expect(r.hooks.Raro).toBe("texto");
  });
});

describe("quitarDeSettings", () => {
  it("quita solo las nuestras", () => {
    const con = fusionarSettings({ model: "x", hooks: { PreToolUse: [AJENO] } }, SCRIPT);
    expect(quitarDeSettings(con)).toEqual({ model: "x", hooks: { PreToolUse: [AJENO] } });
  });

  it("elimina la clave hooks si queda vacía", () => {
    expect(quitarDeSettings(fusionarSettings({ a: 1 }, SCRIPT))).toEqual({ a: 1 });
  });

  it("sin hooks no cambia nada", () => {
    expect(quitarDeSettings({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("esNuestro", () => {
  it("reconoce la url y el script", () => {
    expect(esNuestro({ type: "http", url: HOOK_URL })).toBe(true);
    expect(esNuestro({ type: "command", command: "node C:/a/b/permission-hook.mjs" })).toBe(true);
    expect(esNuestro({ type: "command", command: 'node "C:/a b/permission-hook.mjs"' })).toBe(true);
  });
  it("no confunde hooks ajenos", () => {
    expect(esNuestro({ type: "http", url: "http://127.0.0.1:9999/x" })).toBe(false);
    expect(esNuestro({ type: "command", command: "node other-hook.mjs" })).toBe(false);
    expect(esNuestro(null)).toBe(false);
    expect(esNuestro("x")).toBe(false);
  });
});

describe("estadoHooks", () => {
  it("vacío: faltan todos", () => {
    const e = estadoHooks({}, () => true);
    expect(e.ok).toBe(false);
    expect(e.faltan).toHaveLength(HOOK_EVENTOS.length);
  });
  it("completo y con el script existente: ok", () => {
    const e = estadoHooks(fusionarSettings({}, SCRIPT), (r) => r === SCRIPT);
    expect(e.ok).toBe(true);
    expect(e.scripts).toEqual([SCRIPT]);
  });
  it("script ausente: no ok", () => {
    const e = estadoHooks(fusionarSettings({}, SCRIPT), () => false);
    expect(e.ok).toBe(false);
    expect(e.scriptsFaltantes).toEqual([SCRIPT]);
  });
  it("falta un evento", () => {
    const s = fusionarSettings({}, SCRIPT) as { hooks: Record<string, unknown> };
    delete s.hooks.SessionEnd;
    expect(estadoHooks(s, () => true).faltan).toEqual(["SessionEnd"]);
  });
});

describe("leerSettings / serializarSettings / nombreRespaldo / rutaDeComando", () => {
  it("vacío o ausente es {}", () => {
    expect(leerSettings(undefined)).toEqual({});
    expect(leerSettings("  \n")).toEqual({});
  });
  it("rechaza JSON inválido y no-objetos", () => {
    expect(() => leerSettings("{ no")).toThrow(/no es un JSON válido/);
    expect(() => leerSettings("[1]")).toThrow(/objeto/);
  });
  it("serializa con 2 espacios y salto final", () => {
    expect(serializarSettings({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });
  it("nombre del respaldo", () => {
    expect(nombreRespaldo(new Date(2026, 10, 16, 9, 5, 7))).toBe("settings.json.bak-companion-20261116-090507");
  });
  it("ruta del comando", () => {
    expect(rutaDeComando("node C:/x/permission-hook.mjs")).toBe("C:/x/permission-hook.mjs");
    expect(rutaDeComando('node "C:/a b/permission-hook.mjs"')).toBe("C:/a b/permission-hook.mjs");
    expect(rutaDeComando("python x")).toBeUndefined();
  });
});
