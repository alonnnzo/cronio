#!/usr/bin/env node
// Agente simulado: registra una sesión, pide un permiso al puente y muestra la decisión.
//
// Uso: node packages/bridge/scripts/fake-agent.mjs [--port 33335] [--command "rm -rf build"]
//        [--session fake-1] [--title "Revisión del hero"] [--kind claude|gemini|codex|cursor|hermes]
//        [--project mi-portal]
//      (o COMPANION_API_PORT / COMPANION_BRIDGE_URL)
// Para simular varias sesiones, lánzalo varias veces con distinto --session (y --project / --title).

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { carpetaDatos } from "../../hooks/carpetas.mjs";

// Token local de la API (X-Cronio-Token): COMPANION_API_TOKEN, o el archivo api-token que el puente deja en <repo>/.companion y en la carpeta de configuración.
const token =
  process.env.COMPANION_API_TOKEN ??
  [join(import.meta.dirname, "../../../.companion"), carpetaDatos()]
    .map((dir) => {
      try {
        return readFileSync(join(dir, "api-token"), "utf8").trim();
      } catch {
        return undefined;
      }
    })
    .find(Boolean);
const authHeaders = token ? { "x-cronio-token": token } : {};

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const port = opt("--port", process.env.COMPANION_API_PORT ?? "33335");
const base = process.env.COMPANION_BRIDGE_URL ?? `http://127.0.0.1:${port}`;
const command = opt("--command", "npm test -- --coverage");
const sessionId = opt("--session", `fake-${Math.random().toString(16).slice(2, 8)}`);
const title = opt("--title", undefined);
const kind = opt("--kind", "claude");
const project = opt("--project", undefined);
const cwd = project ? `/fake/${project}` : process.cwd();

// node:http y no fetch: fetch (undici) corta a los 5 minutos sin cabeceras y los permisos esperan sin límite.
function postPermission(body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/permission`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`/permission: HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("conexión cortada")));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const event = (name, extra = {}) => post("/event", { session_id: sessionId, cwd, kind, event: name, ...extra });

try {
  await event("start", { model: "fake-model", ...(title ? { title } : {}) });
  await event("working", { activity: "Preparando el permiso" });
  console.log(`Sesión ${sessionId} (${kind}): pidiendo permiso para "${command}"...`);
  const { decision } = await postPermission({
    session_id: sessionId,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });
  console.log(`Decisión: ${decision}`);
  await event(decision === "allow" ? "done" : "idle", { last_message: `Decisión del permiso: ${decision}` });
  await event("end");
} catch (err) {
  console.error(`No se pudo hablar con el puente en ${base}: ${err.message}`);
  process.exitCode = 1;
}
