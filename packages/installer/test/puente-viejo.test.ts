import { describe, expect, it } from "vitest";
import { decidirPuenteExistente, evaluarCierrePid, parsearNetstat, parsearTasklist } from "../src/setup/puente-viejo.ts";

describe("decidirPuenteExistente", () => {
  const v = "0.2.1";
  it("sin puente: nada que decidir", () => {
    expect(decidirPuenteExistente({ puente: undefined, versionBundle: v })).toBe("sin-puente");
  });
  it("misma versión: lo usa, sea quien sea quien lo lanzó (incluido uno de desarrollo)", () => {
    expect(decidirPuenteExistente({ puente: { version: v, startedBy: "manual" }, versionBundle: v })).toBe("usar");
    expect(decidirPuenteExistente({ puente: { version: v, startedBy: "cronio" }, versionBundle: v })).toBe("usar");
  });
  it("otra versión: pide el cierre", () => {
    expect(decidirPuenteExistente({ puente: { version: "0.2.0" }, versionBundle: v })).toBe("pedir-cierre");
  });
  it("sin versión (puente viejo): pide el cierre", () => {
    expect(decidirPuenteExistente({ puente: {}, versionBundle: v })).toBe("pedir-cierre");
  });
  it("si el bundle no tiene versión conocida, no da por buena ninguna", () => {
    expect(decidirPuenteExistente({ puente: { version: v }, versionBundle: undefined })).toBe("pedir-cierre");
  });
  it("si el cierre falló: avisa; si era de la misma versión, igual lo usa", () => {
    expect(decidirPuenteExistente({ puente: {}, versionBundle: v, cierreFallido: true })).toBe("avisar");
    expect(decidirPuenteExistente({ puente: { version: "0.1.0" }, versionBundle: v, cierreFallido: true })).toBe("avisar");
    expect(decidirPuenteExistente({ puente: { version: v }, versionBundle: v, cierreFallido: true })).toBe("usar");
  });
});

const NETSTAT = `
Conexiones activas

  Proto  Dirección local        Dirección remota       Estado           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180
  TCP    0.0.0.0:33334          0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:33335        0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:33335        127.0.0.1:50321        ESTABLISHED     4242
  TCP    127.0.0.1:50321        127.0.0.1:33335        ESTABLISHED     9001
  TCP    127.0.0.1:333350       0.0.0.0:0              LISTENING       777
  TCP    [::1]:33335            [::]:0                 LISTENING       555
  UDP    0.0.0.0:33333          *:*                                    4242
`;

describe("parsearNetstat", () => {
  it("devuelve el PID que escucha en 127.0.0.1:33335", () => {
    expect(parsearNetstat(NETSTAT, 33335)).toEqual([4242]);
  });
  it("entiende el estado en español y las líneas con CRLF", () => {
    const s = "  TCP    127.0.0.1:33335        0.0.0.0:0              ESCUCHANDO      321\r\n";
    expect(parsearNetstat(s, 33335)).toEqual([321]);
  });
  it("sin coincidencias, o con una salida vacía o rara, no devuelve nada", () => {
    expect(parsearNetstat(NETSTAT, 40000)).toEqual([]);
    expect(parsearNetstat("", 33335)).toEqual([]);
    expect(parsearNetstat("basura\n\n  TCP\n", 33335)).toEqual([]);
  });
  it("no repite un PID que aparece dos veces", () => {
    const s = "  TCP    127.0.0.1:33335   0.0.0.0:0   LISTENING   10\n  TCP    0.0.0.0:33335   0.0.0.0:0   LISTENING   10\n";
    expect(parsearNetstat(s, 33335)).toEqual([10]);
  });
});

describe("parsearTasklist", () => {
  it("lee el nombre del ejecutable", () => {
    expect(parsearTasklist('"node.exe","4242","Console","1","85.000 KB"\r\n')).toBe("node.exe");
    expect(parsearTasklist('"Cronio.exe","77","Console","1","1 KB"')).toBe("Cronio.exe");
  });
  it("sin proceso (mensaje de tasklist) no devuelve nada", () => {
    expect(parsearTasklist("INFORMACIÓN: no hay tareas ejecutándose que coincidan con los criterios especificados.")).toBeUndefined();
    expect(parsearTasklist("")).toBeUndefined();
  });
});

describe("evaluarCierrePid", () => {
  const base = { pid: 4242, escuchando: [4242], nombre: "node.exe", propio: 1 };
  it("node.exe o Cronio.exe que sigue escuchando: se puede", () => {
    expect(evaluarCierrePid(base)).toEqual({ ok: true });
    expect(evaluarCierrePid({ ...base, nombre: "Cronio.exe" })).toEqual({ ok: true });
  });
  it("si ya no escucha en el puerto, no", () => {
    expect(evaluarCierrePid({ ...base, escuchando: [] })).toMatchObject({ ok: false });
    expect(evaluarCierrePid({ ...base, escuchando: [5] })).toMatchObject({ ok: false });
  });
  it("otro ejecutable, o proceso que no existe, no", () => {
    expect(evaluarCierrePid({ ...base, nombre: "chrome.exe" })).toMatchObject({ ok: false, motivo: expect.stringContaining("chrome.exe") });
    expect(evaluarCierrePid({ ...base, nombre: undefined })).toMatchObject({ ok: false });
  });
  it("nunca el proceso propio", () => {
    expect(evaluarCierrePid({ ...base, propio: 4242 })).toMatchObject({ ok: false });
  });
});
