// Endurecimientos del programa del PC: escritura atómica del settings.json, comando del hook entre comillas, poda de respaldos,
// ejecutables de sistema con ruta absoluta y regla de firewall solo para la subred local. Carpetas temporales: nada toca el ~/.claude real.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agregarHooks, escribirAtomico, podarRespaldos, quitarHooks, RESPALDOS_A_CONSERVAR, revisarHooks } from "../src/setup/apply.ts";
import type { RutasHooks } from "../src/setup/apply.ts";
import { argsAgregarRegla, comandoElevadoReemplazar, NETSH_EN_CMD } from "../src/setup/firewall.ts";
import { entradasNuestras, esNuestro, fusionarSettings, HOOK_URL, rutaDeComando } from "../src/setup/settings.ts";
import { carpetaWindows, rutaPowerShell, rutaPrograma, rutaSystem32 } from "../src/setup/sistema.ts";

let dir: string;
let rutas: RutasHooks;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-endurecimiento-"));
  const origen = join(dir, "origen-hook.mjs");
  writeFileSync(origen, "// hook de prueba\n");
  const carpetasOrigen = join(dir, "origen-carpetas.mjs");
  writeFileSync(carpetasOrigen, "// carpetas de prueba\n");
  rutas = { settingsPath: join(dir, ".claude", "settings.json"), hooksDir: join(dir, "appdata", "hooks"), hookOrigen: origen, carpetasOrigen, datosDir: join(dir, "appdata") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const nombresDe = (carpeta: string, parte: string) => readdirSync(carpeta).filter((f) => f.includes(parte)).sort();

describe("settings.json: escritura atómica", () => {
  it("escribe el contenido completo y no deja archivos temporales", () => {
    mkdirSync(join(dir, "x"));
    const ruta = join(dir, "x", "settings.json");
    escribirAtomico(ruta, "uno\n");
    escribirAtomico(ruta, "dos\n"); // reemplaza uno existente
    expect(readFileSync(ruta, "utf8")).toBe("dos\n");
    expect(readdirSync(join(dir, "x"))).toEqual(["settings.json"]);
  });

  it("si no se puede escribir, el original queda intacto y no sobra el temporal", () => {
    mkdirSync(join(dir, "y"));
    const ruta = join(dir, "y", "settings.json");
    writeFileSync(ruta, "original\n");
    expect(() => escribirAtomico(join(dir, "no-existe", "settings.json"), "x")).toThrow();
    expect(readFileSync(ruta, "utf8")).toBe("original\n");
  });

  it("agregar y quitar los hooks pasan por ahí: sin temporales a la vista", () => {
    agregarHooks(rutas, new Date(2026, 10, 16, 10, 0, 0));
    expect(nombresDe(join(dir, ".claude"), ".tmp-companion-")).toEqual([]);
    quitarHooks(rutas, new Date(2026, 10, 16, 10, 0, 5));
    expect(nombresDe(join(dir, ".claude"), ".tmp-companion-")).toEqual([]);
    expect(existsSync(rutas.settingsPath)).toBe(true);
  });
});

describe("respaldos del settings.json", () => {
  it("conserva solo los 5 últimos y no toca lo que no es nuestro", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(rutas.settingsPath, "{}\n");
    for (let s = 0; s < 8; s++) {
      writeFileSync(join(dir, ".claude", `settings.json.bak-companion-20261116-10000${s}`), `r${s}`);
    }
    writeFileSync(join(dir, ".claude", "settings.json.bak-otro"), "ajeno");
    writeFileSync(join(dir, ".claude", "settings.json.bak-companion-malo"), "ajeno");
    const borrados = podarRespaldos(join(dir, ".claude"));
    expect(borrados).toEqual(["settings.json.bak-companion-20261116-100000", "settings.json.bak-companion-20261116-100001", "settings.json.bak-companion-20261116-100002"]);
    expect(nombresDe(join(dir, ".claude"), ".bak-companion-2026")).toHaveLength(RESPALDOS_A_CONSERVAR);
    expect(existsSync(join(dir, ".claude", "settings.json.bak-otro"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "settings.json.bak-companion-malo"))).toBe(true);
  });

  it("agregar muchas veces deja como máximo 5 respaldos, los más nuevos", () => {
    agregarHooks(rutas, new Date(2026, 10, 16, 10, 0, 0)); // sin respaldo: no había settings
    for (let s = 1; s <= 9; s++) agregarHooks(rutas, new Date(2026, 10, 16, 10, 0, s));
    const bak = nombresDe(join(dir, ".claude"), ".bak-companion-");
    expect(bak).toHaveLength(5);
    expect(bak[0]).toBe("settings.json.bak-companion-20261116-100005");
    expect(bak[4]).toBe("settings.json.bak-companion-20261116-100009");
  });

  it("una carpeta que no existe no es un error", () => {
    expect(podarRespaldos(join(dir, "nada"))).toEqual([]);
  });
});

describe("comando del hook entre comillas", () => {
  const SCRIPT = "C:/Users/yo/AppData/Roaming/agent-companion/hooks/permission-hook.mjs";
  const CON_ESPACIOS = "C:/Users/Ana Maria/AppData/Roaming/agent-companion/hooks/permission-hook.mjs";

  it("las entradas nuevas llevan la ruta entre comillas dobles", () => {
    const e = entradasNuestras(CON_ESPACIOS);
    const cmd = (e.PermissionRequest![0]!.hooks as { command: string }[])[0]!.command;
    expect(cmd).toBe(`node "${CON_ESPACIOS}"`);
    expect(rutaDeComando(cmd)).toBe(CON_ESPACIOS);
    expect(esNuestro({ type: "command", command: cmd })).toBe(true);
  });

  it("las entradas viejas, sin comillas, se siguen reconociendo y se reemplazan por las nuevas", () => {
    const vieja = { type: "command", command: `node ${SCRIPT}`, timeout: 86400 };
    expect(esNuestro(vieja)).toBe(true);
    expect(rutaDeComando(vieja.command)).toBe(SCRIPT);
    const ajeno = { type: "command", command: "node otro.mjs" };
    const r = fusionarSettings({ hooks: { PermissionRequest: [{ matcher: "*", hooks: [vieja] }, { hooks: [ajeno] }], Stop: [{ hooks: [{ type: "http", url: HOOK_URL }] }] } }, SCRIPT) as {
      hooks: Record<string, { hooks: { command?: string }[] }[]>;
    };
    const comandos = r.hooks.PermissionRequest!.flatMap((g) => g.hooks.map((h) => h.command));
    expect(comandos).toContain("node otro.mjs");
    expect(comandos).toContain(`node "${SCRIPT}"`);
    expect(comandos).not.toContain(`node ${SCRIPT}`);
  });

  it("revisarHooks encuentra el script en un comando con comillas y en uno sin ellas", () => {
    agregarHooks(rutas, new Date(2026, 10, 16, 10, 0, 0));
    const nuevo = revisarHooks(rutas);
    expect(nuevo.ok).toBe(true);
    // el mismo settings pero con el formato anterior (sin comillas)
    const texto = readFileSync(rutas.settingsPath, "utf8").split(`node \\"`).join("node ").split(`.mjs\\"`).join(".mjs");
    writeFileSync(rutas.settingsPath, texto);
    const viejo = revisarHooks(rutas);
    expect(viejo.scripts).toEqual(nuevo.scripts);
    expect(viejo.ok).toBe(true);
  });
});

describe("programas de sistema con ruta absoluta", () => {
  const ENV = { SystemRoot: "C:\\Windows" };

  it("usa %SystemRoot%\\System32", () => {
    expect(rutaSystem32("netsh.exe", ENV)).toBe("C:\\Windows\\System32\\netsh.exe");
    expect(rutaPowerShell(ENV)).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(rutaPrograma("taskkill", ENV)).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(rutaPrograma("tasklist", ENV)).toBe("C:\\Windows\\System32\\tasklist.exe");
    expect(rutaPrograma("netstat", ENV)).toBe("C:\\Windows\\System32\\netstat.exe");
    expect(rutaPrograma("powershell", ENV)).toBe(rutaPowerShell(ENV));
  });

  it("respeta otra carpeta de Windows y, sin variable, cae en C:\\Windows", () => {
    expect(carpetaWindows({ SystemRoot: "D:\\WINNT" })).toBe("D:\\WINNT");
    expect(carpetaWindows({ windir: "E:\\Win" })).toBe("E:\\Win");
    expect(rutaSystem32("netsh.exe", {})).toBe("C:\\Windows\\System32\\netsh.exe");
  });

  it("ninguna ruta es un nombre suelto", () => {
    for (const p of ["powershell", "netsh", "taskkill", "tasklist", "netstat"] as const) expect(rutaPrograma(p, ENV)).toMatch(/^[A-Z]:\\.*\\System32\\/);
  });
});

describe("regla de firewall", () => {
  it("solo acepta conexiones de la subred local", () => {
    expect(argsAgregarRegla()).toContain("remoteip=localsubnet");
    expect(argsAgregarRegla().join(" ")).toBe(
      "advfirewall firewall add rule name=Cronio dir=in action=allow protocol=TCP localport=33334,33337 remoteip=localsubnet profile=private",
    );
  });

  it("el comando elevado llama a netsh.exe por su ruta completa, no por el nombre suelto", () => {
    const c = comandoElevadoReemplazar();
    expect(NETSH_EN_CMD).toBe("%SystemRoot%\\System32\\netsh.exe");
    expect(c.split(NETSH_EN_CMD)).toHaveLength(4); // borrar la antigua, borrar la actual y agregar
    expect(c).not.toMatch(/(^|[ &'])netsh /);
    expect(c).toContain("remoteip=localsubnet");
  });
});
