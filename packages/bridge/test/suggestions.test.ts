import { describe, expect, it } from "vitest";
import { MAX_TEXT } from "@companion/protocol";
import { parseSuggestions, suggestionsLabel } from "../src/suggestions.ts";

const addRules = (rules: unknown[], destination = "localSettings") => ({ type: "addRules", rules, behavior: "allow", destination });

describe("parseSuggestions", () => {
  it("conserva las entradas tal cual, con sus campos extra", () => {
    const s = [addRules([{ toolName: "Bash", ruleContent: "npm test" }]), { type: "setMode", mode: "acceptEdits", destination: "session", extra: 1 }];
    expect(parseSuggestions(s)).toEqual(s);
  });

  it("ignora lo que no sea una lista de objetos con `type` de texto", () => {
    for (const bad of [undefined, null, 5, "x", {}, [1], [null], [{}], [{ type: 3 }], [addRules([]), "x"]]) {
      expect(parseSuggestions(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  it("pone un tope al número de entradas", () => {
    const many = Array.from({ length: 50 }, () => ({ type: "setMode", mode: "acceptEdits" }));
    expect(parseSuggestions(many)).toEqual([]);
  });
});

describe("suggestionsLabel", () => {
  it("sin sugerencias no hay etiqueta", () => {
    expect(suggestionsLabel([])).toBeUndefined();
  });

  it("addRules: herramienta y, si hay, el contenido entre paréntesis", () => {
    expect(suggestionsLabel([addRules([{ toolName: "Bash", ruleContent: "rm -rf node_modules" }])])).toBe("Bash(rm -rf node_modules)");
    expect(suggestionsLabel([addRules([{ toolName: "WebFetch" }])])).toBe("WebFetch");
  });

  it("addRules con varias reglas o varias entradas: se unen", () => {
    expect(
      suggestionsLabel([addRules([{ toolName: "Bash", ruleContent: "ls" }, { toolName: "Bash", ruleContent: "pwd" }])]),
    ).toBe("Bash(ls), Bash(pwd)");
    expect(suggestionsLabel([addRules([{ toolName: "Bash", ruleContent: "ls" }]), { type: "addDirectories", directories: ["C:\a"] }])).toBe(
      "Bash(ls) + acceso a C:\a",
    );
  });

  it("setMode según el modo y el destino", () => {
    expect(suggestionsLabel([{ type: "setMode", mode: "acceptEdits", destination: "session" }])).toBe("aceptar ediciones en esta sesión");
    expect(suggestionsLabel([{ type: "setMode", mode: "acceptEdits", destination: "localSettings" }])).toBe("aceptar ediciones");
    expect(suggestionsLabel([{ type: "setMode", mode: "plan" }])).toBe("modo plan");
    expect(suggestionsLabel([{ type: "setMode", mode: "raro" }])).toBe("modo raro");
  });

  it("addDirectories: acceso al directorio", () => {
    expect(suggestionsLabel([{ type: "addDirectories", directories: ["/srv/app", "/lib"], destination: "session" }])).toBe(
      "acceso a /srv/app, /lib en esta sesión",
    );
  });

  it("tipos que no se saben describir: etiqueta genérica", () => {
    expect(suggestionsLabel([{ type: "replaceRules", rules: [] }])).toBe("cambiar permisos");
  });

  it("recorta al largo máximo y limpia caracteres de control", () => {
    const label = suggestionsLabel([addRules([{ toolName: "Bash", ruleContent: "x".repeat(200) + "\u0001" }])])!;
    expect(label.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(label.endsWith("…")).toBe(true);
    expect(suggestionsLabel([addRules([{ toolName: "Bash", ruleContent: "a\nb\u202e" }])])).toBe("Bash(a b�)");
  });
});
