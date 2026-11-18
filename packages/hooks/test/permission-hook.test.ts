import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = new URL("../permission-hook.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

// Token local del puente: el hook lo lee de <carpeta de configuración>/api-token. Por defecto las pruebas usan una carpeta de configuración temporal con token.
const TOKEN = "0123456789abcdef".repeat(4);
const CFG_CON_TOKEN = mkdtempSync(join(tmpdir(), "companion-hook-token-"));
writeFileSync(join(CFG_CON_TOKEN, "api-token"), TOKEN);
afterAll(() => rmSync(CFG_CON_TOKEN, { recursive: true, force: true }));

let server: Server | null = null;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

async function startServer(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, body));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const reply = (status: number, body: string | object): Handler => (_req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runHook(env: Record<string, string>, stdin: string = JSON.stringify(INPUT)): Promise<Run> {
  return new Promise((resolve, reject) => {
    // carpeta de configuración temporal por defecto (sin carpetas.json: vale todas; con api-token): nunca se lee nada del %APPDATA% real
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, AGENT_COMPANION_CONFIG_DIR: CFG_CON_TOKEN, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const INPUT = {
  session_id: "sess-1",
  cwd: "C:\\proyectos\\demo",
  tool_name: "Bash",
  tool_input: { command: "ls" },
};

/** En todos los casos: sale con 0 y solo imprime una decisión allow o deny. */
function expectSafe(run: Run, behavior: "allow" | "deny" | null): void {
  expect(run.code).toBe(0);
  if (behavior === null) {
    expect(run.stdout).toBe("");
    return;
  }
  const out = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; decision: { behavior: string } } };
  expect(out.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  expect(out.hookSpecificOutput.decision.behavior).toBe(behavior);
}

describe("permission-hook.mjs", () => {
  it("allow -> imprime allow y sale con 0; envía la solicitud al puente", async () => {
    let seen: { method?: string; url?: string; body: string } = { body: "" };
    const url = await startServer((req, res, body) => {
      seen = { method: req.method, url: req.url, body };
      reply(200, { decision: "allow" })(req, res, body);
    });
    expectSafe(await runHook({ BRIDGE_URL: url }), "allow");
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/permission");
    expect(JSON.parse(seen.body)).toEqual({
      session_id: "sess-1",
      cwd: "C:\\proyectos\\demo",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
  });

  it("reenvía permission_suggestions al puente", async () => {
    const suggestions = [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls" }], behavior: "allow", destination: "localSettings" }];
    let seen = "";
    const url = await startServer((req, res, body) => {
      seen = body;
      reply(200, { decision: "allow" })(req, res, body);
    });
    expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify({ ...INPUT, permission_suggestions: suggestions })), "allow");
    expect(JSON.parse(seen).permission_suggestions).toEqual(suggestions);
  });

  it("allow con updatedPermissions -> los imprime tal cual en la decisión", async () => {
    const updated = [
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls" }], behavior: "allow", destination: "localSettings" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ];
    const url = await startServer(reply(200, { decision: "allow", updatedPermissions: updated }));
    const run = await runHook({ BRIDGE_URL: url });
    expectSafe(run, "allow");
    expect(JSON.parse(run.stdout).hookSpecificOutput.decision).toEqual({ behavior: "allow", updatedPermissions: updated });
  });

  it("updatedPermissions mal formado o vacío -> allow a secas", async () => {
    for (const bad of ["x", [], [1], [{}], [{ type: 3 }], {}]) {
      const url = await startServer(reply(200, { decision: "allow", updatedPermissions: bad }));
      const run = await runHook({ BRIDGE_URL: url });
      expectSafe(run, "allow");
      expect(JSON.parse(run.stdout).hookSpecificOutput.decision, JSON.stringify(bad)).toEqual({ behavior: "allow" });
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it("deny con updatedPermissions -> no los imprime (solo valen con allow)", async () => {
    const url = await startServer(reply(200, { decision: "deny", updatedPermissions: [{ type: "setMode", mode: "acceptEdits" }] }));
    const run = await runHook({ BRIDGE_URL: url });
    expectSafe(run, "deny");
    expect(JSON.parse(run.stdout).hookSpecificOutput.decision.updatedPermissions).toBeUndefined();
  });

  it("deny -> imprime deny y sale con 0", async () => {
    const url = await startServer(reply(200, { decision: "deny" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), "deny");
  });

  it("ask -> sin salida, sale con 0", async () => {
    const url = await startServer(reply(200, { decision: "ask" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("decisión desconocida -> sin salida", async () => {
    const url = await startServer(reply(200, { decision: "quizas" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("estado 500 -> sin salida, sale con 0", async () => {
    const url = await startServer(reply(500, { error: "error interno" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("estado 500 aunque el cuerpo diga allow -> sin salida", async () => {
    const url = await startServer(reply(500, { decision: "allow" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("JSON inválido en la respuesta -> sin salida, sale con 0", async () => {
    const url = await startServer(reply(200, "{esto no es json"));
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("servidor apagado -> sin salida, sale con 0", async () => {
    const tmp = createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
    const port = (tmp.address() as AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));
    expectSafe(await runHook({ BRIDGE_URL: `http://127.0.0.1:${port}` }), null);
  });

  it("sin plazo propio: sigue esperando y aplica la decisión cuando el puente responde tarde", async () => {
    let answer: (() => void) | null = null;
    const url = await startServer((_req, res) => {
      answer = () => reply(200, { decision: "allow" })(_req, res, "");
    });
    const run = runHook({ BRIDGE_URL: url, HOOK_DEADLINE: "100" });
    let done = false;
    void run.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 700));
    expect(done).toBe(false);
    answer!();
    expectSafe(await run, "allow");
  });

  it("el puente cierra la conexión sin responder -> sin salida, sale con 0 de inmediato", async () => {
    const url = await startServer((req) => req.socket.destroy());
    expectSafe(await runHook({ BRIDGE_URL: url }), null);
  });

  it("el padre muere -> el hook cierra la conexión y sale sin decisión, sin vencimiento por tiempo", async () => {
    let closed = false;
    let arrived: (() => void) | null = null;
    const got = new Promise<void>((r) => (arrived = r));
    const url = await startServer((req) => {
      req.socket.on("close", () => (closed = true));
      arrived!();
    });
    const victim = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const run = runHook({ BRIDGE_URL: url, HOOK_WATCH_PID: String(victim.pid), HOOK_WATCH_INTERVAL: "100" });
    await got;
    await new Promise((r) => setTimeout(r, 400));
    let done = false;
    void run.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 100));
    expect(done).toBe(false); // el padre vive: sigue esperando
    const killed = new Promise((r) => victim.once("exit", r));
    victim.kill();
    await killed;
    const res = await run;
    expectSafe(res, null);
    await new Promise((r) => setTimeout(r, 200));
    expect(closed).toBe(true);
  });

  it("HOOK_WATCH_PID=0 desactiva la vigilancia", async () => {
    let answer: (() => void) | null = null;
    const got = new Promise<void>((r) => (answer = r));
    const url = await startServer((req, res) => {
      answer!();
      setTimeout(() => reply(200, { decision: "allow" })(req, res, ""), 500);
    });
    const run = runHook({ BRIDGE_URL: url, HOOK_WATCH_PID: "0", HOOK_WATCH_INTERVAL: "50" });
    await got;
    expectSafe(await run, "allow");
  });

  it("entrada estándar inválida -> sin salida, sale con 0", async () => {
    const url = await startServer(reply(200, { decision: "allow" }));
    expectSafe(await runHook({ BRIDGE_URL: url }, "no es json"), null);
  });

  it("ExitPlanMode: sale con 0 sin salida y sin llamar al puente", async () => {
    let called = false;
    const url = await startServer((req, res, body) => {
      called = true;
      reply(200, { decision: "allow" })(req, res, body);
    });
    const input = { ...INPUT, tool_name: "ExitPlanMode", tool_input: { plan: "x" } };
    expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(input)), null);
    expect(called).toBe(false);
  });
});

describe("permission-hook.mjs como PreToolUse de AskUserQuestion (legado)", () => {
  const QUESTIONS = [
    {
      question: "¿Qué fondo uso?",
      header: "Fondo",
      options: [
        { label: "Video (Recommended)", description: "Pesa más" },
        { label: "Gradiente", description: "Liviano" },
      ],
      multiSelect: false,
    },
    {
      question: "¿Qué secciones?",
      header: "Secciones",
      options: [
        { label: "Hero", description: "Portada" },
        { label: "Footer", description: "Pie" },
      ],
      multiSelect: true,
    },
  ];
  const ASK = {
    session_id: "sess-1",
    cwd: "C:\proyectos\demo",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: QUESTIONS },
  };

  type PreOut = { hookSpecificOutput: { hookEventName: string; permissionDecision: string; updatedInput: Record<string, unknown> } };

  it("answer -> allow con updatedInput: las mismas preguntas más answers (una y varias preguntas, multiSelect, Otra)", async () => {
    const cases: Record<string, string>[] = [
      { "¿Qué fondo uso?": "Video (Recommended)" },
      { "¿Qué fondo uso?": "Gradiente", "¿Qué secciones?": "Hero, Footer" },
      { "¿Qué fondo uso?": "uno con ñ y \"comillas\"", "¿Qué secciones?": "Footer" },
    ];
    for (const answers of cases) {
      let seen: { url?: string; body: string } = { body: "" };
      const url = await startServer((req, res, body) => {
        seen = { url: req.url, body };
        reply(200, { decision: "answer", answers })(req, res, body);
      });
      const run = await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK));
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as PreOut;
      expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(out.hookSpecificOutput.updatedInput).toEqual({ questions: QUESTIONS, answers });
      expect(seen.url).toBe("/question");
      expect(JSON.parse(seen.body)).toEqual({ session_id: "sess-1", cwd: "C:\proyectos\demo", tool_input: { questions: QUESTIONS } });
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it("ask, respuesta rara o error del puente -> sin salida y código 0", async () => {
    const bodies: (string | object)[] = [
      { decision: "ask" },
      { decision: "answer" },
      { decision: "answer", answers: {} },
      { decision: "answer", answers: { a: 1 } },
      { decision: "answer", answers: ["a"] },
      { decision: "answer", answers: "a" },
      { decision: "allow" },
      "no es json",
    ];
    for (const body of bodies) {
      const url = await startServer(reply(200, body));
      expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK)), null);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    const url = await startServer(reply(500, { decision: "answer", answers: { a: "b" } }));
    expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK)), null);
  });

  it("puente apagado -> sin salida y código 0", async () => {
    expectSafe(await runHook({ BRIDGE_URL: "http://127.0.0.1:1", HOOK_CONNECT_TIMEOUT: "500" }, JSON.stringify(ASK)), null);
  });

  it("otra herramienta o entrada rara en PreToolUse -> sin salida y sin llamar al puente", async () => {
    let called = false;
    const url = await startServer((req, res, body) => {
      called = true;
      reply(200, { decision: "answer", answers: { a: "b" } })(req, res, body);
    });
    const inputs = [
      { ...ASK, tool_name: "Bash", tool_input: { command: "ls" } },
      { ...ASK, tool_input: {} },
      { ...ASK, tool_input: { questions: "x" } },
      { ...ASK, tool_input: null },
    ];
    for (const input of inputs) expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(input)), null);
    expect(called).toBe(false);
  });

  it("sin plazo propio: espera la respuesta aunque tarde", async () => {
    const url = await startServer((req, res, body) => {
      setTimeout(() => reply(200, { decision: "answer", answers: { "¿Qué fondo uso?": "Gradiente" } })(req, res, body), 700);
    });
    const run = await runHook({ BRIDGE_URL: url, HOOK_WATCH_PID: "0" }, JSON.stringify(ASK));
    expect((JSON.parse(run.stdout) as PreOut).hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("sigue vigilando al padre: si ya no existe, sale sin salida", async () => {
    const url = await startServer(() => {
      /* nunca responde */
    });
    // un pid que no existe (el de un proceso ya terminado) hace que la vigilancia lo dé por muerto
    const dead = spawn(process.execPath, ["-e", "0"]);
    await new Promise((r) => dead.on("close", r));
    const run = await runHook({ BRIDGE_URL: url, HOOK_WATCH_PID: String(dead.pid), HOOK_WATCH_INTERVAL: "100" }, JSON.stringify(ASK));
    expectSafe(run, null);
  });
});

describe("permission-hook.mjs como PermissionRequest de AskUserQuestion (camino oficial)", () => {
  const QUESTIONS = [
    {
      question: "¿Qué fondo uso?",
      header: "Fondo",
      options: [
        { label: "Video (Recommended)", description: "Pesa más" },
        { label: "Gradiente", description: "Liviano" },
      ],
      multiSelect: false,
    },
    {
      question: "¿Qué secciones?",
      header: "Secciones",
      options: [
        { label: "Hero", description: "Portada" },
        { label: "Footer", description: "Pie" },
      ],
      multiSelect: true,
    },
  ];
  const ASK = { ...INPUT, hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion", tool_input: { questions: QUESTIONS } };

  it("answer -> allow con updatedInput (las mismas preguntas más answers) y va a /question, no a /permission", async () => {
    const cases: Record<string, string>[] = [
      { "¿Qué fondo uso?": "Video (Recommended)" },
      { "¿Qué fondo uso?": "Gradiente", "¿Qué secciones?": "Hero, Footer" },
      { "¿Qué fondo uso?": "uno con ñ y \"comillas\"" },
    ];
    for (const answers of cases) {
      let seen: { url?: string; body: string } = { body: "" };
      const url = await startServer((req, res, body) => {
        seen = { url: req.url, body };
        reply(200, { decision: "answer", answers })(req, res, body);
      });
      const run = await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK));
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: { questions: QUESTIONS, answers } } },
      });
      expect(seen.url).toBe("/question");
      expect(JSON.parse(seen.body)).toEqual({ session_id: ASK.session_id, cwd: ASK.cwd, tool_input: { questions: QUESTIONS } });
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it("ask (por ejemplo, respondida en el PC), respuesta rara, error del puente o puente apagado -> sin salida y código 0", async () => {
    const bodies: (string | object)[] = [{ decision: "ask" }, { decision: "answer" }, { decision: "answer", answers: {} }, { decision: "answer", answers: { a: 1 } }, { decision: "allow" }, "no es json"];
    for (const body of bodies) {
      const url = await startServer(reply(200, body));
      expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK)), null);
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    const url = await startServer(reply(500, { decision: "answer", answers: { a: "b" } }));
    expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify(ASK)), null);
    expectSafe(await runHook({ BRIDGE_URL: "http://127.0.0.1:1", HOOK_CONNECT_TIMEOUT: "500" }, JSON.stringify(ASK)), null);
  });

  it("entrada sin preguntas válidas -> sin salida y sin llamar al puente", async () => {
    let called = false;
    const url = await startServer((req, res, body) => {
      called = true;
      reply(200, { decision: "answer", answers: { a: "b" } })(req, res, body);
    });
    for (const tool_input of [{}, { questions: "x" }, null]) expectSafe(await runHook({ BRIDGE_URL: url }, JSON.stringify({ ...ASK, tool_input })), null);
    expect(called).toBe(false);
  });

  it("espera sin plazo y, si el puente cierra con ask mientras tanto, sale sin salida", async () => {
    const url = await startServer((req, res, body) => {
      setTimeout(() => reply(200, { decision: "ask" })(req, res, body), 600);
    });
    expectSafe(await runHook({ BRIDGE_URL: url, HOOK_WATCH_PID: "0" }, JSON.stringify(ASK)), null);
  });
});

describe("permission-hook.mjs: hook Stop (instrucciones, paso 6)", () => {
  const STOP = { hook_event_name: "Stop", session_id: "sess-1", cwd: "C:\proyectos\demo", stop_hook_active: false, last_assistant_message: "Listo." };
  const runStop = (env: Record<string, string>, input: object = STOP) => runHook(env, JSON.stringify(input));

  it("instruct -> imprime block con la instrucción y sale con 0; manda la sesión y el último mensaje a /stop", async () => {
    let seen: { method?: string; url?: string; body: string } = { body: "" };
    const url = await startServer((req, res, body) => {
      seen = { method: req.method, url: req.url, body };
      reply(200, { decision: "instruct", text: "Agrega pruebas" })(req, res, body);
    });
    const run = await runStop({ BRIDGE_URL: url });
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ decision: "block", reason: "Instrucción desde la 3DS:\nAgrega pruebas" });
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/stop");
    expect(JSON.parse(seen.body)).toEqual({ session_id: "sess-1", cwd: "C:\proyectos\demo", stop_hook_active: false, last_assistant_message: "Listo." });
  });

  it("stop_hook_active: true no corta: se entrega igual", async () => {
    let seen = "";
    const url = await startServer((req, res, body) => {
      seen = body;
      reply(200, { decision: "instruct", text: "otra" })(req, res, body);
    });
    const run = await runStop({ BRIDGE_URL: url }, { ...STOP, stop_hook_active: true });
    expect(JSON.parse(run.stdout).decision).toBe("block");
    expect(JSON.parse(seen).stop_hook_active).toBe(true);
  });

  it("none, instruct sin texto, respuesta rara, 500 o puente apagado -> sin salida y código 0", async () => {
    for (const body of [{ decision: "none" }, { decision: "instruct" }, { decision: "instruct", text: "  " }, { decision: "instruct", text: 5 }, { decision: "allow", text: "x" }, "no es json"]) {
      const url = await startServer(reply(200, body));
      const run = await runStop({ BRIDGE_URL: url });
      expect(run.code).toBe(0);
      expect(run.stdout, JSON.stringify(body)).toBe("");
      await new Promise<void>((r) => {
        server!.closeAllConnections();
        server!.close(() => r());
        server = null;
      });
    }
    const url = await startServer(reply(500, { error: "x" }));
    expect((await runStop({ BRIDGE_URL: url })).stdout).toBe("");
    expect((await runStop({ BRIDGE_URL: "http://127.0.0.1:9" })).stdout).toBe("");
  });

  it("sin session_id o con entrada inválida no habla con el puente y sale con 0", async () => {
    let called = false;
    const url = await startServer((req, res, body) => {
      called = true;
      reply(200, { decision: "instruct", text: "x" })(req, res, body);
    });
    const { session_id: _omit, ...sinSesion } = STOP;
    for (const run of [await runStop({ BRIDGE_URL: url }, sinSesion as object), await runHook({ BRIDGE_URL: url }, "no es json")]) {
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("");
    }
    expect(called).toBe(false);
  });

  it("retenido: espera sin plazo la respuesta del puente y luego imprime el block", async () => {
    let release: (() => void) | null = null;
    const url = await startServer((req, res, body) => {
      release = () => reply(200, { decision: "instruct", text: "tarde" })(req, res, body);
    });
    const running = runStop({ BRIDGE_URL: url, HOOK_CONNECT_TIMEOUT: "300" });
    await new Promise((r) => setTimeout(r, 900)); // más que el plazo de conexión: no corta
    release!();
    const run = await running;
    expect(JSON.parse(run.stdout).reason).toBe("Instrucción desde la 3DS:\ntarde");
  });

  it("el PermissionRequest y las preguntas siguen igual", async () => {
    const url = await startServer(reply(200, { decision: "allow" }));
    expectSafe(await runHook({ BRIDGE_URL: url }), "allow");
  });
});

describe("carpetas elegidas (carpetas.json)", () => {
  let cfg: string;
  beforeEach(() => {
    cfg = mkdtempSync(join(tmpdir(), "companion-hook-cfg-"));
    writeFileSync(join(cfg, "api-token"), TOKEN);
  });
  afterEach(() => rmSync(cfg, { recursive: true, force: true }));
  const escribir = (o: unknown) => writeFileSync(join(cfg, "carpetas.json"), typeof o === "string" ? o : JSON.stringify(o));

  async function conPuente(env: Record<string, string>, input: object) {
    let llamadas = 0;
    const url = await startServer((req, res, body) => {
      llamadas++;
      reply(200, { decision: "allow" })(req, res, body);
    });
    const run = await runHook({ BRIDGE_URL: url, AGENT_COMPANION_CONFIG_DIR: cfg, ...env }, JSON.stringify(input));
    return { run, llamadas };
  }

  it("cwd fuera de las carpetas: sale con 0, sin salida y sin contactar al puente (permiso, pregunta y Stop)", async () => {
    escribir({ modo: "elegidas", carpetas: ["C:\\otra"] });
    for (const input of [
      INPUT,
      { ...INPUT, tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "?", options: [] }] } },
      { session_id: "s", cwd: INPUT.cwd, hook_event_name: "Stop", last_assistant_message: "hola" },
    ]) {
      const { run, llamadas } = await conPuente({}, input);
      expectSafe(run, null);
      expect(llamadas).toBe(0);
    }
  });

  it("cwd dentro de una carpeta elegida (o subcarpeta): funciona como siempre", async () => {
    escribir({ modo: "elegidas", carpetas: ["c:/PROYECTOS"] });
    const { run, llamadas } = await conPuente({}, INPUT);
    expectSafe(run, "allow");
    expect(llamadas).toBe(1);
  });

  it("modo todas y archivo ausente: funciona", async () => {
    escribir({ modo: "todas", carpetas: [] });
    expectSafe((await conPuente({}, INPUT)).run, "allow");
    rmSync(join(cfg, "carpetas.json"));
    expectSafe((await conPuente({}, INPUT)).run, "allow");
  });

  it("archivo corrupto: no actúa", async () => {
    escribir("{roto");
    const { run, llamadas } = await conPuente({}, INPUT);
    expectSafe(run, null);
    expect(llamadas).toBe(0);
  });
});

// Token local (auditoría 2026-11-17): la API del puente exige X-Cronio-Token; el hook lo lee de <carpeta de configuración>/api-token y, sin token o
// con uno malo, no imprime nada para que Claude Code pregunte en el PC.
describe("token local del puente", () => {
  let cfg: string;
  beforeEach(() => {
    cfg = mkdtempSync(join(tmpdir(), "companion-hook-tok-"));
  });
  afterEach(() => rmSync(cfg, { recursive: true, force: true }));

  const PERMISO = INPUT;
  const PREGUNTA = { ...INPUT, hook_event_name: "PermissionRequest", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "¿a?", header: "A", multiSelect: false, options: [{ label: "x", description: "y" }, { label: "z", description: "w" }] }] } };
  const STOP = { hook_event_name: "Stop", session_id: "sess-1", cwd: "C:\proyectos\demo", stop_hook_active: false, last_assistant_message: "Listo." };
  const RUTAS: [string, object][] = [
    ["/permission", PERMISO],
    ["/question", PREGUNTA],
    ["/stop", STOP],
  ];

  it("manda el token en x-cronio-token a /permission, /question y /stop", async () => {
    for (const [ruta, input] of RUTAS) {
      let visto: { url?: string; token?: string | string[] } = {};
      const url = await startServer((req, res, body) => {
        visto = { url: req.url, token: req.headers["x-cronio-token"] };
        reply(200, { decision: "ask" })(req, res, body);
      });
      await runHook({ BRIDGE_URL: url }, JSON.stringify(input));
      expect(visto.url, ruta).toBe(ruta);
      expect(visto.token, ruta).toBe(TOKEN);
      await server!.close();
      server = null;
    }
  });

  it("lee el token de la carpeta de configuración en cada llamada (un puente reiniciado deja uno nuevo)", async () => {
    const nuevo = "fedcba9876543210".repeat(4);
    writeFileSync(join(cfg, "api-token"), nuevo + "\n"); // con salto de línea final: se recorta
    let visto: string | string[] | undefined;
    const url = await startServer((req, res, body) => {
      visto = req.headers["x-cronio-token"];
      reply(200, { decision: "allow" })(req, res, body);
    });
    expectSafe(await runHook({ BRIDGE_URL: url, AGENT_COMPANION_CONFIG_DIR: cfg }), "allow");
    expect(visto).toBe(nuevo);
  });

  it("sin archivo api-token (o ilegible, vacío o con basura): sin salida, código 0 y sin contactar al puente", async () => {
    for (const contenido of [undefined, "", "   \n", "no es un token", "AB".repeat(32), "ab".repeat(31), "ab".repeat(33)]) {
      if (contenido === undefined) rmSync(join(cfg, "api-token"), { force: true });
      else writeFileSync(join(cfg, "api-token"), contenido);
      for (const [ruta, input] of RUTAS) {
        let llamadas = 0;
        const url = await startServer((req, res, body) => {
          llamadas++;
          reply(200, { decision: "allow" })(req, res, body);
        });
        const run = await runHook({ BRIDGE_URL: url, AGENT_COMPANION_CONFIG_DIR: cfg }, JSON.stringify(input));
        expectSafe(run, null);
        expect(llamadas, `${ruta} con ${JSON.stringify(contenido)}`).toBe(0);
        await server!.close();
        server = null;
      }
    }
  });

  it("401 (token malo: este puente es otro o el hook es una copia vieja): sin salida y código 0, aunque el cuerpo diga allow", async () => {
    for (const [ruta, input] of RUTAS) {
      const url = await startServer(reply(401, { error: "falta el token local o no es válido", decision: "allow", text: "haz algo", answers: { "¿a?": "x" } }));
      const run = await runHook({ BRIDGE_URL: url }, JSON.stringify(input));
      expectSafe(run, null);
      expect(run.stderr, ruta).toBe("");
      await server!.close();
      server = null;
    }
  });

  it("un hook sin token (copia vieja) contra un puente que lo exige: nunca aprueba solo", async () => {
    // lo que haría la copia vieja: mandar la solicitud sin la cabecera; el puente responde 401 y el hook no imprime nada
    const url = await startServer((req, res, body) => {
      if (req.headers["x-cronio-token"] !== TOKEN) return reply(401, { error: "token" })(req, res, body);
      reply(200, { decision: "allow" })(req, res, body);
    });
    expectSafe(await runHook({ BRIDGE_URL: url, AGENT_COMPANION_CONFIG_DIR: cfg }), null); // cfg sin token
    expectSafe(await runHook({ BRIDGE_URL: url }), "allow"); // con el token bueno sí
  });
});
