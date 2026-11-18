// Genera los datos de prueba del núcleo en C (client-3ds/tests-host/fixtures/) a partir del protocolo y del puente real:
//   - handshake_fixture.h : los valores de packages/protocol/fixtures/handshake.json
//   - views_fixture.h     : mensajes del puente (ejemplos del protocolo, vistas armadas por el puente real y variantes
//                           para probar límites), cada uno con el veredicto de los esquemas zod y un volcado canónico
//                           de lo que debe leer el parser de C
//   - views/*.json        : las vistas armadas por el puente real, tal cual
// Uso (desde la raíz del repo): npx tsx packages/bridge/scripts/gen-view-fixtures.ts
import "./determinista.ts";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBridgeMessage, type BridgeMessage, type ViewModel } from "@companion/protocol";
import { BridgeStore } from "../src/store.ts";
import { buildText } from "../src/reader.ts";
import * as SUMMARY_MESSAGES from "../test/fixtures/summary-messages.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { parseQuestions } from "../src/questions.ts";

const OUT = fileURLToPath(new URL("../../../client-3ds/tests-host/fixtures/", import.meta.url));
const MESSAGES = fileURLToPath(new URL("../../protocol/fixtures/messages/", import.meta.url));
const HANDSHAKE = fileURLToPath(new URL("../../protocol/fixtures/handshake.json", import.meta.url));
mkdirSync(OUT + "views", { recursive: true });

// ---- literales de C ----

/** Bytes como literal de C (octales de 3 dígitos para lo que no es ASCII imprimible), en trozos de línea corta. */
function cLiteral(buf: Buffer): string {
  const parts: string[] = [];
  let line = "";
  const flush = () => {
    parts.push(`"${line}"`);
    line = "";
  };
  for (const b of buf) {
    const ch = String.fromCharCode(b);
    if (b >= 0x20 && b < 0x7f && ch !== '"' && ch !== "\\" && ch !== "?") line += ch;
    else line += "\\" + b.toString(8).padStart(3, "0");
    if (line.length >= 100) flush();
  }
  if (line.length > 0 || parts.length === 0) flush();
  return parts.join("\n    ");
}

// ---- handshake_fixture.h ----

function genHandshake(): void {
  // el cliente en C solo habla la v2: los HSF_* son los valores de `v2` (K, nonces, código e id son los mismos)
  const root = JSON.parse(readFileSync(HANDSHAKE, "utf8")) as Record<string, any>;
  const hs = { ...root, ...root.v2 } as Record<string, any>;
  const frames = (name: string, list: any[]) =>
    `static const HsFrameFixture __attribute__((unused)) ${name}[] = {\n` +
    list
      .map(
        (f) =>
          `    {${f.counter}, ${f.type}, ${cLiteral(Buffer.from(f.payloadHex))}, ${cLiteral(Buffer.from(f.sealedHex))}, ${cLiteral(Buffer.from(f.frameHex))}},`,
      )
      .join("\n") +
    `\n};\n#define ${name}_COUNT ${list.length}\n`;
  const text =
    `// GENERADO por packages/bridge/scripts/gen-view-fixtures.ts a partir de packages/protocol/fixtures/handshake.json (sección v2). No editar.\n` +
    `#ifndef HANDSHAKE_FIXTURE_H\n#define HANDSHAKE_FIXTURE_H\n\n` +
    `typedef struct {\n  unsigned counter;\n  unsigned type;\n  const char *payload_hex;\n  const char *sealed_hex;\n  const char *frame_hex;\n} HsFrameFixture;\n\n` +
    `#define HSF_CODE ${cLiteral(Buffer.from(hs.code))}\n` +
    `#define HSF_NORMALIZED_CODE ${cLiteral(Buffer.from(hs.normalizedCode))}\n` +
    `#define HSF_DEVICE_ID ${cLiteral(Buffer.from(hs.deviceId))}\n` +
    `#define HSF_NONCE_B_HEX ${cLiteral(Buffer.from(hs.nonceB))}\n` +
    `#define HSF_NONCE_C_HEX ${cLiteral(Buffer.from(hs.nonceC))}\n` +
    `#define HSF_K_HEX ${cLiteral(Buffer.from(hs.k))}\n` +
    `#define HSF_HELLO_MAC_HEX ${cLiteral(Buffer.from(hs.helloMac))}\n` +
    `#define HSF_HELLO_APP_VERSION ${cLiteral(Buffer.from(hs.appVersion))}\n` +
    `#define HSF_HELLO_INSTALL ${cLiteral(Buffer.from(hs.install))}\n` +
    `#define HSF_HELLO_APP_MAC_HEX ${cLiteral(Buffer.from(hs.helloMacApp))}\n` +
    `#define HSF_WELCOME_MAC_HEX ${cLiteral(Buffer.from(hs.welcomeMac))}\n` +
    `#define HSF_KS_HEX ${cLiteral(Buffer.from(hs.ks))}\n` +
    `#define HSF_ENC_B2C_HEX ${cLiteral(Buffer.from(hs.encB2c))}\n` +
    `#define HSF_ENC_C2B_HEX ${cLiteral(Buffer.from(hs.encC2b))}\n` +
    `#define HSF_MAC_B2C_HEX ${cLiteral(Buffer.from(hs.macB2c))}\n` +
    `#define HSF_MAC_C2B_HEX ${cLiteral(Buffer.from(hs.macC2b))}\n\n` +
    frames("HSF_BRIDGE_TO_CONSOLE", hs.bridgeToConsole) +
    "\n" +
    frames("HSF_CONSOLE_TO_BRIDGE", hs.consoleToBridge) +
    `\n#endif\n`;
  writeFileSync(OUT + "handshake_fixture.h", text);
}

// ---- volcado canónico (lo mismo que escribe dump_view en tests-host/test_view.c) ----

function dumpMessage(msg: BridgeMessage): string {
  // El lector de C no puede guardar un NUL en una cadena: \u0000 pasa a U+FFFD.
  return dumpMessageRaw(msg).replace(/\u0000/g, "�");
}

function dumpMessageRaw(msg: BridgeMessage): string {
  if (msg.t === "text") {
    // lo mismo que dump_text en tests-host/test_view.c
    const o = [`text.session_id=${msg.sessionId}`, `text.line_count=${msg.lines.length}`];
    msg.lines.forEach((l, i) => o.push(`text.line[${i}]=${l}`));
    o.push(`text.truncated=${msg.truncated ? 1 : 0}`, `text.question_count=${msg.question?.length ?? 0}`);
    o.push(`text.mode=${msg.mode ?? "full"}`, `text.short=${msg.short ? 1 : 0}`);
    (msg.question ?? []).forEach((l, i) => o.push(`text.question[${i}]=${l}`));
    return o.join("\n") + "\n";
  }
  if (msg.t === "error") return `error=${msg.code.slice(0, 31)}\n`;
  const v = msg.view;
  const o: string[] = [];
  o.push(`rev=${msg.rev}`);
  o.push(`session_count=${v.sessions.length}`);
  v.sessions.forEach((s, i) => {
    o.push(`session[${i}].id=${s.id}`, `session[${i}].kind=${s.kind}`, `session[${i}].title=${s.title}`);
    o.push(`session[${i}].project=${s.project}`, `session[${i}].model=${s.model}`);
    o.push(`session[${i}].state=${s.state}`, `session[${i}].activity=${s.activity}`);
    o.push(`session[${i}].since=${s.sinceS ?? -1}`);
  });
  o.push(`has_request=${v.request ? 1 : 0}`);
  if (v.request) {
    const r = v.request;
    o.push(`request.id=${r.id}`, `request.session_id=${r.sessionId}`, `request.kind=${r.kind ?? "permission"}`, `request.title=${r.title}`);
    o.push(`request.line_count=${r.lines.length}`);
    r.lines.forEach((l, i) => o.push(`request.line[${i}]=${l}`));
    o.push(`request.risk=${r.risk}`, `request.expires_in_s=${r.expiresInS}`);
    o.push(`request.position=${r.position}`, `request.total=${r.total}`);
    if (r.always !== undefined) o.push(`request.always=${r.always}`);
    // lo mismo que dump_view en tests-host/test_view.c
    o.push(`request.question_count=${r.questions?.length ?? 0}`);
    (r.questions ?? []).forEach((q, i) => {
      o.push(`request.q[${i}].header=${q.header}`, `request.q[${i}].text_count=${q.text.length}`);
      q.text.forEach((l, j) => o.push(`request.q[${i}].text[${j}]=${l}`));
      o.push(`request.q[${i}].multi=${q.multi ? 1 : 0}`, `request.q[${i}].option_count=${q.options.length}`);
      q.options.forEach((op, k) => {
        o.push(`request.q[${i}].opt[${k}].label=${op.label}`, `request.q[${i}].opt[${k}].desc_count=${op.desc.length}`);
        op.desc.forEach((l, m) => o.push(`request.q[${i}].opt[${k}].desc[${m}]=${l}`));
        o.push(`request.q[${i}].opt[${k}].recommended=${op.recommended ? 1 : 0}`);
      });
    });
    o.push(`request.quick_count=${r.quick?.length ?? 0}`);
    (r.quick ?? []).forEach((c, i) => o.push(`request.quick[${i}].label=${c.label}`, `request.quick[${i}].text=${c.text}`));
  }
  o.push(`pending_count=${v.pendingCount}`, `mode=${v.mode}`);
  o.push(`face.kind=${v.face.kind ?? "none"}`, `face.mood=${v.face.mood}`, `face.line_count=${v.face.lines.length}`);
  v.face.lines.forEach((l, i) => o.push(`face.line[${i}]=${l}`));
  o.push(`has_detail=${v.detail ? 1 : 0}`);
  if (v.detail) {
    o.push(`detail.session_id=${v.detail.sessionId}`, `detail.line_count=${v.detail.lastMessage.length}`);
    v.detail.lastMessage.forEach((l, i) => o.push(`detail.line[${i}]=${l}`));
    o.push(`detail.question_count=${v.detail.question?.length ?? 0}`);
    (v.detail.question ?? []).forEach((l, i) => o.push(`detail.question[${i}]=${l}`));
    o.push(`detail.notify=${v.detail.notify ?? "none"}`);
    o.push(`detail.instr_count=${v.detail.instructions?.count ?? 0}`, `detail.instr_first=${v.detail.instructions?.first ?? ""}`, `detail.wait_for_me=${v.detail.waitForMe ? 1 : 0}`);
  }
  o.push(`led=${v.led}`);
  o.push(`has_settings=${v.settings ? 1 : 0}`);
  if (v.settings) {
    o.push(`settings.notify_default=${v.settings.notifyDefault}`, `settings.notify_ack=${v.settings.notifyAck ? 1 : 0}`, `settings.sound=${v.settings.sound === false ? 0 : 1}`, `settings.questions=${v.settings.questions === false ? 0 : 1}`, `settings.reader_default=${v.settings.readerDefault ?? "full"}`);
    o.push(`settings.instruct_wait=${v.settings.instructWaitMax ?? 0}`);
    o.push(`settings.hidden_count=${v.settings.hiddenAgents.length}`);
    v.settings.hiddenAgents.forEach((k, i) => o.push(`settings.hidden[${i}]=${k}`));
  }
  o.push(`has_notice=${v.notice ? 1 : 0}`);
  if (v.notice) {
    const n = v.notice;
    o.push(`notice.id=${n.id}`, `notice.session_id=${n.sessionId}`, `notice.kind=${n.kind}`, `notice.agent=${n.agent}`);
    o.push(`notice.project=${n.project}`, `notice.title=${n.title}`, `notice.line_count=${n.lines.length}`);
    n.lines.forEach((l, i) => o.push(`notice.line[${i}]=${l}`));
    o.push(`notice.position=${n.position}`, `notice.total=${n.total}`);
  }
  o.push(`has_chime=${v.chime ? 1 : 0}`);
  if (v.chime) o.push(`chime.kind=${v.chime.kind}`, `chime.seq=${v.chime.seq}`);
  o.push(`has_update=${v.update ? 1 : 0}`);
  if (v.update) o.push(`update.version=${v.update.version}`, `update.url=${v.update.url}`, `update.size=${v.update.size}`, `update.sha256=${v.update.sha256}`);
  return o.join("\n") + "\n";
}

// ---- fixtures ----

interface Fixture {
  name: string;
  json: string;
  zodValid: boolean;
  /** Verdicto esperado del parser de C; difiere de zod solo en los casos documentados (números no enteros simples). */
  cValid: boolean;
  expected: string;
}
const fixtures: Fixture[] = [];
/** Mensajes `text` (respuesta a `read`): los lee reading_parse en C, no view_parse. */
const textFixtures: Fixture[] = [];
const names = new Set<string>();

function isTextMessage(text: string): boolean {
  try {
    return (JSON.parse(text) as { t?: unknown }).t === "text";
  } catch {
    return false;
  }
}

function add(name: string, json: string | Buffer, cStricter = false): void {
  if (names.has(name)) throw new Error(`nombre repetido: ${name}`);
  names.add(name);
  const text = typeof json === "string" ? json : json.toString("utf8");
  let zodValid = false;
  let expected = "";
  try {
    const msg = parseBridgeMessage(JSON.parse(text));
    zodValid = true;
    expected = dumpMessage(msg);
  } catch {
    zodValid = false;
  }
  (isTextMessage(text) ? textFixtures : fixtures).push({
    name,
    json: text,
    zodValid,
    cValid: zodValid && !cStricter,
    expected: zodValid && !cStricter ? expected : "",
  });
}

// 1) ejemplos del protocolo
for (const f of readdirSync(MESSAGES).sort()) {
  if (!f.startsWith("bridge-")) continue;
  add(`protocol/${f}`, readFileSync(MESSAGES + f, "utf8").trim());
}

// 2) vistas armadas por el puente real, con reloj fijo
const NOW = 1_700_000_000_000;
let rev = 0;
let uuidN = 0;

function world(requestTimeoutMs?: number) {
  // sin requestTimeoutMs es el puente real por defecto: sin plazo, expiresInS = 0
  const store = new BridgeStore({ now: () => NOW, sweepIntervalMs: 1e9, requestTimeoutMs });
  const face = new FaceController(store, { now: () => NOW });
  store.setConsoleConnected(true);
  return { store, face };
}

/** Arma la vista y fija el id de la solicitud (el puente usa un UUID al azar) para que los archivos no cambien. */
function snap(w: ReturnType<typeof world>): ViewModel {
  const view = buildView(w.store, w.face, NOW);
  if (view.request) view.request = { ...view.request, id: `00000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}` };
  return view;
}

function publish(name: string, w: ReturnType<typeof world>): ViewModel {
  const view = snap(w);
  const json = JSON.stringify({ t: "view", rev: ++rev, view });
  writeFileSync(OUT + `views/${name}.json`, json + "\n");
  add(`bridge/${name}`, json);
  w.store.dispose();
  w.face.dispose();
  return view;
}

{
  const w = world();
  publish("empty", w);
}
{
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  w.store.setActivity("s1", "Editando hero.astro");
  publish("one-session", w);
}
{
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus" });
  void w.store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "npm install sharp" } });
  publish("request-normal", w);
}
{
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus" });
  void w.store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "rm -rf node_modules && npm ci" } });
  publish("request-high", w);
}
{
  const w = world();
  w.store.setMode("manual");
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "gemini", project: "otro-sitio", model: "Pro" });
  w.store.upsertSession({ sessionId: "c", kind: "codex", project: "ATLAS", model: "GPT" });
  for (const id of ["a", "b", "c"]) {
    void w.store.requestPermission({ sessionId: id, toolName: "Bash", toolInput: { command: `echo ${id}` } });
  }
  publish("manual-pending", w);
}
{
  const w = world();
  w.store.upsertSession({ sessionId: "s2", kind: "codex", project: "ATLAS", model: "GPT", title: "Refactor del runner" });
  w.store.setLastMessage("s2", "Listo el refactor del runner. Corrí los tests y pasan; falta revisar el manejo de errores y la documentación del módulo.");
  w.store.focus("s2");
  publish("detail-open", w);
}
{
  // una sesión espera tu respuesta: cara de 4 líneas (título + pregunta), fila con la pregunta y detalle con `question`
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  w.store.setLastMessage("s1", "Listo el borrador del hero. Falta decidir el fondo.");
  w.store.setQuestion("s1", "¿Prefieres un video de fondo en el hero o un gradiente animado que pese menos y cargue más rápido en el celular?");
  w.store.focus("s1");
  publish("question-open", w);
}
{
  // solicitud en una sesión y detalle abierto en otra
  const w = world();
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "hermes", project: "intranet", model: "H1" });
  w.store.setLastMessage("b", "Todo en orden.");
  void w.store.requestPermission({ sessionId: "a", toolName: "Write", toolInput: { file_path: "src/pages/index.astro", content: "x" } });
  w.store.focus("b");
  publish("request-and-detail", w);
}
{
  const w = world();
  w.store.upsertSession({ sessionId: "acc", kind: "claude", project: "Música y más", model: "Opus", title: "Revisión café ñandú ✓" });
  w.store.upsertSession({ sessionId: "emo", kind: "gemini", project: "Fiesta 😀 de fin", model: "Pro 🎵", title: "Tarea 😀😀😀 lista" });
  w.store.upsertSession({ sessionId: "ctl", kind: "cursor", project: "ctl", model: "x", title: "con\u0001control‮" });
  w.store.setActivity("acc", "Escribiendo “comillas” y \\barras\\ \"dobles\"");
  w.store.setActivity("emo", "Ensayo: 日本語 y ελληνικά");
  w.store.setActivity("ctl", "a\u0000b\u001b[2Jc");
  w.store.setLastMessage("emo", "Línea con emoji 😀 y acentos áéíóú\ny otra línea con € y �");
  w.store.focus("emo");
  publish("accents-emoji", w);
}
const maxViews: [string, string][] = [
  ["max-text-ascii", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  ["max-text-euro", "€"],
  ["max-text-emoji", "😀"],
];
for (const [name, ch] of maxViews) {
  const w = world();
  w.store.setMode("manual");
  const kinds = ["claude", "gemini", "codex", "cursor", "hermes"] as const;
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = `session-${i}`.padEnd(48, "i");
    ids.push(id);
    w.store.upsertSession({
      sessionId: id,
      kind: kinds[i % 5]!,
      project: ch.repeat(100),
      model: ch.repeat(100),
      title: `${i}${ch.repeat(100)}`,
    });
    w.store.setActivity(id, ch.repeat(100));
    w.store.setLastMessage(id, ch.repeat(2000));
    w.store.setSessionState(id, (["working", "ask", "done", "error", "idle"] as const)[i % 5]!);
  }
  void w.store.requestPermission({ sessionId: ids[1]!, toolName: "Bash", toolInput: { command: ch.repeat(2000) } });
  w.store.focus(ids[1]!);
  publish(name, w);
}
{
  // la solicitud ofrece "sí, no volver a preguntar": el campo opcional `always` con la etiqueta ya recortada
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus" });
  void w.store.requestPermission({
    sessionId: "s1",
    toolName: "Bash",
    toolInput: { command: "npm install sharp" },
    suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm install sharp" }], behavior: "allow", destination: "localSettings" }],
  });
  publish("request-always", w);
}
{
  // agentes ocultos y otros ajustes: el campo opcional `settings`; el permiso de un agente oculto sigue llegando
  const w = world();
  w.store.setSetting({ key: "notifyDefault", value: "end" });
  w.store.setSetting({ key: "notifyAck", value: false });
  w.store.setSetting({ key: "sound", value: false });
  w.store.setSetting({ key: "hiddenAgents", value: ["gemini", "hermes"] });
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "gemini", project: "otro-sitio", model: "Pro" });
  w.store.upsertSession({ sessionId: "c", kind: "hermes", project: "intranet", model: "H1" });
  void w.store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "npm test" } });
  publish("settings-hidden", w);
}
{
  // tarjeta de aviso "Terminó" con "Visto" (sin permisos pendientes) y el sonido; el detalle trae el modo de la sesión
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  w.store.setLastMessage("s1", "Listo el borrador del hero. Falta decidir el fondo, el video pesa mucho para el celular y habría que probar un gradiente.");
  w.store.setSessionState("s1", "done");
  w.store.setSessionNotify("s1", "end");
  w.store.focus("s1");
  publish("notice-done", w);
}
{
  // cola de dos avisos (pregunta y error) con el enfoque movido al segundo
  const w = world();
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "codex", project: "ATLAS", model: "GPT" });
  w.store.setQuestion("a", "¿Prefieres un video de fondo en el hero o un gradiente animado que pese menos?", "stop");
  w.store.setActivity("b", "2 tests fallaron en el runner");
  w.store.setSessionState("b", "error");
  w.store.skipNotice();
  publish("notice-queue", w);
}
{
  // un permiso pendiente tapa los avisos: la vista trae `request` y no `notice` (el sonido sí queda)
  const w = world();
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "gemini", project: "otro-sitio", model: "Pro" });
  w.store.setSessionState("a", "done");
  void w.store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "npm test" } });
  publish("notice-and-request", w);
}
{
  // sin "Visto": solo el sonido, sin tarjeta
  const w = world();
  w.store.setSetting({ key: "notifyAck", value: false });
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.setSessionState("a", "done");
  publish("chime-only", w);
}
{
  // con plazo configurado: expiresInS = 45 (cuenta atrás en la consola)
  const w = world(45_000);
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus" });
  void w.store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "npm install sharp" } });
  publish("request-with-limit", w);
}

// preguntas con alternativas (AskUserQuestion, paso 4)
const askQ = (w: ReturnType<typeof world>, sessionId: string, questions: unknown[]) => {
  const toolInput = { questions };
  void w.store.requestQuestion({ sessionId, toolInput, questions: parseQuestions(toolInput)! });
};
{
  // una pregunta; la etiqueta "(Recommended)" sale de la vista y queda marcada
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  askQ(w, "s1", [
    {
      question: "¿Qué fondo uso en el hero?",
      header: "Fondo",
      options: [
        { label: "Video (Recommended)", description: "Pesa más pero se ve mejor en pantallas grandes" },
        { label: "Gradiente animado", description: "Liviano" },
        { label: "Imagen fija", description: "" },
      ],
      multiSelect: false,
    },
  ]);
  publish("question-single", w);
}
{
  // cuatro preguntas (dos multiSelect) con la pregunta segunda en una cola de dos solicitudes; el enfoque pasa a la pregunta
  const w = world();
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "claude", project: "otro", model: "Opus" });
  void w.store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "npm test" } });
  const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Opción ${i + 1}${i === 0 ? " (Recomendado)" : ""}`, description: `Qué pasa con la opción ${i + 1} en detalle, en dos líneas si hace falta` }));
  askQ(w, "a", [
    { question: "¿Qué rama uso para el cambio y cómo la llamo cuando termine el trabajo?", header: "Rama", options: opts(2), multiSelect: false },
    { question: "¿Qué secciones van en la portada?", header: "Secciones", options: opts(4), multiSelect: true },
    { question: "¿Tono?", header: "Tono", options: opts(3), multiSelect: false },
    { question: "¿Algo más?", header: "Extra", options: opts(4), multiSelect: true },
  ]);
  w.store.skip();
  publish("question-queue", w);
}
for (const [name, ch] of maxViews) {
  // la pregunta más grande con 12 sesiones al límite: la vista se achica por niveles para caber en una trama y el lector de C debe aceptarla
  const w = world();
  w.store.setMode("manual");
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = `session-${i}`.padEnd(48, "i");
    ids.push(id);
    w.store.upsertSession({ sessionId: id, kind: (["claude", "gemini", "codex", "cursor", "hermes"] as const)[i % 5]!, project: ch.repeat(100), model: ch.repeat(100), title: `${i}${ch.repeat(100)}` });
    w.store.setActivity(id, ch.repeat(100));
    w.store.setLastMessage(id, ch.repeat(2000));
    w.store.setSessionState(id, (["working", "ask", "done", "error", "idle"] as const)[i % 5]!);
  }
  const questions = Array.from({ length: 4 }, (_, q) => ({
    // los topes de entrada del puente (parseQuestions) son 2000, 300 y 1000 unidades UTF-16: ch es de 1 a 62 caracteres
    question: `${q}${ch.repeat(2000)}`.slice(0, 2000),
    header: ch.repeat(100).slice(0, 250),
    options: Array.from({ length: 4 }, (_, o) => ({ label: `${o}${ch.repeat(100)}`.slice(0, 250), description: ch.repeat(1000).slice(0, 900) })),
    multiSelect: q % 2 === 1,
  }));
  askQ(w, ids[1]!, questions);
  w.store.focus(ids[1]!);
  publish(name.replace("max-text", "max-question"), w);
}
{
  // el ajuste questions apagado va en settings
  const w = world();
  w.store.setSetting({ key: "questions", value: false });
  publish("settings-questions-off", w);
}

// instrucciones por texto (paso 6): el fin de turno retenido es una solicitud de otro tipo y el detalle trae la cola y el modo
{
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  w.store.setSessionWait("s1", true);
  w.store.setLastMessage("s1", "Listo el borrador del hero. Falta decidir el fondo: el video pesa mucho para el celular y habría que probar un gradiente.");
  void w.store.requestStop({ sessionId: "s1" });
  publish("instruction-card", w);
}
{
  // el fin de turno retenido en una cola de dos solicitudes (con un permiso), y el enfoque en la retención
  const w = world();
  w.store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", model: "Opus" });
  w.store.upsertSession({ sessionId: "b", kind: "claude", project: "otro", model: "Opus" });
  w.store.setSessionWait("a", true);
  void w.store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "npm test" } });
  void w.store.requestStop({ sessionId: "a" });
  w.store.skip();
  publish("instruction-queue", w);
}
{
  // detalle con dos instrucciones en cola y "Esperar mi respuesta" encendido
  const w = world();
  w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus", title: "Ajustar el hero" });
  w.store.setLastMessage("s1", "Listo el borrador del hero.");
  w.store.setSessionWait("s1", true);
  w.store.enqueueInstruction("s1", "Agrega pruebas para el login con contraseñas muy largas");
  w.store.enqueueInstruction("s1", "Y documéntalo");
  w.store.focus("s1");
  publish("detail-instructions", w);
}
{
  // otra espera configurada: 30 minutos
  const w = world();
  w.store.setSetting({ key: "instructWaitMax", value: 30 });
  publish("settings-instruct-wait", w);
}

// El mismo contenido de "accents-emoji" en variantes de serialización: debe leerse igual.
{
  const base = readFileSync(OUT + "views/accents-emoji.json", "utf8").trim();
  const obj = JSON.parse(base);
  const escapeAll = (s: string) => s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  add("variant/accents-emoji-escaped", escapeAll(base));
  add("variant/accents-emoji-pretty", JSON.stringify(obj, null, 2));
  add("variant/accents-emoji-escaped-upper", escapeAll(base).replace(/\\u([0-9a-f]{4})/g, (_m, h: string) => "\\u" + h.toUpperCase()));
  add("variant/accents-emoji-crlf-ws", JSON.stringify(obj, null, "\t\r\n ").replace(/\n/g, "\r\n"));
}

// 2b) mensajes `text` armados por el puente real (buildText) y variantes para probar los límites
{
  const textOf = (message: string, question = "", mode: "full" | "summary" = "full") => {
    const w = world();
    w.store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal", model: "Opus" });
    w.store.setLastMessage("s1", message);
    if (question !== "") w.store.setQuestion("s1", question);
    const msg = buildText(w.store, "s1", mode);
    w.store.dispose();
    w.face.dispose();
    return JSON.stringify(msg);
  };
  const md = [
    "# Resumen del cambio",
    "",
    "Se **migró** la tabla `users` y se ajustó el [hero](https://example.com/a_b).",
    "- primer punto, bastante largo para que continúe en una segunda línea",
    "  - sub punto",
    "1. paso uno",
    "2. paso dos",
    "",
    "```ts",
    "const x = 1; // línea de código más larga de lo que cabe en la pantalla",
    "```",
    "| Archivo | Estado |",
    "|---|---|",
    "| a.ts | ok |",
  ].join("\n");
  add("reader/markdown", textOf(md));
  add("reader/question", textOf("Listo el borrador. Falta decidir el fondo.", "¿Prefieres un video de fondo en el hero o un gradiente animado que pese menos?"));
  add("reader/empty-message", textOf(""));
  // paso 5: el mismo lector en modo resumen, con mensajes finales de ejemplo y con uno que ya cabe (short)
  add("reader/summary-bullets", textOf(SUMMARY_MESSAGES.REPORT_BULLETS, "", "summary"));
  add("reader/summary-headings", textOf(SUMMARY_MESSAGES.REPORT_HEADINGS_TABLE_CODE, "", "summary"));
  add("reader/summary-question", textOf(SUMMARY_MESSAGES.REPORT_QUESTION, "¿Cuál prefieres que haga?", "summary"));
  add("reader/summary-short", textOf(SUMMARY_MESSAGES.REPORT_SHORT, "", "summary"));
  add("reader/summary-only-table", textOf(SUMMARY_MESSAGES.REPORT_ONLY_TABLE, "", "summary"));
  add("reader/summary-empty", textOf("", "", "summary"));
  add("reader/full-mode-explicit", textOf(SUMMARY_MESSAGES.REPORT_SHORT, "", "full"));
  add("reader/unknown-session", JSON.stringify(buildText(new BridgeStore(), "nada")));
  add("reader/accents-emoji", textOf("Línea con emoji 😀 y acentos áéíóú ñandú\ny otra línea con € y � y \"comillas\" y \barras\\"));
  // peor caso medido: 8000 caracteres con acentos, cortado por bytes (ver packages/bridge/src/reader.ts)
  add("reader/worst-case-accents", textOf("á".repeat(8000), "¿" + "ñ".repeat(100) + "?"));
  add("reader/worst-case-quotes", textOf('"'.repeat(8000)));
  add("reader/max-lines", textOf(Array.from({ length: 400 }, (_, i) => `l${i}`).join("\n")));
  const tbase = JSON.parse(textOf("uno\ndos", "¿Sigo?")) as any;
  const tmut = (name: string, fn: (m: any) => void) => {
    const m = structuredClone(tbase);
    fn(m);
    add(`text-mut/${name}`, JSON.stringify(m));
  };
  tmut("base", () => {});
  tmut("extra-keys-ignored", (m) => (m.extra = { a: [1] }));
  tmut("question-absent", (m) => delete m.question);
  tmut("question-3", (m) => (m.question = ["a", "b", "c"]));
  tmut("question-4", (m) => (m.question = ["a", "b", "c", "d"]));
  tmut("question-0", (m) => (m.question = []));
  tmut("question-null", (m) => (m.question = null));
  tmut("question-line-49", (m) => (m.question = ["x".repeat(49)]));
  tmut("question-line-48", (m) => (m.question = ["x".repeat(48)]));
  tmut("lines-0", (m) => (m.lines = []));
  tmut("lines-240", (m) => (m.lines = Array.from({ length: 240 }, (_, i) => `l${i}`)));
  tmut("lines-241", (m) => (m.lines = Array.from({ length: 241 }, (_, i) => `l${i}`)));
  tmut("lines-with-blanks", (m) => (m.lines = ["a", "", "b", "", ""]));
  tmut("line-48", (m) => (m.lines = ["x".repeat(48)]));
  tmut("line-49", (m) => (m.lines = ["x".repeat(49)]));
  tmut("line-48-emoji", (m) => (m.lines = ["😀".repeat(48)]));
  tmut("line-number", (m) => (m.lines = [5]));
  tmut("line-null", (m) => (m.lines = [null]));
  tmut("lines-missing", (m) => delete m.lines);
  tmut("lines-string", (m) => (m.lines = "uno"));
  tmut("mode-full", (m) => (m.mode = "full"));
  tmut("mode-summary", (m) => (m.mode = "summary"));
  tmut("mode-summary-short", (m) => ((m.mode = "summary"), (m.short = true)));
  tmut("mode-bad", (m) => (m.mode = "brief"));
  tmut("mode-number", (m) => (m.mode = 1));
  tmut("mode-null", (m) => (m.mode = null));
  tmut("short-string", (m) => ((m.mode = "summary"), (m.short = "si")));
  tmut("short-false", (m) => ((m.mode = "summary"), (m.short = false)));
  tmut("truncated-true", (m) => (m.truncated = true));
  tmut("truncated-missing", (m) => delete m.truncated);
  tmut("truncated-string", (m) => (m.truncated = "false"));
  tmut("truncated-number", (m) => (m.truncated = 0));
  tmut("session-id-missing", (m) => delete m.sessionId);
  tmut("session-id-bad", (m) => (m.sessionId = "s 1"));
  tmut("session-id-49", (m) => (m.sessionId = "a".repeat(49)));
  tmut("session-id-48", (m) => (m.sessionId = "a".repeat(48)));
  tmut("session-id-number", (m) => (m.sessionId = 1));
  add("text-mut/t-text2", JSON.stringify({ ...tbase, t: "text2" }));
  add("text-raw/truncated-half", JSON.stringify(tbase).slice(0, 40) + '"');
}

// 3) variantes para probar los límites: el veredicto lo da zod
{
  const base = JSON.parse(readFileSync(MESSAGES + "bridge-view.valid.json", "utf8")) as any;
  const clone = () => structuredClone(base);
  const mut = (name: string, fn: (m: any) => void, cStricter = false) => {
    const m = clone();
    fn(m);
    add(`mut/${name}`, JSON.stringify(m), cStricter);
  };
  const sess = (n: number) => ({ id: `n${n}`, kind: "claude", title: "t", project: "p", model: "m", state: "idle", activity: "a" });

  mut("base", () => {});
  // settings (opcional): ausente vale; presente exige los tres campos con sus valores
  const settings = () => ({ notifyDefault: "important", notifyAck: true, hiddenAgents: [] as string[] });
  mut("settings-absent", (m) => delete m.view.settings);
  mut("settings-default", (m) => (m.view.settings = settings()));
  for (const nd of ["all", "important", "end", "silent"]) mut(`settings-notify-${nd}`, (m) => (m.view.settings = { ...settings(), notifyDefault: nd }));
  mut("settings-notify-bad", (m) => (m.view.settings = { ...settings(), notifyDefault: "loud" }));
  mut("settings-notify-missing", (m) => ((m.view.settings = settings()), delete m.view.settings.notifyDefault));
  mut("settings-ack-false", (m) => (m.view.settings = { ...settings(), notifyAck: false }));
  mut("settings-ack-string", (m) => (m.view.settings = { ...settings(), notifyAck: "true" }));
  mut("settings-ack-number", (m) => (m.view.settings = { ...settings(), notifyAck: 1 }));
  mut("settings-ack-missing", (m) => ((m.view.settings = settings()), delete m.view.settings.notifyAck));
  mut("settings-reader-summary", (m) => (m.view.settings = { ...settings(), readerDefault: "summary" }));
  mut("settings-reader-full", (m) => (m.view.settings = { ...settings(), readerDefault: "full" }));
  mut("settings-reader-bad", (m) => (m.view.settings = { ...settings(), readerDefault: "brief" }));
  mut("settings-reader-bool", (m) => (m.view.settings = { ...settings(), readerDefault: true }));
  mut("settings-reader-null", (m) => (m.view.settings = { ...settings(), readerDefault: null }));
  mut("settings-sound-off", (m) => (m.view.settings = { ...settings(), sound: false }));
  mut("settings-sound-absent", (m) => ((m.view.settings = settings()), delete m.view.settings.sound));
  mut("settings-sound-string", (m) => (m.view.settings = { ...settings(), sound: "no" }));
  mut("settings-hidden-all", (m) => (m.view.settings = { ...settings(), hiddenAgents: ["claude", "gemini", "codex", "cursor", "hermes"] }));
  mut("settings-hidden-two", (m) => (m.view.settings = { ...settings(), hiddenAgents: ["hermes", "codex"] }));
  mut("settings-hidden-repeated", (m) => (m.view.settings = { ...settings(), hiddenAgents: ["codex", "codex"] }));
  mut("settings-hidden-six", (m) => (m.view.settings = { ...settings(), hiddenAgents: ["claude", "claude", "claude", "claude", "claude", "claude"] }));
  mut("settings-hidden-unknown", (m) => (m.view.settings = { ...settings(), hiddenAgents: ["nadie"] }));
  mut("settings-hidden-not-array", (m) => (m.view.settings = { ...settings(), hiddenAgents: "claude" }));
  mut("settings-hidden-missing", (m) => ((m.view.settings = settings()), delete m.view.settings.hiddenAgents));
  mut("settings-null", (m) => (m.view.settings = null));
  mut("settings-array", (m) => (m.view.settings = []));
  // update (opcional): versión, dirección, tamaño y sha256 del .cia. Solo van aquí los casos en que zod y C coinciden: sin size/sha256 (o con
  // un size fuera de 8192..8 MiB, o un sha256 que no valga) la vista de C se acepta pero sin oferta (has_update = 0), y eso se prueba en test_view.c
  const upd = () => ({ version: "0.3.0", url: "http://192.168.0.20:33337/agent-companion.cia", size: 370000, sha256: "00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef" });
  mut("update-valid", (m) => (m.view.update = upd()));
  mut("update-extra-keys-ignored", (m) => (m.view.update = { ...upd(), firma: "x", otro: { a: 1 } }));
  mut("update-size-min", (m) => (m.view.update = { ...upd(), size: 8192 }));
  mut("update-size-max", (m) => (m.view.update = { ...upd(), size: 8 * 1024 * 1024 }));
  mut("update-version-bad", (m) => (m.view.update = { ...upd(), version: "0.3" }));
  mut("update-url-https", (m) => (m.view.update = { ...upd(), url: "https://192.168.0.20:33337/agent-companion.cia" }));
  mut("update-null", (m) => (m.view.update = null));
  mut("settings-extra-keys-ignored", (m) => (m.view.settings = { ...settings(), idioma: "es" }));
  mut("extra-keys-ignored", (m) => {
    m.extra = 1;
    m.view.extra = [1, { a: 2 }];
    m.view.sessions[0].extra = "x";
    m.view.request.extra = null;
  });
  // tipo de solicitud (opcional) y preguntas con alternativas (paso 4)
  const qOpt = (label = "Video", desc: string[] = ["Pesa más"], recommended = false) => ({ label, desc, recommended });
  const qView = () => ({ header: "Fondo", text: ["¿Qué fondo uso en el hero?"], multi: false, options: [qOpt("Video", ["Pesa más"], true), qOpt("Gradiente", ["Liviano", "y rápido"]), qOpt("Imagen", [])] });
  const asQuestion = (fn: (q: any, r: any) => void = () => {}) => (m: any) => {
    m.view.request.kind = "question";
    m.view.request.questions = [qView()];
    fn(m.view.request.questions[0], m.view.request);
  };
  mut("request-kind-permission", (m) => (m.view.request.kind = "permission"));
  mut("request-kind-question", asQuestion());
  mut("request-kind-bad", (m) => (m.view.request.kind = "plan"));
  mut("request-kind-null", (m) => (m.view.request.kind = null));
  mut("request-kind-number", (m) => (m.view.request.kind = 1));
  mut("request-kind-case", (m) => (m.view.request.kind = "Question"));
  mut("request-question-without-questions", (m) => (m.view.request.kind = "question"));
  mut("request-questions-without-kind", (m) => (m.view.request.questions = [qView()]));
  mut("request-permission-with-questions", (m) => ((m.view.request.kind = "permission"), (m.view.request.questions = [qView()])));
  mut("request-questions-empty", asQuestion((_q, r) => (r.questions = [])));
  mut("request-questions-4", asQuestion((q, r) => (r.questions = [q, q, q, q])));
  mut("request-questions-5", asQuestion((q, r) => (r.questions = [q, q, q, q, q])));
  mut("request-questions-null", asQuestion((_q, r) => (r.questions = null)));
  mut("request-questions-object", asQuestion((q, r) => (r.questions = { 0: q })));
  mut("request-question-not-object", asQuestion((_q, r) => (r.questions = ["x"])));
  mut("question-extra-keys-ignored", asQuestion((q) => ((q.extra = [1]), (q.options[0].extra = 1))));
  mut("question-header-38", asQuestion((q) => (q.header = "h".repeat(38))));
  mut("question-header-39", asQuestion((q) => (q.header = "h".repeat(39))));
  mut("question-header-empty", asQuestion((q) => (q.header = "")));
  mut("question-header-number", asQuestion((q) => (q.header = 5)));
  mut("question-header-missing", asQuestion((q) => delete q.header));
  mut("question-text-3", asQuestion((q) => (q.text = ["a", "b", "c"])));
  mut("question-text-4", asQuestion((q) => (q.text = ["a", "b", "c", "d"])));
  mut("question-text-0", asQuestion((q) => (q.text = [])));
  mut("question-text-missing", asQuestion((q) => delete q.text));
  mut("question-text-string", asQuestion((q) => (q.text = "¿a?")));
  mut("question-text-line-39", asQuestion((q) => (q.text = ["x".repeat(39)])));
  mut("question-text-line-emoji-38", asQuestion((q) => (q.text = ["😀".repeat(38)])));
  mut("question-multi-true", asQuestion((q) => (q.multi = true)));
  mut("question-multi-missing", asQuestion((q) => delete q.multi));
  mut("question-multi-string", asQuestion((q) => (q.multi = "false")));
  mut("question-multi-number", asQuestion((q) => (q.multi = 0)));
  mut("question-options-1", asQuestion((q) => (q.options = [qOpt()])));
  mut("question-options-2", asQuestion((q) => (q.options = [qOpt("a"), qOpt("b")])));
  mut("question-options-4", asQuestion((q) => (q.options = [qOpt("a"), qOpt("b"), qOpt("c"), qOpt("d")])));
  mut("question-options-5", asQuestion((q) => (q.options = [qOpt("a"), qOpt("b"), qOpt("c"), qOpt("d"), qOpt("e")])));
  mut("question-options-missing", asQuestion((q) => delete q.options));
  mut("question-options-object", asQuestion((q) => (q.options = { 0: qOpt() })));
  mut("question-option-not-object", asQuestion((q) => (q.options = ["a", "b"])));
  mut("question-option-label-38", asQuestion((q) => (q.options[0].label = "l".repeat(38))));
  mut("question-option-label-39", asQuestion((q) => (q.options[0].label = "l".repeat(39))));
  mut("question-option-label-missing", asQuestion((q) => delete q.options[0].label));
  mut("question-option-label-number", asQuestion((q) => (q.options[0].label = 7)));
  mut("question-option-desc-0", asQuestion((q) => (q.options[0].desc = [])));
  mut("question-option-desc-2", asQuestion((q) => (q.options[0].desc = ["uno", "dos"])));
  mut("question-option-desc-3", asQuestion((q) => (q.options[0].desc = ["uno", "dos", "tres"])));
  mut("question-option-desc-missing", asQuestion((q) => delete q.options[0].desc));
  mut("question-option-desc-string", asQuestion((q) => (q.options[0].desc = "uno")));
  mut("question-option-desc-line-39", asQuestion((q) => (q.options[0].desc = ["x".repeat(39)])));
  mut("question-option-recommended-missing", asQuestion((q) => delete q.options[0].recommended));
  mut("question-option-recommended-string", asQuestion((q) => (q.options[0].recommended = "true")));
  mut("question-option-recommended-number", asQuestion((q) => (q.options[0].recommended = 1)));
  mut("question-accents-emoji", asQuestion((q) => ((q.header = "Fiesta 😀"), (q.text = ["¿Dónde ñandú café?"]), (q.options[0].label = "Sí ✓ €"))));
  // ajuste questions (opcional, booleano)
  mut("settings-questions-off", (m) => (m.view.settings = { ...settings(), questions: false }));
  mut("settings-questions-on", (m) => (m.view.settings = { ...settings(), questions: true }));
  mut("settings-questions-absent", (m) => ((m.view.settings = settings()), delete m.view.settings.questions));
  mut("settings-questions-string", (m) => (m.view.settings = { ...settings(), questions: "no" }));
  mut("settings-questions-number", (m) => (m.view.settings = { ...settings(), questions: 0 }));
  mut("settings-questions-null", (m) => (m.view.settings = { ...settings(), questions: null }));
  // rev
  mut("rev-zero", (m) => (m.rev = 0));
  mut("rev-max-safe", (m) => (m.rev = Number.MAX_SAFE_INTEGER));
  add("mut/rev-2^53", JSON.stringify(base).replace('"rev":7', '"rev":9007199254740992'));
  add("mut/rev-huge", JSON.stringify(base).replace('"rev":7', '"rev":99999999999999999999999999'));
  mut("rev-negative", (m) => (m.rev = -1));
  mut("rev-fraction", (m) => (m.rev = 1.5));
  mut("rev-string", (m) => (m.rev = "7"));
  mut("rev-missing", (m) => delete m.rev);
  add("mut/rev-1.0", JSON.stringify(base).replace('"rev":7', '"rev":1.0'), true);
  add("mut/rev-1e2", JSON.stringify(base).replace('"rev":7', '"rev":1e2'), true);
  add("mut/rev-minus-zero", JSON.stringify(base).replace('"rev":7', '"rev":-0'), true);
  // estructura
  mut("t-unknown", (m) => (m.t = "view2"));
  mut("t-missing", (m) => delete m.t);
  mut("view-missing", (m) => delete m.view);
  mut("view-null", (m) => (m.view = null));
  mut("view-array", (m) => (m.view = []));
  mut("sessions-missing", (m) => delete m.view.sessions);
  mut("sessions-not-array", (m) => (m.view.sessions = {}));
  mut("sessions-12", (m) => (m.view.sessions = Array.from({ length: 12 }, (_, i) => sess(i))));
  mut("sessions-13", (m) => (m.view.sessions = Array.from({ length: 13 }, (_, i) => sess(i))));
  mut("sessions-empty", (m) => {
    m.view.sessions = [];
    m.view.request = null;
    m.view.pendingCount = 0;
  });
  mut("session-not-object", (m) => (m.view.sessions[0] = "s1"));
  for (const key of ["id", "kind", "title", "project", "model", "state", "activity"]) {
    mut(`session-missing-${key}`, (m) => delete m.view.sessions[0][key]);
    mut(`session-${key}-number`, (m) => (m.view.sessions[0][key] = 5));
    mut(`session-${key}-null`, (m) => (m.view.sessions[0][key] = null));
  }
  mut("session-kind-bad", (m) => (m.view.sessions[0].kind = "claudee"));
  mut("session-kind-case", (m) => (m.view.sessions[0].kind = "Claude"));
  mut("session-state-bad", (m) => (m.view.sessions[0].state = "busy"));
  // textos y largos (en unidades UTF-16)
  const set = (field: string, value: string) => (m: any) => (m.view.sessions[0][field] = value);
  mut("title-38", set("title", "a".repeat(38)));
  mut("title-39", set("title", "a".repeat(39)));
  mut("title-empty", set("title", ""));
  mut("title-38-euro", set("title", "€".repeat(38)));
  mut("title-39-euro", set("title", "€".repeat(39)));
  // zod 4 cuenta puntos de código: 38 emoji valen 38, aunque sean 76 unidades UTF-16
  mut("title-19-emoji", set("title", "😀".repeat(19)));
  mut("title-19-emoji-x", set("title", "😀".repeat(19) + "x"));
  mut("title-20-emoji", set("title", "😀".repeat(20)));
  mut("title-38-emoji", set("title", "😀".repeat(38)));
  mut("title-39-emoji", set("title", "😀".repeat(39)));
  mut("title-quotes-backslashes", set("title", '"\\/"\\\\'));
  mut("title-lone-surrogate-escape", (m) => (m.view.sessions[0].title = "x\ud83dy"));
  add("mut/title-escaped-nul", JSON.stringify(base).replace('"mi-portal","project"', '"a\\u0000b","project"'));
  mut("activity-39", set("activity", "b".repeat(39)));
  mut("model-39", set("model", "c".repeat(39)));
  mut("project-39", set("project", "d".repeat(39)));
  // ids
  const id = (v: string) => (m: any) => (m.view.sessions[0].id = v);
  mut("id-48", id("a".repeat(48)));
  mut("id-49", id("a".repeat(49)));
  mut("id-empty", id(""));
  mut("id-space", id("s 1"));
  mut("id-slash", id("s/1"));
  mut("id-accent", id("sé"));
  mut("id-all-chars", id("Az09_.:-"));
  mut("id-nul-escape", id("a\u0000b"));
  mut("request-id-bad", (m) => (m.view.request.id = "r 1"));
  mut("request-session-id-49", (m) => (m.view.request.sessionId = "x".repeat(49)));
  // solicitud
  mut("request-null", (m) => {
    m.view.request = null;
    m.view.sessions[0].state = "idle";
  });
  mut("request-missing", (m) => delete m.view.request);
  mut("request-string", (m) => (m.view.request = "r1"));
  mut("request-array", (m) => (m.view.request = []));
  for (const key of ["id", "sessionId", "title", "lines", "risk", "expiresInS", "position", "total"]) {
    mut(`request-missing-${key}`, (m) => delete m.view.request[key]);
  }
  mut("request-lines-0", (m) => (m.view.request.lines = []));
  mut("request-lines-6", (m) => (m.view.request.lines = ["1", "2", "3", "4", "5", "6"]));
  mut("request-lines-7", (m) => (m.view.request.lines = ["1", "2", "3", "4", "5", "6", "7"]));
  mut("request-line-39", (m) => (m.view.request.lines = ["x".repeat(39)]));
  mut("request-line-number", (m) => (m.view.request.lines = [1]));
  mut("request-line-null", (m) => (m.view.request.lines = [null]));
  mut("request-lines-object", (m) => (m.view.request.lines = { 0: "a" }));
  mut("request-risk-high", (m) => (m.view.request.risk = "high"));
  mut("request-risk-bad", (m) => (m.view.request.risk = "low"));
  mut("request-expires-0", (m) => (m.view.request.expiresInS = 0));
  mut("request-expires-negative", (m) => (m.view.request.expiresInS = -1));
  mut("request-expires-fraction", (m) => (m.view.request.expiresInS = 4.5));
  mut("request-expires-string", (m) => (m.view.request.expiresInS = "45"));
  mut("request-expires-99999", (m) => (m.view.request.expiresInS = 99999));
  // "always" (opcional): texto de 1 a 38 caracteres
  mut("request-always-ok", (m) => (m.view.request.always = "Bash(npm test)"));
  mut("request-always-38", (m) => (m.view.request.always = "a".repeat(38)));
  mut("request-always-39", (m) => (m.view.request.always = "a".repeat(39)));
  mut("request-always-emoji-38", (m) => (m.view.request.always = "😀".repeat(38)));
  mut("request-always-empty", (m) => (m.view.request.always = ""));
  mut("request-always-null", (m) => (m.view.request.always = null));
  mut("request-always-number", (m) => (m.view.request.always = 5));
  mut("request-always-object", (m) => (m.view.request.always = { a: 1 }));
  mut("request-position-0", (m) => (m.view.request.position = 0));
  mut("request-total-0", (m) => (m.view.request.total = 0));
  mut("request-position-12", (m) => ((m.view.request.position = 12), (m.view.request.total = 12)));
  // contadores, modo, led
  mut("pending-0", (m) => (m.view.pendingCount = 0));
  mut("pending-negative", (m) => (m.view.pendingCount = -2));
  mut("pending-fraction", (m) => (m.view.pendingCount = 2.5));
  mut("pending-missing", (m) => delete m.view.pendingCount);
  mut("mode-manual", (m) => (m.view.mode = "manual"));
  mut("mode-bad", (m) => (m.view.mode = "auto"));
  mut("mode-missing", (m) => delete m.view.mode);
  for (const led of ["off", "working", "ask", "done", "error"]) mut(`led-${led}`, (m) => (m.view.led = led));
  mut("led-bad", (m) => (m.view.led = "blink"));
  mut("led-missing", (m) => delete m.view.led);
  // cara
  mut("face-missing", (m) => delete m.view.face);
  mut("face-kind-null", (m) => (m.view.face.kind = null));
  mut("face-kind-missing", (m) => delete m.view.face.kind);
  mut("face-kind-bad", (m) => (m.view.face.kind = "bot"));
  mut("face-mood-bad", (m) => (m.view.face.mood = "sleepy"));
  for (const mood of ["idle", "working", "ask", "done", "error"]) mut(`face-mood-${mood}`, (m) => (m.view.face.mood = mood));
  mut("face-lines-0", (m) => (m.view.face.lines = []));
  mut("face-lines-1", (m) => (m.view.face.lines = ["uno"]));
  mut("face-lines-3", (m) => (m.view.face.lines = ["1", "2", "3"]));
  mut("face-lines-4", (m) => (m.view.face.lines = ["1", "2", "3", "4"]));
  mut("face-lines-5", (m) => (m.view.face.lines = ["1", "2", "3", "4", "5"]));
  mut("face-lines-4-long", (m) => (m.view.face.lines = ["x".repeat(38), "y".repeat(38), "z".repeat(38), "w".repeat(38)]));
  mut("face-line-39", (m) => (m.view.face.lines = ["x".repeat(39)]));
  // detalle
  mut("detail-missing", (m) => delete m.view.detail);
  mut("detail-null", (m) => (m.view.detail = null));
  mut("detail-4-lines", (m) => (m.view.detail = { sessionId: "s1", lastMessage: ["1", "2", "3", "4"] }));
  mut("detail-5-lines", (m) => (m.view.detail = { sessionId: "s1", lastMessage: ["1", "2", "3", "4", "5"] }));
  mut("detail-0-lines", (m) => (m.view.detail = { sessionId: "s1", lastMessage: [] }));
  mut("detail-bad-id", (m) => (m.view.detail = { sessionId: "s 1", lastMessage: [] }));
  mut("detail-no-lines", (m) => (m.view.detail = { sessionId: "s1" }));
  mut("detail-line-39", (m) => (m.view.detail = { sessionId: "s1", lastMessage: ["x".repeat(39)] }));
  // pregunta opcional del detalle: ausente, de 1 a 3 líneas de 38; vacía, de 4, null o larga no valen
  const dq = (question: unknown) => (m: any) => (m.view.detail = { sessionId: "s1", lastMessage: ["1"], ...(question === undefined ? {} : { question }) });
  mut("detail-question-absent", dq(undefined));
  mut("detail-question-1", dq(["¿Sigo?"]));
  mut("detail-question-3", dq(["uno", "dos", "tres"]));
  mut("detail-question-3-max", dq(["x".repeat(38), "y".repeat(38), "z".repeat(38)]));
  mut("detail-question-4", dq(["1", "2", "3", "4"]));
  mut("detail-question-0", dq([]));
  mut("detail-question-null", dq(null));
  mut("detail-question-string", dq("¿Sigo?"));
  mut("detail-question-line-39", dq(["x".repeat(39)]));
  mut("detail-question-number", dq([1]));
  mut("detail-question-and-no-last", (m) => (m.view.detail = { sessionId: "s1", lastMessage: [], question: ["¿Sigo?"] }));
  // aviso con "Visto" (opcional): ausente vale; presente exige todos sus campos
  const notice = () => ({ id: "n1", sessionId: "s1", kind: "done", agent: "Claude", project: "mi-portal", title: "Terminó", lines: ["Listo el hero."], position: 1, total: 1 });
  const nt = (fn: (n: any) => void) => (m: any) => {
    m.view.notice = notice();
    fn(m.view.notice);
  };
  mut("notice-absent", (m) => delete m.view.notice);
  mut("notice-ok", nt(() => {}));
  for (const kind of ["done", "ask", "error", "idle"]) mut(`notice-kind-${kind}`, nt((n) => (n.kind = kind)));
  mut("notice-kind-permission", nt((n) => (n.kind = "permission")));
  mut("notice-kind-bad", nt((n) => (n.kind = "terminado")));
  mut("notice-null", (m) => (m.view.notice = null));
  mut("notice-array", (m) => (m.view.notice = []));
  mut("notice-string", (m) => (m.view.notice = "n1"));
  for (const key of ["id", "sessionId", "kind", "agent", "project", "title", "lines", "position", "total"]) {
    mut(`notice-missing-${key}`, nt((n) => delete n[key]));
  }
  mut("notice-id-bad", nt((n) => (n.id = "n 1")));
  mut("notice-id-49", nt((n) => (n.id = "n".repeat(49))));
  mut("notice-session-id-bad", nt((n) => (n.sessionId = "s/1")));
  mut("notice-lines-0", nt((n) => (n.lines = [])));
  mut("notice-lines-4", nt((n) => (n.lines = ["1", "2", "3", "4"])));
  mut("notice-lines-5", nt((n) => (n.lines = ["1", "2", "3", "4", "5"])));
  mut("notice-line-38", nt((n) => (n.lines = ["x".repeat(38)])));
  mut("notice-line-39", nt((n) => (n.lines = ["x".repeat(39)])));
  mut("notice-line-number", nt((n) => (n.lines = [1])));
  mut("notice-lines-string", nt((n) => (n.lines = "uno")));
  mut("notice-title-39", nt((n) => (n.title = "t".repeat(39))));
  mut("notice-agent-39", nt((n) => (n.agent = "a".repeat(39))));
  mut("notice-project-39", nt((n) => (n.project = "p".repeat(39))));
  mut("notice-title-emoji-38", nt((n) => (n.title = "😀".repeat(38))));
  mut("notice-position-0", nt((n) => (n.position = 0)));
  mut("notice-total-0", nt((n) => (n.total = 0)));
  mut("notice-position-fraction", nt((n) => (n.position = 1.5)));
  mut("notice-position-string", nt((n) => (n.position = "1")));
  mut("notice-queue-3-of-5", nt((n) => ((n.position = 3), (n.total = 5))));
  mut("notice-extra-keys-ignored", nt((n) => (n.extra = [1])));
  // sonido (opcional)
  mut("chime-absent", (m) => delete m.view.chime);
  for (const kind of ["done", "ask", "error", "permission"]) mut(`chime-kind-${kind}`, (m) => (m.view.chime = { kind, seq: 7 }));
  mut("chime-kind-bad", (m) => (m.view.chime = { kind: "idle", seq: 7 }));
  mut("chime-seq-1", (m) => (m.view.chime = { kind: "done", seq: 1 }));
  mut("chime-seq-max", (m) => (m.view.chime = { kind: "done", seq: 4294967295 }));
  mut("chime-seq-over", (m) => (m.view.chime = { kind: "done", seq: 4294967296 }));
  mut("chime-seq-0", (m) => (m.view.chime = { kind: "done", seq: 0 }));
  mut("chime-seq-negative", (m) => (m.view.chime = { kind: "done", seq: -1 }));
  mut("chime-seq-fraction", (m) => (m.view.chime = { kind: "done", seq: 1.5 }));
  mut("chime-seq-string", (m) => (m.view.chime = { kind: "done", seq: "7" }));
  mut("chime-seq-missing", (m) => (m.view.chime = { kind: "done" }));
  mut("chime-kind-missing", (m) => (m.view.chime = { seq: 7 }));
  mut("chime-null", (m) => (m.view.chime = null));
  mut("chime-array", (m) => (m.view.chime = []));
  // modo de aviso de la sesión abierta (detail.notify, opcional)
  const dn = (notify: unknown) => (m: any) => (m.view.detail = { sessionId: "s1", lastMessage: ["1"], ...(notify === undefined ? {} : { notify }) });
  mut("detail-notify-absent", dn(undefined));
  for (const nm of ["all", "important", "end", "silent"]) mut(`detail-notify-${nm}`, dn(nm));
  mut("detail-notify-bad", dn("ruidoso"));
  mut("detail-notify-null", dn(null));
  mut("detail-notify-number", dn(1));
  mut("detail-notify-with-question", (m) => (m.view.detail = { sessionId: "s1", lastMessage: ["1"], question: ["¿Sigo?"], notify: "end" }));
  // instrucciones por texto (paso 6): tipo de solicitud, cola y modo en el detalle, y la espera en los ajustes
  mut("request-kind-instruction", (m) => (m.view.request.kind = "instruction"));
  mut("request-kind-instruction-with-questions", (m) => {
    m.view.request.kind = "instruction";
    m.view.request.questions = [{ header: "H", text: ["¿Sí?"], multi: false, options: [{ label: "a", desc: [], recommended: false }, { label: "b", desc: [], recommended: false }] }];
  });
  // comandos rápidos de la tarjeta de instrucción (Fase 3): de 0 a 4 pares etiqueta/texto, solo con kind instruction
  const quickOk = [{ label: "Sigue", text: "Sigue con lo que estabas haciendo." }, { label: "Resume", text: "Resume en pocas líneas qué hiciste y qué falta." }];
  const withQuick = (quick: unknown) => (m: any) => {
    m.view.request.kind = "instruction";
    m.view.request.quick = quick;
  };
  mut("request-quick-ok", withQuick(quickOk));
  mut("request-quick-empty", withQuick([]));
  mut("request-quick-four", withQuick(Array.from({ length: 4 }, (_, i) => ({ label: `c${i}`, text: `t${i}` }))));
  mut("request-quick-five", withQuick(Array.from({ length: 5 }, (_, i) => ({ label: `c${i}`, text: `t${i}` }))));
  mut("request-quick-label-20", withQuick([{ label: "x".repeat(20), text: "a" }]));
  mut("request-quick-label-21", withQuick([{ label: "x".repeat(21), text: "a" }]));
  mut("request-quick-label-emoji-20", withQuick([{ label: "😀".repeat(20), text: "a" }]));
  mut("request-quick-label-emoji-21", withQuick([{ label: "😀".repeat(21), text: "a" }]));
  mut("request-quick-label-empty", withQuick([{ label: "", text: "a" }]));
  mut("request-quick-text-120", withQuick([{ label: "a", text: "ñ".repeat(120) }]));
  mut("request-quick-text-121", withQuick([{ label: "a", text: "x".repeat(121) }]));
  mut("request-quick-text-empty", withQuick([{ label: "a", text: "" }]));
  mut("request-quick-text-missing", withQuick([{ label: "a" }]));
  mut("request-quick-not-array", withQuick({ label: "a", text: "b" }));
  mut("request-quick-item-number", withQuick([3]));
  mut("request-quick-null", withQuick(null));
  mut("request-quick-with-permission", (m) => (m.view.request.quick = quickOk));
  // segundos en el estado actual (opcional): entero de 0 a 99 días
  const withSince = (value: unknown) => (m: any) => (m.view.sessions = [{ ...sess(1), sinceS: value }]);
  mut("session-since-0", withSince(0));
  mut("session-since-max", withSince(99 * 86400));
  mut("session-since-over", withSince(99 * 86400 + 1));
  mut("session-since-negative", withSince(-1));
  mut("session-since-float", withSince(1.5));
  mut("session-since-string", withSince("5"));
  mut("session-since-null", withSince(null));
  const di = (extra: Record<string, unknown>) => (m: any) => (m.view.detail = { sessionId: "s1", lastMessage: ["1"], ...extra });
  mut("detail-instructions-1", di({ instructions: { count: 1, first: "Agrega pruebas" } }));
  mut("detail-instructions-5", di({ instructions: { count: 5, first: "x".repeat(38) } }));
  mut("detail-instructions-6", di({ instructions: { count: 6, first: "x" } }));
  mut("detail-instructions-0", di({ instructions: { count: 0, first: "x" } }));
  mut("detail-instructions-float", di({ instructions: { count: 1.5, first: "x" } }));
  mut("detail-instructions-count-string", di({ instructions: { count: "2", first: "x" } }));
  mut("detail-instructions-first-39", di({ instructions: { count: 1, first: "x".repeat(39) } }));
  mut("detail-instructions-first-missing", di({ instructions: { count: 1 } }));
  mut("detail-instructions-count-missing", di({ instructions: { first: "x" } }));
  mut("detail-instructions-null", di({ instructions: null }));
  mut("detail-instructions-array", di({ instructions: [] }));
  mut("detail-wait-true", di({ waitForMe: true }));
  mut("detail-wait-false", di({ waitForMe: false }));
  mut("detail-wait-string", di({ waitForMe: "si" }));
  mut("detail-wait-null", di({ waitForMe: null }));
  mut("detail-wait-and-instructions", di({ notify: "end", instructions: { count: 2, first: "a" }, waitForMe: true }));
  for (const w of [5, 10, 30]) mut(`settings-instruct-wait-${w}`, (m) => (m.view.settings = { ...settings(), instructWaitMax: w }));
  for (const [nm, w] of [["0", 0], ["7", 7], ["60", 60], ["string", "10"], ["null", null], ["float", 5.5], ["true", true]] as const) {
    mut(`settings-instruct-wait-bad-${nm}`, (m) => (m.view.settings = { ...settings(), instructWaitMax: w }));
  }
  // sintaxis rota o fuera de lugar
  add("raw/empty", "");
  add("raw/spaces", "   ");
  add("raw/not-json", "hola");
  add("raw/array", "[]");
  add("raw/string", '"view"');
  add("raw/null", "null");
  add("raw/trailing-garbage", JSON.stringify(base) + " x");
  add("raw/trailing-comma", JSON.stringify(base).replace(/}$/, ",}"));
  add("raw/truncated-half", JSON.stringify(base).slice(0, 200));
  add("raw/unclosed-string", '{"t":"view');
  add("raw/bad-escape", '{"t":"vi\\qew"}');
  add("raw/incomplete-unicode", '{"t":"vi\\u12"}');
  add("raw/bad-hex-unicode", '{"t":"vi\\u12zz"}');
  add("raw/leading-zero", JSON.stringify(base).replace('"rev":7', '"rev":07'));
  add("raw/comment", "/* x */" + JSON.stringify(base));
  add("raw/single-quotes", "{'t':'view'}");
  add("raw/duplicate-rev", JSON.stringify(base).replace('"rev":7', '"rev":3,"rev":9'));
  add("raw/duplicate-view-keys", JSON.stringify(base).replace('"mode":"queue"', '"mode":"manual","mode":"queue"'));
  add("raw/deep-nesting-ok", JSON.stringify(base).replace(/}$/, ',"x":' + "[".repeat(10) + "]".repeat(10) + "}"));
  add("raw/deep-nesting-too-deep", JSON.stringify(base).replace(/}$/, ',"x":' + "[".repeat(40) + "]".repeat(40) + "}"), true);
  add("raw/many-tokens", JSON.stringify(base).replace(/}$/, ',"x":[' + "0,".repeat(900) + "0]}"), true);
  add("raw/control-char-in-string", '{"t":"view\n"}');
}

// ---- views_fixture.h ----

function genViews(): void {
  const lines = [
    `// GENERADO por packages/bridge/scripts/gen-view-fixtures.ts. No editar.`,
    `#ifndef VIEWS_FIXTURE_H`,
    `#define VIEWS_FIXTURE_H`,
    ``,
    `typedef struct {`,
    `  const char *name;`,
    `  const char *json;`,
    `  unsigned long json_len;`,
    `  int zod_valid;     // veredicto de los esquemas zod del protocolo`,
    `  int c_valid;       // veredicto esperado de view_parse (igual que zod salvo números como 1.0, 1e2 o -0, que C rechaza)`,
    `  const char *expected; // volcado canónico si c_valid (ver dump_view en test_view.c)`,
    `} ViewFixture;`,
    ``,
    `static const ViewFixture __attribute__((unused)) VIEW_FIXTURES[] = {`,
  ];
  for (const f of fixtures) {
    const bytes = Buffer.from(f.json, "utf8");
    lines.push(
      `    {"${f.name}", ${cLiteral(bytes)}, ${bytes.length}UL, ${f.zodValid ? 1 : 0}, ${f.cValid ? 1 : 0},\n    ${cLiteral(Buffer.from(f.expected, "utf8"))}},`,
    );
  }
  lines.push(`};`, `#define VIEW_FIXTURE_COUNT ${fixtures.length}`, ``);
  // mensajes text (respuesta a read): mismo formato, los analiza reading_parse
  lines.push(`static const ViewFixture __attribute__((unused)) TEXT_FIXTURES[] = {`);
  for (const f of textFixtures) {
    const bytes = Buffer.from(f.json, "utf8");
    lines.push(
      `    {"${f.name}", ${cLiteral(bytes)}, ${bytes.length}UL, ${f.zodValid ? 1 : 0}, ${f.cValid ? 1 : 0},
    ${cLiteral(Buffer.from(f.expected, "utf8"))}},`,
    );
  }
  lines.push(`};`, `#define TEXT_FIXTURE_COUNT ${textFixtures.length}`, ``);
  // mensajes de la consola válidos del protocolo: lo que msg_* debe reproducir byte a byte
  const consoleMsgs = readdirSync(MESSAGES)
    .sort()
    .filter((f) => f.startsWith("console-") && f.endsWith(".valid.json"))
    .map((f) => ({ name: f.replace(".valid.json", ""), json: readFileSync(MESSAGES + f, "utf8").trim() }));
  for (const m of consoleMsgs) {
    if (JSON.stringify(JSON.parse(m.json)) !== m.json) throw new Error(`${m.name}: no está en la forma de JSON.stringify`);
  }
  lines.push(`typedef struct {
  const char *name;
  const char *json;
} ConsoleFixture;`, ``);
  lines.push(`static const ConsoleFixture __attribute__((unused)) CONSOLE_FIXTURES[] = {`);
  for (const m of consoleMsgs) lines.push(`    {"${m.name}", ${cLiteral(Buffer.from(m.json))}},`);
  lines.push(`};`, `#define CONSOLE_FIXTURE_COUNT ${consoleMsgs.length}`, ``, `#endif`, ``);
  writeFileSync(OUT + "views_fixture.h", lines.join("\n"));
}

genHandshake();
genViews();
const valid = fixtures.filter((f) => f.cValid).length;
console.log(`escrito ${OUT}: handshake_fixture.h, views_fixture.h (${fixtures.length} mensajes, ${valid} válidos; ${textFixtures.length} de texto), views/*.json`);
process.exit(0);
