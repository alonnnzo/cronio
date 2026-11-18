#!/usr/bin/env node
// Hook PermissionRequest de Claude Code (prueba 0.8).
//
// Lee la solicitud por stdin, la envía al puente local y espera la decisión.
// No tiene plazo propio: espera lo que tarde el puente. La solicitud solo termina cuando se responde en la consola o
// el simulador, cuando el permiso se resuelve en la terminal (el puente lo detecta por otros hooks, o Claude Code
// mata este proceso y se cierra la conexión) o cuando el puente se cae.
// "Sí, no volver a preguntar": se reenvían al puente las `permission_suggestions` que trae Claude Code y, si la consola
// elige esa opción, el puente responde `allow` con `updatedPermissions` (las mismas sugerencias) y se imprimen tal cual
// en la decisión. Si vienen mal formadas se ignoran y se aprueba a secas.
// ExitPlanMode no es un permiso: como PermissionRequest este hook sale de inmediato sin salida y Claude Code muestra su propia
// interfaz en la terminal.
// Las preguntas con alternativas (AskUserQuestion, Fase 2b, paso 4) llegan por este mismo hook como PermissionRequest (la entrada `*`
// de settings ya las cubre): manda la pregunta al puente (POST /question) y, si la consola la responde, imprime un `allow` con
// `updatedInput` (las mismas preguntas más `answers`: etiqueta elegida por texto de pregunta; varias etiquetas se unen con ", ";
// "Otra" manda el texto escrito). Un `allow` sin `answers` no sirve. Mientras espera, Claude Code muestra la pregunta en el PC a la
// vez: se puede responder en cualquiera de los dos lados (si se responde en el PC, el puente cierra la petición con `ask` y este hook
// sale sin salida). Sin salida (y código 0) Claude Code decide en el PC: es la salida ante cualquier fallo, sin consola conectada, el
// ajuste `questions` apagado o "Responder en el PC".
// Instrucciones por texto (Fase 2b, paso 6): este mismo script atiende el hook `Stop` (entrada `command` con timeout 3600, además del http de
// estado). Manda `{session_id, cwd, stop_hook_active, last_assistant_message}` a `POST /stop`. Si el puente responde
// `{"decision":"instruct","text"}` imprime `{"decision":"block","reason":"Instrucción desde la 3DS:\n<texto>"}` y Claude Code sigue con
// ese texto como instrucción; con `{"decision":"none"}` (sin cola ni "Esperar mi respuesta", sin consola, ante cualquier fallo) no imprime nada
// y Claude termina normal. El puente retiene la respuesta solo si la sesión tiene "Esperar mi respuesta" y hay consola conectada: mientras
// espera, el PC no deja escribir en esa sesión, por eso el puente siempre la libera (consola que se desconecta, "Seguir en el PC", plazo
// `instructWaitMax`, sesión que termina, el usuario escribe en el PC). `stop_hook_active: true` no corta: solo las escribe el usuario.
// Legado: la primera versión usaba un hook PreToolUse con matcher "AskUserQuestion". Se conserva la rama por si alguien aún tiene esa
// entrada, pero no se recomienda: un PreToolUse bloquea y mientras espera el PC no muestra la pregunta.
// Regla de seguridad: ante cualquier fallo (puente apagado que no responde al conectar, sin consola, error, respuesta
// rara) no imprime nada y sale con 0 de inmediato, para que Claude Code muestre su diálogo normal en el terminal.
//
// Token local (auditoría 2026-11-17): la API del puente exige `X-Cronio-Token` en /permission, /question y /stop. El puente lo genera en cada arranque
// y deja una copia en <carpeta de configuración>/api-token (la misma carpeta de carpetas.json); este hook lo lee de ahí en cada llamada. Sin archivo
// (puente que nunca arrancó), con un token que no es el de este puente (401: p. ej. este hook es una copia vieja o el puente se reinició) o con
// cualquier otra respuesta que no sea 2xx, no imprime nada: Claude Code pregunta en el PC. Nunca se aprueba nada sin que el puente lo autorice.
//
// Carpetas (carpetas.mjs): si `cwd` no está en una carpeta elegida, sale de inmediato con 0 y sin salida, antes de contactar
// al puente (permisos, preguntas y Stop). Sin carpetas.json vale "todas"; con el archivo corrupto no actúa en ninguna.
//
// Variables de entorno:
//   BRIDGE_URL             http://127.0.0.1:33335
//   HOOK_CONNECT_TIMEOUT   ms máximos para conectar con el puente (5000). Solo la conexión, no la espera de la decisión.
//   HOOK_WATCH_PID         pid del proceso padre que se vigila (por defecto process.ppid). "0" desactiva la vigilancia.
//   HOOK_WATCH_INTERVAL    ms entre comprobaciones del padre (2000).
//   AGENT_COMPANION_CONFIG_DIR  carpeta de carpetas.json y de api-token (por defecto %APPDATA%/agent-companion).
//   (el "timeout" del hook en settings debe ser muy largo: 86400 s)
//
// Vigilancia del padre: si Claude Code muere sin SessionEnd, en Windows este proceso puede sobrevivir con la conexión
// abierta y, sin plazo, la solicitud se quedaría en la cola para siempre. Cada ~2 s se comprueba que el padre sigue
// vivo; si ya no existe, se destruye la petición y se sale sin decisión (el puente ve cerrarse la conexión y retira).
// No es un vencimiento por tiempo: depende solo de que el padre siga vivo.

import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { carpetaDatos, cwdPermitido } from './carpetas.mjs';

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://127.0.0.1:33335';
const CONNECT_TIMEOUT = +(process.env.HOOK_CONNECT_TIMEOUT ?? 5000);
const WATCH_PID = +(process.env.HOOK_WATCH_PID ?? process.ppid);
const WATCH_INTERVAL = +(process.env.HOOK_WATCH_INTERVAL ?? 2000);

// Herramientas que no son permisos y que este hook nunca debe convertir en tarjeta.
const NOT_PERMISSIONS = new Set(['AskUserQuestion', 'ExitPlanMode']);

let currentReq = null;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM'; // existe pero no es nuestro: vivo
  }
}

function watchParent() {
  if (!Number.isInteger(WATCH_PID) || WATCH_PID <= 0 || !(WATCH_INTERVAL > 0)) return;
  setInterval(() => {
    if (isAlive(WATCH_PID)) return;
    currentReq?.destroy();
    process.exit(0); // sin decisión, sin salida
  }, WATCH_INTERVAL).unref();
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

// Lista no vacía de objetos con `type` de texto (lo que Claude Code entiende como actualización de permisos).
function isUpdates(v) {
  return (
    Array.isArray(v) && v.length > 0 && v.every(u => u !== null && typeof u === 'object' && typeof u.type === 'string')
  );
}

function emit(decision) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
}

// Token local del puente (api-token en la carpeta de configuración). undefined si falta o no tiene la forma de un token.
function readApiToken() {
  try {
    const token = readFileSync(join(carpetaDatos(), 'api-token'), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

// node:http y no fetch: fetch (undici) corta a los 5 minutos sin cabeceras y aquí no debe haber plazo.
function post(url, payload) {
  return new Promise((resolve, reject) => {
    const token = readApiToken();
    // sin token no se contacta al puente (respondería 401): sin salida, decide el PC
    if (!token) return reject(new Error('sin token local del puente'));
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cronio-token': token } }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, text: data }));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('conexión cortada')));
    });
    currentReq = req;
    req.on('error', reject);
    req.on('socket', socket => {
      const timer = setTimeout(() => req.destroy(new Error('el puente no respondió al conectar')), CONNECT_TIMEOUT);
      if (socket.connecting) socket.once('connect', () => clearTimeout(timer));
      else clearTimeout(timer);
    });
    req.end(JSON.stringify(payload));
  });
}

// Respuestas válidas del puente: objeto no vacío cuyos valores son todos texto.
function isAnswers(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const values = Object.values(v);
  return values.length > 0 && values.every(x => typeof x === 'string');
}

// AskUserQuestion (PermissionRequest; PreToolUse en la rama legada): la pregunta va al puente y se espera a que la consola la responda.
async function handleQuestion(input, eventName) {
  const toolInput = input.tool_input;
  if (input.tool_name !== 'AskUserQuestion' || toolInput === null || typeof toolInput !== 'object' || !Array.isArray(toolInput.questions)) {
    process.exit(0);
  }
  watchParent();
  const res = await post(`${BRIDGE_URL}/question`, { session_id: input.session_id, cwd: input.cwd, tool_input: toolInput });
  if (!res.ok) return;
  const { decision, answers } = JSON.parse(res.text);
  if (decision === 'answer' && isAnswers(answers)) {
    const updatedInput = { ...toolInput, answers };
    process.stdout.write(
      JSON.stringify(
        eventName === 'PermissionRequest'
          ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput } } }
          : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } },
      ),
    );
  }
  // "ask" o cualquier otra cosa: sin salida, decide el PC.
}

// Stop: entrega una instrucción escrita en la consola (cola o espera). Sin instrucción no imprime nada.
async function handleStop(input) {
  if (typeof input.session_id !== 'string') process.exit(0);
  watchParent();
  const last = typeof input.last_assistant_message === 'string' ? input.last_assistant_message.slice(0, 8000) : undefined;
  const res = await post(`${BRIDGE_URL}/stop`, {
    session_id: input.session_id,
    cwd: input.cwd,
    stop_hook_active: input.stop_hook_active === true,
    last_assistant_message: last,
  });
  if (!res.ok) return;
  const { decision, text } = JSON.parse(res.text);
  if (decision === 'instruct' && typeof text === 'string' && text.trim() !== '') {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `Instrucción desde la 3DS:\n${text}` }));
  }
}

try {
  const input = JSON.parse(await readStdin());
  // Carpetas elegidas (carpetas.json): fuera de ellas no hace nada, ni siquiera contacta al puente.
  if (!cwdPermitido(input.cwd)) process.exit(0);
  if (input.hook_event_name === 'Stop') {
    await handleStop(input);
    process.exit(0);
  }
  if (input.hook_event_name === 'PreToolUse') {
    await handleQuestion(input, 'PreToolUse');
    process.exit(0);
  }
  // Prueba: AskUserQuestion por PermissionRequest, para ver si el PC muestra la pregunta mientras la consola espera.
  if (input.tool_name === 'AskUserQuestion') {
    await handleQuestion(input, 'PermissionRequest');
    process.exit(0);
  }
  if (NOT_PERMISSIONS.has(input.tool_name)) process.exit(0);
  watchParent();
  const res = await post(`${BRIDGE_URL}/permission`, {
    session_id: input.session_id,
    cwd: input.cwd,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    permission_suggestions: input.permission_suggestions,
  });
  if (res.ok) {
    const { decision, updatedPermissions } = JSON.parse(res.text);
    if (decision === 'allow') emit(isUpdates(updatedPermissions) ? { behavior: 'allow', updatedPermissions } : { behavior: 'allow' });
    else if (decision === 'deny') emit({ behavior: 'deny', message: 'Rechazado desde la 3DS' });
    // "ask" o cualquier otra cosa: sin salida, decide el terminal.
  }
} catch {
  // Puente apagado, error o entrada inválida: sin salida, decide el terminal.
}
process.exit(0);
