import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { comandoPuente, crearRutas } from "../src/paths.ts";

const REPO = resolve("/repo");
const DIST = join(REPO, "packages", "installer", "dist");
const RECURSOS = resolve("/Programas/Cronio/resources");
const EXE = resolve("/Programas/Cronio/Cronio.exe");

describe("crearRutas en desarrollo", () => {
  const r = crearRutas({ empaquetada: false, dirMain: DIST });
  it("sube a la raíz del repo", () => {
    expect(r.raizRepo).toBe(REPO);
    expect(r.cia).toBe(join(REPO, "client-3ds", "agent-companion.cia"));
    expect(r.ciaVersion).toBe(join(REPO, "client-3ds", "agent-companion.version"));
    expect(r.tresdsx).toBe(join(REPO, "client-3ds", "agent-companion.3dsx"));
    expect(r.hookOrigen).toBe(join(REPO, "packages", "hooks", "permission-hook.mjs"));
    expect(r.carpetasOrigen).toBe(join(REPO, "packages", "hooks", "carpetas.mjs"));
    expect(r.skillGrillMe).toBe(join(REPO, "packages", "hooks", "skills", "grill-me", "SKILL.md"));
    expect(r.simulador).toBe(join(REPO, "packages", "simulator", "public"));
  });
  it("renderer, ícono y preload salen del paquete", () => {
    const paquete = join(REPO, "packages", "installer");
    expect(r.renderer).toBe(join(paquete, "renderer", "index.html"));
    expect(r.ico).toBe(join(paquete, "assets", "cronio.ico"));
    expect(r.preload).toBe(join(DIST, "preload.js"));
  });
});

describe("crearRutas empaquetada", () => {
  const asar = join(RECURSOS, "app.asar");
  const r = crearRutas({ empaquetada: true, dirMain: join(asar, "dist"), recursos: RECURSOS });
  it("toma los recursos de resourcesPath y no tiene raíz de repo", () => {
    expect(r.raizRepo).toBeUndefined();
    expect(r.cia).toBe(join(RECURSOS, "client-3ds", "agent-companion.cia"));
    expect(r.ciaVersion).toBe(join(RECURSOS, "client-3ds", "agent-companion.version"));
    expect(r.tresdsx).toBe(join(RECURSOS, "client-3ds", "agent-companion.3dsx"));
    expect(r.hookOrigen).toBe(join(RECURSOS, "hooks", "permission-hook.mjs"));
    expect(r.carpetasOrigen).toBe(join(RECURSOS, "hooks", "carpetas.mjs"));
    expect(r.skillGrillMe).toBe(join(RECURSOS, "skills", "grill-me", "SKILL.md"));
    expect(r.ico).toBe(join(RECURSOS, "assets", "cronio.ico"));
    expect(r.simulador).toBe(join(RECURSOS, "simulator"));
  });
  it("renderer y preload viven dentro del asar", () => {
    expect(r.renderer).toBe(join(asar, "renderer", "index.html"));
    expect(r.preload).toBe(join(asar, "dist", "preload.js"));
  });
  it("exige la carpeta de recursos", () => {
    expect(() => crearRutas({ empaquetada: true, dirMain: DIST })).toThrow();
  });
});

describe("comandoPuente", () => {
  it("en desarrollo usa node con tsx desde la raíz del repo", () => {
    const c = comandoPuente({ empaquetada: false, dirMain: DIST }, "datos");
    expect(c.archivo).toBe("node");
    expect(c.args).toEqual(["--import", "tsx", "packages/bridge/src/cli.ts", "start"]);
    expect(c.cwd).toBe(REPO);
    // el puente sirve el .cia del repo (y lee su versión del .version que está al lado)
    // y en desarrollo el simulador sigue como siempre: no se le pasa COMPANION_SIMULATOR
    expect(c.env).toEqual({ COMPANION_CIA_PATH: join(REPO, "client-3ds", "agent-companion.cia") });
    expect(c.env.COMPANION_SIMULATOR).toBeUndefined();
  });
  it("empaquetado usa el propio ejecutable como Node con el bundle", () => {
    const c = comandoPuente({ empaquetada: true, dirMain: DIST, recursos: RECURSOS, ejecutable: EXE }, join("C:", "datos"));
    expect(c.archivo).toBe(EXE);
    expect(c.args[0]).toBe(join(RECURSOS, "bridge", "cli.mjs"));
    expect(c.args.slice(1)).toEqual(["start", "--data-dir", join("C:", "datos", "bridge")]);
    expect(c.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(c.env.COMPANION_STATIC_DIR).toBe(join(RECURSOS, "simulator"));
    expect(c.env.COMPANION_CIA_PATH).toBe(join(RECURSOS, "client-3ds", "agent-companion.cia"));
    // el programa instalado no levanta el simulador (su WebSocket deja decidir permisos a cualquier proceso local)
    expect(c.env.COMPANION_SIMULATOR).toBe("0");
  });
});

describe("versión del puente que trae la app", () => {
  it("en desarrollo sale del package.json del puente; empaquetada, de bridge/cli.version", () => {
    expect(crearRutas({ empaquetada: false, dirMain: DIST }).puenteVersion).toBe(join(REPO, "packages", "bridge", "package.json"));
    const asar = join(RECURSOS, "app.asar");
    expect(crearRutas({ empaquetada: true, dirMain: join(asar, "dist"), recursos: RECURSOS }).puenteVersion).toBe(join(RECURSOS, "bridge", "cli.version"));
  });
});
