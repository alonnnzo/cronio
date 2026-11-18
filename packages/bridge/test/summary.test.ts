import { describe, expect, it } from "vitest";
import { MAX_READ_TEXT } from "@companion/protocol";
import { SUMMARY_MAX_LINES, extractive, sentences, shortenPaths, summarize } from "../src/summary.ts";
import * as F from "./fixtures/summary-messages.ts";

/** Salida esperada del resumen extractivo para cada mensaje de ejemplo (fijada a mano tras revisarla). */
const EXPECTED: Record<keyof typeof F, { short: boolean; lines: string[] }> = {
  REPORT_BULLETS: { short: false, lines: [
      "Listo: migré la tabla users a identificadores",
      "UUID y todo el flujo de registro sigue",
      "funcionando.",
      "",
      "• Migración 014: agrega la columna uuid con…",
      "• Modelo User: el id pasa a ser UUID…",
      "• Rutas de la API: /users/:id valida el…",
      "• Pruebas: agregué 14 casos nuevos en…",
      "",
      "• Falta probar el rollback de la migración…",
      "• Todavía hay dos consumidores internos (el…",
    ] },
  REPORT_HEADINGS_TABLE_CODE: { short: false, lines: [
      "Medí el tiempo de carga de las cinco páginas",
      "principales antes y después de optimizar las",
      "imágenes.",
      "",
      "• Resultado de la auditoría de rendimiento: la",
      "  mejora promedio fue de un 38 %.",
      "• Qué hice: convertí los .jpg a AVIF con un",
      "  respaldo en WebP y agregué loading=\"lazy\" a…",
      "",
      "• Las fotos de los vendedores siguen en su",
      "  tamaño original porque vienen del módulo de…",
      "• No se probó en Safari.",
    ] },
  REPORT_QUESTION: { short: false, lines: [
      "Encontré el origen del error: la caché de",
      "sesiones se invalida cuando cambia el idioma…",
      "",
      "• Limpiar la copia local en el cierre de sesión",
      "  (cambio chico, 6 líneas).",
      "• Mover toda la sesión a una cookie httpOnly",
      "  (cambio grande, toca el login y el",
      "  middleware).",
      "",
      "• ¿Cuál prefieres que haga?",
    ] },
  REPORT_NUMBERED_PATHS: { short: false, lines: [
      "Terminé la revisión del módulo de vendedores y",
      "dejé los cambios en la rama fase-2b.",
      "",
      "• Revisé render-ficha.tsx y encontré que el",
      "  nombre se cortaba a los 24 caracteres.",
      "• Corregí el corte en la guía de estilo y lo",
      "  dejé en 38 para que coincida con el resto.",
      "• Actualicé la documentación en",
      "  docs/vendedores.md.",
      "• Corrí el linter y el verificador de tipos sin",
      "  errores.",
    ] },
  REPORT_PROSE: { short: false, lines: [
      "El servidor de desarrollo ya arranca sin",
      "errores.",
      "",
      "• El problema era una variable de entorno…",
      "• Moví la carga del archivo al primer…",
      "• También limpié los registros de la consola…",
      "• Probé el arranque limpio tres veces…",
      "",
      "• Todavía no revisé el despliegue en producción,",
      "  porque ahí las variables vienen de otro…",
    ] },
  REPORT_SHORT: { short: true, lines: [
      "Listo, el botón de descarga ya apunta al archivo",
      "nuevo.",
      "",
      "• Cambié el enlace en index.html.",
      "• Subí el .3dsx a la carpeta pública.",
    ] },
  REPORT_ONLY_TABLE: { short: false, lines: [
      "(tabla de 14 filas)",
    ] },
  REPORT_SECTIONS: { short: false, lines: [
      "El paso 4 ya está programado y pasa todas las",
      "pruebas en el PC, pero todavía no se probó en la",
      "nube ni con una cuenta real de cliente.",
      "",
      "• Qué quedó hecho: hay 5 commits nuevos en…",
      "• Cómo se usa en la terminal: cada filtro…",
      "• Para probarlo: hay que agregar la variable…",
      "",
      "• No se ha comprobado que Excel acepte la hoja",
      "  que genera el exportador; solo se probó con…",
      "• Tampoco se ha visto en la terminal el teclado",
      "  de \"Otra…\" ni cómo se ve la tarjeta.",
    ] },
};

describe("resumen extractivo: mensajes de ejemplo", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(name, () => {
      const r = extractive.summarize(F[name as keyof typeof F]);
      expect(r.lines).toEqual(expected.lines);
      expect(r.short).toBe(expected.short);
    });
  }

  it("siempre cabe en una pantalla: 12 líneas de 48 caracteres", () => {
    for (const msg of Object.values(F)) {
      const r = extractive.summarize(msg);
      expect(r.lines.length).toBeLessThanOrEqual(SUMMARY_MAX_LINES);
      expect(r.lines.every((l) => l.length <= MAX_READ_TEXT)).toBe(true);
    }
  });

  it("summarize() devuelve solo las líneas", () => {
    expect(summarize(F.REPORT_BULLETS)).toEqual(EXPECTED.REPORT_BULLETS.lines);
  });
});

describe("resumen extractivo: reglas", () => {
  it("un mensaje que ya cabe es su propio resumen (short)", () => {
    const r = extractive.summarize("Listo, ya quedó.\n\n- uno\n- dos");
    expect(r).toEqual({ short: true, lines: ["Listo, ya quedó.", "", "• uno", "• dos"] });
  });

  it("primera idea: dos oraciones si la primera es muy corta", () => {
    const body = Array.from({ length: 14 }, (_, i) => `- punto ${i + 1}`).join("\n");
    const corta = extractive.summarize(`Listo. Funcionó a la primera.\n\n${body}`);
    expect(corta.lines[0]).toBe("Listo. Funcionó a la primera.");
    const larga = extractive.summarize(`Terminé de migrar la base de datos completa. Funcionó.\n\n${body}`);
    expect(larga.lines[0]).toBe("Terminé de migrar la base de datos completa.");
  });

  it("descarta bloques de código y no los toma por puntos", () => {
    const md = `Cambié la función.\n\n\`\`\`ts\n- esto no es una lista\nconst x = 1;\n\`\`\`\n\n${Array.from({ length: 12 }, (_, i) => `- paso ${i + 1}`).join("\n")}`;
    const out = summarize(md).join("\n");
    expect(out).not.toContain("esto no es una lista");
    expect(out).not.toContain("const x");
    expect(out).toContain("• paso 1");
  });

  it("solo una tabla: dice cuántas filas tiene (sin el encabezado)", () => {
    expect(summarize(F.REPORT_ONLY_TABLE)).toEqual(["(tabla de 14 filas)"]);
  });

  it("solo código: cae al comienzo del mensaje", () => {
    const code = "```\n" + Array.from({ length: 30 }, (_, i) => `linea ${i}`).join("\n") + "\n```";
    const out = summarize(code);
    expect(out.length).toBe(SUMMARY_MAX_LINES);
    expect(out[0]).toBe("  linea 0");
  });

  it("lo que queda abierto sube al final aunque aparezca primero y no se repite como punto", () => {
    const md = `Terminé el módulo de pagos por completo.\n\n- Falta probar el reembolso parcial en sandbox.\n${Array.from({ length: 10 }, (_, i) => `- Cambio ${i + 1} en el módulo`).join("\n")}`;
    const out = summarize(md);
    const idx = out.findIndex((l) => l.includes("Falta probar"));
    expect(idx).toBeGreaterThan(out.findIndex((l) => l.includes("Cambio 1")));
    expect(out.filter((l) => l.includes("Falta probar"))).toHaveLength(1);
  });

  it("detecta falta, pendiente, sin probar, no se probó, todavía y las preguntas", () => {
    for (const frase of ["Falta el manual.", "Queda pendiente el manual.", "Sigue sin probar en la consola.", "No se probó en Safari.", "Todavía no hay manual.", "¿Sigo con el manual?"]) {
      const md = `Terminé la primera parte del trabajo.\n\n${Array.from({ length: 12 }, (_, i) => `- Hecho ${i + 1} del módulo`).join("\n")}\n\n${frase}`;
      expect(summarize(md).join("\n"), frase).toContain(frase.replace("Queda pendiente", "Queda pendiente"));
    }
  });

  it("\"si falta X\" describe una comprobación, no algo pendiente", () => {
    const md = `Moví la carga del archivo de entorno al inicio.\n\n- Hecho 1 en el módulo\n- Hecho 2 en el módulo\n- Hecho 3 en el módulo\n- Hecho 4 en el módulo\n- Hecho 5 en el módulo\n- Hecho 6 en el módulo\n- Hecho 7 en el módulo\n- Hecho 8 en el módulo\n- Hecho 9 en el módulo\n- Hecho 10 en el módulo\n- Hecho 11 en el módulo\n- Agregué una verificación que se detiene si falta alguna variable.`;
    const out = summarize(md).join("\n");
    expect(out).not.toContain("falta alguna");
  });

  it("la pregunta pendiente de la sesión no se repite en el resumen", () => {
    const con = extractive.summarize(F.REPORT_QUESTION);
    expect(con.lines.join("\n")).toContain("¿Cuál prefieres que haga?");
    const sin = extractive.summarize(F.REPORT_QUESTION, { question: "¿Cuál prefieres que haga?" });
    expect(sin.lines.join("\n")).not.toContain("¿Cuál prefieres");
  });

  it("enlaces reducidos a su texto y rutas largas al último tramo", () => {
    const out = summarize(F.REPORT_NUMBERED_PATHS).join("\n");
    expect(out).toContain("render-ficha.tsx");
    expect(out).not.toContain("otro-sistema");
    expect(out).toContain("la guía de estilo");
    expect(out).not.toContain("https://");
    expect(shortenPaths(String.raw`ver C:\a\b\c\muy-larga-carpeta\archivo.ts ahora`)).toBe("ver archivo.ts ahora");
    expect(shortenPaths("abre src/a.ts")).toBe("abre src/a.ts");
    expect(shortenPaths("en https://ejemplo.cl/ruta/larga?x=1 hay")).toBe("en ejemplo.cl hay");
  });

  it("no corta oraciones en abreviaturas ni en decimales", () => {
    expect(sentences("Usa p. ej. un hook. Luego sigue.")).toEqual(["Usa p. ej. un hook.", "Luego sigue."]);
    expect(sentences("La versión 3.5 anda. Falló la 4.0 ayer.")).toEqual(["La versión 3.5 anda.", "Falló la 4.0 ayer."]);
    expect(sentences("¿Funciona? Sí. ¡Perfecto!")).toEqual(["¿Funciona?", "Sí.", "¡Perfecto!"]);
  });

  it("prosa sin estructura: primera idea, oraciones siguientes y lo pendiente", () => {
    const out = summarize(F.REPORT_PROSE);
    expect(out[0]).toBe("El servidor de desarrollo ya arranca sin");
    expect(out.join("\n")).toContain("Todavía no revisé el despliegue");
  });

  it("entrada vacía o solo espacios: sin líneas", () => {
    expect(extractive.summarize("")).toEqual({ lines: [], short: true });
    expect(extractive.summarize("  \n\n ")).toEqual({ lines: [], short: true });
  });

  it("respeta width y maxLines de las opciones", () => {
    const r = extractive.summarize(F.REPORT_BULLETS, { width: 30, maxLines: 8 });
    expect(r.lines.length).toBeLessThanOrEqual(8);
    expect(r.lines.every((l) => l.length <= 30)).toBe(true);
  });
});

describe("resumen extractivo: secciones", () => {
  it("una viñeta por sección, en orden, con el título delante y la primera oración en minúscula", () => {
    const out = summarize(F.REPORT_SECTIONS);
    expect(out.slice(4, 7)).toEqual(["• Qué quedó hecho: hay 5 commits nuevos en…", "• Cómo se usa en la terminal: cada filtro…", "• Para probarlo: hay que agregar la variable…"]);
  });

  it("una sección \"Sin probar\" aporta sus primeros ítems como pendientes, no como puntos", () => {
    const out = summarize(F.REPORT_SECTIONS).join("\n");
    expect(out).toContain("No se ha comprobado que Excel acepte");
    expect(out).toContain("Tampoco se ha visto en la terminal el teclado");
    expect(out).not.toContain("Sin probar:");
  });

  it("los títulos de pendiente: falta, pendiente, queda, no probado, sin verificar", () => {
    for (const h of ["Lo que falta", "Pendiente", "Queda por hacer", "No probado", "Sin verificar"]) {
      const md = `Terminé el trabajo principal del módulo de pagos por completo ahora.\n\n**Hecho**\n${Array.from({ length: 4 }, (_, i) => `- Cambio ${i + 1} en el módulo`).join("\n")}\n\n**Más cambios**\n- Otro cambio importante en el módulo de reportes\n- Y otro más\n\n**${h}**\n- El reembolso parcial en sandbox\n- El webhook de errores\n- Un tercero que no entra`;
      const out = summarize(md).join("\n");
      expect(out, h).toContain("El reembolso parcial en sandbox");
      expect(out, h).toContain("El webhook de errores");
      expect(out, h).not.toContain("tercero");
      expect(out, h).not.toContain(h + ":");
    }
  });

  it("la primera idea no se corta a media palabra: entera si cabe en 3 líneas, si no en una coma o conjunción", () => {
    const largo = "Encontré el origen del error en la caché de sesiones del servidor, que se invalida cada vez que cambia el idioma de la interfaz, pero el cierre de sesión nunca limpia la copia local del navegador.";
    const out = summarize(`${largo}\n\n${Array.from({ length: 14 }, (_, i) => `- punto ${i + 1}`).join("\n")}`);
    expect(out.length).toBeGreaterThan(0);
    const lead = out.slice(0, out.indexOf("")).join(" ");
    expect(lead.endsWith("…")).toBe(true);
    expect(largo.startsWith(lead.slice(0, -1))).toBe(true);
    expect(/[,y] ?…$|…$/.test(lead)).toBe(true);
    expect(lead.slice(0, -1).trimEnd().endsWith(" ")).toBe(false);
    expect(out.indexOf("")).toBeLessThanOrEqual(3);
    expect(summarize(F.REPORT_SECTIONS)[2]).toBe("nube ni con una cuenta real de cliente."); // 135 caracteres: caben en 3 líneas, sin "…"
  });
});
