import { describe, expect, it } from "vitest";
import { ViewModelSchema, compareVersions, parseVersion } from "../src/index.ts";

describe("parseVersion", () => {
  it("lee una, dos o tres partes y completa con ceros", () => {
    expect(parseVersion("0.2.0")).toEqual({ major: 0, minor: 2, micro: 0 });
    expect(parseVersion("1.2")).toEqual({ major: 1, minor: 2, micro: 0 });
    expect(parseVersion("3")).toEqual({ major: 3, minor: 0, micro: 0 });
    expect(parseVersion("v1.0.4")).toEqual({ major: 1, minor: 0, micro: 4 });
  });
  it("rechaza lo que no es una versión", () => {
    for (const x of ["", "a.b.c", "1.2.3.4", "1..2", "-1.0.0", "1.0.0-beta", " 1.0.0", "1.0.0 ", "99999999.0.0", "70000.0.0", undefined, null, 3, {}]) {
      expect(parseVersion(x), String(x)).toBeUndefined();
    }
  });
});

describe("compareVersions", () => {
  it("ordena por mayor, menor y micro", () => {
    expect(compareVersions("0.2.0", "0.3.0")).toBe(-1);
    expect(compareVersions("0.3.0", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1); // numérica, no de texto
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
  });
  it("una versión desconocida no se puede comparar", () => {
    expect(compareVersions(undefined, "0.2.0")).toBeUndefined();
    expect(compareVersions("0.2.0", "basura")).toBeUndefined();
  });
});

describe("update en la vista", () => {
  const base = {
    sessions: [],
    request: null,
    pendingCount: 0,
    mode: "queue",
    face: { kind: null, mood: "idle", lines: ["Hola"] },
    detail: null,
    led: "off",
  };
  it("es opcional y valida versión, dirección, tamaño y sha256", () => {
    const url = "http://192.168.0.20:33337/agent-companion.cia";
    const ok = { version: "0.3.0", url, size: 370000, sha256: "ab".repeat(32) };
    expect(ViewModelSchema.safeParse(base).success).toBe(true);
    expect(ViewModelSchema.safeParse({ ...base, update: ok }).success).toBe(true);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, version: "0.3" } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, url: "https://evil.example/x.cia" } }).success).toBe(false);
    // sin size o sin sha256 (o con valores raros) no vale: la consola no ofrece instalar algo que no puede verificar
    expect(ViewModelSchema.safeParse({ ...base, update: { version: "0.3.0", url } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, sha256: undefined } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, size: undefined } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, sha256: "AB".repeat(32) } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, sha256: "ab".repeat(31) } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, size: 0 } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, size: 8 * 1024 * 1024 + 1 } }).success).toBe(false);
    expect(ViewModelSchema.safeParse({ ...base, update: { ...ok, size: 1.5 } }).success).toBe(false);
  });
});
