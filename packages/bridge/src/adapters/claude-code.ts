import { ID_PATTERN } from "@companion/protocol";
import type { BridgeStore } from "../store.ts";

const IDLE_ACTIVITY = "Esperando instrucciones";
const ASK_TOOL_ACTIVITY = "Te hace una pregunta";
const ASK_STOP_ACTIVITY = "Espera tu respuesta";
const ASK_USER_QUESTION = "AskUserQuestion";
/** Caja de fin de turno de la app de escritorio de Claude: su `ask` es la pregunta que deja al usuario. */
const WRAP_UP_TOOL = "mcp__ccd_turn__wrap_up";

/** `question` de la primera pregunta de AskUserQuestion. */
function firstQuestion(toolInput: unknown): string | undefined {
  const qs = (toolInput as { questions?: unknown } | null)?.questions;
  const q = Array.isArray(qs) ? (qs[0] as { question?: unknown } | null) : undefined;
  return str(q?.question);
}

/** Último tramo de una ruta (acepta `/` y `\`). */
export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Nombre del proyecto: último tramo de `cwd`. */
export function projectOf(cwd: string | undefined): string {
  return lastSegment(cwd ?? "") || "unknown";
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Actividad que se muestra según la herramienta que Claude Code va a usar. */
export function activityFor(toolName: string | undefined, toolInput: unknown): string {
  const input = (typeof toolInput === "object" && toolInput !== null ? toolInput : {}) as Record<string, unknown>;
  const file = lastSegment(str(input.file_path) ?? str(input.notebook_path) ?? str(input.path) ?? "");
  const withArg = (verb: string, arg: string) => (arg ? `${verb} ${arg}` : verb);
  switch (toolName) {
    case undefined:
      return "Trabajando";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return withArg("Editando", file);
    case "Read":
      return withArg("Leyendo", file);
    case "Bash":
    case "PowerShell":
      return withArg("Ejecutando", str(input.command) ?? "");
    case "Grep":
    case "Glob":
      return "Buscando en el proyecto";
    case "WebFetch":
    case "WebSearch":
      return "Buscando en la web";
    case "Agent":
    case "Task":
      return "Coordinando subagentes";
    default:
      if (toolName.startsWith("mcp__")) return withArg("Usando", toolName.split("__")[1] ?? "");
      return `Usando ${toolName}`;
  }
}

/**
 * Traduce el JSON de un hook de Claude Code (tal cual llega) a cambios en el store.
 * Nunca lanza ni decide nada: una carga inesperada se ignora.
 */
export function applyClaudeHook(store: BridgeStore, payload: unknown): void {
  try {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    const sessionId = str(p.session_id);
    if (!sessionId || !ID_PATTERN.test(sessionId)) return;
    const event = str(p.hook_event_name);

    if (event === "SessionEnd") { // removeSession retira también sus solicitudes pendientes
      store.removeSession(sessionId);
      return;
    }

    const cwd = str(p.cwd);
    const model = str(p.model);
    const title = str(p.session_title);
    const known = store.getSession(sessionId);

    if (event === "SessionStart") {
      store.upsertSession({ sessionId, kind: "claude", project: cwd ? projectOf(cwd) : (known?.project ?? "unknown"), model, title });
      return;
    }
    if (!known) store.upsertSession({ sessionId, kind: "claude", project: projectOf(cwd), model, title });

    switch (event) {
      case "UserPromptSubmit":
        store.clearQuestion(sessionId); // el usuario respondió
        store.resolveElsewhere(sessionId);
        store.releaseSessionInstruction(sessionId, "user_prompt"); // escribió en el PC: se libera el fin de turno retenido; la cola no se borra
        store.clearDelivered(sessionId);
        store.setSessionState(sessionId, "working");
        store.setActivity(sessionId, "Pensando");
        break;
      case "PreToolUse": {
        const tool = str(p.tool_name);
        if (tool === ASK_USER_QUESTION) {
          store.setQuestion(sessionId, firstQuestion(p.tool_input) ?? ASK_TOOL_ACTIVITY);
          store.setActivity(sessionId, ASK_TOOL_ACTIVITY);
          break;
        }
        if (tool === WRAP_UP_TOOL) {
          // la caja de fin de turno no es trabajo: solo recuerda la pregunta hasta el Stop
          store.setStopQuestion(sessionId, str((p.tool_input as { ask?: unknown } | null)?.ask) ?? "");
          break;
        }
        // no retira nada: con herramientas en paralelo o subagentes, el PreToolUse de otra herramienta no prueba
        // que un permiso pendiente se haya resuelto
        store.clearDelivered(sessionId);
        store.setSessionState(sessionId, "working");
        store.setActivity(sessionId, activityFor(tool, p.tool_input));
        break;
      }
      case "PostToolUse":
      case "PostToolUseFailure":
        if (str(p.tool_name) === ASK_USER_QUESTION) {
          store.clearQuestion(sessionId); // ya respondió: el trabajo continúa
          store.setSessionState(sessionId, "working");
          store.setActivity(sessionId, "Pensando");
        }
        // retira solo la solicitud de esa misma herramienta e input; sin coincidencia no retira nada. AskUserQuestion
        // respondida en el PC vuelve con el input cambiado (`answers`): se retira por nombre (una sesión hace una
        // pregunta a la vez).
        store.resolveElsewhere(
          sessionId,
          str(p.tool_name) === ASK_USER_QUESTION
            ? { toolName: ASK_USER_QUESTION }
            : { toolName: str(p.tool_name), toolInput: p.tool_input },
        );
        store.touchSession(sessionId);
        break;
      case "Notification":
        if (p.notification_type === "idle_prompt" && !store.getSession(sessionId)?.question) {
          store.setSessionState(sessionId, "idle");
          store.setActivity(sessionId, IDLE_ACTIVITY);
          store.notifyIdle(sessionId); // espera instrucciones (aviso, salvo que ya avisó el fin de turno)
        } else store.touchSession(sessionId);
        break;
      case "Stop": {
        store.resolveElsewhere(sessionId);
        const asked = store.getSession(sessionId)?.stopQuestion;
        store.clearQuestion(sessionId);
        const last = str(p.last_assistant_message);
        if (asked) {
          // el turno terminó con una pregunta: la sesión espera tu respuesta, no está "terminada"
          if (last !== undefined) store.setLastMessage(sessionId, last);
          store.setQuestion(sessionId, asked, "stop");
          store.setActivity(sessionId, ASK_STOP_ACTIVITY);
          break;
        }
        // el mensaje antes que el estado: el aviso "terminó" toma de él el comienzo del texto
        if (last !== undefined) store.setLastMessage(sessionId, last);
        // paso 6: si el hook de instrucciones tiene el `Stop` retenido (la sesión espera tu instrucción) o hay una instrucción por
        // entregarse o recién entregada, la sesión no terminó: sigue su estado (los dos hooks llegan a la vez, en cualquier orden)
        if (store.hasInstructionRequest(sessionId)) break;
        if (store.stopContinues(sessionId)) {
          store.setSessionState(sessionId, "working");
          store.setActivity(sessionId, "Siguiendo tu instrucción");
          break;
        }
        store.setSessionState(sessionId, "done");
        store.setActivity(sessionId, IDLE_ACTIVITY);
        break;
      }
      default:
        store.touchSession(sessionId);
    }
  } catch {
    // un hook con una carga rara no debe afectar al puente
  }
}
