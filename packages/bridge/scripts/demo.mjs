#!/usr/bin/env node
// Demo para probar a mano la cola de permisos y los modos.
//
// Crea 2 sesiones de Claude en proyectos distintos, 1 de Gemini y 1 de Codex (con actividades), y luego lanza dos
// permisos casi a la vez desde las dos sesiones de Claude. Imprime las decisiones que van llegando (apruébalas o
// recházalas en el simulador o en la consola). Las sesiones quedan abiertas; con --end se retiran al terminar.
//
// Uso: node packages/bridge/scripts/demo.mjs [--port 33335] [--end]
//      (o COMPANION_API_PORT / COMPANION_BRIDGE_URL)

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

const SESSIONS = [
  { id: "demo-claude-web", kind: "claude", project: "mi-portal", title: "Ajustar el hero", model: "Opus", activity: "Editando hero.astro", last: "Ajusté el hero y falta revisar el contraste del botón." },
  { id: "demo-claude-lea", kind: "claude", project: "OTRO-SISTEMA", model: "Sonnet", activity: "Corriendo los tests", last: "Agregué el módulo de reportes; corro la suite." },
  { id: "demo-gemini", kind: "gemini", project: "otro-sitio", model: "Pro", activity: "Revisando el formulario", last: "El formulario valida bien; reviso el envío." },
  { id: "demo-codex", kind: "codex", project: "ATLAS", model: "GPT", activity: "Leyendo el runner", last: "Listo el refactor del runner." },
];

const ev = (s, event, extra = {}) =>
  post("/event", { session_id: s.id, cwd: `/demo/${s.project}`, kind: s.kind, event, ...extra });

try {
  for (const s of SESSIONS) {
    await ev(s, "start", { model: s.model, ...(s.title ? { title: s.title } : {}), last_message: s.last });
    await ev(s, "working", { activity: s.activity });
  }
  console.log("Sesiones creadas: 2 de Claude (mi-portal, OTRO-SISTEMA), 1 de Gemini, 1 de Codex.");

  const asks = [
    { s: SESSIONS[0], command: "npm install sharp" },
    { s: SESSIONS[1], command: "rm -rf node_modules && npm ci" },
  ];
  console.log("Lanzando dos permisos casi a la vez; respóndelos en el simulador o en la consola...");
  const results = await Promise.all(
    asks.map(async ({ s, command }, i) => {
      await new Promise((r) => setTimeout(r, i * 100));
      const { decision } = await postPermission({
        session_id: s.id,
        cwd: `/demo/${s.project}`,
        tool_name: "Bash",
        tool_input: { command },
      });
      console.log(`Decisión para ${s.project} ("${command}"): ${decision}`);
      return decision;
    }),
  );
  console.log(`Listo: ${results.join(", ")}`);

  if (args.includes("--end")) {
    for (const s of SESSIONS) await ev(s, "end");
    console.log("Sesiones retiradas.");
  } else {
    console.log("Las sesiones siguen abiertas (el puente las retira tras 30 minutos sin eventos). Usa --end para retirarlas.");
  }
} catch (err) {
  console.error(`No se pudo hablar con el puente en ${base}: ${err.message}`);
  process.exitCode = 1;
}
