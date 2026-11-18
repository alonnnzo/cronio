# Fase 1b — La pantalla es la cara, y varias sesiones por agente

Decidido con el usuario el 2026-11-12. Sustituye, donde haya diferencia, a `06-fase-1-diseno.md` (modelo de vista,
mensajes de la consola, pantalla superior e inferior del simulador). Lo demás de la Fase 1 sigue igual: tramas,
saludo, sellado, emparejamiento, transportes, reglas de seguridad y de saneado de texto.

Referencia visual y de comportamiento: `art/cara/index.html` (prototipo aprobado).

## Decisiones

1. **Pantalla superior = una sola cara.** Toda la pantalla se pinta del color del agente del que habla, con ojos
   grandes y boca, y avisa con un globo de texto. No hay fila de puntos arriba.
2. **Pantalla inferior = agentes → sesiones → detalle.** Los cinco agentes como puntos con contador; al elegir
   uno se ven todas sus sesiones abiertas; al elegir una sesión se ve su detalle y, si pide permiso, la tarjeta.
3. **Varias sesiones del mismo agente** son lo normal. Cada sesión tiene su título, proyecto, modelo, estado,
   actividad y último mensaje.
4. **Varios permisos a la vez: dos modos, elegibles en la consola.**
   - `queue` ("en fila"): el puente enfoca el permiso más antiguo y la pantalla inferior salta sola a su tarjeta,
     con contador "1 de 3". Se puede saltar al siguiente sin responder.
   - `manual` ("elijo yo"): no se enfoca ninguno solo. La cara avisa cuántos hay y el usuario entra a la sesión
     que quiere responder.
5. **Se aprueba ahí mismo**: en modo `queue` la tarjeta aparece sin navegar.
6. **Nombre de la sesión:** el título que le pone Claude Code; si no hay, el proyecto, y si se repite se numera
   (`mi-portal`, `mi-portal 2`, por orden de llegada).
7. **Sesiones abandonadas:** una sesión sin eventos durante 30 minutos se retira (configurable).
8. **Tope:** 12 sesiones en la vista (las más recientes por actividad; las que piden permiso nunca se descartan).

## Reglas añadidas tras la revisión de estos cambios (2026-11-12)

- **Aprobar es un gesto ligado a una solicitud.** Solo se aprueba si la solicitud que estaba en pantalla al
  empezar a pulsar es la misma al soltar, si ya llevaba 500 ms visible cuando empezó la pulsación y, en riesgo
  alto, si se mantuvo 1 s sobre esa misma solicitud. Si la solicitud en pantalla cambia a mitad del gesto, el
  gesto se cancela. Vale para el simulador y para la consola.
- **Nombres de sesión únicos y estables.** Dos sesiones del mismo agente nunca muestran el mismo nombre, venga
  del título o del proyecto, y el nombre de una sesión no cambia porque otra se retire.
- **Tope de 200 sesiones** en el puente; la vista sigue mostrando 12.
- **Límites conocidos:**
  - Con más de 12 sesiones pidiendo permiso a la vez, las que sobran no aparecen en la lista hasta que se
    resuelvan otras (sus permisos siguen en la cola).
  - El enfoque de sesión es uno solo para todos los clientes conectados. Con el simulador y la consola abiertos
    a la vez, lo que uno abre se lo cierra al otro. No afecta a qué solicitud se decide.

## Protocolo

### Tamaño de trama

`MAX_PAYLOAD` sube de 8192 a **16384**. La vista más grande posible debe caber en `MAX_PAYLOAD - 16` con margen;
la prueba de tamaño se actualiza para la vista nueva. El formato de trama y el saludo no cambian
(`handshake.json` no debe cambiar).

### Identificadores

`id` de sesión y de solicitud: 1 a 48 caracteres de `[A-Za-z0-9_.:-]`. La API rechaza con 400 un `session_id`
que no cumpla.

### Modelo de vista (`viewmodel.ts`)

```ts
type AgentKind  = "claude" | "gemini" | "codex" | "cursor" | "hermes";
type AgentState = "idle" | "working" | "ask" | "done" | "error";
type Mood       = "idle" | "working" | "ask" | "done" | "error";
type PermissionMode = "queue" | "manual";

interface SessionView { id: string; kind: AgentKind; title: string; project: string; model: string;
                        state: AgentState; activity: string; }
interface RequestView { id: string; sessionId: string; title: string; lines: string[]; risk: "normal" | "high";
                        expiresInS: number; position: number; total: number;
                        always?: string; }   // "position de total", desde 1; expiresInS 0 = sin límite; always: ver abajo
interface FaceView    { kind: AgentKind | null; mood: Mood; lines: string[]; }   // 1 o 2 líneas
interface DetailView  { sessionId: string; lastMessage: string[]; }              // hasta 4 líneas
interface ViewModel   { sessions: SessionView[]; request: RequestView | null; pendingCount: number;
                        mode: PermissionMode; face: FaceView; detail: DetailView | null;
                        led: "off" | "working" | "ask" | "done" | "error"; }
```

- Textos de una línea (`title`, `project`, `model`, `activity`, cada elemento de `lines` y de `lastMessage`):
  máximo 38 caracteres, ya saneados y cortados por el puente. `request.lines`: máximo 6. `face.lines`: 1 o 2.
- `sessions`: máximo 12. Desaparecen `agents`, `selectedAgentId` y `status`.
- `request` es el permiso **enfocado** (ver más abajo), o `null`. `pendingCount` es el total de pendientes.
- `request.always` (opcional): solo está si el agente ofrece "sí, no volver a preguntar" (Claude Code manda
  `permission_suggestions`). Es una etiqueta de 1 a 38 caracteres, ya recortada, de lo que quedaría permitido
  (`Bash(npm test)`, `aceptar ediciones en esta sesión`, `acceso a <dir>`). Sin el campo la consola no ofrece la tercera opción.

### Mensajes de la consola al puente (`messages.ts`)

- `{ t: "decision", requestId, decision: "allow" | "allow_always" | "deny" }` — `allow_always` aprueba y aplica lo que el
  agente sugirió (el puente responde al hook `allow` con `updatedPermissions`); sobre una solicitud sin `always` vale como `allow`.
- `{ t: "focus", sessionId: string | null }` — la consola abrió el detalle de una sesión (o lo cerró con `null`).
- `{ t: "skip" }` — en modo `queue`, pasar al siguiente permiso pendiente sin responder.
- `{ t: "mode", mode: "queue" | "manual" }`

Desaparece `select`. Puente → consola no cambia (`view`, `error`).

## Puente

### Sesiones (`store.ts`)

- `upsertSession({ sessionId, kind, project, model?, title? })`, `setSessionState`, `setActivity(sessionId, text)`,
  `setLastMessage(sessionId, text)`, `removeSession`. Cada llamada actualiza `lastSeen`.
- Barrido cada minuto: se retiran las sesiones con `lastSeen` más antiguo que 30 min y sin permiso pendiente.
- Nombre mostrado: `title` si existe; si no, `project`, numerado si otra sesión del mismo `kind` muestra el
  mismo nombre.
- Renombrar la API pública de "agent" a "session" es parte de la tarea; no se mantiene compatibilidad.

### Permisos, enfoque y modos

- Varias solicitudes pendientes a la vez, en orden de llegada. Reglas de plazo, cancelación, desconexión e
  idempotencia: las de la Fase 1, sin cambios (salvo el plazo de 45 s, sustituido: ver "Permisos sin vencimiento").
- `mode` vive en el puente (lo ven igual el simulador y la consola) y se guarda en `.companion/settings.json`.
  Por defecto `queue`.
- **Enfoque** (qué solicitud va en `view.request`):
  - Modo `queue`: si la consola tiene abierta una sesión con solicitud pendiente (`focus`), esa; si no, la más
    antigua. `skip` mueve el enfoque a la siguiente pendiente (circular) y anula el `focus` de sesión. Cuando la
    enfocada se resuelve, vuelve a la más antigua.
  - Modo `manual`: solo hay enfoque si la sesión abierta con `focus` tiene solicitud pendiente; si no, `null`.
- `position` / `total`: lugar de la enfocada en la cola, por antigüedad.
- `decide` solo acepta el `requestId` de una solicitud pendiente (enfocada o no); el resto se ignora.
- `detail`: si hay `focus` de sesión, `{ sessionId, lastMessage }` con el último mensaje cortado en 4 líneas.

### La cara (`face.ts`)

El puente decide qué dice la cara; los clientes solo la dibujan. Prioridad:

1. **Aviso reciente** (dura 5 s): al terminar una sesión (`done`), al fallar (`error`), al decidir un permiso
   ("Permiso aprobado" / "Permiso rechazado") y cuando una sesión empieza a trabajar.
2. **Permisos pendientes:** `mood: "ask"`, color del agente de la solicitud enfocada (o de la más antigua).
   Una pendiente: `["<Agente> necesita permiso", "<resumen del comando> · <sesión>"]`. Varias:
   `["<N> permisos pendientes", "<Agente>, <Agente>…"]` en modo `manual`, y la enfocada con
   `"(1 de N)"` en modo `queue`.
3. **Ambiente:** si hay sesiones trabajando, rota entre ellas cada 6 s:
   `["<Agente> en <sesión>", "<actividad>"]`, `mood: "working"`. Si no hay ninguna:
   `{ kind: null, mood: "idle", lines: ["Todo tranquilo"] }`.

Los textos exactos de los avisos son los del prototipo. Todas las líneas pasan por `clip` (38). Los
temporizadores de aviso y de rotación usan `unref()` y solo emiten `change` cuando la cara cambia de verdad.
`led` se deriva de `face.mood` (`idle` → `off`).

### Adaptador de Claude Code (`adapters/claude-code.ts`)

`POST /hook/claude` en la API local recibe **el JSON del hook tal cual** y lo traduce. Responde siempre `200`
con cuerpo vacío (nunca decide nada) y nunca falla por un campo inesperado.

| `hook_event_name` | Efecto |
| :--- | :--- |
| `SessionStart` | `upsertSession` con `model` y `session_title` si vienen |
| `UserPromptSubmit` | estado `working`, actividad "Pensando" |
| `PreToolUse` | estado `working` y actividad según la herramienta (tabla de abajo) |
| `Notification` con `notification_type: "idle_prompt"` | estado `idle`, actividad "Esperando instrucciones" |
| `Stop` | estado `done`, `setLastMessage(last_assistant_message)`, actividad "Esperando instrucciones" |
| `SessionEnd` | `removeSession` |
| cualquier otro | solo actualiza `lastSeen` |

Si la sesión no existe, se crea (`kind: "claude"`, `project` = último tramo de `cwd`).

Actividad por herramienta (el nombre de archivo es el último tramo de la ruta):
`Edit`/`Write`/`MultiEdit`/`NotebookEdit` → "Editando <archivo>"; `Read` → "Leyendo <archivo>";
`Bash`/`PowerShell` → "Ejecutando <comando>"; `Grep`/`Glob` → "Buscando en el proyecto";
`WebFetch`/`WebSearch` → "Buscando en la web"; `Agent`/`Task` → "Coordinando subagentes";
herramientas `mcp__*` → "Usando <servidor>"; otras → "Usando <herramienta>".

`POST /permission` y `POST /event` siguen existiendo (los usan el hook de permisos, el agente falso y los
demás agentes); `/event` acepta además `title`, `activity` y `last_message` opcionales.

`packages/hooks/settings.example.json` registra, además del hook de permisos, los eventos de la tabla como hooks
de tipo `http` hacia `http://127.0.0.1:33335/hook/claude` con `timeout` 2. Queda **sin verificar con Claude Code
real** hasta que se pruebe a mano.

## Simulador

- `face.js` reemplaza a `dots.js` como módulo de dibujo puro: `drawFace(ctx, face, timeMs, localState)`, sin DOM
  ni red, con las constantes de movimiento nombradas (referencia para el cliente en C). Comportamiento por
  `mood` y transición de color como en el prototipo. El globo muestra `face.lines`.
- Pantalla inferior con tres niveles (estado local del cliente): agentes → sesiones del agente → detalle de la
  sesión. Entrar al detalle envía `focus`; salir envía `focus` con `null`.
- Si `view.request` no es `null`, la tarjeta de permiso aparece sobre el nivel actual (en modo `queue` esto
  ocurre solo; en `manual`, al entrar a la sesión). Muestra a qué sesión pertenece y `position de total`.
- Controles: `A` aprobar (con las reglas de 500 ms y de mantener 1 s en riesgo alto), `B` rechazar si hay
  tarjeta y volver si no, flechas para moverse, `Enter` para entrar, `L`/`R` para saltar permiso (`skip`),
  `M` (o el botón en pantalla) para cambiar de modo. Todo también con clic o toque.
- Nada desborda los 320×240; las listas largas se desplazan.

## Permisos sin vencimiento (2026-11-12)

Sustituye al plazo de 45 s del puente, al plazo propio de 50 s del hook (`HOOK_DEADLINE`) y al `timeout` de 60 s de
`settings.example.json`. Un permiso ya no vence por tiempo: se queda en la cola hasta que se responde en la consola o
el simulador, o hasta que se resuelve en la terminal del agente.

- **Plazo configurable, sin límite por defecto.** `requestTimeoutMs` (opción del puente y del store): 0 o ausente =
  sin límite; mayor que 0 = el plazo de antes (vence con `ask`). `RequestView.expiresInS` vale **0 cuando no hay
  límite**; el simulador y el cliente 3DS no muestran cuenta atrás ni tratan la solicitud como vencida. Con plazo
  configurado, `expiresInS` es al menos 1 mientras la solicitud siga pendiente. `fixtures/handshake.json` no cambia.
- **Hook sin plazo propio.** `permission-hook.mjs` espera lo que tarde el puente (usa `node:http`, porque `fetch`
  cortaría a los 5 min). Sigue siendo a prueba de fallos: si no conecta con el puente en 5 s (`HOOK_CONNECT_TIMEOUT`),
  o hay cualquier error, sale sin decisión de inmediato. El `timeout` del hook en settings es 86400 s.
- **Una solicitud pendiente se retira** (resultado `ask`, sin decisión) cuando:
  1. se cierra la conexión HTTP de `/permission` del hook (si el hook muere, sale de la cola de inmediato);
  2. llega por `/hook/claude` un evento de la misma `session_id` que demuestra que se resolvió:
     - `Stop`, `UserPromptSubmit` y `SessionEnd` retiran todas las solicitudes de la sesión;
     - `PostToolUse` y `PostToolUseFailure` (nuevos en el adaptador) retiran **solo** las que coinciden en
       `tool_name` e input (comparación sin importar el orden de las claves); sin coincidencia, o sin `tool_name` ni
       `tool_input`, no retiran nada;
     - `PreToolUse` no retira nada: con herramientas en paralelo o subagentes que comparten `session_id`, el evento
       de otra herramienta no prueba que un permiso pendiente se haya resuelto (retirarlo haría decir a la cara
       "Respondido en el PC" sin ser cierto);
  3. el hook comprueba que su proceso padre sigue vivo (ver "Vigilancia del padre" abajo) y, si no, cierra la
     conexión (caso 1);
  4. `POST /event` (otros agentes) acepta `cancel_pending: true` para retirar las solicitudes pendientes de la sesión.
- **Vigilancia del padre.** Si Claude Code muere sin `SessionEnd`, en Windows el proceso del hook puede sobrevivir con
  la conexión abierta y, sin plazo, la solicitud quedaría en la cola para siempre. Cada ~2 s (temporizador `unref`) el
  hook comprueba con `process.kill(process.ppid, 0)` que el padre existe (`EPERM` cuenta como vivo); si ya no, destruye
  la petición y sale con 0 sin decisión, y el puente retira la solicitud por el cierre de la conexión. No es un
  vencimiento por tiempo: solo depende de que el padre siga vivo. Variables `HOOK_WATCH_PID` (pid a vigilar; `0`
  desactiva) y `HOOK_WATCH_INTERVAL` (ms) para pruebas.
- **Aviso en la cara.** Al retirarse por 2 o 4 (`answered_elsewhere`), la cara muestra 5 s "Respondido en el PC"
  (mood `working`, segunda línea "<agente> sigue en <sesión>"). Si se retira por el cierre de la conexión del hook
  (`aborted`: pudo ser que el usuario interrumpiera al agente) el aviso es neutro: "Permiso retirado" (segunda línea:
  el nombre de la sesión). Una desconexión de la consola o el fin de la sesión retiran sin aviso.
- **Sin verificar con Claude Code real.** No está documentado si Claude Code muestra el diálogo de permiso en la
  terminal mientras el hook `PermissionRequest` sigue corriendo. Si el diálogo no aparece hasta que el hook termina, la
  terminal quedaría esperando a la consola (sin forma de resolverlo allí). Hay que comprobarlo a mano; hasta entonces
  este diseño es una hipótesis. Tampoco se ha comprobado que `PostToolUse`/`PostToolUseFailure` lleguen con
  `tool_input` igual al del `PermissionRequest`.
