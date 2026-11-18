import { describe, expect, it } from "vitest";
import { ENLACES_BANDEJA, PAUSAS_MIN, plantillaMenu, tooltipBandeja, varianteIcono } from "../src/setup/bandeja.ts";
import type { ElementoMenu, EstadoBandeja } from "../src/setup/bandeja.ts";

const base: EstadoBandeja = {
  version: "0.3.3",
  puenteActivo: true,
  puentePropio: true,
  consola: true,
  consolaVersion: "0.3.3",
  actualizacion: { origen: "local", fase: "al-dia" },
  inicioConWindows: false,
};
const con = (c: Partial<EstadoBandeja>): EstadoBandeja => ({ ...base, ...c });

/** Aplana el menú (con submenús) para buscar elementos por id o por texto. */
const todos = (items: ElementoMenu[]): ElementoMenu[] => items.flatMap((i) => [i, ...(i.submenu ? todos(i.submenu) : [])]);
const etiquetas = (e: EstadoBandeja) => todos(plantillaMenu(e)).map((i) => i.label).filter(Boolean);
const porId = (e: EstadoBandeja, id: string) => todos(plantillaMenu(e)).find((i) => i.id === id);

describe("plantillaMenu: cabecera y estado", () => {
  it("empieza con «Cronio 0.3.x» deshabilitado y el estado del puente y de la 3DS", () => {
    const m = plantillaMenu(base);
    expect(m[0]).toEqual({ label: "Cronio 0.3.3", enabled: false });
    expect(m[1]).toEqual({ label: "Puente: en marcha", enabled: false });
    expect(m[2]).toEqual({ label: "3DS: conectada (app 0.3.3)", enabled: false });
  });

  it("puente detenido: lo dice y la 3DS figura sin conexión aunque el último dato dijera lo contrario", () => {
    const m = plantillaMenu(con({ puenteActivo: false, puentePropio: false, consola: true }));
    expect(m[1]).toEqual({ label: "Puente: detenido", enabled: false });
    expect(m[2]).toEqual({ label: "3DS: sin conexión", enabled: false });
  });

  it("puente en marcha pero sin consola: 3DS sin conexión", () => {
    expect(etiquetas(con({ consola: false }))).toContain("3DS: sin conexión");
  });

  it("consola conectada sin versión conocida: no inventa una", () => {
    const { consolaVersion: _v, ...sinVersion } = base;
    expect(etiquetas(sinVersion)).toContain("3DS: conectada");
  });

  it("«Abrir Cronio» siempre está y no está deshabilitado", () => {
    for (const e of [base, con({ puenteActivo: false }), con({ actualizacion: { origen: "ninguno", fase: "sin-origen" } })]) {
      expect(porId(e, "abrir")).toEqual({ id: "abrir", label: "Abrir Cronio" });
    }
  });
});

describe("plantillaMenu: puente y pausa", () => {
  it("en marcha y propio: «Detener el puente» y el submenú de pausa con 30 min, 1 h y hasta que lo reactive", () => {
    expect(porId(base, "puente-detener")).toEqual({ id: "puente-detener", label: "Detener el puente" });
    expect(porId(base, "puente-iniciar")).toBeUndefined();
    const pausar = plantillaMenu(base).find((i) => i.label === "Pausar avisos por…")!;
    expect(pausar.enabled).toBe(true);
    expect(pausar.submenu!.map((i) => [i.id, i.label])).toEqual([
      ["pausa-30", "30 minutos"],
      ["pausa-60", "1 hora"],
      ["pausa-indefinida", "Hasta que lo reactive"],
    ]);
  });

  it("en marcha pero iniciado por otro: no se ofrece detenerlo ni pausarlo", () => {
    const e = con({ puentePropio: false });
    expect(porId(e, "puente-detener")?.enabled).toBe(false);
    expect(plantillaMenu(e).find((i) => i.label === "Pausar avisos por…")?.enabled).toBe(false);
  });

  it("detenido: «Iniciar el puente», sin detener ni pausar", () => {
    const e = con({ puenteActivo: false, puentePropio: false, consola: false });
    expect(porId(e, "puente-iniciar")).toEqual({ id: "puente-iniciar", label: "Iniciar el puente" });
    expect(porId(e, "puente-detener")).toBeUndefined();
    expect(etiquetas(e)).not.toContain("Pausar avisos por…");
  });

  it("en pausa con hora: lo dice y ofrece reactivar en vez de iniciar", () => {
    const e = con({ puenteActivo: false, puentePropio: false, consola: false, pausaHasta: new Date(2026, 10, 18, 15, 30).getTime() });
    expect(etiquetas(e)).toContain("Puente: en pausa hasta las 15:30");
    expect(porId(e, "pausa-reactivar")).toEqual({ id: "pausa-reactivar", label: "Reactivar los avisos ahora" });
    expect(porId(e, "puente-iniciar")).toBeUndefined();
  });

  it("en pausa sin plazo (0): «en pausa» a secas", () => {
    expect(etiquetas(con({ puenteActivo: false, puentePropio: false, pausaHasta: 0 }))).toContain("Puente: en pausa");
  });

  it("las pausas valen 30 min, 60 min y sin plazo", () => {
    expect(PAUSAS_MIN).toEqual({ "pausa-30": 30, "pausa-60": 60, "pausa-indefinida": 0 });
  });
});

describe("plantillaMenu: actualizaciones", () => {
  it("al día: solo «Buscar actualizaciones»", () => {
    expect(porId(base, "act-buscar")).toEqual({ id: "act-buscar", label: "Buscar actualizaciones", enabled: true });
    expect(porId(base, "act-actualizar")).toBeUndefined();
  });

  it("versión nueva: «Actualizar a x.y.z» además de buscar", () => {
    const e = con({ actualizacion: { origen: "local", fase: "nueva", version: "0.4.0" } });
    expect(porId(e, "act-actualizar")).toEqual({ id: "act-actualizar", label: "Actualizar a 0.4.0", enabled: true });
    expect(porId(e, "act-buscar")?.enabled).toBe(true);
  });

  it("buscando: el botón dice que está buscando y no se puede pulsar", () => {
    expect(porId(con({ actualizacion: { origen: "github", fase: "buscando" } }), "act-buscar")).toEqual({ id: "act-buscar", label: "Buscando actualizaciones…", enabled: false });
  });

  it("descargando: muestra la versión y deshabilita las dos acciones", () => {
    const e = con({ actualizacion: { origen: "github", fase: "descargando", version: "0.4.0" } });
    expect(porId(e, "act-actualizar")).toMatchObject({ label: "Descargando 0.4.0…", enabled: false });
    expect(porId(e, "act-buscar")?.enabled).toBe(false);
  });

  it("descargada: sigue ofreciendo «Actualizar a x.y.z» (la ventana hace el reinicio)", () => {
    expect(porId(con({ actualizacion: { origen: "github", fase: "descargada", version: "0.4.0" } }), "act-actualizar")).toMatchObject({ label: "Actualizar a 0.4.0", enabled: true });
  });

  it("origen ninguno: «Actualizaciones: desactivadas» deshabilitado y «Configurar…», sin buscar", () => {
    const e = con({ actualizacion: { origen: "ninguno", fase: "sin-origen" } });
    expect(etiquetas(e)).toContain("Actualizaciones: desactivadas");
    expect(plantillaMenu(e).find((i) => i.label === "Actualizaciones: desactivadas")?.enabled).toBe(false);
    expect(porId(e, "act-configurar")).toEqual({ id: "act-configurar", label: "Configurar…" });
    expect(porId(e, "act-buscar")).toBeUndefined();
  });

  it("GitHub sin versiones publicadas: lo dice y lleva a Configurar", () => {
    const e = con({ actualizacion: { origen: "github", fase: "sin-publicar" } });
    expect(etiquetas(e)).toContain("Actualizaciones: aún sin versiones publicadas");
    expect(porId(e, "act-configurar")).toBeDefined();
    expect(porId(e, "act-buscar")).toBeUndefined();
  });
});

describe("plantillaMenu: utilidades y salida", () => {
  it("«Iniciar con Windows» es una casilla que refleja el estado", () => {
    expect(porId(base, "inicio-windows")).toEqual({ id: "inicio-windows", label: "Iniciar con Windows", type: "checkbox", checked: false });
    expect(porId(con({ inicioConWindows: true }), "inicio-windows")).toMatchObject({ type: "checkbox", checked: true });
  });

  it("trae el QR, el registro, la página web, la ayuda y Salir (esta última al final)", () => {
    expect(porId(base, "qr")?.label).toBe("Mostrar el QR de instalación");
    expect(porId(base, "registro")?.label).toBe("Ver el registro del puente");
    expect(porId(base, "web")).toBeDefined();
    expect(porId(base, "ayuda")).toBeDefined();
    const m = plantillaMenu(base);
    expect(m[m.length - 1]).toEqual({ id: "salir", label: "Salir" });
  });

  it("no hay dos separadores seguidos ni uno al principio o al final, en ningún estado", () => {
    const estados: EstadoBandeja[] = [
      base,
      con({ puenteActivo: false, puentePropio: false, consola: false }),
      con({ puenteActivo: false, puentePropio: false, pausaHasta: 0 }),
      con({ actualizacion: { origen: "ninguno", fase: "sin-origen" } }),
      con({ actualizacion: { origen: "local", fase: "nueva", version: "0.4.0" }, inicioConWindows: true }),
    ];
    for (const e of estados) {
      const m = plantillaMenu(e);
      expect(m[0]!.type).not.toBe("separator");
      expect(m[m.length - 1]!.type).not.toBe("separator");
      m.forEach((it, i) => {
        if (it.type === "separator") expect(m[i - 1]!.type).not.toBe("separator");
      });
    }
  });

  it("todo elemento con acción tiene un texto y las URLs son fijas", () => {
    for (const it of todos(plantillaMenu(base))) if (it.id) expect(it.label).toBeTruthy();
    expect(ENLACES_BANDEJA.web).toBe("https://alonnnzo.github.io/cronio/");
    expect(ENLACES_BANDEJA.ayuda).toMatch(/^https:\/\/github\.com\/alonnnzo\/cronio\/issues$/);
  });
});

describe("tooltip e ícono", () => {
  it("puente en marcha y 3DS conectada", () => {
    expect(tooltipBandeja(base)).toBe("Cronio · puente en marcha · 3DS conectada");
  });
  it("puente en marcha sin 3DS", () => {
    expect(tooltipBandeja(con({ consola: false }))).toBe("Cronio · puente en marcha · 3DS sin conexión");
  });
  it("puente detenido", () => {
    expect(tooltipBandeja(con({ puenteActivo: false, consola: false }))).toBe("Cronio · puente detenido");
  });
  it("en pausa", () => {
    expect(tooltipBandeja(con({ puenteActivo: false, pausaHasta: 0 }))).toBe("Cronio · avisos en pausa");
    expect(tooltipBandeja(con({ puenteActivo: false, pausaHasta: new Date(2026, 10, 18, 9, 5).getTime() }))).toBe("Cronio · avisos en pausa hasta las 09:05");
  });
  it("con una versión nueva la suma al final", () => {
    expect(tooltipBandeja(con({ actualizacion: { origen: "local", fase: "nueva", version: "0.4.0" } }))).toBe("Cronio · puente en marcha · 3DS conectada · hay una versión nueva (0.4.0)");
  });
  it("el tooltip cabe en los 127 caracteres de Windows incluso en el peor caso", () => {
    expect(tooltipBandeja(con({ actualizacion: { origen: "github", fase: "descargada", version: "10.20.30" } })).length).toBeLessThan(127);
  });

  it("ícono: normal, apagado con el puente detenido y punto con una versión nueva", () => {
    expect(varianteIcono(base)).toEqual({ apagado: false, punto: false });
    expect(varianteIcono(con({ puenteActivo: false }))).toEqual({ apagado: true, punto: false });
    expect(varianteIcono(con({ actualizacion: { origen: "local", fase: "nueva", version: "0.4.0" } }))).toEqual({ apagado: false, punto: true });
    expect(varianteIcono(con({ puenteActivo: false, actualizacion: { origen: "github", fase: "descargada", version: "0.4.0" } }))).toEqual({ apagado: true, punto: true });
  });

  it("al día, buscando o con error no hay punto", () => {
    for (const fase of ["al-dia", "buscando", "error", "inactivo"]) expect(varianteIcono(con({ actualizacion: { origen: "local", fase } })).punto).toBe(false);
  });
});
