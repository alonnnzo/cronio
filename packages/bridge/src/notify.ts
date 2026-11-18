import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NotifyModeSchema, type NotifyMode } from "@companion/protocol";

/**
 * Hechos de una sesión que pueden avisar (Fase 2b, paso 3). El puente decide con esta tabla; la consola solo dibuja y suena.
 *  - importantes: `permission`, `ask_tool` (pregunta de AskUserQuestion), `ask_stop` ("te espera": el turno terminó con una
 *    pregunta), `error`, `done` (fin de turno) e `idle` (esperando instrucciones);
 *  - menores: `working` (empezó a trabajar; la actividad de las herramientas solo cambia la cara ambiente).
 */
export type AttentionEvent = "working" | "permission" | "ask_tool" | "ask_stop" | "error" | "done" | "idle";

/**
 * ¿Un hecho llega (globo, tarjeta y sonido) con este modo?
 *  - `all`: todo.
 *  - `important`: todo lo importante (no el globo de "empezó a trabajar").
 *  - `end`: solo fin de turno, "te espera" e instrucciones pendientes. Los permisos y las preguntas siguen apareciendo
 *    (la tarjeta de permiso y la pregunta del detalle no dependen del modo) pero sin aviso ni sonido.
 *  - `silent`: nada. Los permisos siguen apareciendo como tarjeta (seguridad), sin sonido.
 */
export function passes(mode: NotifyMode, ev: AttentionEvent): boolean {
  switch (mode) {
    case "all":
      return true;
    case "important":
      return ev !== "working";
    case "end":
      return ev === "done" || ev === "ask_stop" || ev === "idle";
    case "silent":
      return false;
  }
}

/** Orden en que "Avisos" recorre los modos (el de la consola y el simulador). */
export const NOTIFY_ORDER: readonly NotifyMode[] = ["all", "important", "end", "silent"];

/** Tope de proyectos recordados; al pasarlo se olvida el más antiguo. */
export const MAX_REMEMBERED_PROJECTS = 200;

/** Modo de aviso recordado por proyecto (`.companion/notify-modes.json`). Un archivo ausente o dañado equivale a vacío. */
export function loadProjectModes(path: string): Map<string, NotifyMode> {
  const out = new Map<string, NotifyMode>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
    for (const [project, mode] of Object.entries(parsed as Record<string, unknown>)) {
      const m = NotifyModeSchema.safeParse(mode);
      if (m.success && project.length > 0 && project.length <= 2000 && out.size < MAX_REMEMBERED_PROJECTS) out.set(project, m.data);
    }
  } catch {
    // ausente o dañado: sin recuerdos
  }
  return out;
}

/** Proyectos con "Esperar mi respuesta" activo (paso 6; `.companion/wait-projects.json`, una lista de nombres). Ausente o dañado = vacío. */
export function loadWaitProjects(path: string): Set<string> {
  const out = new Set<string>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return out;
    for (const p of parsed) if (typeof p === "string" && p.length > 0 && p.length <= 2000 && out.size < MAX_REMEMBERED_PROJECTS) out.add(p);
  } catch {
    // ausente o dañado: sin recuerdos
  }
  return out;
}

export function saveWaitProjects(path: string, projects: ReadonlySet<string>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...projects], null, 2) + "\n");
    renameSync(tmp, path);
  } catch {
    // los recuerdos son auxiliares
  }
}

/** Escritura atómica; un fallo de disco no debe tumbar al puente. */
export function saveProjectModes(path: string, modes: ReadonlyMap<string, NotifyMode>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(modes), null, 2) + "\n");
    renameSync(tmp, path);
  } catch {
    // los recuerdos son auxiliares
  }
}
