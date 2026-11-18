import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AgentKindSchema,
  MAX_QUICK_COMMANDS,
  MAX_QUICK_LABEL,
  MAX_QUICK_TEXT,
  NotifyDefaultSchema,
  InstructWaitSchema,
  PermissionModeSchema,
  ReadModeSchema,
  type AgentKind,
  type InstructWait,
  type NotifyDefault,
  type PermissionMode,
  type QuickCommand,
  type ReadMode,
  type SettingChange,
} from "@companion/protocol";
import { sanitizeText } from "./text.ts";

/** `.companion/settings.json`: preferencias que sobreviven a un reinicio del puente. */
export interface Settings {
  mode: PermissionMode;
  /** Aviso por defecto de las sesiones nuevas (se usa desde el paso 3 de la Fase 2b). */
  notifyDefault: NotifyDefault;
  /** Los avisos piden "Visto" (se usa desde el paso 3). */
  notifyAck: boolean;
  /** Agentes ocultos en la lista de la consola y en la cara ambiente. Sus permisos siguen llegando. */
  hiddenAgents: AgentKind[];
  /** La consola hace sonar los avisos (paso 3b). */
  sound: boolean;
  /** Las preguntas con alternativas (AskUserQuestion) se responden desde la consola (paso 4). Apagado: se responden en el PC. */
  questions: boolean;
  /** En qué modo abre el lector los mensajes: completo o resumen (paso 5; X lo alterna dentro del lector). */
  readerDefault: ReadMode;
  /** Minutos que "Esperar mi respuesta" retiene el fin de turno de una sesión (paso 6): 5, 10 o 30. */
  instructWaitMax: InstructWait;
  /** Atajos de un toque de la tarjeta de instrucción (Fase 3): etiqueta y texto que se manda. De 0 a 4; se editan en este archivo. */
  quickCommands: QuickCommand[];
}

/** Los atajos de fábrica de la tarjeta "espera tu instrucción". */
export const DEFAULT_QUICK_COMMANDS: readonly QuickCommand[] = [
  { label: "Sigue", text: "Sigue con lo que estabas haciendo." },
  { label: "Corre las pruebas", text: "Corre las pruebas y arregla lo que falle." },
  { label: "Haz commit", text: "Haz commit de los cambios con un mensaje claro." },
  { label: "Resume", text: "Resume en pocas líneas qué hiciste y qué falta." },
];

export const DEFAULT_SETTINGS: Settings = {
  mode: "queue",
  notifyDefault: "important",
  notifyAck: true,
  hiddenAgents: [],
  sound: true,
  questions: true,
  readerDefault: "full",
  instructWaitMax: 10,
  quickCommands: DEFAULT_QUICK_COMMANDS.map((c) => ({ ...c })),
};

/** Recorta a `max` caracteres (puntos de código, como cuenta zod), sin partir un emoji. */
function clipChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * Lo que se acepta de `quickCommands` en el archivo: hasta 4 pares con etiqueta y texto no vacíos, en una línea y recortados a
 * los topes del protocolo. Lo que no sirva se descarta. Ausente (o no es una lista) = los de fábrica; una lista vacía = ninguno.
 */
export function cleanQuickCommands(raw: unknown): QuickCommand[] {
  if (!Array.isArray(raw)) return DEFAULT_QUICK_COMMANDS.map((c) => ({ ...c }));
  const out: QuickCommand[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { label, text } = item as Record<string, unknown>;
    if (typeof label !== "string" || typeof text !== "string") continue;
    const oneLine = (v: string) => sanitizeText(v).replace(/\n/g, " ").trim();
    const l = clipChars(oneLine(label), MAX_QUICK_LABEL).trim();
    const t = clipChars(oneLine(text), MAX_QUICK_TEXT).trim();
    if (l === "" || t === "") continue;
    out.push({ label: l, text: t });
    if (out.length === MAX_QUICK_COMMANDS) break;
  }
  return out;
}

/** Orden fijo de los agentes (el de la cuadrícula de la consola). */
const AGENT_ORDER: readonly AgentKind[] = AgentKindSchema.options;

/** Sin repetidos y en el orden de la cuadrícula: así el archivo y la vista son estables. */
export function normalizeHidden(list: readonly AgentKind[]): AgentKind[] {
  return AGENT_ORDER.filter((k) => list.includes(k));
}

/** Aplica un cambio ya validado y devuelve los ajustes nuevos (no modifica el original). */
export function applyChange(settings: Settings, change: SettingChange): Settings {
  switch (change.key) {
    case "notifyDefault":
      return { ...settings, notifyDefault: change.value };
    case "notifyAck":
      return { ...settings, notifyAck: change.value };
    case "sound":
      return { ...settings, sound: change.value };
    case "questions":
      return { ...settings, questions: change.value };
    case "readerDefault":
      return { ...settings, readerDefault: change.value };
    case "instructWaitMax":
      return { ...settings, instructWaitMax: change.value };
    case "hiddenAgents":
      return { ...settings, hiddenAgents: normalizeHidden(change.value) };
  }
}

/**
 * Lee los ajustes; si el archivo falta o está dañado, o un campo falta o no es válido, ese campo usa su valor por
 * defecto (un archivo anterior que solo trae `mode` sigue valiendo).
 */
export function loadSettings(path: string): Settings {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_SETTINGS, hiddenAgents: [], quickCommands: cleanQuickCommands(undefined) };
  }
  const mode = PermissionModeSchema.safeParse(data.mode);
  const notifyDefault = NotifyDefaultSchema.safeParse(data.notifyDefault);
  const readerDefault = ReadModeSchema.safeParse(data.readerDefault);
  const instructWaitMax = InstructWaitSchema.safeParse(data.instructWaitMax);
  const hidden = Array.isArray(data.hiddenAgents)
    ? data.hiddenAgents.filter((k): k is AgentKind => AgentKindSchema.safeParse(k).success)
    : [];
  return {
    mode: mode.success ? mode.data : DEFAULT_SETTINGS.mode,
    notifyDefault: notifyDefault.success ? notifyDefault.data : DEFAULT_SETTINGS.notifyDefault,
    notifyAck: typeof data.notifyAck === "boolean" ? data.notifyAck : DEFAULT_SETTINGS.notifyAck,
    hiddenAgents: normalizeHidden(hidden),
    sound: typeof data.sound === "boolean" ? data.sound : DEFAULT_SETTINGS.sound,
    questions: typeof data.questions === "boolean" ? data.questions : DEFAULT_SETTINGS.questions,
    readerDefault: readerDefault.success ? readerDefault.data : DEFAULT_SETTINGS.readerDefault,
    instructWaitMax: instructWaitMax.success ? instructWaitMax.data : DEFAULT_SETTINGS.instructWaitMax,
    quickCommands: cleanQuickCommands(data.quickCommands),
  };
}

/** Escritura atómica (archivo temporal + rename). Un fallo de disco no debe tumbar al puente. */
export function saveSettings(path: string, settings: Settings): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, path);
  } catch {
    // los ajustes son auxiliares
  }
}
