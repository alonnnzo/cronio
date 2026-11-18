import { z } from "zod";
import { MAX_VERSION_TEXT } from "./version.ts";

/** Largo máximo de los textos de una línea (título, proyecto, modelo, actividad, cada línea de tarjeta, cara y detalle). */
export const MAX_TEXT = 38;
/** Líneas máximas de la tarjeta de permiso. */
export const MAX_LINES = 6;
/**
 * Líneas de la cara: de 1 a 4. Con 1 o 2 es el globo de siempre (título y detalle); con 3 o 4 el globo crece hacia arriba
 * (título + hasta MAX_QUESTION_LINES de la pregunta que espera respuesta); el cuarto renglón es lo más que cabe sin
 * tapar la boca en los 400x240 de la pantalla superior.
 */
export const MAX_FACE_LINES = 4;
/** Líneas máximas de la pregunta que espera respuesta (en la cara y en el detalle). */
export const MAX_QUESTION_LINES = 3;
/** Líneas máximas del último mensaje en el detalle de una sesión. */
export const MAX_DETAIL_LINES = 4;
/** Preguntas máximas de una solicitud de pregunta (AskUserQuestion) y opciones por pregunta. */
export const MAX_QUESTIONS = 4;
export const MAX_QUESTION_OPTIONS = 4;
/** Líneas máximas de la descripción de una opción en la vista. */
export const MAX_OPTION_DESC_LINES = 2;
/** Largo máximo (en caracteres) de la respuesta "Otra" escrita en la consola. */
export const MAX_OTHER_TEXT = 200;
/** Largo máximo (en caracteres) de una instrucción escrita en la consola (paso 6) y cuántas se encolan por sesión. */
export const MAX_INSTRUCTION_TEXT = 400;
export const MAX_INSTRUCTIONS = 5;
/** Minutos que una sesión espera tu instrucción con "Esperar mi respuesta" (ajuste `instructWaitMax`, paso 6). */
export const INSTRUCT_WAIT_OPTIONS = [5, 10, 30] as const;
/**
 * Comandos rápidos de la tarjeta de instrucción (Fase 3): atajos de un toque que mandan un texto fijo como instrucción. Hasta
 * MAX_QUICK_COMMANDS; la etiqueta cabe en medio ancho de la pantalla de abajo y el texto es lo que se manda (el puente lo guarda
 * en sus ajustes y lo recorta a estos topes, en caracteres).
 */
export const MAX_QUICK_COMMANDS = 4;
export const MAX_QUICK_LABEL = 20;
export const MAX_QUICK_TEXT = 120;
/** Líneas máximas de una tarjeta de aviso (comienzo del último mensaje o la pregunta), cada una de hasta MAX_TEXT. */
export const MAX_NOTICE_LINES = 4;
/**
 * Líneas máximas del mensaje completo que el puente manda a pedido (`text`, Fase 2b paso 1). Aparte de este tope,
 * el puente corta por bytes para que la trama sellada quepa siempre en MAX_PAYLOAD (ver `packages/bridge/src/reader.ts`).
 */
export const MAX_READ_LINES = 240;
/**
 * Largo máximo de cada línea del mensaje completo (`text`). Propio del lector: la 3DS lo dibuja con una letra más
 * pequeña que las tarjetas, así que usa todo el ancho de la pantalla. El resto del protocolo sigue con MAX_TEXT.
 */
export const MAX_READ_TEXT = 48;
/**
 * Tope de `sinceS` (segundos desde el último cambio de estado de una sesión): 99 días. El puente lo recorta a este valor; la consola
 * le suma su propio reloj desde que recibió la vista, así que el reloj del PC y el de la consola no tienen que coincidir.
 */
export const MAX_SINCE_S = 99 * 86400;
/** Sesiones máximas en la vista. */
export const MAX_SESSIONS = 12;
/** Largo máximo de los identificadores (sesión y solicitud). */
export const MAX_ID = 48;
/** Juego de caracteres de los identificadores: 1 a 48 de [A-Za-z0-9_.:-]. */
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,48}$/;

const text = z.string().max(MAX_TEXT);
export const IdSchema = z.string().regex(ID_PATTERN);

export const AgentKindSchema = z.enum(["claude", "gemini", "codex", "cursor", "hermes"]);
export const AgentStateSchema = z.enum(["idle", "working", "ask", "done", "error"]);
export const MoodSchema = z.enum(["idle", "working", "ask", "done", "error"]);
export const PermissionModeSchema = z.enum(["queue", "manual"]);

/**
 * Modo de aviso: el de las sesiones nuevas (ajuste `notifyDefault`) y el de cada sesión (Fase 2b, paso 3).
 * `all` todo; `important` permisos, preguntas, errores y fin de turno; `end` solo fin de turno, "te espera" y esperando
 * instrucciones; `silent` ninguno (los permisos siguen apareciendo como tarjeta).
 */
export const NotifyDefaultSchema = z.enum(["all", "important", "end", "silent"]);
export const NotifyModeSchema = NotifyDefaultSchema;

/**
 * Cómo se lee el último mensaje (Fase 2b, paso 5): `full` el mensaje entero o `summary` un resumen corto que cabe en una
 * pantalla. Es el valor de `read.mode`, de `text.mode` y del ajuste `readerDefault`.
 */
export const ReadModeSchema = z.enum(["full", "summary"]);
export type ReadMode = z.infer<typeof ReadModeSchema>;

/** Qué pasó en una tarjeta de aviso: terminó el turno, espera tu respuesta, error o espera instrucciones. */
export const NoticeKindSchema = z.enum(["done", "ask", "error", "idle"]);
/** Sonido que le corresponde a un aviso (la consola lo reproduce desde el paso 3b): fin, pregunta, error o permiso. */
export const ChimeKindSchema = z.enum(["done", "ask", "error", "permission"]);

/**
 * Preferencias que la consola muestra en su menú de configuración (SELECT). El puente las guarda
 * (`.companion/settings.json`); la consola solo las dibuja y pide cambiarlas con `setting`.
 */
export const InstructWaitSchema = z.union([z.literal(5), z.literal(10), z.literal(30)]);

export const SettingsViewSchema = z.object({
  notifyDefault: NotifyDefaultSchema,
  /** Los avisos piden "Visto" (se usa a partir del paso 3). */
  notifyAck: z.boolean(),
  /** Sonido de los avisos en la consola (paso 3b). Opcional: un puente anterior no lo manda y se toma como activo. */
  sound: z.boolean().optional(),
  /** Preguntas con alternativas en la consola (paso 4). Opcional: un puente anterior no lo manda y se toma como activo. */
  questions: z.boolean().optional(),
  /** Modo en que el lector abre los mensajes (paso 5). Opcional: un puente anterior no lo manda y se toma como `full`. */
  readerDefault: ReadModeSchema.optional(),
  /** Minutos que una sesión con "Esperar mi respuesta" retiene el fin de turno (paso 6): 5, 10 o 30. Opcional: un puente anterior no lo manda y se toma como 10. */
  instructWaitMax: InstructWaitSchema.optional(),
  /** Agentes que no aparecen en la lista ni en la cara ambiente; sus permisos sí llegan siempre. Sin repetidos. */
  hiddenAgents: z.array(AgentKindSchema).max(5),
});

export const SessionViewSchema = z.object({
  id: IdSchema,
  kind: AgentKindSchema,
  title: text,
  project: text,
  model: text,
  state: AgentStateSchema,
  activity: text,
  /** Opcional: segundos que lleva la sesión en su estado actual, medidos por el puente al armar la vista. Ausente en un puente anterior. */
  sinceS: z.number().int().min(0).max(MAX_SINCE_S).optional(),
});

/** Una opción de una pregunta; la etiqueta ya viene sin "(Recommended)" y `recommended` lo dice aparte. */
export const QuestionOptionViewSchema = z.object({
  label: text,
  /** Descripción de la opción en hasta MAX_OPTION_DESC_LINES líneas cortas (puede no tener). */
  desc: z.array(text).max(MAX_OPTION_DESC_LINES),
  recommended: z.boolean(),
});

/** Una pregunta de AskUserQuestion, ya recortada a los límites de la vista. */
export const QuestionViewSchema = z.object({
  header: text,
  /** El texto de la pregunta en hasta MAX_QUESTION_LINES líneas. */
  text: z.array(text).min(1).max(MAX_QUESTION_LINES),
  /** Se pueden marcar varias opciones. */
  multi: z.boolean(),
  options: z.array(QuestionOptionViewSchema).min(2).max(MAX_QUESTION_OPTIONS),
});

/** Un comando rápido: la etiqueta del botón y el texto que se manda como instrucción. */
export const QuickCommandSchema = z.object({
  label: z.string().min(1).max(MAX_QUICK_LABEL),
  text: z.string().min(1).max(MAX_QUICK_TEXT),
});

export const RequestKindSchema = z.enum(["permission", "question", "instruction"]);

export const RequestViewSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  /**
   * Opcional: `permission` (por defecto, la tarjeta de siempre) o `question` (AskUserQuestion: se responde con `answer`,
   * nunca con `decision`, y trae `questions`) o `instruction` (paso 6: la sesión terminó su turno y espera tu instrucción; `lines` es el
   * comienzo de su último mensaje y se responde con `instruct` o `release`, nunca con `decision`). Una consola que no entienda
   * `question` ni `instruction` no debe aprobar nada con ellas.
   */
  kind: RequestKindSchema.optional(),
  title: text,
  lines: z.array(text).max(MAX_LINES),
  risk: z.enum(["normal", "high"]),
  /** Segundos que faltan para que venza la solicitud. 0 = sin límite: no hay cuenta atrás ni vencimiento. */
  expiresInS: z.number().int().nonnegative(),
  /** Lugar de la solicitud enfocada en la cola, por antigüedad, desde 1. */
  position: z.number().int().min(1),
  total: z.number().int().min(1),
  /**
   * Presente solo si el agente ofrece "sí, no volver a preguntar": texto corto (ya recortado) de lo que quedaría
   * permitido, p. ej. `Bash(npm test)`. Sin este campo la consola no ofrece la tercera opción (`allow_always`).
   */
  always: z.string().min(1).max(MAX_TEXT).optional(),
  /** Solo con `kind: "question"`: de 1 a MAX_QUESTIONS preguntas, en orden. */
  questions: z.array(QuestionViewSchema).min(1).max(MAX_QUESTIONS).optional(),
  /** Solo con `kind: "instruction"`: de 0 a MAX_QUICK_COMMANDS atajos que se mandan con `instruct` (la consola no los edita). */
  quick: z.array(QuickCommandSchema).max(MAX_QUICK_COMMANDS).optional(),
})
  .refine((r) => (r.kind === "question") === (r.questions !== undefined), "las preguntas van solo con kind question (y siempre con él)")
  .refine((r) => r.quick === undefined || r.kind === "instruction", "los comandos rápidos van solo con kind instruction");

/**
 * Tarjeta de aviso con acuse de recibo ("Visto"): lo que pasó en una sesión, sin pedir decisión. Solo viaja si no hay
 * ningún permiso pendiente (los permisos van siempre primero) y el ajuste `notifyAck` está activo. Se retira al
 * marcarla (`ack`), cuando la sesión vuelve a trabajar, termina o llega un aviso más nuevo de la misma sesión.
 */
export const NoticeViewSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  kind: NoticeKindSchema,
  agent: text,
  project: text,
  /** "Terminó", "Espera tu respuesta", "Error" o "Esperando instrucciones". */
  title: text,
  /** Comienzo del último mensaje o la pregunta, ya cortado en líneas. */
  lines: z.array(text).max(MAX_NOTICE_LINES),
  /** Lugar de este aviso en la cola (desde 1) y cuántos hay. */
  position: z.number().int().min(1),
  total: z.number().int().min(1),
});

/**
 * Último aviso que merece sonido. `seq` sube de uno en uno mientras el puente vive: la consola reproduce el sonido una
 * sola vez por `seq` nuevo (y debe tomar el primero que ve al conectarse como punto de partida, sin sonar).
 */
export const ChimeViewSchema = z.object({
  kind: ChimeKindSchema,
  seq: z.number().int().min(1).max(4294967295),
});

/**
 * Hay una versión nueva de la app de la consola (Fase 7, actualizar desde la 3DS). El puente la manda solo a la consola cuya
 * versión (`appVersion` del saludo) es menor que la del .cia que sirve; `url` es la dirección que la consola descarga
 * (`http://<ip del PC en esa red>:33337/agent-companion.cia`). `size` y `sha256` (hex, 64 caracteres) son los del .cia que el puente
 * sirve desde memoria: la consola exige que lo descargado tenga ese tamaño y ese hash antes de tocar AM (el HTTP va en claro). Es un
 * aviso aparte: nunca cuenta como permiso ni como pregunta.
 */
export const MAX_UPDATE_URL = 120;
/** Tamaño máximo del .cia que se ofrece (8 MiB: el mismo tope que la consola, que lo baja entero a memoria). */
export const MAX_UPDATE_SIZE = 8 * 1024 * 1024;
export const UpdateViewSchema = z.object({
  version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/).max(MAX_VERSION_TEXT),
  url: z.string().max(MAX_UPDATE_URL).regex(/^http:\/\/[0-9.]{7,15}:\d{1,5}\/[A-Za-z0-9_.-]{1,40}$/),
  size: z.number().int().min(1).max(MAX_UPDATE_SIZE),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const FaceViewSchema = z.object({
  kind: AgentKindSchema.nullable(),
  mood: MoodSchema,
  lines: z.array(text).min(1).max(MAX_FACE_LINES),
});

export const DetailViewSchema = z.object({
  sessionId: IdSchema,
  lastMessage: z.array(text).max(MAX_DETAIL_LINES),
  /** Opcional: la pregunta que la sesión espera que respondas, completa y ya cortada en líneas. Ausente si no hay. */
  question: z.array(text).min(1).max(MAX_QUESTION_LINES).optional(),
  /** Opcional: modo de aviso de esta sesión (se cambia con `setting` `sessionNotify`). */
  notify: NotifyModeSchema.optional(),
  /** Opcional (paso 6): instrucciones en cola para el próximo fin de turno de la sesión (cuántas y el comienzo de la primera). Ausente si no hay. */
  instructions: z.object({ count: z.number().int().min(1).max(MAX_INSTRUCTIONS), first: text }).optional(),
  /** Opcional (paso 6): "Esperar mi respuesta" de esta sesión; ausente = apagado (se cambia con `setting` `sessionWait`). */
  waitForMe: z.boolean().optional(),
});

export const ViewModelSchema = z.object({
  sessions: z.array(SessionViewSchema).max(MAX_SESSIONS),
  request: RequestViewSchema.nullable(),
  pendingCount: z.number().int().nonnegative(),
  mode: PermissionModeSchema,
  face: FaceViewSchema,
  detail: DetailViewSchema.nullable(),
  led: z.enum(["off", "working", "ask", "done", "error"]),
  /** Opcional por compatibilidad: un puente anterior no lo manda y la consola deja el menú de ajustes sin conexión. */
  settings: SettingsViewSchema.optional(),
  /** Opcional: la tarjeta de aviso a la vista (ausente = ninguna; nunca junto a un permiso pendiente). */
  notice: NoticeViewSchema.optional(),
  /** Opcional: último aviso con sonido. */
  chime: ChimeViewSchema.optional(),
  /** Opcional: hay una versión nueva de la app (solo para la consola que tiene una menor). Ausente = nada que avisar. */
  update: UpdateViewSchema.optional(),
});

export type AgentKind = z.infer<typeof AgentKindSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type Mood = z.infer<typeof MoodSchema>;
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type NotifyDefault = z.infer<typeof NotifyDefaultSchema>;
export type NotifyMode = z.infer<typeof NotifyModeSchema>;
export type InstructWait = z.infer<typeof InstructWaitSchema>;
export type NoticeKind = z.infer<typeof NoticeKindSchema>;
export type ChimeKind = z.infer<typeof ChimeKindSchema>;
export type QuickCommand = z.infer<typeof QuickCommandSchema>;
export type RequestKind = z.infer<typeof RequestKindSchema>;
export type QuestionView = z.infer<typeof QuestionViewSchema>;
export type QuestionOptionView = z.infer<typeof QuestionOptionViewSchema>;
export type NoticeView = z.infer<typeof NoticeViewSchema>;
export type ChimeView = z.infer<typeof ChimeViewSchema>;
export type UpdateView = z.infer<typeof UpdateViewSchema>;
export type SettingsView = z.infer<typeof SettingsViewSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export type RequestView = z.infer<typeof RequestViewSchema>;
export type FaceView = z.infer<typeof FaceViewSchema>;
export type DetailView = z.infer<typeof DetailViewSchema>;
export type ViewModel = z.infer<typeof ViewModelSchema>;
