# Fase 2 — Diseño: cliente para la Nintendo 3DS

Objetivo de la fase: aprobar un permiso real con el botón A en la consola. El puente, el protocolo y el
simulador ya existen (`06` y `07`); este documento fija cómo se construye el cliente en C.

## Lo que se sabe del hardware (Fase 0, New 3DS XL)

- `citro2d` dibuja bien las dos pantallas. El LED se maneja con `mcuHwcInit` / `MCUHWC_SetInfoLedPattern`.
- El aviso UDP del puente llega a la consola (puerto 33333) y la consola puede conectarse al PC por TCP.
- Después del reposo los sockets viejos no sirven y crear uno de escucha falla: la consola es **cliente** y, al
  despertar, descarta todo y se reconecta. Conviene reiniciar el servicio de red (`socExit` / `socInit`).
- Latencia medida de unos 85 ms atendiendo la red una vez por cuadro. Es suficiente; no se usa hilo de red.
- Compilación: desde el bash de devkitPro, con `DEVKITPRO=/opt/devkitpro` y `DEVKITARM=/opt/devkitpro/devkitARM`
  (ver `spikes/hola-3ds` y `spikes/red-3ds`, que son la referencia de Makefile y de uso de sockets y LED).
- En ese mismo bash hay `gcc` nativo para las pruebas en el PC.

## Reglas generales

- C99. Sin dependencias externas: no hay cJSON ni mbedTLS instalados y no se descarga nada. SHA-256, HMAC, HKDF
  y el lector de JSON se escriben en el proyecto y se prueban contra los ejemplos del protocolo.
- Sin memoria dinámica en el núcleo: búferes fijos con los límites del protocolo (`MAX_PAYLOAD` 16384, 12
  sesiones, 38 caracteres por texto, 6 líneas por solicitud, ids de 48). Todo texto recibido se copia con tope
  y terminador.
- El cliente **no decide nada**: dibuja la última vista y envía entradas. Ante cualquier error de protocolo
  (etiqueta inválida, JSON inesperado, trama demasiado larga) cierra la conexión y reconecta.
- Comentarios en español, identificadores en inglés.

## Estructura

```text
client-3ds/
├── Makefile                 # genera agent-companion.3dsx
├── source/
│   ├── core/                # C portátil, sin libctru: se compila también en el PC
│   │   ├── sha256.c/.h      # SHA-256, HMAC-SHA256, HKDF-SHA256
│   │   ├── frame.c/.h       # tramas [tipo][largo u16 LE][contenido]; sellado y apertura con etiqueta de 16 bytes
│   │   ├── handshake.c/.h   # saludo: challenge → hello → welcome; clave de sesión
│   │   ├── json.c/.h        # lector de JSON mínimo (objetos, arreglos, cadenas con escapes y \uXXXX, números, true/false/null)
│   │   ├── view.c/.h        # ViewModel en estructuras de tamaño fijo; view_parse(json, len, &view)
│   │   ├── msg.c/.h         # arma los mensajes de la consola: decision, focus, skip, mode
│   │   ├── approve.c/.h     # gesto de aprobar (port de packages/simulator/public/approve.js)
│   │   ├── nav.c/.h         # navegación de la pantalla inferior (port de nav.js)
│   │   └── session.c/.h     # máquina de estados del cliente sobre una interfaz de transporte abstracta
│   ├── net.c/.h             # libctru: aviso UDP, conexión TCP no bloqueante, reconexión, reposo
│   ├── config.c/.h          # tarjeta SD: sdmc:/3ds/agent-companion/config.ini
│   ├── pairing.c/.h         # pantalla de emparejamiento y teclado del sistema
│   ├── render_top.c/.h      # la cara (port de face.js) con citro2d
│   ├── render_bottom.c/.h   # agentes → sesiones → detalle, tarjeta de permiso
│   ├── render_guide.c/.h    # guía de botones (SELECT)
│   ├── led.c/.h             # patrones del LED según view.led
│   └── main.c
└── tests-host/              # pruebas del núcleo, compiladas con gcc en el PC
    ├── Makefile             # `make test`
    └── test_*.c
```

## Núcleo portátil (`source/core`)

Referencias en TypeScript/JavaScript que se portan, con sus pruebas como guía de casos:

| C | Referencia |
| :--- | :--- |
| `sha256`, `handshake`, sellado en `frame` | `packages/protocol/src/auth.ts`, `fixtures/handshake.json` |
| `frame` | `packages/protocol/src/framing.ts` |
| `view`, `msg` | `packages/protocol/src/viewmodel.ts`, `messages.ts`, `fixtures/messages/` |
| `approve` | `packages/simulator/public/approve.js` y su prueba |
| `nav` | `packages/simulator/public/nav.js` y su prueba |
| `session` | `packages/bridge/test/fake-console.ts` |

### `session` — la máquina de estados

Independiente de la red real, para poder probarla en el PC contra un transporte simulado:

```c
typedef struct {
  int  (*send)(void *ctx, const uint8_t *data, size_t len);   // 0 si todo salió
  void *ctx;
} Transport;

typedef enum { SESSION_IDLE, SESSION_WAIT_CHALLENGE, SESSION_WAIT_WELCOME, SESSION_READY, SESSION_FAILED } SessionState;

void session_init(Session *s, const char *device_id, const uint8_t key[32], const uint8_t nonce_c[16]);
void session_on_connected(Session *s, Transport t);
// Bytes recibidos del socket. Devuelve <0 si hay que cerrar la conexión (y deja el motivo en s->error).
int  session_on_data(Session *s, const uint8_t *data, size_t len);
// Tras SESSION_READY: última vista válida y si cambió desde la última consulta.
const View *session_view(const Session *s);
int  session_send_decision(Session *s, const char *request_id, int allow);
int  session_send_focus(Session *s, const char *session_id /* NULL = ninguno */);
int  session_send_skip(Session *s);
int  session_send_mode(Session *s, int manual);
int  session_send_ping(Session *s);
```

- Errores de autenticación distinguibles (`SESSION_ERR_AUTH`): la aplicación los usa para ofrecer emparejar de
  nuevo en vez de reintentar en bucle.
- La vista solo se reemplaza si `rev` es mayor que el último visto y el JSON pasa todas las comprobaciones de
  límites; una vista inválida cierra la conexión.

### Pruebas en el PC (`tests-host`)

Obligatorias y automáticas (`make test` desde el bash de devkitPro, salida distinta de cero si algo falla):

- SHA-256, HMAC y HKDF con vectores públicos conocidos y con todos los valores de `handshake.json`
  (clave del dispositivo, macs, clave de sesión y las cuatro tramas selladas, byte a byte).
- Tramas: ida y vuelta, fragmentación byte a byte, varias en un bloque, exceso de largo, etiqueta alterada,
  trama repetida, dirección equivocada, contador.
- JSON: escapes, `\uXXXX` incluidos pares sustitutos → UTF-8, anidamiento, entradas truncadas o malformadas
  (no se cuelga ni lee fuera del búfer), textos más largos que el destino (se cortan sin romper un carácter
  UTF-8).
- Vista: todos los ejemplos de `packages/protocol/fixtures/messages/*view*` y vistas generadas por el puente
  real (ver más abajo), más vistas inválidas que deben rechazarse.
- `approve` y `nav`: los mismos escenarios que las pruebas de JavaScript.
- `session`: saludo completo contra un "puente" simulado en la prueba usando los valores de `handshake.json`;
  clave incorrecta; mensaje inesperado antes del saludo; trama repetida; vista con `rev` menor.
- Además, compilar con `-Wall -Wextra -Werror -fsanitize=address,undefined` si el `gcc` instalado lo soporta
  (si no, sin sanitizadores y decirlo).

Vistas de ejemplo: un script `packages/bridge/scripts/gen-view-fixtures.ts` genera en
`client-3ds/tests-host/fixtures/` un conjunto de mensajes `view` reales (vacía, una sesión, 12 sesiones al
máximo de texto, con solicitud normal, de riesgo alto, en modo manual con pendientes, con detalle abierto,
con caracteres acentuados, emoji y el marcador `�`).

## Aplicación (`source/*.c`)

### Arranque y configuración

- `sdmc:/3ds/agent-companion/config.ini`: `device_id` (se genera al primer arranque: `3ds-` + 8 hex
  aleatorios), `key` (64 hex, vacía si no está emparejada), `host` (última IP del puente), `port`.
- Sin clave: pantalla de emparejamiento.

### Emparejamiento

- La pantalla explica: "En el PC ejecuta `npm run companion -- pair` y escribe aquí el código".
- El código se escribe con el teclado del sistema (`swkbd`), se normaliza (mayúsculas, sin guiones ni espacios)
  y se valida (16 caracteres del alfabeto Crockford). De él se deriva la clave
  (`HKDF-SHA256(código, salt "3dsac-pair-v1", info device_id)`), se intenta el saludo y solo si el puente
  responde `welcome` se guarda la clave en la SD. Si falla, se informa y se puede reintentar.
- Si un saludo con la clave guardada falla por autenticación, se ofrece emparejar de nuevo (no se borra la
  clave sin confirmación).

### Red (`net.c`)

- Busca el aviso UDP en el puerto 33333 (JSON con `service: "3ds-agent-companion"` y `port`); toma la IP del
  remitente. Si en 3 s no llega, prueba la última IP guardada. La IP se puede escribir a mano desde la guía
  (SELECT > Guía de botones, última página: X).
- Conexión TCP no bloqueante con plazo de 4 s; se considera lista cuando el primer `recv` o `send` funciona
  (no usar `poll` + `SO_ERROR`: dio falsos fallos en la Fase 0). `TCP_NODELAY` si está disponible.
- `PING` cada 5 s; si no llega nada en 15 s, se cierra y se reconecta. Reintentos con espera creciente (1 s, 2 s,
  4 s, tope 5 s).
- Reposo: si entre dos cuadros pasan más de 2 s, se cierran todos los sockets, se reinicia `soc` y se reconecta.
- Estados visibles para la interfaz: buscando el puente, conectando, emparejando, conectado, sin conexión.

### Pantalla superior (`render_top.c`)

Port de `packages/simulator/public/face.js` (mismas constantes y comportamiento por `mood`): fondo del color del
agente con transición, brillo, ojos, boca, parpadeo, globo con una o dos líneas. Texto con la fuente del sistema
(`C2D_Text`), que cubre acentos; lo que no exista en la fuente no debe romper el dibujo. Sin conexión: cara
gris con ojos cerrados y el estado de la red en el globo.

### Pantalla inferior (`render_bottom.c`) y entrada

- Tres niveles con `nav` (agentes → sesiones → detalle) y la tarjeta de permiso con `approve`, como el
  simulador: título de la sesión, líneas del comando, cuenta regresiva local, "N de M", aviso de riesgo alto y
  barra de retención.
- Botones: `A` aprobar (reglas de 500 ms y de mantener 1 s en riesgo alto, sobre la misma solicitud), `B`
  rechazar si hay tarjeta y volver si no, cruceta para moverse, `A` también entra a un elemento cuando no hay
  tarjeta, `L`/`R` saltar permiso, `X` cambiar de modo, `START` salir.
- `SELECT` abre el **menú de configuración** (Fase 2b, paso 2: ver `09-fase-2b.md`); la **guía** es su entrada
  "Guía de botones" y se abre encima del menú (pantalla inferior local, sobre cualquier estado: conectada, buscando el
  puente o sin emparejar). `SELECT` o `B` cierran la guía (y vuelven al menú); `START` sigue saliendo. Mientras está abierta las entradas no llegan a la app
  de debajo (A no aprueba, B no rechaza, L/R no saltan, X no cambia el modo, el toque no llega a la tarjeta) y abrirla
  anula el gesto de aprobar en curso y reinicia la guarda de 500 ms (`approve_uncovered`). La conexión sigue viva (ping, vistas, LED) y la pantalla
  superior sigue avisando. Con el diagnóstico abierto, `SELECT` no hace nada (no pueden estar las dos a la vez).
  El **diagnóstico** (L+R mantenidos 1 s) tapa la tarjeta, así que también traga A, B, X, Y, la cruceta, el toque y el
  salto con L/R; solo valen `START` (salir) y el acorde L+R que lo cierra. Abrirlo o cerrarlo anula los gestos en curso
  (A, B, lápiz) y reinicia la guarda de 500 ms: una tarjeta que llegó con el diagnóstico abierto no se aprueba hasta
  500 ms después de cerrarlo.
  Cuatro páginas, que se cambian con la cruceta izquierda/derecha o tocando las flechas, con "1 de 4":

  | Página | Contenido |
  | :--- | :--- |
  | 1. Lo básico | La cara avisa; abajo agente → sesión → detalle; cruceta o lápiz, A entra, B vuelve. |
  | 2. Permisos | A aprueba (riesgo alto: mantener 1 s), B rechaza, L/R pasan al siguiente sin responder (en fila, con varios); los permisos no vencen. |
  | 3. Modos | X alterna "En fila" (el más antiguo aparece solo) y "Elijo yo" (entras a la sesión que quieres). |
  | 4. Conexión y ajustes | Y: código de emparejamiento; L+R 1 s: diagnóstico; START: salir; **X (solo en esta página): escribir la IP del puente a mano**, tras lo cual la guía se cierra. |

  La lógica (estado, página, flechas táctiles y textos como tabla) está en `source/logic/guide.c`; la tragada de
  entradas, en `input_logic.c`; el dibujo, en `render_guide.c`.
- Táctil: tocar un agente o una sesión entra; tocar "Aprobar" / "Rechazar" equivale a A / B con las mismas
  reglas (la retención vale mientras el lápiz siga sobre el botón).
- Nada se dibuja fuera de 320×240; las listas largas se desplazan con la cruceta.

### LED (`led.c`)

`view.led`: `off` apagado, `working` pulso azul lento, `ask` parpadeo amarillo, `done` verde fijo breve,
`error` parpadeo rojo. Solo se reprograma cuando cambia. Al salir y al perder la conexión, apagado.

## Lo que no entra en esta fase

Voz, sonido, 3D estereoscópico, paquete `.cia`, ajustes en pantalla más allá de IP y emparejamiento, y el
instalador de hooks en el PC (queda la configuración de ejemplo de `packages/hooks`).

## Salida de la fase

1. `make test` en `client-3ds/tests-host` pasa.
2. `make` en `client-3ds` genera `agent-companion.3dsx` sin advertencias.
3. En la New 3DS XL: la consola encuentra el puente, se empareja con el código, muestra la cara y las sesiones
   de `demo.mjs`, y aprueba y rechaza permisos con A y B; tras cerrar y abrir la tapa se reconecta sola.
4. Con Claude Code real y los hooks instalados: un permiso real aprobado desde la consola.
