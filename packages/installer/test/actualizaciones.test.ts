import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  argsInstalador,
  compararVersiones,
  copiarYVerificar,
  debeNotificar,
  decidirOferta,
  leerConfigGithub,
  leerLatestYml,
  sha512Base64,
  tocaBuscar,
} from "../src/setup/actualizaciones.ts";
import { actualizacionesPorDefecto, guardarActualizaciones, guardarVersionAvisada, leerAjustesApp, rutaAjustes } from "../src/setup/app-ajustes.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-act-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha = (buf: Buffer | string) => createHash("sha512").update(buf).digest("base64");

const latestYml = (version: string, path: string, sha512: string) =>
  `version: ${version}\nfiles:\n  - url: ${path}\n    sha512: ${sha512}\n    size: 123\npath: ${path}\nsha512: ${sha512}\nreleaseDate: '2026-11-16T10:00:00.000Z'\n`;

describe("compararVersiones", () => {
  it("compara número a número, no como texto", () => {
    expect(compararVersiones("0.2.10", "0.2.9")).toBe(1);
    expect(compararVersiones("0.2.2", "0.2.2")).toBe(0);
    expect(compararVersiones("0.2.2", "1.0.0")).toBe(-1);
    expect(compararVersiones("v1.2.3", "1.2.3")).toBe(0);
  });
  it("una versión con -pre es menor que la final y se ordenan entre sí", () => {
    expect(compararVersiones("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compararVersiones("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compararVersiones("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compararVersiones("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
  it("algo que no es versión no se compara", () => {
    expect(compararVersiones("hola", "1.0.0")).toBeUndefined();
    expect(compararVersiones("1.0", "1.0.0")).toBeUndefined();
    expect(compararVersiones(undefined, "1.0.0")).toBeUndefined();
  });
});

describe("leerLatestYml", () => {
  const S = sha("x");
  it("lee version, path y sha512 de primer nivel (no los de files)", () => {
    const l = leerLatestYml(latestYml("0.3.0", "Cronio-Setup-0.3.0.exe", S));
    expect(l).toEqual({ ok: true, latest: { version: "0.3.0", path: "Cronio-Setup-0.3.0.exe", sha512: S } });
  });
  it("acepta CRLF, comillas y comentarios al final", () => {
    const t = `version: "0.3.0"\r\npath: 'Cronio-Setup-0.3.0.exe'  # comentario\r\nsha512: ${S}\r\n`;
    expect(leerLatestYml(t)).toMatchObject({ ok: true, latest: { version: "0.3.0", path: "Cronio-Setup-0.3.0.exe" } });
  });
  it("rechaza lo incompleto o peligroso", () => {
    expect(leerLatestYml("")).toMatchObject({ ok: false });
    expect(leerLatestYml(`version: 0.3.0\nsha512: ${S}\n`)).toMatchObject({ ok: false });
    expect(leerLatestYml(`version: 0.3.0\npath: Cronio.exe\nsha512: corto\n`)).toMatchObject({ ok: false });
    expect(leerLatestYml(`version: abc\npath: Cronio.exe\nsha512: ${S}\n`)).toMatchObject({ ok: false });
  });
  it("el path es solo un nombre de .exe: nada de carpetas ni de otros tipos", () => {
    for (const p of ["..\\x.exe", "../x.exe", "C:/x.exe", "sub/x.exe", "x.bat", "x.exe.lnk"]) {
      expect(leerLatestYml(latestYml("0.3.0", p, S))).toMatchObject({ ok: false });
    }
  });
});

describe("decidirOferta", () => {
  it("ofrece solo si la publicada es mayor", () => {
    expect(decidirOferta("0.2.2", "0.3.0")).toEqual({ tipo: "nueva", version: "0.3.0" });
    expect(decidirOferta("0.2.2", "0.2.2")).toEqual({ tipo: "al-dia" });
    expect(decidirOferta("0.3.0", "0.2.2")).toEqual({ tipo: "al-dia" });
  });
  it("versiones ilegibles no se ofrecen", () => {
    expect(decidirOferta("0.2.2", "nueva")).toMatchObject({ tipo: "ilegible" });
  });
});

describe("debeNotificar", () => {
  it("una sola vez por versión", () => {
    expect(debeNotificar(undefined, "0.3.0")).toBe(true);
    expect(debeNotificar("0.3.0", "0.3.0")).toBe(false);
    expect(debeNotificar("0.3.0", "0.4.0")).toBe(true);
  });
});

describe("sha512 y copia del instalador", () => {
  it("calcula el sha512 en base64 igual que electron-builder", async () => {
    const f = join(dir, "a.exe");
    writeFileSync(f, "contenido");
    expect(await sha512Base64(f)).toBe(sha("contenido"));
  });

  it("copia a una carpeta temporal y deja el instalador si el sha512 coincide", async () => {
    const carpeta = join(dir, "release");
    const tmp = join(dir, "tmp");
    mkdirSync(carpeta);
    mkdirSync(tmp);
    writeFileSync(join(carpeta, "Cronio-Setup-0.3.0.exe"), "instalador bueno");
    const r = await copiarYVerificar({ carpeta, tmp, latest: { version: "0.3.0", path: "Cronio-Setup-0.3.0.exe", sha512: sha("instalador bueno") } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(existsSync(r.ruta)).toBe(true);
      expect(r.ruta.startsWith(tmp)).toBe(true);
    }
  });

  it("si el sha512 no coincide, no entrega nada y borra la copia", async () => {
    const carpeta = join(dir, "release");
    const tmp = join(dir, "tmp");
    mkdirSync(carpeta);
    mkdirSync(tmp);
    writeFileSync(join(carpeta, "Cronio-Setup-0.3.0.exe"), "instalador cambiado");
    const r = await copiarYVerificar({ carpeta, tmp, latest: { version: "0.3.0", path: "Cronio-Setup-0.3.0.exe", sha512: sha("instalador bueno") } });
    expect(r).toMatchObject({ ok: false });
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("si el instalador no está, lo dice y no deja carpetas", async () => {
    const carpeta = join(dir, "release");
    const tmp = join(dir, "tmp");
    mkdirSync(carpeta);
    mkdirSync(tmp);
    const r = await copiarYVerificar({ carpeta, tmp, latest: { version: "0.3.0", path: "Cronio-Setup-0.3.0.exe", sha512: sha("x") } });
    expect(r).toMatchObject({ ok: false });
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe("argsInstalador", () => {
  it("lleva --updated y no /S (la ventana de progreso tiene que verse)", () => {
    expect(argsInstalador()).toEqual(["--updated"]);
    expect(argsInstalador()).not.toContain("/S");
  });
});

describe("leerConfigGithub", () => {
  it("POR_DEFINIR = todavía no hay versiones publicadas", () => {
    expect(leerConfigGithub("owner: POR_DEFINIR\nrepo: cronio\nprovider: github\nupdaterCacheDirName: cronio-updater\n")).toEqual({ estado: "por-definir" });
  });
  it("con dueño real queda definido", () => {
    expect(leerConfigGithub("owner: alguien\nrepo: cronio\nprovider: github\n")).toEqual({ estado: "definido", owner: "alguien", repo: "cronio" });
  });
  it("sin archivo o con otro proveedor, no hay GitHub", () => {
    expect(leerConfigGithub(undefined)).toEqual({ estado: "ausente" });
    expect(leerConfigGithub("provider: generic\nurl: http://x\n")).toEqual({ estado: "ausente" });
  });
});

describe("app.json (ajustes del programa)", () => {
  it("sin archivo y sin carpeta conocida: origen ninguno", () => {
    expect(leerAjustesApp(dir)).toEqual({ actualizaciones: { origen: "ninguno" }, porDefecto: true });
  });

  it("por defecto es local solo si la carpeta conocida existe en este PC", () => {
    const release = join(dir, "release");
    expect(actualizacionesPorDefecto(release)).toEqual({ origen: "ninguno" });
    mkdirSync(release);
    expect(actualizacionesPorDefecto(release)).toEqual({ origen: "local", carpeta: release });
    expect(leerAjustesApp(dir, release)).toMatchObject({ actualizaciones: { origen: "local", carpeta: release }, porDefecto: true });
  });

  it("GitHub nunca es el valor por defecto", () => {
    expect(leerAjustesApp(dir, join(dir, "no-existe")).actualizaciones.origen).toBe("ninguno");
  });

  it("lo guardado manda sobre el valor por defecto y se conserva el resto del archivo", () => {
    const release = join(dir, "release");
    mkdirSync(release);
    guardarVersionAvisada(dir, "0.3.0");
    guardarActualizaciones(dir, { origen: "github" });
    expect(leerAjustesApp(dir, release)).toEqual({ actualizaciones: { origen: "github" }, ultimaVersionAvisada: "0.3.0", porDefecto: false });
    guardarActualizaciones(dir, { origen: "ninguno" });
    expect(leerAjustesApp(dir, release)).toMatchObject({ actualizaciones: { origen: "ninguno" }, ultimaVersionAvisada: "0.3.0", porDefecto: false });
  });

  it("un archivo roto o con otro origen vuelve al valor por defecto", () => {
    writeFileSync(rutaAjustes(dir), "{roto");
    expect(leerAjustesApp(dir).actualizaciones.origen).toBe("ninguno");
    writeFileSync(rutaAjustes(dir), JSON.stringify({ actualizaciones: { origen: "ftp" } }));
    expect(leerAjustesApp(dir)).toMatchObject({ actualizaciones: { origen: "ninguno" }, porDefecto: true });
  });
});

describe("tocaBuscar", () => {
  const T = 1_000_000_000;
  const SEIS_H = 6 * 60 * 60 * 1000;
  it("«ninguno» nunca busca", () => {
    for (const m of ["inicio", "intervalo", "foco"] as const) expect(tocaBuscar("ninguno", T, undefined, m)).toBe(false);
  });
  it("al iniciar busca con cualquier origen activo", () => {
    expect(tocaBuscar("local", T, T, "inicio")).toBe(true);
    expect(tocaBuscar("github", T, T, "inicio")).toBe(true);
  });
  it("carpeta local: cada 60 s", () => {
    expect(tocaBuscar("local", T, undefined, "intervalo")).toBe(true);
    expect(tocaBuscar("local", T, T - 59_000, "intervalo")).toBe(false);
    expect(tocaBuscar("local", T, T - 60_000, "intervalo")).toBe(true);
  });
  it("carpeta local: con el foco solo si pasaron más de 15 s", () => {
    expect(tocaBuscar("local", T, T - 15_000, "foco")).toBe(false);
    expect(tocaBuscar("local", T, T - 15_001, "foco")).toBe(true);
    expect(tocaBuscar("local", T, undefined, "foco")).toBe(true);
  });
  it("GitHub: cada 6 h y el foco no cuenta", () => {
    expect(tocaBuscar("github", T, T - SEIS_H + 1, "intervalo")).toBe(false);
    expect(tocaBuscar("github", T, T - SEIS_H, "intervalo")).toBe(true);
    expect(tocaBuscar("github", T, undefined, "foco")).toBe(false);
    expect(tocaBuscar("github", T, T - 10 * SEIS_H, "foco")).toBe(false);
  });
});
