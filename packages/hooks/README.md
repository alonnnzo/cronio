# @companion/hooks

## Hook de permisos (`PermissionRequest`)

Envía cada solicitud de permiso al puente local (`http://127.0.0.1:33335/permission`) y espera la decisión de la
consola (o del simulador). **No tiene plazo**: el permiso se queda en cola hasta que se responde en la consola o se
resuelve en la terminal del agente. Ante cualquier fallo (puente apagado que no responde al conectar, sin consola,
error) no imprime nada y sale con 0 de inmediato: Claude Code muestra su diálogo normal en el terminal.

**"Sí, no volver a preguntar".** Claude Code manda en la entrada del hook `permission_suggestions` (opcional): lista de
actualizaciones de permisos, p. ej. `[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test"}],"behavior":"allow","destination":"localSettings"}]`
(también `setMode`, `addDirectories`...). El hook las reenvía tal cual en el cuerpo de `POST /permission` como
`permission_suggestions`; el puente las valida por encima (lista de objetos con `type` de texto; si no, se ignoran y la solicitud
sigue) y, si hay alguna, la tarjeta de la consola ofrece la tercera opción con una etiqueta corta (`Bash(npm test)`,
`aceptar ediciones en esta sesión`, `acceso a <dir>`...). Si se elige, el puente responde
`{"decision":"allow","updatedPermissions":[...las mismas sugerencias]}` y el hook imprime
`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[...]}}}`.
`updatedPermissions` solo se imprime con `allow` y si es una lista no vacía de objetos con `type`; en cualquier otro caso
la aprobación es a secas. Un `allow_always` sobre una solicitud sin sugerencias también es un `allow` normal.

**Token local** (auditoría 2026-11-17): la API del puente exige la cabecera `X-Cronio-Token` en `/permission`, `/question` y `/stop`. El puente genera el token
en cada arranque y deja una copia en `<carpeta de configuración>/api-token` (`%APPDATA%/agent-companion`, o `AGENT_COMPANION_CONFIG_DIR`: la misma
carpeta de `carpetas.json`); el hook la lee en cada llamada. Sin archivo, con un token que no vale (401: el hook es una copia vieja o el puente se
reinició) o con cualquier respuesta que no sea 2xx, **no imprime nada** y Claude Code pregunta en el PC: nunca se aprueba nada solo.

Variables: `BRIDGE_URL` (por defecto `http://127.0.0.1:33335`) y `HOOK_CONNECT_TIMEOUT` (5000 ms, solo para conectar con el
puente; no limita la espera de la decisión). Usa `node:http` y no `fetch`, que cortaría a los 5 minutos.

Cuando el permiso se resuelve en la terminal, el puente lo retira de la consola (ver "Permisos sin vencimiento" en
`docs/07-fase-1b-cara-y-sesiones.md`): por el cierre de la conexión de este hook, o por los hooks `PostToolUse`,
`PostToolUseFailure` de la misma herramienta e input, o por `Stop`, `UserPromptSubmit` o `SessionEnd` de la misma sesión.
Si Claude Code muere sin `SessionEnd`, el hook comprueba cada 2 s que su proceso padre sigue vivo y, si no, cierra la
conexión y sale sin decisión (`HOOK_WATCH_PID` y `HOOK_WATCH_INTERVAL` lo ajustan; `HOOK_WATCH_PID=0` lo desactiva).

## Preguntas con alternativas (`PermissionRequest` de `AskUserQuestion`)

Las preguntas de `AskUserQuestion` llegan a este mismo `permission-hook.mjs` por la entrada `PermissionRequest` con `matcher: "*"`
(no hace falta otra entrada). Manda `{session_id, cwd, tool_input}` a `POST /question` y espera. Claude Code muestra la pregunta en el PC
a la vez que la consola: se responde en cualquiera de los dos lados. Si la consola responde, el puente contesta
`{"decision":"answer","answers":{"<texto de la pregunta>":"<etiqueta>"}}` y el hook imprime
`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{...tool_input, "answers":{...}}}}}`
(varias etiquetas de una pregunta multiSelect van unidas con `", "`; "Otra" manda el texto escrito) y el PC cierra la pregunta. Si se responde
en el PC, Claude Code no mata este proceso: el hook `PostToolUse` (o `PostToolUseFailure`) de `AskUserQuestion` hace que el puente retire la
tarjeta y cierre la petición abierta con `{"decision":"ask"}`; el hook sale sin salida. Sin salida y código 0 (Claude Code decide en el PC)
también ante cualquier fallo, sin consola, con el ajuste `questions` apagado o con "Responder en el PC". Detalles en
`docs/09-fase-2b.md`, Paso 4.

Legado: el hook sigue aceptando `PreToolUse` con `matcher: "AskUserQuestion"` (la primera versión), pero no se recomienda: un `PreToolUse`
bloquea y mientras espera el PC no muestra la pregunta. Si tienes esa entrada en tu `settings.json`, quítala.

## Instrucciones por texto (hook `Stop`, paso 6)

El mismo `permission-hook.mjs` atiende el evento `Stop`: en `settings.example.json` la entrada `Stop` trae el hook http de estado y, a su lado, un hook
`command` (el mismo script) con `timeout` 3600. Manda `{session_id, cwd, stop_hook_active, last_assistant_message}` a `POST /stop` y:

- si el puente responde `{"decision":"instruct","text"}`, imprime `{"decision":"block","reason":"Instrucción desde la 3DS:\n<texto>"}` (el formato de `Stop` es de
  primer nivel, no `hookSpecificOutput`) y Claude Code sigue trabajando con ese texto como instrucción;
- con `{"decision":"none"}`, ante cualquier fallo o con el puente apagado no imprime nada y sale con 0: Claude termina normal.

El puente responde en el acto si hay instrucciones en cola (escritas en la consola con anterioridad). Si no hay y la sesión tiene **"Esperar mi
respuesta"** (menú Y de la sesión en la consola) y hay consola conectada, **retiene** la respuesta: la consola muestra "Espera tu instrucción" y,
mientras tanto, esa sesión **no deja escribir en el PC** (Claude Code espera a este hook). Por eso siempre se libera: "Seguir en el PC", la
consola que se desconecta, el plazo (5, 10 o 30 min; ajuste "Esperar instrucción hasta"), la sesión que termina o el usuario que escribe en el PC.
`stop_hook_active: true` no corta: solo las escribe el usuario, no hay bucle. Misma vigilancia del padre que los demás.

## Hooks de estado (`type: "http"`)

Además, `settings.example.json` registra estos eventos de Claude Code como hooks de tipo `http` hacia
`http://127.0.0.1:33335/hook/claude` (`timeout` 2 s): `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop` y `SessionEnd`. El puente traduce cada uno a la sesión (estado, actividad, último mensaje) y
responde siempre `200` con cuerpo vacío: estos hooks nunca deciden nada. `PreToolUse` tampoco bloquea: solo informa.

**Estos hooks `http` van sin token**: un hook `http` de Claude Code no puede leer archivos, y el token cambia en cada arranque del puente, así que no
hay forma de ponérselo en `headers`. Por eso `/hook/claude` es la única entrada de escritura sin token, y por eso solo recibe eventos informativos:
no aprueba ni rechaza nada (a lo sumo retira una solicitud pendiente dejándola para el PC, que es lo que ya hacían), y lo que sí decide algo
(`/permission`, `/question`, `/stop`) va por `permission-hook.mjs`, que lleva el token.

| Evento | Efecto en el puente |
| :--- | :--- |
| `SessionStart` | crea la sesión (con `model` y `session_title` si vienen) |
| `UserPromptSubmit` | trabajando, "Pensando"; retira las solicitudes pendientes de la sesión |
| `PreToolUse` | trabajando, actividad según la herramienta; no retira nada |
| `PostToolUse` / `PostToolUseFailure` | retiran solo la solicitud pendiente con la misma herramienta e input; sin coincidencia, nada |
| `Notification` (`idle_prompt`) | inactiva, "Esperando instrucciones" |
| `Stop` | terminó, guarda `last_assistant_message`; retira las solicitudes pendientes de la sesión (no una retención de instrucciones; con instrucciones por entregar, la sesión sigue trabajando) |
| `SessionEnd` | retira la sesión |

> **Sin verificar con Claude Code real.** Los hooks `http` están escritos según la documentación y probados solo
> con cargas simuladas (`applyClaudeHook` y `POST /hook/claude` en las pruebas del puente). Hay que comprobar a mano
> con una sesión real que Claude Code los acepta con este formato y que los campos coinciden.

## Instalar

Copia el bloque `hooks` de `settings.example.json` a `~/.claude/settings.json` (ajusta la ruta del hook de permisos
si el repo está en otro lado). El `timeout` del hook de permisos es 86400 s (24 h) porque no hay vencimiento. Sin instalador todavía
(Fase 2).

## Prueba manual con dos terminales

1. Terminal 1: `npm run companion -- start`, y abre el simulador en http://127.0.0.1:33340/.
2. Terminal 2: inicia `claude` y pídele algo que requiera permiso (por ejemplo, ejecutar un comando de shell).
3. El permiso aparece en el simulador: `A` aprueba, `B` rechaza y, si la tarjeta lo ofrece, `Y` aprueba y no vuelve a preguntar. Si cierras el simulador, vuelve al terminal.

Sin Claude Code a mano:

- `node packages/bridge/scripts/fake-agent.mjs --command "rm -rf dist"` (una sesión; acepta `--session`, `--title`,
  `--kind`, `--project` para simular varias).
- `node packages/bridge/scripts/demo.mjs`: 2 sesiones de Claude, 1 de Gemini y 1 de Codex, y dos permisos casi
  simultáneos para probar la cola y los modos.
