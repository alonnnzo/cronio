import { z } from "zod";
import { MAX_TEXT } from "@companion/protocol";
import { clip } from "./text.ts";

// "Sí, no volver a preguntar" de Claude Code: la solicitud de permiso trae `permission_suggestions`, una lista de
// actualizaciones de permisos (addRules, setMode, addDirectories...). Si el usuario elige esa opción, el hook las
// devuelve tal cual en `updatedPermissions`. Aquí solo se validan por encima (nunca debe fallar la solicitud por ellas)
// y se resumen en una etiqueta corta para la consola.

/** Entradas máximas que se aceptan; más que eso se considera una carga rara y se ignora. */
const MAX_SUGGESTIONS = 16;

const SuggestionSchema = z.looseObject({ type: z.string().min(1) });
const SuggestionsSchema = z.array(SuggestionSchema).max(MAX_SUGGESTIONS);

/** Una actualización de permisos tal como la manda Claude Code (se conserva completa, con sus campos extra). */
export type PermissionSuggestion = z.infer<typeof SuggestionSchema>;

/** Lista válida de sugerencias, o `[]` si falta o no tiene la forma esperada. */
export function parseSuggestions(raw: unknown): PermissionSuggestion[] {
  const r = SuggestionsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

const MODE_NAMES: Record<string, string> = {
  acceptEdits: "aceptar ediciones",
  plan: "modo plan",
  default: "modo normal",
  dontAsk: "modo sin preguntar",
  bypassPermissions: "modo sin permisos",
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function describe(s: PermissionSuggestion): string {
  const where = s.destination === "session" ? " en esta sesión" : "";
  switch (s.type) {
    case "addRules": {
      const rules = Array.isArray(s.rules) ? s.rules : [];
      const names = rules.flatMap((r: unknown) => {
        const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
        const tool = str(o.toolName);
        if (!tool) return [];
        const content = str(o.ruleContent);
        return [content ? `${tool}(${content})` : tool];
      });
      return names.length > 0 ? names.join(", ") + where : "cambiar permisos";
    }
    case "setMode": {
      const mode = str(s.mode);
      return (mode ? (MODE_NAMES[mode] ?? `modo ${mode}`) : "cambiar el modo") + where;
    }
    case "addDirectories": {
      const dirs = (Array.isArray(s.directories) ? s.directories : []).filter((d: unknown): d is string => typeof d === "string" && d.length > 0);
      return dirs.length > 0 ? `acceso a ${dirs.join(", ")}${where}` : "cambiar permisos";
    }
    default:
      return "cambiar permisos";
  }
}

/** Resumen corto (ya saneado y recortado a `MAX_TEXT`) de lo que quedaría permitido; `undefined` si no hay sugerencias. */
export function suggestionsLabel(suggestions: readonly PermissionSuggestion[]): string | undefined {
  if (suggestions.length === 0) return undefined;
  const parts: string[] = [];
  for (const s of suggestions) {
    const d = describe(s);
    if (!parts.includes(d)) parts.push(d);
  }
  return clip(parts.join(" + ")) || "cambiar permisos";
}
