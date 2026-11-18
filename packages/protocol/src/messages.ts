import { z } from "zod";
import { AgentKindSchema, IdSchema, InstructWaitSchema, MAX_INSTRUCTION_TEXT, NotifyDefaultSchema, NotifyModeSchema, MAX_OTHER_TEXT, MAX_QUESTION_LINES, MAX_QUESTION_OPTIONS, MAX_QUESTIONS, MAX_READ_LINES, MAX_READ_TEXT, PermissionModeSchema, ReadModeSchema, ViewModelSchema } from "./viewmodel.ts";

export const BridgeMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("view"), rev: z.number().int().nonnegative(), view: ViewModelSchema }),
  z.object({ t: z.literal("error"), code: z.string() }),
  /**
   * Respuesta a `read`: el último mensaje completo de la sesión, ya limpio de markdown y cortado en líneas de hasta
   * MAX_READ_TEXT (la consola no parte texto). Solo va a la consola que lo pidió; nunca forma parte de la vista.
   * `lines` vacío = sesión desconocida o sin mensaje. `truncated`: el mensaje no cupo y se cortó al final.
   * `question`: si la sesión espera respuesta, su pregunta (hasta MAX_QUESTION_LINES) para mostrarla arriba.
   * `mode` (paso 5): `full` o `summary`, el modo de `lines` (opcional: un puente anterior no lo manda y es `full`).
   * `short`: en `summary`, el mensaje ya cabía entero y `lines` es el mensaje, no un resumen.
   */
  z.object({
    t: z.literal("text"),
    sessionId: IdSchema,
    lines: z.array(z.string().max(MAX_READ_TEXT)).max(MAX_READ_LINES),
    truncated: z.boolean(),
    question: z.array(z.string().max(MAX_READ_TEXT)).min(1).max(MAX_QUESTION_LINES).optional(),
    mode: ReadModeSchema.optional(),
    short: z.boolean().optional(),
  }),
]);

/**
 * Un cambio de ajuste válido (clave y valor). La consola lo manda dentro de `{ t: "setting", key, value }`; el puente lo
 * valida con este esquema y, si no cumple (clave desconocida o valor inválido), lo ignora y lo registra sin cerrar la conexión.
 */
export const SettingChangeSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("notifyDefault"), value: NotifyDefaultSchema }),
  z.object({ key: z.literal("notifyAck"), value: z.boolean() }),
  z.object({ key: z.literal("sound"), value: z.boolean() }),
  z.object({ key: z.literal("questions"), value: z.boolean() }),
  z.object({ key: z.literal("readerDefault"), value: ReadModeSchema }),
  z.object({ key: z.literal("instructWaitMax"), value: InstructWaitSchema }),
  z.object({
    key: z.literal("hiddenAgents"),
    value: z
      .array(AgentKindSchema)
      .max(5)
      .refine((a) => new Set(a).size === a.length, "sin repetidos"),
  }),
]);
export type SettingChange = z.infer<typeof SettingChangeSchema>;

/**
 * Cambio del modo de aviso de una sesión (`{ t: "setting", key: "sessionNotify", sessionId, value }`). Como el resto de
 * los ajustes, si no cumple se ignora y se registra sin cerrar la conexión.
 */
export const SessionNotifyChangeSchema = z.object({ sessionId: IdSchema, value: NotifyModeSchema });
export type SessionNotifyChange = z.infer<typeof SessionNotifyChangeSchema>;

/**
 * Cambio de "Esperar mi respuesta" de una sesión (`{ t: "setting", key: "sessionWait", sessionId, value }`, paso 6). Como
 * `sessionNotify`, si no cumple se ignora y se registra sin cerrar la conexión.
 */
export const SessionWaitChangeSchema = z.object({ sessionId: IdSchema, value: z.boolean() });
export type SessionWaitChange = z.infer<typeof SessionWaitChangeSchema>;

/**
 * Instrucción escrita en la consola (paso 6): de 1 a MAX_INSTRUCTION_TEXT caracteres con algo que no sea espacio y sin
 * caracteres de control (ni saltos de línea). El puente la valida con este esquema y, si no cumple, la ignora y la registra.
 */
export const InstructionTextSchema = z
  .string()
  .max(MAX_INSTRUCTION_TEXT)
  .refine((s) => s.trim().length > 0, "no vacía")
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "sin caracteres de control");

/**
 * Respuesta de la consola a una solicitud de pregunta (AskUserQuestion): una entrada por pregunta, en orden. La consola manda
 * índices de opciones, no textos: el puente traduce a las etiquetas completas. `other` es el texto escrito en "Otra…".
 */
export const AnswerEntrySchema = z.union([
  z.strictObject({
    choose: z
      .array(z.number().int().min(0).max(MAX_QUESTION_OPTIONS - 1))
      .min(1)
      .max(MAX_QUESTION_OPTIONS)
      .refine((a) => new Set(a).size === a.length, "sin repetidos"),
  }),
  z.strictObject({ other: z.string().min(1).max(MAX_OTHER_TEXT) }),
]);
export type AnswerEntry = z.infer<typeof AnswerEntrySchema>;

/**
 * `answer` válido: las respuestas a todas las preguntas, o `pc: true` ("Responder en el PC": se devuelve la pregunta a
 * Claude Code). Como `setting`, el puente lo valida con este esquema y, si no cumple, lo ignora y lo registra sin cerrar la conexión.
 */
export const AnswerSchema = z.union([
  z.strictObject({ requestId: IdSchema, pc: z.literal(true) }),
  z.strictObject({ requestId: IdSchema, answers: z.array(AnswerEntrySchema).min(1).max(MAX_QUESTIONS) }),
]);
export type Answer = z.infer<typeof AnswerSchema>;

/** Segundos máximos de una pausa anunciada con `hold` (el teclado del sistema congela la app). */
export const MAX_HOLD_SECONDS = 300;

export const ConsoleMessageSchema = z.discriminatedUnion("t", [
  /** `allow_always`: aprobar y aplicar lo que el agente sugiere para no volver a preguntar (solo si la solicitud lo ofrece). */
  z.object({ t: z.literal("decision"), requestId: IdSchema, decision: z.enum(["allow", "allow_always", "deny"]) }),
  /** La consola abrió el detalle de una sesión (o lo cerró con `null`). */
  z.object({ t: z.literal("focus"), sessionId: IdSchema.nullable() }),
  /** En modo `queue`: pasar al siguiente permiso pendiente sin responder. */
  z.object({ t: z.literal("skip") }),
  z.object({ t: z.literal("mode"), mode: PermissionModeSchema }),
  /** "Visto": retira la tarjeta de aviso `id`. Solo en la consola: no se le manda nada al agente. */
  z.object({ t: z.literal("ack"), id: IdSchema }),
  /** Pasa a la siguiente tarjeta de aviso de la cola (circular), como `skip` con los permisos. */
  z.object({ t: z.literal("skipNotice") }),
  /** Pide el último mensaje de la sesión; el puente responde con `text`. `mode` (paso 5): `full` (por defecto) o `summary`. */
  z.object({ t: z.literal("read"), sessionId: IdSchema, mode: ReadModeSchema.optional() }),
  /**
   * Responde una solicitud de pregunta. Aquí solo se comprueba la forma; el contenido se valida con AnswerSchema y contra la
   * pregunta en el puente, que ignora lo inválido (y lo registra) en vez de cerrar la conexión.
   */
  z.object({ t: z.literal("answer"), requestId: z.string().max(60), pc: z.unknown().optional(), answers: z.unknown().optional() }),
  /**
   * Instrucción para una sesión (paso 6): si la sesión espera (tarjeta "Espera tu instrucción") se le entrega en el acto; si no, queda
   * en cola para su próximo fin de turno. Aquí solo se comprueba la forma; el texto se valida con InstructionTextSchema en el puente.
   */
  z.object({ t: z.literal("instruct"), sessionId: z.string().max(60), text: z.string().max(4 * MAX_INSTRUCTION_TEXT) }),
  /** Vacía la cola de instrucciones de la sesión. */
  z.object({ t: z.literal("instructClear"), sessionId: z.string().max(60) }),
  /** "Seguir en el PC": libera la solicitud de tipo `instruction` sin instrucción. */
  z.object({ t: z.literal("release"), requestId: z.string().max(60) }),
  /** La consola va a abrir el teclado del sistema y no hablará durante `seconds`: el puente no la corta por silencio. */
  z.object({ t: z.literal("hold"), seconds: z.number().int().min(1).max(MAX_HOLD_SECONDS) }),
  /**
   * Cambia un ajuste del puente (menú de configuración). Aquí solo se comprueba la forma: la clave y el valor se validan
   * con SettingChangeSchema en el puente, que ignora lo inválido en vez de cerrar la conexión.
   */
  z.object({
    t: z.literal("setting"),
    key: z.string().max(40),
    /** Solo con `key: "sessionNotify"` o `"sessionWait"`: la sesión cuyo ajuste se cambia. */
    sessionId: z.string().max(60).optional(),
    value: z.union([z.string().max(40), z.boolean(), z.number().int(), z.array(z.string().max(40)).max(16)]),
  }),
]);

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type ConsoleMessage = z.infer<typeof ConsoleMessageSchema>;

export function parseBridgeMessage(json: unknown): BridgeMessage {
  return BridgeMessageSchema.parse(json);
}

export function parseConsoleMessage(json: unknown): ConsoleMessage {
  return ConsoleMessageSchema.parse(json);
}
