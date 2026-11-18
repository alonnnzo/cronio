import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { AgentKindSchema, IdSchema } from "@companion/protocol";
import type { BridgeStore } from "./store.ts";
import type { PairingManager } from "./pairing.ts";
import type { DeviceStore } from "./devices.ts";
import type { ConsoleCounter } from "./feed.ts";
import { isLocalHostHeader } from "./local.ts";
import { applyClaudeHook, projectOf } from "./adapters/claude-code.ts";
import { parseSuggestions } from "./suggestions.ts";
import { parseQuestions } from "./questions.ts";
import { carpetaPermitida, leerConfig } from "../../hooks/carpetas.mjs";
import { TOKEN_HEADER, tokenMatches } from "./api-token.ts";

const NOT_PERMISSION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Rutas que exigen el token local (`X-Cronio-Token`): las que deciden o cambian algo. `/health` (solo lectura) y `/hook/claude` no: los hooks `http` de
 * Claude Code no pueden leer archivos ni el token (cambia en cada arranque), y esa entrada solo recibe eventos informativos (ver `applyClaudeHook`:
 * nunca aprueba nada, a lo sumo retira solicitudes dejándolas para el PC).
 */
export const TOKEN_PATHS: ReadonlySet<string> = new Set(["/pair", "/permission", "/question", "/stop", "/shutdown", "/event", "/devices/forget"]);

export interface HttpApiOptions {
  store: BridgeStore;
  pairing: PairingManager;
  /** Fuentes de consola; permite distinguir consola real de simulador en /health. */
  counter: ConsoleCounter;
  /** Puerto (0 = efímero). */
  port: number;
  /** Token local que exigen las rutas de `TOKEN_PATHS` (64 hex). Sin 401. */
  apiToken: string;
  /** Estado del servidor del .cia (lo ve el programa del PC en /health para saber si el paso 4 debe servirlo él). */
  cia?: () => { serving: boolean; port?: number; version?: string };
  /** Última IPv4 local por la que llegó una consola (se recuerda aunque se haya desconectado): esa IP se sabe que funciona para el QR. */
  consoleLocalIp?: () => string | undefined;
  /** Versión de la app de la última consola que se conectó (la que dijo en su saludo). Ausente si no la dijo. */
  consoleVersion?: () => string | undefined;
  /** Quién es este puente (lo muestra /health para que el programa del PC distinga uno viejo, de otra versión o suelto). */
  info?: { version: string; startedBy: "cronio" | "manual" };
  /** Consolas emparejadas (`devices.json`): `GET /devices` las lista sin claves y `POST /devices/forget` borra la clave de una. Sin esto, 501. */
  devices?: DeviceStore;
  /** Corta la conexión de una consola (devuelve si estaba conectada). Lo usa `POST /devices/forget` después de borrar su clave. */
  disconnectDevice?: (deviceId: string) => boolean;
  /** Ids de las consolas conectadas ahora (para marcarlas en `GET /devices`). */
  connectedDevices?: () => string[];
  /** Lo que hace `POST /shutdown` después de responder 202. Sin él, el puente no se deja cerrar por la API (501). */
  onShutdown?: () => void;
  log?: (msg: string) => void;
}

const PermissionBody = z.object({
  session_id: IdSchema,
  cwd: z.string().optional(),
  tool_name: z.string().min(1),
  tool_input: z.unknown().optional(),
  /** Opcional y sin validar aquí: si no tiene la forma esperada se ignora (`parseSuggestions`), nunca falla la solicitud. */
  permission_suggestions: z.unknown().optional(),
});

const QuestionBody = z.object({
  session_id: IdSchema,
  cwd: z.string().optional(),
  /** Sin validar aquí: `parseQuestions` lo comprueba y, si no cumple, la pregunta se deja al PC. */
  tool_input: z.unknown().optional(),
});

const StopBody = z.object({
  session_id: IdSchema,
  cwd: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  /** El último mensaje del agente: la tarjeta "Espera tu instrucción" muestra su comienzo. */
  last_assistant_message: z.string().max(20000).optional(),
});

const ForgetBody = z.object({
  /** Mismo formato que acepta el saludo de la consola: letras, números, _ y -. */
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

const EventBody = z.object({
  session_id: IdSchema,
  cwd: z.string().optional(),
  kind: AgentKindSchema.default("claude"),
  event: z.enum(["start", "working", "idle", "done", "error", "end"]),
  model: z.string().optional(),
  title: z.string().max(1000).optional(),
  activity: z.string().max(1000).optional(),
  last_message: z.string().max(10000).optional(),
  /** Retira las solicitudes pendientes de la sesión (el agente las resolvió en otra parte). */
  cancel_pending: z.boolean().optional(),
});

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Lee el cuerpo completo; si excede el límite lo descarta y responde 413 al terminar. */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(c);
    });
    req.on("error", reject);
    req.on("aborted", () => reject(new HttpError(400, "conexión cortada")));
    req.on("end", () => {
      if (tooLarge) return reject(new HttpError(413, "cuerpo demasiado grande"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "JSON inválido"));
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function parse<T>(schema: z.ZodType<T>, json: unknown): T {
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(400, "cuerpo inválido");
  return r.data;
}

/** Carpetas elegidas (carpetas.json, ver packages/hooks/carpetas.mjs). Se lee en cada petición: los cambios valen sin reiniciar. */
function crearFiltroCarpetas(store: BridgeStore, log?: (msg: string) => void) {
  let avisado = "";
  return (sessionId: string | undefined, cwd: string | undefined): boolean => {
    const config = leerConfig();
    if (config.aviso && config.aviso !== avisado) log?.(`aviso: ${config.aviso}`);
    avisado = config.aviso ?? "";
    if (carpetaPermitida(cwd, config)) return true;
    // una sesión que ya se aceptó antes sigue aceptándose si el aviso llega sin cwd
    return cwd === undefined && sessionId !== undefined && config.estado === "ok" && store.getSession(sessionId) !== undefined;
  };
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export async function startHttpApi(options: HttpApiOptions): Promise<{ port: number; close(): Promise<void> }> {
  const { store, pairing, counter } = options;
  const carpetaActiva = crearFiltroCarpetas(store, options.log);

  const ensureSession = (sessionId: string, cwd: string | undefined, kind: z.infer<typeof AgentKindSchema>, model?: string) => {
    const known = store.getSession(sessionId);
    if (!known) store.upsertSession({ sessionId, kind, project: projectOf(cwd), model });
    else if (model !== undefined && model !== known.model) {
      store.upsertSession({ sessionId, kind: known.kind, project: known.project, model });
    }
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // los navegadores siempre envían Origin en peticiones entre sitios; los hooks y scripts no
    if (req.headers.origin !== undefined || !isLocalHostHeader(req.headers.host)) throw new HttpError(403, "prohibido");
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const method = req.method ?? "GET";

    // sin token, o con uno malo: 401 y no se lee ni el cuerpo. El hook, ante cualquier respuesta que no sea 2xx, no imprime nada y Claude Code pregunta en el PC.
    if (TOKEN_PATHS.has(path) && !tokenMatches(options.apiToken, req.headers[TOKEN_HEADER])) throw new HttpError(401, "falta el token local o no es válido");

    if (path === "/health") {
      if (method !== "GET") throw new HttpError(405, "método no permitido");
      return sendJson(res, 200, {
        ok: true,
        console: store.consoleConnected,
        device: counter.devices > 0,
        simulator: counter.count - counter.devices > 0,
        pending: store.pendingCount,
        cia: options.cia?.() ?? { serving: false },
        ...(options.consoleLocalIp?.() ? { consoleLocalIp: options.consoleLocalIp() } : {}),
        ...(options.consoleVersion?.() ? { consoleVersion: options.consoleVersion() } : {}),
        ...(options.info ? { version: options.info.version, startedBy: options.info.startedBy } : {}),
        pid: process.pid,
      });
    }
    if (path === "/shutdown") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      // además del Host/Origin locales: solo desde este mismo PC y con la cabecera propia (una página web no puede ponerla sin preflight)
      if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, "prohibido");
      if (req.headers["x-cronio"] !== "shutdown") throw new HttpError(403, "falta la cabecera X-Cronio");
      const onShutdown = options.onShutdown;
      if (!onShutdown) throw new HttpError(501, "este puente no se puede cerrar por la API");
      options.log?.("cierre pedido por la API (POST /shutdown)");
      // se responde primero; el cierre empieza cuando la respuesta ya salió
      res.once("finish", () => setTimeout(onShutdown, 20));
      return sendJson(res, 202, { ok: true, shuttingDown: true });
    }
    if (path === "/devices") {
      if (method !== "GET") throw new HttpError(405, "método no permitido");
      const dispositivos = options.devices;
      if (!dispositivos) throw new HttpError(501, "este puente no administra consolas por la API");
      const conectadas = new Set(options.connectedDevices?.() ?? []);
      // nunca sale la clave: solo quién es y desde cuándo está emparejada
      return sendJson(res, 200, {
        devices: dispositivos.list().map((d) => ({ deviceId: d.deviceId, name: d.name, pairedAt: d.pairedAt, connected: conectadas.has(d.deviceId) })),
      });
    }
    if (path === "/devices/forget") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      const dispositivos = options.devices;
      if (!dispositivos) throw new HttpError(501, "este puente no administra consolas por la API");
      const b = parse(ForgetBody, await readJson(req));
      if (!dispositivos.remove(b.deviceId)) throw new HttpError(404, "esa consola no está emparejada");
      // primero se borra la clave y después se corta la conexión: al reconectar ya no podrá autenticarse
      const disconnected = options.disconnectDevice?.(b.deviceId) ?? false;
      options.log?.(`consola olvidada: ${b.deviceId}${disconnected ? " (se cortó su conexión)" : ""}`);
      return sendJson(res, 200, { ok: true, forgotten: true, disconnected });
    }
    if (path === "/pair") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      await readJson(req).catch(() => {}); // el cuerpo no se usa
      return sendJson(res, 200, pairing.createCode());
    }
    if (path === "/event") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      const b = parse(EventBody, await readJson(req));
      if (b.event === "end") {
        store.removeSession(b.session_id);
      } else {
        ensureSession(b.session_id, b.cwd, b.kind, b.model);
        if (b.cancel_pending) store.resolveElsewhere(b.session_id);
        if (b.title !== undefined) {
          const known = store.getSession(b.session_id)!;
          store.upsertSession({ sessionId: b.session_id, kind: known.kind, project: known.project, title: b.title });
        }
        if (b.activity !== undefined) store.setActivity(b.session_id, b.activity);
        if (b.last_message !== undefined) store.setLastMessage(b.session_id, b.last_message);
        if (b.event !== "start") store.setSessionState(b.session_id, b.event);
        if (b.event === "idle") store.notifyIdle(b.session_id);
      }
      return sendJson(res, 200, { ok: true });
    }
    if (path === "/hook/claude") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      // el hook entrega el JSON tal cual; nunca falla ni decide: siempre 200 con cuerpo vacío
      try {
        const payload = await readJson(req);
        const p = (typeof payload === "object" && payload !== null ? payload : {}) as { session_id?: unknown; cwd?: unknown };
        // sesiones en carpetas no elegidas: no se registra nada
        if (carpetaActiva(typeof p.session_id === "string" ? p.session_id : undefined, typeof p.cwd === "string" ? p.cwd : undefined)) {
          applyClaudeHook(store, payload);
        }
      } catch {
        // cuerpo inválido o demasiado grande: se ignora
      }
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(200, { "content-length": 0 });
        res.end();
      }
      return;
    }
    if (path === "/permission") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      const b = parse(PermissionBody, await readJson(req));
      // preguntas y planes no son permisos (y un `allow` a secas no las responde): decide la terminal
      if (NOT_PERMISSION_TOOLS.has(b.tool_name)) return sendJson(res, 200, { decision: "ask" });
      if (!carpetaActiva(b.session_id, b.cwd)) return sendJson(res, 200, { decision: "ask" }); // carpeta no elegida: decide el PC
      ensureSession(b.session_id, b.cwd, "claude");
      const ac = new AbortController();
      // si el hook cierra antes de la respuesta, se retira la solicitud
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const suggestions = parseSuggestions(b.permission_suggestions);
      const decision = await store.requestPermission({
        sessionId: b.session_id,
        toolName: b.tool_name,
        toolInput: b.tool_input ?? {},
        suggestions,
        signal: ac.signal,
      });
      // "no volver a preguntar": es un "allow" con las sugerencias del agente como permisos a aplicar
      if (decision === "allow_always") return sendJson(res, 200, { decision: "allow", updatedPermissions: suggestions });
      return sendJson(res, 200, { decision });
    }
    if (path === "/question") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      const b = parse(QuestionBody, await readJson(req));
      // preguntas inválidas, sin consola o con el ajuste apagado: se responde `ask` en el acto y decide el PC
      const questions = parseQuestions(b.tool_input);
      if (!questions || !store.consoleConnected || !store.settings.questions) return sendJson(res, 200, { decision: "ask" });
      if (!carpetaActiva(b.session_id, b.cwd)) return sendJson(res, 200, { decision: "ask" });
      ensureSession(b.session_id, b.cwd, "claude");
      const ac = new AbortController();
      // si el hook cierra antes de la respuesta (Claude Code lo mató o la pregunta se respondió en el PC), se retira
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const outcome = await store.requestQuestion({ sessionId: b.session_id, toolInput: b.tool_input, questions, signal: ac.signal });
      return sendJson(res, 200, outcome);
    }
    if (path === "/stop") {
      if (method !== "POST") throw new HttpError(405, "método no permitido");
      const b = parse(StopBody, await readJson(req));
      if (!carpetaActiva(b.session_id, b.cwd)) return sendJson(res, 200, { decision: "none" });
      ensureSession(b.session_id, b.cwd, "claude");
      const ac = new AbortController();
      // si el hook cierra antes de la respuesta (Claude Code lo mató, el usuario escribió en el PC...), se libera la retención
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const outcome = await store.requestStop({ sessionId: b.session_id, lastMessage: b.last_assistant_message, signal: ac.signal });
      return sendJson(res, 200, outcome);
    }
    throw new HttpError(404, "no encontrado");
  }

  const server: Server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else {
        options.log?.(`error interno: ${String(err)}`);
        sendJson(res, 500, { error: "error interno" });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
