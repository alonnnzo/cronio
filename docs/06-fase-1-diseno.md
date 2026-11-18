# Fase 1 — Diseño: protocolo v1 y núcleo del puente

Este documento fija las interfaces. Las tareas de implementación se apoyan en él; si algo aquí resulta
imposible o contradictorio, se detiene la tarea y se informa, no se improvisa.

## Reglas generales

- TypeScript estricto, módulos ES, Node ≥ 22. Pruebas con Vitest. Sin frameworks.
- Dependencias permitidas: `zod`, `ws`, `typescript`, `vitest`, `tsx`, `@types/node`, `@types/ws`. Nada más sin
  justificarlo en el informe.
- Criptografía solo con `node:crypto`. Nada casero salvo componer HMAC como se indica.
- Código y comentarios en español neutro; identificadores en inglés.
- Cada tarea corre solo sus propias pruebas (`npx vitest run packages/<paquete>`), no la suite completa.
- Un commit por tarea en la rama `fase-1`, con el mensaje `fase 1: <qué>`.
- Puertos: UDP 33333 (aviso), TCP 33334 (consola, LAN), HTTP 33335 (hooks, solo `127.0.0.1`), HTTP+WS 33340
  (simulador, solo `127.0.0.1`).
- Datos locales del puente en `.companion/` (ignorado por git): `devices.json`, `events.jsonl`.

## Decisiones tomadas tras la Fase 0

- **La consola se conecta al puente** (TCP 33334). El puente emite un aviso UDP cada 2 s por cada interfaz IPv4
  no interna, a la dirección de difusión de esa interfaz.
- **Emparejamiento con código largo, sin criptografía de clave pública en la consola.** El puente genera un
  código de 16 caracteres en base32 Crockford (80 bits), mostrado como `XXXX-XXXX-XXXX-XXXX`. Se escribe una vez
  en la consola. Reemplaza al código de 6 dígitos de la revisión: con 6 dígitos, quien capture el saludo podría
  adivinar el código probando el millón de combinaciones.
- El hook de Claude Code es `PermissionRequest`; ante cualquier fallo no decide y el permiso vuelve al terminal.

## Cambios tras la revisión final de la rama (2026-11-12)

Estas reglas sustituyen a lo que diga el resto del documento donde haya diferencia.

- **Texto de la tarjeta de permiso.** Antes de cortar, el texto se sanea: los caracteres de control, de
  dirección de texto y de ancho cero se muestran como `�`; se quitan las líneas vacías. Si no cabe en 6 líneas,
  la última termina en `… (+N)` con los caracteres que faltan. Un comando de varias líneas o que no cabe entero
  es siempre de riesgo alto.
- **Emparejamiento.** El código ya no se invalida por saludos fallidos (permitía sabotear el emparejamiento
  desde la red). Se limita el ritmo: 1 intento por segundo por IP y 5 por segundo en total. Un dispositivo ya
  emparejado puede volver a emparejarse con un código nuevo.
- **Servidor de la consola.** Máximo 16 conexiones, 4 sin autenticar por IP, y un error al aceptar no detiene el
  puente.
- **Identificadores.** `id`, `agentId`, `requestId`, `selectedAgentId` y `session_id`: máximo 48 caracteres, para
  que la vista más grande posible quepa en una trama.
- **Aprobar.** Tras aparecer una solicitud nueva, aprobar queda bloqueado 500 ms (rechazar no). Vale para el
  simulador y para la consola.

## Paquete `packages/protocol` (`@companion/protocol`)

### Tramas (`framing.ts`)

`[tipo: u8][largo: u16 little endian][contenido]`. Largo máximo del contenido: 8192 bytes.

```ts
export const FrameType = { JSON: 1, AUDIO: 2, PING: 3, PONG: 4 } as const;
export const MAX_PAYLOAD = 8192;
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array; // lanza si excede MAX_PAYLOAD
export class FrameDecoder {
  push(chunk: Uint8Array): { type: number; payload: Uint8Array }[]; // acumula; lanza FrameError si largo > MAX_PAYLOAD
}
```

### Autenticación (`auth.ts`)

- Clave del dispositivo: `K = HKDF-SHA256(ikm = código normalizado (sin guiones, mayúsculas) en ASCII,
  salt = "3dsac-pair-v1", info = deviceId en UTF-8, largo 32)`.
- Saludo, en tramas JSON **sin** etiqueta:
  1. Puente → consola: `{ t: "challenge", v: 1, nonceB }` (16 bytes aleatorios en hex).
  2. Consola → puente: `{ t: "hello", v: 1, deviceId, nonceC, mac }` con
     `mac = hex(HMAC-SHA256(K, "hello" | nonceB | nonceC))` (concatenación de bytes; los nonces en binario).
  3. Puente → consola: `{ t: "welcome", mac }` con `mac = hex(HMAC-SHA256(K, "welcome" | nonceC | nonceB))`, o
     `{ t: "error", code: "auth" }` y cierre.
- Clave de sesión: `Ks = HMAC-SHA256(K, "session" | nonceB | nonceC)`.
- **Protocolo v2 (tráfico cifrado): ver «Auditoría de seguridad (2026-11-17)», punto 5.** Lo que sigue describe la **v1** (en claro + etiqueta), que hoy
  solo se usa con consolas viejas (0.2.9 y anteriores) y en modo «solo actualizar».
- Después del saludo, **todas** las tramas llevan al final una etiqueta de 16 bytes:
  `tag = HMAC-SHA256(Ks, dir | contador u32 LE | tipo u8 | contenido)[0..16]`, con `dir = 0x01` puente→consola y
  `0x02` consola→puente. El contador empieza en 0 y sube de a uno por dirección; no viaja en la trama. Una
  etiqueta inválida cierra la conexión. El largo de la trama incluye la etiqueta.
- Comparaciones con `timingSafeEqual`.

```ts
export function generatePairingCode(): string;              // "XXXX-XXXX-XXXX-XXXX"
export function deriveDeviceKey(code: string, deviceId: string): Buffer;
export function helloMac(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer;
export function welcomeMac(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer;
export function sessionKey(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer;
export class FrameSealer { constructor(ks: Buffer, dir: 1 | 2); seal(type: number, payload: Uint8Array): Uint8Array; }   // devuelve contenido + etiqueta
export class FrameOpener { constructor(ks: Buffer, dir: 1 | 2); open(type: number, sealed: Uint8Array): Uint8Array; }    // lanza AuthError
```

### Mensajes (`messages.ts`, esquemas zod + tipos inferidos)

Puente → consola:

- `{ t: "view", rev: number, view: ViewModel }` — estado completo; la consola solo dibuja el último.
- `{ t: "error", code: string }`

Consola → puente:

- `{ t: "decision", requestId: string, decision: "allow" | "deny" }`
- `{ t: "select", agentId: string }`

`parseBridgeMessage(json: unknown)` y `parseConsoleMessage(json: unknown)` devuelven el mensaje validado o lanzan.

### Modelo de vista (`viewmodel.ts`)

```ts
type AgentKind  = "claude" | "gemini" | "codex" | "cursor" | "hermes";
type AgentState = "idle" | "working" | "ask" | "done" | "error";
interface AgentView   { id: string; kind: AgentKind; name: string; state: AgentState; project: string; model: string; }
interface RequestView { id: string; agentId: string; title: string; lines: string[]; risk: "normal" | "high"; expiresInS: number; }
interface ViewModel   { agents: AgentView[]; selectedAgentId: string | null; request: RequestView | null; status: string;
                        led: "off" | "working" | "ask" | "done" | "error"; }
```

- `lines`: texto ya cortado por el puente, máximo 6 líneas de 38 caracteres (la última termina en `…` si se
  cortó). `title`, `name`, `project`, `model`, `status`: máximo 38 caracteres.
- `agents`: máximo 8.

### Estilo de los puntos (`dots.ts`)

Constante `AGENT_STYLES: Record<AgentKind, { color: string; color2?: string; signature: "sparks" | "twin" | "typing" | "cursor" | "wings" }>`
con los valores del prototipo `art/dots/index.html`.

### Ejemplos (`fixtures/`)

- `messages/*.json`: un ejemplo válido por tipo de mensaje y tres inválidos.
- `handshake.json`: un saludo completo con valores fijos (código, deviceId, nonces) y todos los valores
  intermedios en hex (K, macs, Ks, y dos tramas selladas por dirección). Lo usará el cliente en C para probar su
  implementación; debe generarse con un script reproducible (`fixtures/generate.ts`) y verificarse en las pruebas.

## Paquete `packages/bridge` (`@companion/bridge`)

### Núcleo (sin red; tarea 2)

- `store.ts` — `BridgeStore` (EventEmitter, emite `"change"`):
  - `upsertAgent({ sessionId, kind, project, model? })`, `setAgentState(sessionId, state)`, `removeAgent(sessionId)`.
    `id` del agente = `sessionId`. `done` y `error` vuelven solos a `idle` tras 3 s.
  - `setConsoleConnected(boolean)`, `selectAgent(id)`.
  - `requestPermission({ sessionId, toolName, toolInput, signal?: AbortSignal }): Promise<"allow" | "deny" | "ask">`
    - Sin consola conectada: resuelve `"ask"` de inmediato.
    - Con consola: encola, pone al agente en `ask` y espera `decide()`. Plazo de 45 s (configurable) → `"ask"`. *(Sustituido el 2026-11-12: sin plazo por defecto; ver "Permisos sin vencimiento" en el doc 07. El hook tampoco tiene ya su plazo de 50 s ni el `timeout` de 60 s de la configuración, ahora 86400 s.)*
    - Si `signal` se aborta (el hook cerró): se retira la solicitud sin resolver nada más.
    - Si la consola se desconecta: todas las pendientes resuelven `"ask"`.
    - Al resolver, el agente vuelve a `working`.
  - `decide(requestId, decision)`: aplica una sola vez; ids desconocidos o repetidos se ignoran y devuelve `false`.
  - Solo la primera solicitud de la cola aparece en la vista.
- `events.ts` — registro de eventos en `.companion/events.jsonl` (una línea JSON por evento con `ts`, `type`,
  datos). Tipos: `agent_seen`, `state`, `request`, `decision`, `timeout`, `console_connected`,
  `console_disconnected`. La ruta se inyecta para poder probar en una carpeta temporal.
- `risk.ts` — `classifyRisk(toolName, toolInput): "normal" | "high"`. Alto para: `rm -rf`/`rm -r`, `del /s`,
  `rmdir /s`, `git push --force`/`-f`, `git reset --hard`, `git clean -f`, `format`, `mkfs`, `dd of=`,
  `shutdown`, `DROP TABLE`/`DROP DATABASE`, `chmod -R 777`, y `curl`/`wget` con tubería a `sh`/`bash`.
- `text.ts` — `wrapLines(text, width = 38, maxLines = 6)` y `clip(text, max = 38)`.
- `view.ts` — `buildView(store): ViewModel`. Para una solicitud: `title` = `"<nombre> pide permiso"`;
  `lines` = resumen de la herramienta (para `Bash`, el comando; para `Write`/`Edit`, `"<herramienta> <ruta>"`; en
  otro caso `"<herramienta> " + JSON` recortado). `led`: `ask` si hay solicitud; si no `error` > `done` >
  `working` > `off` según los agentes. `status`: `"N de M agentes activos"` o `"Todo tranquilo"`.

### Transportes (tarea 3)

- `http-api.ts` — `127.0.0.1:33335`:
  - `POST /permission` con `{ session_id, cwd, tool_name, tool_input }` → `{ decision: "allow" | "deny" | "ask" }`.
    Registra al agente si no existe (`kind: "claude"`, `project` = último tramo de `cwd`). Si el cliente cierra
    la conexión, aborta la solicitud.
  - `POST /event` con `{ session_id, cwd, kind, event: "start" | "working" | "idle" | "done" | "error" | "end", model? }`.
  - `GET /health` → `{ ok: true, console: boolean, pending: number }`.
- `console-server.ts` — TCP `0.0.0.0:33334`. Saludo y sellado según `auth.ts`. Una consola a la vez (una nueva
  autenticada reemplaza a la anterior). Envía `view` en cada `"change"` (con `rev` creciente y agrupando cambios
  de un mismo instante). Responde `PING` con `PONG`. Cierra tras 15 s sin recibir nada.
- `ws-server.ts` — HTTP + WebSocket en `127.0.0.1:33340`, sin autenticación (solo local). Sirve los archivos
  estáticos del simulador y por WebSocket intercambia los mismos mensajes JSON sin sellar. Un simulador conectado
  cuenta como consola conectada.
- `beacon.ts` — aviso UDP `{ "service": "3ds-agent-companion", "v": 1, "port": 33334, "name": <hostname> }`.
- `pairing.ts` + `devices.ts` — `.companion/devices.json` con `{ deviceId, name, keyHex, pairedAt }`. Como la
  clave depende del `deviceId`, el emparejamiento guarda el código pendiente (válido 5 min) y la clave se deriva
  y guarda en el primer saludo correcto de un `deviceId` desconocido.
- `main.ts` + `cli.ts` — `companion start` (arranca todo), `companion pair` (pide al puente en marcha un código
  nuevo por `POST /pair` en la API local y lo muestra), `companion devices`.
- `scripts/fake-agent.mjs` — agente simulado: registra una sesión, pide un permiso y muestra la decisión.
- `test/fake-console.ts` — cliente de consola en TypeScript (saludo, sellado, recibe vistas, envía decisiones),
  usado en las pruebas de integración y reutilizable como referencia del cliente en C.

Prueba de integración obligatoria (tarea 3), todo en un proceso con puertos efímeros: emparejar → consola falsa
conecta → agente falso pide permiso → la vista muestra la solicitud → la consola aprueba → el agente recibe
`allow`. Variantes: rechazo; plazo vencido → `ask` (solo con un plazo configurado, ya no por defecto); sin consola → `ask` inmediato; consola con clave incorrecta
rechazada; trama repetida (misma etiqueta) cierra la conexión; el hook aborta → la solicitud desaparece de la vista.

## Paquete `packages/simulator` (tarea 4)

Página estática sin paso de compilación (HTML + módulos JS), servida por el puente en `http://127.0.0.1:33340/`.

- Pantalla superior 400×240 (canvas): los puntos de `art/dots/index.html`, dibujados desde el `ViewModel`
  recibido. El código de dibujo se separa en un módulo (`dots.js`) sin dependencias del DOM más allá del
  contexto 2D, porque es la referencia para el cliente en C.
- Pantalla inferior 320×240: lista de agentes y, si hay solicitud, la tarjeta con `title`, `lines`, cuenta
  regresiva y botones A / B. Riesgo alto: hay que mantener A un segundo.
- Teclado: `A` aprueba, `B` rechaza, flechas arriba/abajo seleccionan agente.
- Indicador del LED según `view.led`.
- Reconexión automática del WebSocket.

## Paquete `packages/hooks` (tarea 4)

`permission-hook.mjs` (el de `spikes/hooks-claude-code/`, apuntando a `http://127.0.0.1:33335`) y
`settings.example.json`. Sin instalador todavía (Fase 2).

## Salida de la fase

Con `companion start` en marcha y el simulador abierto: `node packages/bridge/scripts/fake-agent.mjs` hace
aparecer el permiso en el simulador; A lo aprueba y el script lo informa. Y los casos de la prueba de integración
pasan.

## Auditoría de seguridad (2026-11-17)

Cuatro arreglos, un commit por punto, en este orden de prioridad.

### 1. El `.cia` de la actualización se verifica antes de instalarlo (alta)

- **Protocolo**: `update` pasa a `{ version, url, size, sha256 }` (`size` entero de 1 a 8 MiB, `sha256` hex en minúsculas de 64 caracteres).
- **Puente** (`update.ts`): lee el `.cia` a memoria (`loadCia`, recarga si cambia el mtime o el tamaño), calcula tamaño y hash y **sirve esos mismos
  bytes** desde memoria. `updateFor` no ofrece nada si no puede leer el archivo.
- **Consola**: `core/view.c` exige `size` (8192 a 8 MiB) y `sha256` (64 hex); si faltan o no valen la vista se acepta pero sin oferta
  (`has_update = 0`: no se instala nada que no se pueda verificar). `updater.c` exige el mismo host del puente y `Content-Length == size`,
  y verifica el SHA-256 en tiempo constante antes de `amInit`. `updflow.c` ya no llama a `AM_DeleteTitle` ni reintenta.
- **Compatibilidad**: una consola 0.2.9 o anterior ignora `size`/`sha256` (su parser lee solo los campos que conoce) y sigue actualizándose como
  antes, sin verificar: la verificación solo la hacen las consolas con esta versión o una posterior.

### 2. Endurecer el puente (baja)

- **`deviceId` del saludo**: `^[A-Za-z0-9_-]{1,64}$` (la consola genera `3ds-` + 8 hex). Cualquier otro id cierra la conexión al validar el esquema,
  antes de llegar a los registros o a `devices.json`.
- **Registros con datos de la red**: todo lo que llega de la red va por `safeLog` (`JSON.stringify` del texto cortado a 80 o 200 caracteres:
  entre comillas, escapado y sin saltos de línea), incluido el mensaje de error de `JSON.parse`/zod, que puede citar un trozo de lo recibido.
- **«Saludo rechazado»**: como mucho un registro por IP cada 10 s (igual para «intento de emparejamiento limitado»).
- **Rotación por tamaño**: `events.jsonl` (`EventLog`, en el puente) y `bridge.log` (`RegistroRotativo`, en el programa del PC) pasan a `.1`
  al llegar a 5 MB, reemplazando el `.1` anterior: quedan entre 5 y 10 MB de historia como máximo.
- **Cupos de conexión**: además del tope por IP (4), las conexiones sin autenticar tienen un tope total de 8 (`MAX_UNAUTHENTICATED`) dentro de las
  16 (`MAX_CONNECTIONS`): al menos 8 plazas quedan para las autenticadas, que nunca se desplazan. Con las 8 llenas, la conexión nueva desplaza a la sin
  autenticar más antigua (no se rechaza): quien ocupe plazas sin hablar no deja fuera a la consola de verdad. El tope de Node (`maxConnections`)
  queda al doble solo como red de seguridad.

### 3. Simulador en el programa instalado (media)

El WebSocket del simulador (127.0.0.1:33340) permite `decision`, `instruct` y `answer` a cualquier proceso local sin Origin. En el build
empaquetado el programa del PC lanza el puente con `COMPANION_SIMULATOR=0` (`comandoPuente` en `installer/src/paths.ts`) y el puente **no abre ese
puerto** (`startBridge` acepta también la opción `simulator`, que manda sobre el entorno). En desarrollo (`npm run companion -- start`) sigue como
siempre. Nada del programa del PC depende del simulador: `/health.simulator` ya significaba «hay un simulador conectado» (`counter`), así que sin
simulador es siempre `false`; el instalador solo usa `/health` para el PID, la versión y el estado de la consola. `Bridge.ports.ws` pasa a ser
opcional.

### 4. Token local para la API (media)

- **Generación**: al arrancar, el puente genera 32 bytes al azar (64 hex), nuevos en cada arranque, y los guarda en `<carpeta de datos>/api-token` y en una
  copia en la carpeta de configuración de la app (`%APPDATA%/agent-companion/api-token`, o `AGENT_COMPANION_CONFIG_DIR`; la misma de `carpetas.json`, que es
  donde el hook ya mira). Se escribe a un temporal y se renombra (nadie lo lee a medias), con permisos 0600, y **antes** de abrir ningún puerto. `startBridge`
  acepta `configDir` para fijar o desactivar la copia (las pruebas usan carpetas temporales) y expone `apiToken`.
- **Dónde se exige** (cabecera `X-Cronio-Token`, comparación en tiempo constante, `401` sin leer el cuerpo): `/pair`, `/permission`, `/question`, `/stop`,
  `/shutdown` (además de la cabecera `X-Cronio: shutdown` de siempre) y `/event`. En el WebSocket del simulador (solo cuando está activo, o sea en
  desarrollo): `?token=` en la dirección, `401` si falta o es malo, con o sin Origin; la página `.html` del simulador recibe `window.COMPANION_API_TOKEN` inyectado
  al servirse (`cache-control: no-store`) y `app.js` lo manda. `/health` (solo lectura) no lo lleva.
- **`/hook/claude` queda SIN token** (decisión): los hooks de tipo `http` de Claude Code no pueden leer archivos y el token cambia en cada arranque, así que
  no hay cómo ponérselo (en `settings.example.json` solo llevan `url` y `timeout`). Es aceptable porque esa entrada es solo de eventos informativos: responde siempre
  200 vacío y nunca aprueba ni rechaza (a lo sumo `resolveElsewhere`: retira solicitudes dejándolas en `ask`, es decir, para el PC; una prueba lo comprueba).
  Todo lo que decide algo va por `permission-hook.mjs`, que sí lee el archivo y manda el token.
- **Hooks**: `permission-hook.mjs` lee `<carpetaDatos>/api-token` en cada llamada y lo manda. Sin archivo o con basura no contacta al puente; ante 401 o cualquier
  respuesta no 2xx no imprime nada y Claude Code pregunta en el PC (fallo cerrado).
- **Programa del PC**: `/pair`, `/shutdown` y los `/event` de prueba mandan el token leyéndolo del mismo archivo (`installer/src/token-api.ts`). `companion pair`
  y los scripts `fake-agent.mjs` y `demo.mjs` también.
- **Compatibilidad con hooks ya instalados**: las copias de `%APPDATA%/agent-companion/hooks/` anteriores no mandan el token. El puente les responde 401 y el hook no imprime
  nada: **los permisos, preguntas e instrucciones se contestan en el PC hasta que se actualicen; nunca se aprueban solos**. Antes de este cambio el programa del PC
  NO detectaba una copia vieja del hook (solo miraba que estuvieran los eventos y que el script existiera). Ahora `revisarHooks` compara el script al que apunta el
  settings con el del programa (y `carpetas.mjs` de al lado, sin contar CRLF/LF): si difiere, `ok` es falso, el paso 2 y la tarjeta de Claude Code de Inicio avisan
  («el archivo de permisos es de una versión anterior… hasta que lo actualices, los permisos se preguntan en el PC») y el botón pasa a «Actualizar», que vuelve a copiar
  los archivos. Un settings que apunta directamente al script del repo (desarrollo) no cuenta.
- **Alcance**: el token protege de páginas web, de otros usuarios del PC y de procesos que no conocen la carpeta de configuración. No protege de código que corra con el
  mismo usuario (puede leer el archivo, igual que la clave de la consola o `settings.json` de Claude Code).

### 5. Tráfico cifrado entre el puente y la consola: protocolo v2 (alta)

Hasta la v1 cada trama era `JSON en claro | etiqueta HMAC`: autenticada, pero legible por cualquiera en la misma Wi-Fi (comandos, mensajes de Claude, lo que
se escribe). La v2 cifra.

**Negociación.** La consola anuncia la versión en `hello.v` (la nueva anuncia 2; la 0.2.9 y anteriores, 1). El `v` del `challenge` es el del saludo base y **sigue
en 1** (así la 0.2.9 lo acepta). La versión queda autenticada: en la v2 el MAC del hello, el del welcome y la clave de sesión llevan el byte de versión, y una
v1 no puede hacerse pasar por v2 ni al revés (etiquetas distintas: `hello`/`hello2`, `welcome`/`welcome2`, `session`/`session2`). Si alguien en el camino cambia
`v` de 2 a 1 para forzar el modo sin cifrado, el puente calcula el MAC de v1, no coincide con el de v2 que firmó la consola y el saludo falla (`error auth`); lo mismo
si la consola, ya en v2, recibe un welcome calculado a la manera de la v1. No hay vuelta atrás: una consola v2 nunca baja a la v1.

**Saludo v2** (K = clave del dispositivo, igual que en la v1; `lp(x)` = largo u8 + bytes):

- `hello.mac = HMAC-SHA256(K, "hello2" | nonceB | nonceC | 0x02 | lp(deviceId) | lp(appVersion) | install)`, con `appVersion` ausente = cadena vacía e
  `install` = 0 (ausente), 1 (`cia`) o 2 (`3dsx`). **Entran `appVersion` e `install`**, que en la v1 quedaban fuera del MAC. En la v2 el puente exige que sean
  exactamente `appVersion` (versión válida) o nada, e `install` = `cia` / `3dsx` o nada; otra cosa cierra la conexión.
- `welcome.mac = HMAC-SHA256(K, "welcome2" | nonceC | nonceB | 0x02)`.
- `Ks = HMAC-SHA256(K, "session2" | nonceB | nonceC | 0x02)`.

**Claves por uso y por dirección** (al estilo HKDF-Expand, un bloque: `T(1) = HMAC-SHA256(Ks, info | 0x01)`, con `info = "3dsac-v2 " + etiqueta`):
`enc-b2c`, `mac-b2c` (puente → consola, `dir = 1`) y `enc-c2b`, `mac-c2b` (consola → puente, `dir = 2`). Cuatro claves de 32 bytes, todas distintas entre sí.

**Trama sellada (encrypt-then-MAC):**

- `cifrado = ChaCha20(enc, nonce, bloque inicial 0) XOR contenido` (RFC 8439). `nonce` = 12 bytes: el **contador de tramas de esa dirección** (u32 little endian)
  y 8 ceros. El contador ya existía, empieza en 0, sube de a uno por dirección y no viaja; como cada dirección tiene su propia clave de cifrado, el par
  (clave, nonce) no se repite. El contador **no envuelve**: la trama con el contador 2^32 - 1 no se usa (ni se sella ni se abre; hay que cerrar la sesión mucho antes).
- `etiqueta = HMAC-SHA256(mac, dir | contador u32 LE | tipo | cifrado)[0..16)`: cubre el **texto cifrado**, el tipo, la dirección y el contador. Se verifica
  **antes** de descifrar; una etiqueta inválida cierra la conexión y el contador no avanza. El largo de la trama sigue incluyendo la etiqueta (16 bytes).
- En Node: `crypto.createCipheriv('chacha20', key, iv)` con `iv` de 16 bytes = contador de bloque (u32 LE, 0) + nonce de 12 (la prueba de `packages/protocol`
  lo verifica contra los vectores 2.3.2 y 2.4.2 del RFC). En C: `source/core/chacha20.{h,c}`, probada con los mismos vectores (`tests-host/test_chacha20.c`).
- API: `FrameSealer`/`FrameOpener` reciben la versión (`new FrameSealer(ks, dir, 2)`); `helloMacV2`, `welcomeMacV2`, `sessionKeyV2` y `subKeyV2` en `auth.ts`. En C, `hs_hello_mac`
  (ahora con id, `appVersion` e `install`), `hs_welcome_mac`, `hs_session_key` y `frame_sealer_init`/`frame_opener_init` son los de la v2: **el cliente en C solo habla la v2**.

**Consolas v1: modo «solo actualizar»** (la app instalada hoy, 0.2.9, solo habla v1 y se actualiza desde el puente; hace falta que pueda dar ese salto):

- El saludo v1 se acepta (autenticado como siempre), pero la sesión queda limitada. Por v1 **nunca viaja contenido**: el puente manda **una sola vista mínima**
  (`legacy-view.ts`): sin sesiones, sin solicitud, sin detalle, sin avisos ni ajustes, cara con «Actualiza Cronio / para seguir» y, si tiene un `.cia` más nuevo, `update`.
  Esa vista pasa el parser de la 0.2.9 (se comprobó contra `git show 8fc2ba1:client-3ds/source/core/view.c`: exige `sessions`, `request`, `pendingCount`, `mode`, `face`, `detail` y `led`;
  `update` solo pide `version` y `url`, e ignora `size` y `sha256`) y muestra la tarjeta de actualización porque `update_card_visible` (`logic/update.c`) pide un `update` más nuevo que la versión
  instalada, sin solicitud ni aviso.
- Del lado del puente una consola v1 **no** cuenta como consola conectada (no cambia el estado de la cara ni retiene permisos: se contestan en el PC), **no** reemplaza a una consola v2 y no se
  suscribe a la vista. De lo que mande **se ignora todo** (`decision`, `answer`, `instruct`, `read`, `focus`, `skip`, `mode`, `ack`, ajustes...) y queda en el registro (una línea por tipo y conexión).
  Solo se atienden los `hold` (el silencio anunciado no cierra la conexión) y los `ping`. Así por v1 no sale contenido y nadie puede aprobar nada.
- **Ojo:** la 0.2.9 no verifica el `.cia` (ignora `size` y `sha256`) y la descarga es HTTP en claro: ese salto sigue siendo el último sin verificar y es inevitable. La 0.3 en adelante
  habla v2 y verifica.
- Un puente anterior (sin v2) rechaza el `hello` v2 (`v` solo valía 1) y cierra la conexión; el puente y la app se actualizan en ese orden (el programa del PC primero).
- El simulador web usa el WebSocket local, no este canal: no cambia.

**Pruebas.** `packages/protocol/test` (vectores del RFC, MACs a mano, ida y vuelta, trama alterada bit a bit, contador, direcciones, contador agotado, fixtures `handshake.json` sección `v2`),
`packages/bridge/test/protocol-v2.test.ts` (nada legible en el cable, trama alterada, repetida, versión alterada en cualquiera de los dos sentidos, `appVersion`/`install` alterados, consola v1 que solo recibe la vista
mínima y cuyas decisiones se ignoran) y `client-3ds/tests-host` (`test_chacha20`, `test_frame`, `test_handshake`, `test_session`, con los vectores v2 generados desde TypeScript por `gen-view-fixtures.ts`).
