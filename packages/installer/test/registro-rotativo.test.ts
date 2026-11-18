import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_LOG_BYTES, RegistroRotativo } from "../src/registro-rotativo.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cronio-log-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("RegistroRotativo (bridge.log)", () => {
  it("el tope es de 5 MB", () => {
    expect(MAX_LOG_BYTES).toBe(5 * 1024 * 1024);
  });

  it("escribe texto y bytes, creando la carpeta", () => {
    const ruta = join(dir, "sub", "bridge.log");
    const log = new RegistroRotativo(ruta);
    log.write("hola\n");
    log.write(Buffer.from("mundo\n"));
    expect(readFileSync(ruta, "utf8")).toBe("hola\nmundo\n");
    expect(existsSync(`${ruta}.1`)).toBe(false);
  });

  it("al pasar del tope renombra a .1, reemplazando el anterior, y sigue en uno nuevo", () => {
    const ruta = join(dir, "bridge.log");
    const log = new RegistroRotativo(ruta, 100);
    log.write("a".repeat(120));
    expect(existsSync(`${ruta}.1`)).toBe(false); // todavía no se midió contra el tope: se rota al escribir lo siguiente
    log.write("b".repeat(10));
    expect(readFileSync(`${ruta}.1`, "utf8")).toBe("a".repeat(120));
    expect(readFileSync(ruta, "utf8")).toBe("b".repeat(10));
    log.write("c".repeat(100));
    log.write("d");
    // el .1 es ahora el anterior y el primero se perdió: nunca hay un .2
    expect(readFileSync(`${ruta}.1`, "utf8")).toBe("b".repeat(10) + "c".repeat(100));
    expect(readFileSync(ruta, "utf8")).toBe("d");
    expect(existsSync(`${ruta}.2`)).toBe(false);
  });

  it("mide el archivo que ya había (un arranque nuevo sobre un registro grande rota enseguida)", () => {
    const ruta = join(dir, "bridge.log");
    writeFileSync(ruta, "x".repeat(500));
    new RegistroRotativo(ruta, 100).write("nuevo\n");
    expect(readFileSync(`${ruta}.1`, "utf8")).toBe("x".repeat(500));
    expect(readFileSync(ruta, "utf8")).toBe("nuevo\n");
  });

  it("nunca lanza, ni con una ruta imposible", () => {
    expect(() => new RegistroRotativo(join(dir, "\0malo", "x.log")).write("x")).not.toThrow();
  });
});
