# Fase 2b — Seguir el trabajo desde la consola

Diseño y decisiones de cada paso de la Fase 2b (ver `02-plan-de-trabajo.md`). Un paso por sección, en el orden en
que se construyen.

## Paso 1 — Mensaje completo

**Estado (2026-11-15): hecho y visto en la New 3DS XL.** Se lee el mensaje completo con A desde la sesión. La
primera versión usaba solo la mitad izquierda de la pantalla (líneas de 38 caracteres a escala 0.36); con 48
caracteres a escala 0.42 ocupa todo el ancho y se ve bien. Sin probar en la consola: que el lector ceda ante
una tarjeta de permiso que llega mientras se lee (cubierto por pruebas).

**Objetivo:** leer desde la 3DS el último mensaje entero de una sesión (el texto final del turno, el
`last_assistant_message` del hook `Stop`) para saber en qué quedó el trabajo, sin mirar la terminal.

### Por qué no va en la vista

La vista completa se reenvía en cada cambio y una trama sellada admite 16384 bytes (`MAX_PAYLOAD`). El detalle sigue
mostrando solo el comienzo (`detail.lastMessage`, 4 líneas de 38). El mensaje entero es un **documento aparte que la
consola pide a demanda**: un mensaje de ida y uno de vuelta, solo para la consola que lo pidió.

### Mensajes (`packages/protocol/src/messages.ts`)

| Sentido | Mensaje | Campos |
| :--- | :--- | :--- |
| consola → puente | `{"t":"read","sessionId":"s1"}` | `sessionId`: id de la sesión (el mismo patrón que `focus`) |
| puente → consola | `{"t":"text","sessionId":"s1","lines":[...],"truncated":false,"question":[...]}` | ver abajo |

Campos de `text`:

- `sessionId`: la sesión pedida (la consola ignora una respuesta de otra sesión).
- `lines`: hasta `MAX_READ_LINES` = **240** líneas de hasta `MAX_READ_TEXT` = **48** caracteres (propio del lector; `MAX_TEXT` sigue en 38 para todo lo demás), ya sin markdown y cortadas por
  el puente (la consola nunca parte texto). Las líneas vacías separan párrafos. `[]` si la sesión no existe o no tiene
  mensaje: el puente **nunca falla** por un `read`.
- `truncated`: el mensaje no cupo y se cortó al final; la consola agrega la línea "… sigue en el PC".
- `question` (opcional): si la sesión espera respuesta, su pregunta en hasta 3 líneas de `MAX_READ_TEXT` (`MAX_QUESTION_LINES`, igual que
  `detail.question`), para mostrarla arriba, resaltada.

Fixtures: `packages/protocol/fixtures/messages/console-read*.json` y `bridge-text*.json`. El generador del cliente en C
(`packages/bridge/scripts/gen-view-fixtures.ts`) agrega mensajes `text` armados por el puente real y variantes de
límites a `client-3ds/tests-host/fixtures/views_fixture.h` (`TEXT_FIXTURES`).

### Límites

- **Guardado:** el puente guarda hasta **8000** caracteres del último mensaje (`MAX_STORED_MESSAGE` en `store.ts`; antes
  2000). Los demás textos siguen en 2000.
- **Líneas:** 240 (`MAX_READ_LINES`).
- **Bytes:** el JSON del `text` mide como máximo `MAX_PAYLOAD - 16 (etiqueta) - 1024 (margen)` = **15344 bytes**
  (`MAX_TEXT_JSON_BYTES` en `packages/bridge/src/reader.ts`). Con acentos cada carácter pesa 2 bytes (y una comilla,
  2 por el escape), así que 240 líneas de 48 caracteres pasarían de 16 KB: se corta también por bytes. Si el mensaje no
  cabe, se corta y `truncated` es `true`.
- **Peor caso medido** (8000 caracteres de `á`, pregunta de 3 líneas): **151 líneas, 15310 bytes de JSON, trama sellada
  de 15329 bytes** (límite 16387 con la cabecera). Está en `packages/bridge/test/reader.test.ts`, que también prueba
  comillas, barras invertidas, español con espacios y japonés (3 bytes por carácter).
- **Memoria en la consola:** el documento vive dentro de la sesión (estática, no en la pila): 240 líneas ×
  (48 caracteres × 4 bytes UTF-8 + NUL = 193 bytes) ≈ 46 KB, más la pregunta (`ReadText`, `READING_MAX_TEXT`). El lector JSON admite 384 tokens y el mensaje más
  grande usa unos 250.

### Limpieza de markdown (`packages/bridge/src/plaintext.ts`)

La pantalla es de texto plano. Antes de cortar en líneas, el puente aplica estas reglas (función pura, con pruebas en
`plaintext.test.ts`):

- énfasis `**x**`, `__x__`, `*x*`, `_x_` y código en línea `` `x` ``: se quitan los marcadores. No se toca `snake_case`
  ni `2 * 3`, ni lo que hay dentro de un código en línea;
- títulos `# Título` → `Título`, con una línea en blanco antes;
- listas `- ` / `* ` / `+ ` → `• `, con las líneas de continuación sangradas 2 espacios; las numeradas (`1. `) se
  mantienen, con la continuación bajo el texto; el sangrado de sublistas se conserva (hasta 8);
- bloques de código: sin las vallas ```` ``` ````; las líneas se sangran 2 espacios y, si no caben, se **cortan a duro**
  (no por palabras) y no se interpreta markdown dentro;
- enlaces `[texto](url)` → `texto`; imágenes → su texto alternativo;
- tablas: se quita la fila separadora `|---|`; las demás filas pasan a sus celdas unidas con ` · `;
- citas `> ` pierden el marcador; las reglas horizontales (`---`) quedan como una línea en blanco;
- 3 o más saltos de línea seguidos → una sola línea en blanco; se recortan las líneas en blanco de los extremos.

Antes de todo eso el texto pasa por `sanitizeText` (controles, bidi y ancho cero pasan al marcador `�`).

### Cliente (3DS)

- **Abrir:** en el detalle de una sesión, **sin tarjeta de permiso**, **A** (o tocar la franja "A: leer todo el
  mensaje" al pie del detalle). En el detalle A no hacía nada (`nav_enter` en el nivel de detalle no hace nada), así
  que no se pisó ninguna función. Con tarjeta A sigue siendo aprobar y la franja no se ofrece.
- **Cargando:** la consola envía `read` y muestra "Cargando…" hasta que llega el `text` de esa sesión.
- **Pantalla (320×240):** cabecera con agente · proyecto, la posición `n-m/N` y "B Volver"; la pregunta pendiente arriba
  (mismo bloque amarillo del detalle); debajo las líneas, con letra a escala 0.42 y 48 caracteres por línea (unos 265 de los 306 px útiles; si una línea es más ancha la letra se achica hasta 0.26 y, si aun así no cabe, se corta con "…"): 14 filas de 15 px (13 con el aviso de mensaje nuevo, 9 con la
  pregunta de 3 líneas), y una barra de desplazamiento a la derecha. Si el puente cortó el mensaje, la última línea es
  "… sigue en el PC".
- **Controles:** cruceta **↑/↓** una línea (con repetición de teclas); **←/→** y **L/R** una página (filas − 1, con una
  línea de contexto; L/R actúan al soltar y no si se pulsaron juntas, para no chocar con el acorde L+R del diagnóstico);
  el **lápiz** arrastra (cada 15 px una línea); **B** (o tocar "B Volver") vuelve al detalle sin cerrar el enfoque; una
  segunda B ya es la de siempre (un nivel atrás). **X**, **Y** y el resto se tragan.
- **Es una foto:** si llega un mensaje nuevo mientras se lee (cambia el extracto de 4 líneas del detalle), no salta:
  aparece la barra "mensaje nuevo · A recarga". **A** (o tocarla) vuelve a pedir el texto y empieza desde arriba.
- **Regla de seguridad:** el lector nunca tapa ni intercepta aprobar o rechazar. Cuando aparece una tarjeta de permiso
  (vista con `request`), el lector **se cierra en el acto** y la tarjeta funciona exactamente como desde el detalle:
  mismas guardas (500 ms antes de poder aprobar, la misma identidad de lo mostrado para rechazar, retención en riesgo
  alto). Con el lector abierto no hay tarjeta, así que A y B no pueden aprobar ni rechazar nada. Además de la vista
  nueva, `input_frame` comprueba en cada cuadro que sigue sin haber tarjeta y que el detalle abierto es el de la sesión
  leída; si no, lo cierra antes de atender la pulsación. También se cierra al perderse la sesión o si el envío de
  `read` falla.
- **Superposiciones:** la guía (SELECT) se abre encima y se traga las entradas; B la cierra a ella, no al lector. El
  diagnóstico (L+R 1 s) lo tapa y sigue tragándose todo, como en el resto de la app.
- **Guía:** la primera página ("Lo básico") explica A para leer, los controles y B.
- **Código:** `core/reading.c` (lee `text`), `core/msg.c` (`msg_read`), `core/session.c` (búfer propio y
  `session_read_seq`; el `text` nunca toca la vista ni su contador), `logic/reader.c` (estado y geometría),
  `logic/input_logic.c` (controles y cierre), `render_reader.c` (dibujo).

### Simulador (`packages/simulator`)

El mismo lector, en `public/reader.js` (módulo puro, espejo de `logic/reader.c` con las mismas cuentas de filas) y
`public/bottom.js`. Teclas: **Enter** o **A** abren en el detalle sin tarjeta; **↑/↓** una línea, **←/→** o **L/R**
página, rueda del ratón de a 3 líneas; **B** o **Esc** vuelven; **A**/**Enter** recargan si hay un mensaje nuevo. Una
tarjeta de permiso lo cierra igual que en la consola.

### Pruebas

- puente: `plaintext.test.ts` (reglas de markdown), `reader.test.ts` (límites, peor caso en bytes, sesión
  desconocida, pregunta), `integration-sessions.test.ts` (consola real y WebSocket, respuestas solo a quien pidió);
- protocolo: fixtures `console-read*`, `bridge-text*`;
- cliente en C (`tests-host`): `test_view.c` (`reading_parse` contra los esquemas zod, volcados idénticos),
  `test_msg.c`, `test_session.c` (`read` → `text`, texto inválido cierra la sesión), `test_reader.c` (controles,
  recarga, y que una tarjeta cierre el lector y deje aprobar y rechazar como siempre);
- simulador: `test/reader.test.ts`.

### Decidido y pendiente (paso 1)

- El detalle (`detail.lastMessage`) sigue mostrando el texto sin limpiar de markdown; solo el lector lo limpia.
- El aviso "mensaje nuevo" compara el extracto de 4 líneas del detalle: un mensaje nuevo que empiece igual que el
  anterior no se detectaría. Si molesta, se agrega un contador de mensaje a la vista.
- Probado con el simulador en el navegador y con las pruebas del PC; **falta probarlo en la consola real**.

## Paso 2 — Configuración (SELECT)

**Estado (2026-11-15): hecho y visto en la New 3DS XL.** En la consola la letra chica se veía borrosa (escalas
de 0.26 a 0.34 de la fuente del sistema); ahora todas las escalas viven en `client-3ds/source/ui_scale.h` con
piso de 0.36 y se ve nítida. Sin cambiar el filtrado de la fuente (mipmaps o `GPU_NEAREST` quedan como
experimento si hiciera falta). El
idioma **no** entra en este paso (viene después, con su tabla de textos). Los avisos por defecto y el "Visto" se
guardaron primero y **se usan desde el paso 3a** (ver más abajo).

**Objetivo:** que SELECT abra un menú de configuración en la pantalla inferior, en vez de la guía. Las preferencias las
guarda el puente (`.companion/settings.json`, sobreviven a reinstalar la app); la consola solo las muestra y pide
cambiarlas. El puente decide, la consola dibuja.

### Ajustes (`packages/bridge/src/settings.ts`)

| Ajuste | Valores | Por defecto | Efecto hoy |
| :--- | :--- | :--- | :--- |
| `notifyDefault` | `all` · `important` · `end` · `silent` (todo, lo importante, solo al terminar, silencio) | `important` | modo de las sesiones nuevas (paso 3a) |
| `notifyAck` | booleano ("Visto" en los avisos) | `true` | los avisos quedan en una tarjeta con "Visto" (paso 3a) |
| `hiddenAgents` | lista de `claude` · `gemini` · `codex` · `cursor` · `hermes` | `[]` | oculta agentes en la consola |
| `mode` | `queue` · `manual` (el de siempre) | `queue` | sin cambios |

`loadSettings` valida **campo por campo**: si falta o es inválido, ese campo usa su defecto y los demás se conservan. Un
`settings.json` anterior que solo trae `mode` sigue valiendo. `hiddenAgents` se normaliza (sin repetidos, en el orden
de la cuadrícula). `BridgeStore` guarda todo junto (`settings`, `setSetting`) con escritura atómica y emite `change`, así
que la vista se reenvía sola.

**Agente oculto** (vista y cara): sus sesiones salen de `sessions` y la cara no los menciona (ambiente, "empezó a
trabajar", "terminó", error, "espera tu respuesta"). **Lo que nunca se filtra** son los permisos: `request`,
`pendingCount`, la cara de permiso, el LED y los avisos de decisión (aprobado, rechazado, retirado) siguen igual, para que
un permiso de un agente oculto no se quede esperando sin que nadie lo vea. Una sola excepción en `sessions`: la sesión
de la tarjeta enfocada se queda aunque su agente esté oculto, para que la consola siga resolviendo de quién es la
tarjeta (la lista de agentes de la consola no la muestra). Para que un agente no mande permisos hay que quitarle los
hooks (como dice el plan).

### Protocolo

- **Vista:** campo opcional `settings: { notifyDefault, notifyAck, hiddenAgents }` (`SettingsViewSchema`). Opcional por
  compatibilidad: sin él, la consola deja las tres primeras entradas del menú desactivadas.
- **Consola → puente:** `{"t":"setting","key":"notifyDefault","value":"end"}` (también `notifyAck` con booleano y
  `hiddenAgents` con la lista completa de ocultos). `ConsoleMessageSchema` solo comprueba la forma (clave y valor
  acotados); la clave y el valor se validan con `SettingChangeSchema` (zod) dentro del puente. Una clave desconocida o un
  valor inválido **se ignora, se registra ("ajuste ignorado: ...") y no cierra la conexión** (los demás mensajes inválidos
  sí la cierran). Tras un cambio válido el puente guarda y reenvía la vista.
- **Fixtures:** `bridge-view-settings*.json`, `console-setting-*.json`; el generador del cliente (`gen-view-fixtures.ts`)
  agrega `settings` al volcado canónico (`has_settings`, `settings.notify_default`, `settings.notify_ack`,
  `settings.hidden_count`, `settings.hidden[i]`) y unas 25 variantes (ausente, nulo, vacío, valores inválidos, 6 agentes,
  etc.) con el veredicto de zod; la consola en C debe coincidir en todas.

### Menú en la consola (3DS)

Pantalla inferior (`logic/menu.c`, `render_menu.c`). SELECT abre y cierra; **B** sube un nivel dentro del submenú y cierra
en la raíz; cruceta **↑/↓** (con repetición) elige; **A** (o ←/→ en los valores) cambia; el lápiz toca filas y el botón
de arriba a la derecha hace de B.

1. **Avisos por defecto** — A, → avanzan; ← retrocede: `todo` → `lo importante` → `solo al terminar` → `silencio` (da la
   vuelta). Ayuda debajo: "Sesiones nuevas · cada sesión cambia el suyo".
2. **Pedir "Visto" en los avisos** — A, ←, → alternan sí/no. Ayuda: "Cada aviso queda en una tarjeta con "Visto"".
3. **Agentes** — A entra a un submenú con Claude, Gemini, Codex, Cursor y Hermes, cada uno con su interruptor
   (visible/oculto; A, ← o → lo alternan; B vuelve). Una ayuda al pie dice que un agente oculto no sale en la lista ni en
   la cara, pero sus permisos sí llegan y se muestran. Un agente oculto desaparece de la lista de agentes: las casillas
   se compactan (el índice del cursor y del toque cuenta sobre los visibles) y, si se ocultan todos, la lista dice
   "Todos los agentes están ocultos".
4. **Guía de botones** — A abre la guía de siempre **encima del menú** (todas sus páginas, con el código de emparejamiento
   en Y y la IP a mano en X en la última). SELECT o B la cierran y se vuelve al menú; Y/X de la última página cierran guía
   y menú y abren el teclado.
5. **Diagnóstico** — A alterna la pantalla de diagnóstico (lo mismo que L+R 1 s). Con ella abierta el menú queda debajo;
   L+R 1 s la cierra y se vuelve al menú.

**Sin conexión:** las entradas 1 a 3 necesitan una vista con `settings`. Sin vista (sin conexión o sin emparejar) o con
un puente que no la manda salen atenuadas con "sin conexión" y no hacen nada; la guía y el diagnóstico se pueden usar.
Con vista, los valores salen de `view.settings`: la consola no guarda nada propio, solo el cursor. Un cambio se ve cuando el
puente devuelve la vista (milisegundos).

**Código:** `core/view.c` (lee `settings`; `view_agent_hidden`, `view_visible_agents`), `core/msg.c`
(`msg_setting_notify_default`, `msg_setting_notify_ack`, `msg_setting_hidden_agents`), `core/session.c`
(`session_send_setting_*`), `core/nav.c` (agentes visibles: `nav_agent_count`, `nav_agent_at`; si el agente de la pantalla
se oculta, vuelve a la lista y suelta el enfoque), `logic/layout.c` (solo las casillas visibles), `logic/menu.c`
(estado, valores, geometría), `logic/input_logic.c` (teclas, acciones `IN_ACT_SETTING_*`, cierre ante una tarjeta),
`render_menu.c` (dibujo).

### Regla de seguridad: el menú nunca tapa ni intercepta aprobar o rechazar

- Una **tarjeta de permiso que llega con el menú abierto lo cierra en el acto** (y a la guía que abrió desde él, y al
  submenú), igual que el lector: en `input_view_changed` y otra vez al comienzo de cada `input_frame`, antes de atender la
  pulsación. Desde ese instante A, B, Y, el lápiz y L/R funcionan como siempre, con las mismas guardas (500 ms desde que
  llega la tarjeta, la misma identidad de lo mostrado para rechazar, retención en riesgo alto).
- Con el menú abierto no hay tarjeta, así que A y B no pueden aprobar ni rechazar nada; sus pulsaciones solo mueven o
  cambian el menú.
- **Con una tarjeta a la vista, SELECT no abre el menú** (decisión nuestra, más estricta que la guía anterior, que se abría
  encima de la tarjeta y anulaba el gesto): primero se responde. Si la cola es larga, L+R 1 s sigue abriendo el
  diagnóstico. SELECT con la tarjeta no anula el gesto de aprobar en curso.
- **Diagnóstico y teclado del sistema** se comportan como hoy: el diagnóstico tapa todo y traga todo salvo START y L+R; con
  él abierto SELECT no hace nada.

### Simulador (`packages/simulator`)

El mismo menú en `public/menu.js` (módulo puro, espejo de `logic/menu.c`) y `public/bottom.js`. El simulador no tenía
SELECT: ahora son **S** o **Retroceso**; **↑/↓** eligen, **A**/**Enter** (o ←/→ en los valores) cambian, **B**/**Esc** suben o
cierran, el ratón toca filas. "Guía de botones" muestra las teclas del simulador y "Diagnóstico" el estado de la conexión
y de la vista (no hay red ni memoria que medir). Una tarjeta de permiso lo cierra y con una tarjeta S no lo abre. La lista de
agentes oculta lo que diga `view.settings.hiddenAgents` (`nav.js`: `visibleKinds`).

### Pruebas

- puente: `settings.test.ts` (carga campo por campo y con el archivo anterior, esquema de cambios, guardar y reiniciar,
  ajuste inválido ignorado sin tumbar, vista y cara con agentes ocultos, los permisos de un agente oculto siguen
  llegando, integración por TCP);
- protocolo: fixtures `bridge-view-settings*`, `console-setting-*`;
- cliente en C (`tests-host`): `test_view.c` (variantes de `settings` contra zod y `test_settings_field`), `test_msg.c`
  (mensajes `setting` byte a byte), `test_menu.c` (cursor, valores, sin conexión, geometría), `test_nav.c` y
  `test_layout.c` (agentes ocultos), `test_input.c` (SELECT, acciones hacia el puente, tarjeta que cierra el menú y la
  guía, SELECT ignorado con tarjeta, guarda de 500 ms, diagnóstico desde el menú, toque) y `test_reader.c`;
- simulador: `menu.test.ts`, `nav-hidden.test.ts`.

### Decidido y pendiente

- Probado con el simulador en el navegador (puente de prueba en puertos efímeros: cambiar el aviso, ocultar agentes, y
  un permiso de un agente oculto que llega con el menú abierto cierra el menú y muestra la tarjeta) y con las pruebas del
  PC; **falta probarlo en la consola real**.
- La cara oculta también las preguntas ("espera tu respuesta") de un agente oculto, pero el LED sigue pidiendo atención
  mientras haya una pregunta o un permiso pendiente (no se filtra).
- El idioma (español o inglés) queda para después; el menú ya tiene lugar para una entrada más.

## Paso 3 — Avisos (3a: modos y tarjetas con "Visto"; el sonido es el paso 3b)

**Estado (2026-11-15): hecho y visto en la New 3DS XL.** La tarjeta azul de aviso llegó al terminar un turno con
pregunta; "Visto" (A) y "Leer todo" funcionaron. Sin probar todavía en la consola: L/R entre varios avisos, el
cambio de modo por sesión con Y y que un permiso tome la pantalla sobre un aviso (cubierto por pruebas). Sin sonido todavía: la vista
ya lleva qué sonido toca y un `seq`, pero la consola solo lo lee (paso 3b: `ndsp` y `dspfirm.cdc`).

**Objetivo:** que cada sesión avise según su modo y que lo importante quede en una tarjeta que se cierra con "Visto", sin
confundirse nunca con un permiso. El puente decide qué avisar; la consola dibuja.

### Modo de aviso por sesión

Cada sesión tiene un modo (`all` · `important` · `end` · `silent`), que el puente guarda en memoria por id de sesión. Al crearse
toma el modo que se eligió la última vez para **ese proyecto** (nombre de la carpeta, `.companion/notify-modes.json`; un archivo
ausente o con valores inválidos se carga igual, sin recuerdos) y, si no hay, el ajuste `notifyDefault`. Cambiarlo desde la
consola lo recuerda para el proyecto (hasta 200 proyectos). Cambiar `notifyDefault` no toca las sesiones ya creadas.

**Clasificación de hechos** (adaptador de Claude Code y ruta genérica `/event`):

| Hecho | Origen | Clase |
| :--- | :--- | :--- |
| permiso | `requestPermission` (hook de permisos) | importante |
| pregunta de herramienta | `PreToolUse` de `AskUserQuestion` (`ask_tool`) | importante |
| "te espera" | `Stop` con la pregunta de la caja de fin de turno (`ask_stop`) | importante |
| error | estado `error` (`/event`) | importante |
| fin de turno | `Stop` → `done` | importante |
| esperando instrucciones | `Notification` `idle_prompt` / `/event` `idle` (`idle`) | importante |
| empezó a trabajar | `working` desde otro estado | menor |
| actividad de la herramienta | `PreToolUse` | menor (solo cambia la cara ambiente) |

**Qué deja pasar cada modo** (globo de la cara, tarjeta y sonido van juntos; `chime` es el sonido que toca):

| Hecho | `all` | `important` | `end` | `silent` |
| :--- | :---: | :---: | :---: | :---: |
| empezó a trabajar | globo | – | – | – |
| permiso | tarjeta de permiso + `permission` | igual | tarjeta de permiso, **sin** aviso ni sonido | tarjeta de permiso, sin sonido |
| pregunta de herramienta | aviso + `ask` | aviso + `ask` | sin aviso (la pregunta se ve igual en la fila y el detalle) | sin aviso |
| "te espera" | aviso + `ask` | aviso + `ask` | aviso + `ask` | sin aviso |
| error | globo + aviso + `error` | globo + aviso + `error` | – | – |
| fin de turno | globo + aviso + `done` | globo + aviso + `done` | globo + aviso + `done` | – |
| esperando instrucciones | aviso + `done` | aviso + `done` | aviso + `done` | – |

Notas del cuadro: la tabla vive en `packages/bridge/src/notify.ts` (`passes`); "aviso" es la tarjeta con "Visto" si `notifyAck` está
activo (si no, solo globo y sonido); un **agente oculto** no genera avisos ni sonido (sus permisos siguen llegando como tarjeta); en
`silent` la sesión tampoco sale en la cara (ambiente, "te espera") ni enciende el LED por una pregunta, pero un permiso suyo
sí lo hace. Un `idle_prompt` posterior a un fin de turno, pregunta o error ya avisados **no** vuelve a avisar (`notified`, que se
limpia al volver a trabajar). La cara ambiente (sesiones que trabajan, con su actividad) sigue en `all`, `important` y `end`:
no es un aviso, es el estado.

### Protocolo (campos opcionales, compatibles hacia atrás)

- **Vista:** `notice` (la tarjeta de aviso a la vista), `chime` (el último aviso con sonido) y `detail.notify` (modo de la sesión
  abierta). Un puente anterior no los manda y la consola sigue como antes (sin franja de modo de aviso).
  - `notice`: `{ id, sessionId, kind: done|ask|error|idle, agent, project, title, lines (0 a 4 de 38), position, total }`. `title` es
    "Terminó", "Espera tu respuesta", "Error" o "Esperando instrucciones"; `lines` son las primeras líneas del último mensaje
    (limpio de markdown), la pregunta o la actividad del error, ya cortadas. Una por sesión (la más nueva reemplaza a la
    anterior); `position`/`total` dan su lugar en la cola.
  - `chime`: `{ kind: done|ask|error|permission, seq }`. `seq` sube de uno en uno mientras el puente vive. La consola del paso 3b
    debe tomar el **primer `seq` que ve al conectarse como punto de partida sin sonar** y sonar solo con `seq` mayores (si llega uno
    menor, el puente se reinició: nuevo punto de partida). El simulador lo hace con `chimeStep` (`notice.js`).
  - Los permisos van siempre antes: con **cualquier** permiso pendiente (aunque en modo "elijo yo" no haya tarjeta a la vista) el
    puente no manda `notice`, y la consola tampoco la muestra si por error llegara junto a `request`.
  - LED: permiso pendiente > pregunta > aviso sin "Visto" (`done`/`idle` → `done`, `ask` → `ask`, `error` → `error`) > lo que muestre
    la cara (trabajando, nada). Sin "Visto" activo no hay tarjetas y el LED sigue a la cara.
- **Consola → puente:** `{"t":"ack","id":"<notice id>"}` ("Visto": retira la tarjeta; **nada se manda al agente**; un id desconocido
  se ignora y se registra), `{"t":"skipNotice"}` (siguiente tarjeta, circular) y
  `{"t":"setting","key":"sessionNotify","sessionId":"s1","value":"end"}` (modo de la sesión). El último se valida con zod
  (`SessionNotifyChangeSchema`): una sesión desconocida, un valor inválido o un id mal formado se ignoran y se registran
  ("ajuste ignorado: ...") sin cerrar la conexión.
- **Retiro de una tarjeta:** al marcarla, cuando su sesión vuelve a trabajar (`UserPromptSubmit`, `PreToolUse` de trabajo), al
  terminar la sesión (`SessionEnd`), cuando llega un permiso de esa sesión, si llega un aviso más nuevo de la misma sesión, si el
  nuevo modo de la sesión ya no la dejaría pasar, si se oculta su agente o si se desactiva "Pedir Visto".
- **Fixtures:** `bridge-view-notice*`, `bridge-view-chime-*`, `bridge-view-detail-notify*`, `console-ack*`, `console-skip-notice`,
  `console-setting-session-notify`; el generador del cliente (`gen-view-fixtures.ts`) agrega al volcado `has_notice`, `notice.*`,
  `has_chime`, `chime.*` y `detail.notify`, vistas reales del puente (`notice-done`, `notice-queue`, `notice-and-request`,
  `chime-only`) y unas 65 variantes con el veredicto de zod; la consola en C debe coincidir en todas.

### Consola (3DS)

- **Tarjeta de aviso** (abajo, en lugar de la de permiso): marco y botón **azules**, cabecera "AVISO · Claude · proyecto", el título
  grande (verde terminó, amarillo espera, rojo error, gris instrucciones), hasta 4 líneas, "N de M" con `< L` y `R >` si hay
  varias, y los botones **A: Visto** y **Leer todo**. Nunca dice "permiso" ni tiene Aprobar/Rechazar.
- **"Visto":** A (o tocar el botón). Es el gesto de aprobar reutilizado en **otra instancia** de `core/approve.c` (`InputLogic.ack`):
  la pulsación debe empezar con el aviso a la vista desde hace ≥ 500 ms, se anula si cambia lo mostrado (otro id o líneas) y no se
  repite tras marcar. Emite `IN_ACT_ACK` (`{t:"ack"}`), nunca una decisión. Con un aviso a la vista, A **solo** marca "Visto": no
  entra a listas ni abre el lector.
- **L / R** (o las flechas de la tarjeta): otro aviso (`IN_ACT_SKIP_NOTICE`); no pasa con L+R juntos (acorde del diagnóstico) ni con un
  solo aviso. Con permisos pendientes L/R siguen siendo los de los permisos.
- **Leer todo:** abre el detalle de la sesión del aviso y su lector (`nav_open_session`, `reader.from_notice`). El aviso sigue a la
  vista: B vuelve al detalle con el aviso todavía ahí. En ese lector L/R son páginas y A solo recarga (si llegó un mensaje nuevo).
- **Modo de aviso de la sesión:** en el detalle, la franja "Y: avisos · <modo>" (al pie, a la derecha de "A: leer todo el mensaje") o
  la tecla **Y** recorren todo → lo importante → solo al terminar → silencio → todo (`IN_ACT_SESSION_NOTIFY`). Se ofrece solo si el
  puente manda `detail.notify` y no hay un permiso a la vista (con permiso, **Y es "sí, no volver a preguntar"**; en el detalle sin
  tarjeta Y no tenía otra función, así que no choca). Con un aviso a la vista la franja de lectura desaparece (A marca "Visto") pero la
  de modo se queda.
- **Teclas libres:** X (modo de permisos) sigue igual en todos los niveles; Y solo abre el código de emparejamiento sin vista.
- **Menú y guía:** "Pedir Visto" y "Avisos por defecto" ya no dicen "se aplica con el paso 3" (ayudas: "cada sesión cambia el suyo" y
  "cada aviso queda en una tarjeta con "Visto""). La guía tiene una página nueva, **Avisos** (5 páginas; la última sigue con X e Y).
- **Código:** `core/view.c` (`notice`, `chime`, `detail.notify`; `view_has_notice_card`), `core/msg.c` y `core/session.c` (`ack`,
  `skipNotice`, `sessionNotify`), `core/nav.c` (`nav_open_session`), `logic/layout.c` (tarjeta de aviso, franjas, `layout_input_from_view`),
  `logic/input_logic.c` (gesto, L/R, Y, reglas de ceder), `render_bottom.c` (dibujo), `logic/guide.c`.

### Reglas de seguridad y pruebas

1. **Un aviso nunca se confunde con un permiso.** Aspecto distinto (azul, "AVISO", sin Aprobar/Rechazar); la zona de "Visto" y la de
   aprobar nunca existen a la vez (`layout_compute` ignora el aviso si hay tarjeta de permiso); A sobre un aviso emite `ack`, jamás
   `decision`. Pruebas: `test_layout_notice`, `test_ack_never_decides_even_with_pen_on_permission_zone`.
2. **Un permiso que llega le quita la pantalla al aviso y ninguna pulsación empezada sobre el aviso aprueba nada.** El gesto de "Visto"
   vive en su propia máquina: cuando llega el permiso se anula (`input_view_changed`, y en cada cuadro `input_frame`), y la máquina de
   aprobar solo conoce la tarjeta de permiso (la pulsación empezó antes → anulada, y aprobar exige pasar su propia guarda de 500 ms).
   También vale con el lápiz. Pruebas: `test_permission_takes_over_pressed_ack`, `test_permission_takes_over_pressed_pen`,
   `test_permission_with_notice_in_same_view` (un puente con errores que mande las dos: manda el permiso), `test_new_notice_restarts_guard`
   (verificado a mano: quitar la anulación hace fallar las pruebas).
3. **Guarda:** una pulsación que empezó antes de que apareciera el aviso, o dentro de los 500 ms, no lo marca
   (`test_ack_guard_press_before_card`, `test_ack_with_a`, `test_ack_with_pen`); un envío fallido no deja el aviso bloqueado
   (`test_ack_failed_send_not_locked`).
4. **Menú, guía, lector y diagnóstico ceden ante un aviso como ante un permiso** (misma regla elegida): una tarjeta de aviso que
   llega **cierra** el menú (y la guía que abrió) y el lector normal; con un aviso a la vista **SELECT no abre el menú** (primero se
   marca "Visto"; con el diagnóstico abierto SELECT sigue sin hacer nada). La única excepción es el lector abierto con "Leer todo" de
   ese mismo aviso, que el aviso no cierra (el permiso sí). El diagnóstico tapa todo, traga A y anula el gesto en curso.
   Pruebas: `test_select_ignored_with_notice`, `test_notice_closes_menu_and_guide`, `test_notice_closes_normal_reader`,
   `test_diag_swallows_ack_and_drops_gesture`, `test_notice_read_strip`, `test_permission_closes_notice_reader`,
   `test_notice_reader_reloads_on_new_message`.
5. **Y no cambia de significado con un permiso a la vista** (sigue siendo "siempre"): `test_y_notify_conditions`.

### Simulador (`packages/simulator`)

El mismo comportamiento: `public/notice.js` (módulo puro: `noticeShown`, `noticeApproval`, `skipNoticeMessages`, `cycleNotifyMessages`,
`chimeStep`), `reader.js` (`fromNotice`), `menu.js` y `nav.js` (`openSession`) ajustados, y `app.js`/`bottom.js` con la tarjeta azul,
la franja "Y: avisos" y el gesto de "Visto" en una segunda instancia de `approve.js`. Teclas: **A** marca "Visto" (con un aviso a la
vista, Enter se traga), **L/R** (Q/W) otro aviso, **Y** el modo de aviso en el detalle, **S** no abre el menú con un aviso. La guía del
simulador lo menciona.

### Pruebas (paso 3a)

- puente: `notify.test.ts` (56: tabla de modos por hecho, un caso por modo × hecho, sin "Visto", globo de la cara por modo, `silent`,
  agente oculto, tarjetas: contenido/título/una por sesión/retiro/permisos primero/`skipNotice`/LED, `chime` con `seq`, hooks de Claude
  Code, mensajes por el puente real con lo inválido ignorado, `notify-modes.json`), más los ajustes a `face`, `view`, `events` e
  `integration-sessions` (el globo "empezó a trabajar" ya es solo de `all`; el LED queda en `done` hasta el "Visto");
- protocolo: fixtures nuevos y dos pruebas de compatibilidad (`notice`/`chime`/`detail.notify` opcionales, `ack`/`skipNotice`/`sessionNotify`);
- cliente en C: `test_notice.c` (31 pruebas, 196 aserciones: disposición, "Visto" con A y lápiz, guarda, permiso que llega, L/R, Y y franja,
  menú/guía/lector/diagnóstico, "Leer todo", mensajes), `test_view.c` (variantes de `notice`/`chime`/`detail.notify` contra zod),
  `test_msg.c`, `test_session.c`, `test_guide.c`;
- simulador: `notice.test.ts`.

### Decidido y pendiente

- **Sin sonido:** `chime` se lee y se guarda, nada suena (paso 3b).
- La **cara ambiente** (sesiones que trabajan, rotando) se mantiene en `all`, `important` y `end`: se tomó como estado, no como aviso. Solo
  el globo de "empezó a trabajar" depende del modo (`all`). Si se prefiere que `important` no muestre ambiente, es un cambio de una línea.
- Un aviso de error solo existe en `all` e `important` (en `end` no: "solo al terminar").
- Con un aviso fijo (con "Visto" activo) SELECT no abre el menú hasta marcarlo: es la misma regla que con un permiso, pedida así; si molesta,
  "Pedir Visto" se puede apagar desde el menú mientras no haya aviso a la vista, o bastará con marcar "Visto".
- Un `ack` solo retira la tarjeta del puente: si había varias consolas, la tarjeta se va de todas.
- Probado con el simulador en el navegador contra un puente de prueba (puertos efímeros): tarjetas "Terminó" y "Error" por `/event`,
  L/R, "Visto", "Leer todo" y un permiso que llega con el lector abierto (lo cierra y muestra su tarjeta), Y cambiando el modo (queda
  en `notify-modes.json`); **falta probarlo en la consola real**.

### Paso 3b — Sonido

**Estado (2026-11-15): hecho y visto en la New 3DS XL.** El diagnóstico dice `sonido: ok` y el aviso de fin de turno suena
bien. Primera prueba sin sonido: el volumen de la consola estaba bajo (el sonido es moderado a propósito, `CHIME_PEAK` 11000);
con el volumen arriba sonó. Falta oír los otros tres sonidos (pregunta, error, permiso) cuando lleguen en uso normal.

**Objetivo:** que cada `chime` de la vista suene en la consola (hecho, pregunta, error, permiso), sin que el usuario tenga que copiar
nada a la SD. Sonido con `ndsp`, que exige `sdmc:/3ds/dspfirm.cdc` (el firmware del DSP de Nintendo: no se puede repartir con la app).
Decisión tomada con el usuario: **si falta, la app lo extrae sola al iniciar, del sistema de la propia consola, como la herramienta DSP1.**

#### Cómo lo hace DSP1 (investigado)

[DSP1](https://github.com/zoogie/DSP1) (zoogie, licencia **MIT**, `source/main.c`) es un volcador de firmware del DSP. Lo que hace:

1. **Qué lee:** el `.code` del **menú HOME** (el firmware del DSP va empaquetado dentro del HOME). Prueba los seis títulos de
   regiones en la NAND: `0004003000008F02` (EE. UU.), `...8202` (Japón), `...9802` (Europa), `...A102` (China), `...A902` (Corea),
   `...B102` (Taiwán); en cada consola existe uno solo y se queda con el primero que abre.
2. **Cómo lo abre:** `FSUSER_OpenFileDirectly` con el archivo especial de ExeFS (`0x2345678A`), ruta de archivo binaria
   `{ id del título bajo, id alto, tipo de medio 0 = NAND, 0 }` y ruta del archivo `{0, 0, 2, ".code"}` (el 2 es el tipo de nombre de ExeFS).
   Solo lectura. No usa `am` ni instala nada, y no necesita más permisos que los de un `.3dsx` lanzado desde el Homebrew Launcher con
   Luma (DSP1 mismo existe como `.3dsx` y como CIA).
3. **Cómo encuentra el firmware:** el `.code` está comprimido con el LZSS "hacia atrás" de la 3DS (pie de 8 bytes: tamaño de la zona
   comprimida y largo del pie, y los bytes que crece al descomprimir). Se descomprime, se busca el texto `DSP1` y el bloque empieza
   **0x100 bytes antes** (la firma RSA); el entero que sigue al texto es el tamaño (normalmente `0xC25C`). Una tabla en `0x120` de
   hasta 10 secciones (0x30 bytes: desplazamiento, tamaño, SHA-256) permite comprobar la integridad.
4. **Qué escribe:** `sdmc:/3ds/dspfirm.cdc` con ese bloque. Si algún SHA-256 no coincide, DSP1 avisa pero **lo escribe igual**;
   nosotros no.

Nuestro código es propio (`logic/dspfirm.c` y `dsp_extract.c`), con el método de DSP1 y atribución en los comentarios; no copiamos
su código (la descompresión LZSS de DSP1 viene de ctrtool). Diferencias a propósito: rechazamos un bloque que no verifica; todos los
tamaños y desplazamientos se comprueban contra los límites antes de leer; la escritura va a un `.tmp`, se relee y se verifica, y recién
entonces se renombra; y solo se escribe ese archivo.

#### Arranque (`app.c: init_sound`, `sound.c`)

1. Si existe `sdmc:/3ds/dspfirm.cdc` (con tamaño > 0) → `ndspInit` directo.
2. Si falta → pantalla **"Preparando el sonido…"** ("Un momento, solo pasa la primera vez."), extracción y luego `ndspInit`. Tarda
   del orden de un segundo (lee el `.code` del HOME, unos pocos MB, lo descomprime y calcula SHA-256).
3. Si la extracción o `ndspInit` fallan: la app **sigue sin sonido**, muestra el motivo en una pantalla corta (4 s, o cualquier botón) y lo
   deja en el **diagnóstico** (L+R 1 s), línea nueva `sonido: ok` · `sonido: sin dspfirm (extraer <código>)` · `sonido: error <código>`
   (el diagnóstico perdió su línea de "fallos de red seguidos": ahora van en la primera, `... fallos N`). No se reintenta en
   caliente; en el siguiente inicio se vuelve a intentar.
4. `ndspExit` y liberación de los búferes al salir (`app_exit`).

Mensajes posibles (español claro): "No se encontró el firmware de sonido en esta consola." · "No se pudo leer el firmware de sonido." ·
"El firmware de sonido de la consola no es válido." · "No se pudo escribir en la tarjeta SD." · "Falta memoria para preparar el sonido." ·
y si se extrajo bien pero `ndspInit` no arrancó en esa misma sesión: "El sonido quedó listo: cierra la app y ábrela de nuevo."
(el archivo ya está en la SD; en el siguiente inicio se usa directo).

**Qué puede salir mal:** consola con el HOME de una región no contemplada o sin permiso de ExeFS (poco probable con Luma) → "No se
encontró…"; SD protegida o llena → "No se pudo escribir…"; poca memoria → "Falta memoria…" (el `.code` descomprimido puede pasar de
3 MB; el tope es de 16 MB); `ndspInit` falla por algo del sistema → "error <código>". Nada de esto cierra la app. No se toca ningún
archivo del sistema ni de la NAND (solo lectura).

#### Los sonidos (`logic/chime.c`, `chime_synth`)

Se sintetizan al iniciar en búferes PCM16 mono de 32 728 Hz en memoria lineal (unos 107 KB en total), sin archivos externos. Cada uno dura
≤ 400 ms, con ataque de 8 ms y caída de 28 ms suavizados (sin clics) y un volumen moderado (pico 11 000 de 32 767):

| `chime.kind` | Sonido | Duración |
| :--- | :--- | :---: |
| `done` | dos notas que suben, do5 → sol5 | 370 ms |
| `ask` | deslizamiento ascendente 440 → 740 Hz y un toque agudo (como pregunta) | 370 ms |
| `error` | dos pulsos graves, 196 Hz y 155 Hz, con algo de armónico | 330 ms |
| `permission` | tres toques agudos (mi6, la6, mi6), más brillantes | 340 ms |

Un solo canal de `ndsp` (el 0), salida estéreo con la señal en los dos lados. `sound_play` corta lo que suene y encola el siguiente sin
bloquear el bucle.

**Cuándo suena** (`ChimeGate`, probado en `test_chime.c`): una vez por `chime.seq` nuevo.
- El primer `seq` que se ve tras (re)conectar es el punto de partida y **no suena**.
- Una vista sin `chime` pone el punto de partida en 0 (el primer aviso de un puente nuevo, `seq` 1, sí suena).
- Un `seq` menor al punto de partida (el puente se reinició) lo reinicia sin sonar.
- Con el ajuste apagado o sin `ndsp` el punto de partida avanza igual: al encender no se sueltan avisos viejos.
- Máximo un sonido cada 1,5 s; los que llegan antes se descartan (no se acumulan).

#### El ajuste "Sonido"

Entrada nueva del menú (SELECT), tercera de la raíz: **"Sonido: sí/no"** (A o izquierda/derecha alternan). Ajuste del puente
`sound` (booleano, por defecto `true`; `.companion/settings.json` sin el campo se carga igual y vale `true`). Mensaje
`{"t":"setting","key":"sound","value":true|false}`; en la vista, `settings.sound` (opcional: un puente anterior no lo manda y la consola
lo toma como activo). Si la consola no tiene sonido (sin `dspfirm` o `ndspInit` con error) la fila dice **"sin sonido en esta consola"**
pero se puede cambiar igual (el valor queda guardado en el puente). El menú ya no cabía con 6 filas: las filas sin ayuda bajaron a 22 px
y el menú empieza 2 px más arriba. El simulador espeja la entrada (sin audio).

#### Código y pruebas

- **Cliente:** `logic/dspfirm.c` (LZSS, búsqueda y verificación), `logic/chime.c` (compuerta y síntesis), `dsp_extract.c` (lectura del HOME
  y escritura de la SD), `sound.c` (ndsp), `app.c` (`init_sound`, `chime_gate_step` en cada vista nueva, reinicio de la compuerta al
  conectar y al cerrar la sesión), `logic/menu.c`, `render_menu.c`, `core/msg.c`/`session.c`/`view.c` (`sound`), `logic/diag.c`.
- **Puente y protocolo:** `settings.ts` (campo `sound` con su valor por defecto por campo), `SettingChangeSchema`, `SettingsViewSchema`
  (`sound` opcional), fixtures `console-setting-sound`, `bridge-view-settings-sound-off`.
- **Pruebas:** `test_dspfirm.c` (compresor de prueba voraz propio: ida y vuelta, literales y coincidencias, entradas rotas sin
  desbordes, bloque con señuelo, SHA-256 alterado, tamaños fuera de rango), `test_chime.c` (compuerta y síntesis), ajustes en
  `test_menu.c`, `test_input.c`, `test_msg.c`, `test_view.c`, `test_diag.c`; `settings.test.ts`, `menu.test.ts` (simulador).
- **No probado en la consola real:** la lectura del `.code` del HOME con `FSUSER_OpenFileDirectly`, `ndspInit` tras la extracción en
  la misma sesión y el sonido mismo (volumen, claridad) solo se pueden ver ahí.

#### Qué mirar la primera vez en la consola

1. Al abrir la app, si no hay `dspfirm.cdc`: pantalla "Preparando el sonido…" un instante y luego la app normal (sin más mensajes).
2. Si aparece un mensaje en vez de eso, leerlo (se cierra solo a los 4 s) y mirar el diagnóstico (L+R 1 s): línea `sonido:`.
3. Menú (SELECT): fila "Sonido: sí". Provocar un aviso (terminar un turno): suena una vez; el primero tras conectar no suena a propósito.
4. Cerrar y volver a abrir la app: ya no debe aparecer "Preparando el sonido…" (el archivo quedó en la SD).

## Paso 4 — Preguntas con alternativas (AskUserQuestion)

**Estado (2026-11-15): hecho y verificado en la New 3DS XL con Claude Code real (app de escritorio).** La pregunta se ve a la vez en el PC y en la 3DS. Respondida en la 3DS, Claude recibe la respuesta y el PC cierra la pregunta; respondida en el PC, la tarjeta de la 3DS se retira. Sin probar aún: multiSelect, varias preguntas, "Otra…" con el teclado y "Responder en el PC".

**Objetivo:** cuando Claude Code usa `AskUserQuestion` (grill-me y cualquier skill), la pregunta aparece en la consola con
sus opciones y se responde desde ahí; la respuesta llega a Claude como si se hubiera elegido en el PC.

### Mecanismo oficial (Claude Code)

- Un hook **`PermissionRequest`** (el mismo de los permisos, entrada `*`) recibe `AskUserQuestion`, manda la pregunta al puente y
  espera. Para responder imprime:
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"questions":<las mismas>,"answers":{"<texto de la pregunta>":"<etiqueta>"}}}}}`.
  Varias etiquetas (multiSelect) se unen con `", "`. "Otra" manda el texto escrito en lugar de una etiqueta. Un `allow`
  sin `answers` no sirve.
- **Verla en los dos lados:** un hook `PermissionRequest` no bloquea la interfaz: Claude Code muestra la pregunta en el PC mientras el hook
  espera, así que la pregunta está en el PC y en la 3DS a la vez y vale la primera respuesta. (La primera versión usaba un hook
  `PreToolUse` con `matcher: "AskUserQuestion"`; bloqueaba y el PC no mostraba la pregunta, así que se dejó. La rama sigue en el hook como
  legado.)
- Sin salida (y código 0) = Claude Code decide en el PC. Es la salida ante **cualquier** fallo: puente apagado, sin consola
  conectada, entrada rara, el ajuste apagado o la consola elige "Responder en el PC".
- **Respondida en el PC:** Claude Code **no mata** el proceso del hook que espera. El hook `PostToolUse` (o `PostToolUseFailure`) de
  `AskUserQuestion` llega al puente, que retira la tarjeta **por nombre de herramienta** (Claude añade `answers` al `tool_input`, así
  que ya no coincide con el de la pregunta) y cierra la petición abierta del hook con `{"decision":"ask"}` (`answered_elsewhere`); el
  hook sale sin salida. Una sesión hace una pregunta a la vez, por eso basta el nombre.
- "Responder en el PC" en la tarjeta: ahora solo quita la tarjeta de la 3DS y deja la pregunta en el PC (ya estaba ahí). Se conserva la fila
  como forma de descartarla desde la consola. Si la consola se desconecta mientras espera, el puente cierra la petición con `ask`.
- Se reutiliza `packages/hooks/permission-hook.mjs` (ramifica por `hook_event_name`), con la misma vigilancia del padre, sin plazo
  propio y la misma regla de seguridad (ante la duda, sin salida).
- `settings.example.json` no necesita entrada propia: la de `PermissionRequest` con `*` ya la cubre. **La configuración global del
  usuario (`~/.claude/settings.json`) se toca solo con su permiso.**

### Puente

- `POST /question` con `{session_id, cwd, tool_input}`. Valida `questions` (1 a 4; cada una `question`, `header`,
  `options` de 2 a 4 con `label` y `description`, `multiSelect`). Si no cumple, o no hay consola, o `questions` está
  apagado: responde `{"decision":"ask"}` en el acto. Si no, encola una **solicitud de tipo pregunta** en la misma cola
  que los permisos (mismo orden, L/R, `pendingCount`, prioridad sobre los avisos, retirada al terminar la sesión o al
  responderse en otra parte) y deja la respuesta HTTP abierta hasta que la consola conteste.
- Respuesta al hook: `{"decision":"answer","answers":{...}}` (el hook arma el `updatedInput`) o `{"decision":"ask"}`.
- La etiqueta "(Recommended)" o "(Recomendado)" al final de una opción se quita al mostrarla y se marca como recomendada;
  la respuesta manda la etiqueta **completa, tal cual llegó**.
- Ajuste nuevo `questions` (booleano, `true` por defecto): "Preguntas en la 3DS: sí/no" en SELECT.
- La consola manda índices, no textos; el puente traduce a etiquetas completas (así el recorte de pantalla no afecta la
  respuesta).

### Protocolo (campos opcionales, compatibles hacia atrás)

- Vista: la solicitud enfocada puede ser `request.kind: "question"` con `questions: [{header, text, multi,
  options: [{label, desc, recommended}]}]` (textos recortados a los límites de la vista; `text` en hasta
  `MAX_QUESTION_LINES` líneas, `desc` en 2 líneas cortas). Una consola vieja que no entiende `kind` la debe ignorar
  sin aprobar nada (comprobar en los fixtures).
- Consola → puente: `{"t":"answer","requestId","answers":[{"choose":[0,2]} | {"other":"texto"}]}` (una entrada por
  pregunta, en orden) y `{"t":"answer","requestId","pc":true}` para "Responder en el PC". Un `answer` inválido se
  ignora y se registra (como `setting`), no cierra la conexión.
- `{"t":"hold","seconds":N}` (N ≤ 300) antes de abrir el teclado del sistema: el puente no corta la conexión por
  silencio durante ese tiempo (el teclado congela la app). Al volver, la consola sigue normal.

### Consola (3DS)

- Tarjeta de pregunta (pantalla de abajo): encabezado (`header`) y texto arriba; opciones abajo, una por fila, con la
  descripción en letra de cuerpo y una estrella en la recomendada. Al final, siempre: **"Otra…"** (abre el teclado) y
  **"Responder en el PC"**. Arriba (pantalla superior) la cara dice "Te hace una pregunta" como hoy.
- Cruceta arriba/abajo o lápiz para marcar; **A** elige (en multiSelect, A marca o desmarca y una fila final
  "Listo" envía). Con varias preguntas se avanza una por una ("1/3") y se envían todas juntas al final; B vuelve a la
  pregunta anterior (en la primera, B no hace nada: **nunca rechaza ni responde**).
- Mismas guardas que aprobar: 500 ms desde que llega la tarjeta antes de aceptar A o el lápiz; la tarjeta enfocada cierra
  lector, menú y avisos como un permiso.
- "Otra…": manda `hold`, abre `swkbd` (hasta 200 caracteres, sin vacío), y lo escrito es la respuesta de esa pregunta.

### Simulador

Igual que la consola (misma vista y mismos mensajes), para probar en el PC sin la 3DS.

### Pruebas

- Hook: allow con `updatedInput` correcto (una y varias preguntas, multiSelect, "Otra"), salida vacía en cada fallo, el
  PermissionRequest sigue igual.
- Puente: validación de `questions`, retención solo con consola y ajuste, liberación al desconectar, traducción de
  índices a etiquetas completas, "(Recommended)" quitado en la vista y conservado en la respuesta, `hold`.
- Cliente (host en C): parseo de la vista con `kind:"question"` (fixtures del generador), navegación, multiSelect,
  B nunca envía, guardas de 500 ms.

### Lo escrito (decisiones más allá del diseño)

- **Hook:** el mismo `packages/hooks/permission-hook.mjs` ramifica por `hook_event_name`. Con `PermissionRequest` (y, como legado, `PreToolUse`) de `AskUserQuestion` manda
  `{session_id, cwd, tool_input}` a `POST /question` y, si el puente contesta `{"decision":"answer","answers":{...}}`, imprime el
  `allow` (`behavior: "allow"` en PermissionRequest) con `updatedInput: {...tool_input, answers}` (las mismas preguntas más `answers`). Solo se imprime con `answers` no vacío y de
  textos; cualquier otra cosa, el puente apagado o un error: sin salida y código 0. Misma vigilancia del padre y sin plazo propio.
  `settings.example.json` no suma entrada: la de `PermissionRequest` con `*` cubre `AskUserQuestion` (la entrada `PreToolUse` con
  `matcher: "AskUserQuestion"` de la primera versión se quitó; el `*` de `PreToolUse` sigue siendo el hook http de estado).
- **Puente:** `packages/bridge/src/questions.ts` valida `tool_input` (1 a 4 preguntas, 2 a 4 opciones; `header`, `description` y `multiSelect`
  que falten toman un valor por defecto; un texto de pregunta repetido se rechaza porque las respuestas se indexan por ese texto) y
  traduce índices a etiquetas completas. Si no cumple, no hay consola o `questions` está apagado: `{"decision":"ask"}` en el acto. La
  solicitud entra en la misma cola que los permisos (`kind: "question"`); el puente **ignora una `decision` sobre una pregunta** (defensa
  para una consola que no entienda `kind`) y solo `answer` la resuelve. Se libera al PC al desconectarse la consola, al apagar el ajuste,
  al terminar la sesión, al cerrarse el hook o al resolverse en otra parte. Un `answer` que no cuadra (índices, cantidad, texto vacío) se
  ignora y se registra; la pregunta sigue esperando.
- **Vista:** `request.kind`/`questions` son opcionales; `request.lines` lleva el texto de la primera pregunta para que una consola vieja
  muestre algo. Si una pregunta enorme no cabe en una trama (4 preguntas de 4 opciones con textos al límite y 12 sesiones al límite, todo en
  caracteres de 3 bytes), `buildView` le quita descripciones y líneas por niveles hasta que quepa; las opciones y sus etiquetas nunca se tocan.
  La cara dice "Claude te hace una pregunta" con el texto de la pregunta en hasta 3 líneas.
- **`hold`:** la consola manda `{"t":"hold","seconds":300}` antes de abrir el teclado; el puente suma esos segundos al plazo de silencio
  (15 s) y el plazo normal vuelve con la primera trama que llega después (también un PING).
- **Consola:** la pregunta tiene su propia pantalla (`render_question.c`) y máquina de estados (`logic/question.c`, espejo de
  `packages/simulator/public/question.js`). Filas: opciones, **Listo** (solo multiSelect), **Otra…** y **Responder en el PC**. La
  descripción de la fila marcada va en un panel fijo bajo las filas (así caben 7 filas con una pregunta de 3 líneas); la recomendada lleva
  una estrella dibujada y el multiSelect casillas dibujadas (la fuente del sistema puede no tener esos glifos). La guarda de 500 ms
  cuenta desde que llega la tarjeta **y vuelve a contar en cada cambio de pregunta** (un doble toque no elige también la siguiente). El
  lápiz marca la fila al apoyar y elige solo si se suelta sobre la misma fila. L/R saltan a otra solicitud (como con los permisos).
  La pregunta nunca entra en la máquina de aprobar: nada de lo que se pulse emite una `decision` (probado con todas las teclas y con el
  lápiz sobre toda la pantalla). El menú, la guía, el lector y los avisos ceden ante ella.
- **Menú (SELECT):** entrada nueva **"Preguntas en la 3DS: sí/no"**, cuarta de la raíz (después de Sonido), ajuste `questions` del puente
  (booleano, `true` por defecto; `settings.questions` opcional en la vista). La raíz tiene 7 filas: bajaron a 19 px (las dos con ayuda,
  30 px) con 1 px de separación. El simulador la espeja.
- **Cliente (cambios de fondo):** `JSON_MAX_TOKENS` pasó de 384 a 768 (una vista con 12 sesiones y una pregunta de 4x4 usa unos 520);
  `session_send_answer` usa un búfer propio (`MSG_ANSWER_MAX` 6 144) porque la respuesta con texto pasa de los 256 bytes de los demás mensajes.

### Instalar el hook

No hay nada que agregar si ya tienes el hook de permisos: la entrada `PermissionRequest` con `matcher: "*"` de
`packages/hooks/settings.example.json` (comando `node .../packages/hooks/permission-hook.mjs`, `timeout` 86400) recibe también
`AskUserQuestion`. Si en `~/.claude/settings.json` quedó la entrada antigua `PreToolUse` con `matcher: "AskUserQuestion"`, hay que
quitarla (bloquea y el PC no muestra la pregunta).

### Pruebas (en el PC)

- **Hook:** allow con `updatedInput` (una y varias preguntas, multiSelect, "Otra" con comillas y ñ), salida vacía en cada fallo (respuesta rara,
  500, puente apagado, entrada rara), espera sin plazo, vigilancia del padre, y ExitPlanMode sigue sin salida. Para PermissionRequest de `AskUserQuestion`: allow con `updatedInput`, salida vacía con `ask`/fallos, y la rama PreToolUse legada.
- **Puente:** `questions.test.ts`, `question-flow.test.ts` (cola compartida, liberaciones, decision ignorada, vista, cara) e
  `integration-questions.test.ts` (HTTP `/question` con consola TCP y simulador, `answer` inválido que no cierra la conexión, `hold`
  que no corta y que vence solo, desconexión mientras espera, anulación del hook), `size.test.ts` (la pregunta más grande cabe).
- **Cliente (host en C):** `test_question.c` (estado, geometría, integración con `input_logic`, seguridad), `test_msg.c` (answer con escapes
  y límites), `test_session.c` (envíos sellados), `test_view.c` (fixtures del generador, incluidas las vistas máximas con pregunta),
  `test_menu.c`, `test_input.c`.
- **Simulador:** `question.test.ts`; además se vio funcionando en el navegador contra un puente de prueba (responder, "Responder en el PC").

### Qué mirar la primera vez en la consola

1. Con el hook de permisos instalado (sin entrada `PreToolUse` de `AskUserQuestion`), pedirle algo que use `AskUserQuestion` (por ejemplo una skill con preguntas).
2. La cara dice "Claude te hace una pregunta" con el texto y la pantalla de abajo muestra la tarjeta: encabezado, texto, una fila por opción
   (estrella en la recomendada), "Otra…" y "Responder en el PC", y la descripción de la fila marcada abajo. La misma pregunta
   está a la vez en el PC; vale la primera respuesta.
3. Elegir con arriba/abajo y A. Con varias preguntas se pasa de una a otra ("1/3" arriba a la derecha) y recién al final Claude recibe todo;
   B vuelve a la anterior. En multiSelect: A marca, "Listo" envía.
4. "Otra…": se abre el teclado (la app se congela unos segundos: es normal, avisó con `hold`), escribir y "Enviar"; en el PC debe verse
   la respuesta escrita como si se hubiera elegido allí. Cancelar el teclado no responde nada.
5. Comprobar que el texto cabe: etiquetas de 38 caracteres, la pregunta de 3 líneas y las 7 filas de una pregunta multiSelect de 4 opciones.
6. "Responder en el PC": la tarjeta desaparece y la pregunta sigue en el PC. Responder en el PC sin tocar la 3DS: la tarjeta se retira.
7. Apagar "Preguntas en la 3DS" en el menú (SELECT): la siguiente pregunta debe salir directo en el PC. Con la consola apagada o
   sin conexión, también.
8. Por seguridad: pulsar A apenas aparece la tarjeta (antes de medio segundo) no debe elegir nada, y B nunca debe contestar.
9. Ver que el sonido de "pregunta" suena una vez al aparecer (lo dispara el hook de estado de siempre) y que el LED queda en "pregunta".

## Paso 5 — Versión resumida

**Estado (2026-11-15): hecho y visto en la New 3DS XL.** X alterna resumen y completo en el lector; cabecera, pie y el menú de 8 filas se ven bien. La calidad del resumen se ajustó con un mensaje real (una viñeta por sección, secciones "Sin probar" como pendientes). Ver "Cómo quedó" y "Qué mirar la primera vez" al final de este paso.

**Decisión del usuario (2026-11-15):** el resumen base es **sin modelo** (extractivo): gratis, instantáneo y sin que el
texto salga del PC. Un resumen con modelo queda como mejora opcional para después. Recomendación anotada: ofrecerlo
con la suscripción de Claude del propio usuario (`claude -p` con Haiku, sin clave ni cobro aparte) o con su clave de la
API (Haiku 5.5: US$0,10 / US$0,50 por millón de tokens, unos US$0,0002 por resumen, unos US$0,50 al mes con 100
resúmenes al día); un plan de pago con servidor propio solo si hay demanda (servidor, cuentas, cobros y privacidad
cuestan más que el modelo).

**Objetivo:** en el lector, **X** alterna entre el mensaje completo y un resumen corto que cabe en una pantalla.

### Resumen extractivo (`packages/bridge/src/summary.ts`)

Función pura `summarize(markdown, opts) -> string[]` (líneas ya cortadas a `MAX_READ_TEXT`), sobre el mismo texto que usa
el lector (`renderPlain`), con un tope de **12 líneas** (una pantalla del lector sin pregunta):

1. **Primera idea:** la primera oración del primer párrafo de prosa (hasta 2 si la primera es muy corta, menos de 40
   caracteres). Esa suele ser la conclusión ("Listo: …", "Funcionó…", "El problema era…").
2. **Puntos clave:** después, hasta 5 viñetas `• ` elegidas en orden de aparición entre: títulos (`#`, o líneas cortas en
   negrita que terminan en `:`), el texto en negrita al comienzo de un ítem de lista (`- **Hook:** …` → "Hook: …" con su
   primera frase), e ítems de lista de primer nivel. Cada viñeta, una sola idea recortada a su primera frase.
3. **Lo que queda abierto:** si alguna oración o ítem contiene "falta", "pendiente", "sin probar", "no se probó",
   "todavía", "¿", o termina en "?", se agrega al final (prioridad sobre los puntos clave si no caben). Si hay pregunta
   pendiente de la sesión, no se repite (ya va arriba en el lector).
4. **Se descarta:** bloques de código, tablas (se convierten en "(tabla de N filas)" solo si no hay otra cosa), enlaces
   reducidos a su texto, rutas largas acortadas al último tramo.
5. Si el mensaje ya cabe en 12 líneas, el resumen **es** el mensaje y la consola lo dice ("El mensaje ya es corto").

Pruebas con mensajes reales: copiar 5 o 6 mensajes finales de esta sesión (español, viñetas, negritas, tablas, código)
como fixtures y fijar la salida esperada.

**Extensión futura:** `summary.ts` exporta una interfaz `Summarizer` (`extractive` hoy); un `claude`/`api` posterior la
implementa sin cambiar el protocolo.

### Protocolo (compatible hacia atrás)

- `read` acepta `mode` opcional: `{"t":"read","sessionId","mode":"summary"}` (`"full"` por defecto).
- `text` lleva `mode` (`"full"` o `"summary"`) y, en resumen, `short: true` si el mensaje ya cabía entero.
- Fixtures nuevos (`console-read-summary`, `bridge-text-summary*`) y el generador del cliente en C los incluye.

### Ajuste

`readerDefault`: `full` · `summary` (por defecto `full`): "Abrir mensajes en: completo / resumen" en SELECT. El lector
abre en ese modo; X alterna.

### Consola (3DS)

- En el lector, **X** pide el otro modo (`read` con `mode`), muestra "Cargando…" y empieza arriba. La cabecera dice
  "Resumen" o "Completo" y el pie "X: completo" / "X: resumen". Hoy X se traga en el lector: no pisa nada.
- La barra "mensaje nuevo · A recarga" recarga en el modo actual.
- Mismas reglas de seguridad que el lector (cede ante una tarjeta, guardas intactas).
- La guía ("Lo básico") menciona X en el lector.

### Simulador

Igual: X (o un botón) alterna, y el ajuste en su menú.

### Cómo quedó (2026-11-15)

Escrito y probado en el PC (puente, protocolo, simulador y cliente en C); **falta verlo en la consola**. El `.3dsx` se
compila (`client-3ds/agent-companion.3dsx`, unos 312 KB) pero no se ha enviado a la 3DS.

**Puente (`packages/bridge/src/summary.ts`).** `summarize(markdown, opts) -> string[]` es pura. Debajo está
`Summarizer { name, summarize(markdown, opts) -> { lines, short } }` y `extractive` es la única implementación hoy; un
resumen con `claude -p` o con la API se enchufa como otro `Summarizer` en `buildText(store, sessionId, mode, summarizer)` sin
tocar el protocolo. El algoritmo, sobre el markdown del mensaje (no sobre el texto ya plano):

1. Si `renderPlain` ya da 12 líneas o menos, el resumen **es** el mensaje y `short` es `true`.
2. **Primera idea:** primera oración de la primera prosa (dos si la primera mide menos de 40 caracteres), de hasta 130
   caracteres. Las etiquetas (`**Qué cambió:**`, `# Título`, una línea corta que termina en `:`) no cuentan como prosa.
3. **Pendientes (hasta 2):** oraciones o ítems con "falta(n)", "pendiente(s)", "sin probar", "no se probó", "no probé",
   "todavía", un `¿` o que terminan en `?` (se corta desde el `¿`). Salvo "si falta X…", que describe una comprobación. Si
   la sesión tiene una pregunta pendiente, la oración de la pregunta no se repite (el lector ya la muestra arriba).
4. **Puntos clave (hasta 5):** ítems de lista de primer nivel (la negrita inicial queda como "Hook: …") y títulos con
   prosa debajo ("Título: primera oración"), en orden de aparición, una sola oración cada uno. Un título que solo lo siguen
   una lista, una tabla o código no dice nada solo y se omite. Sin estructura (prosa corrida), los puntos son las oraciones
   que siguen a la primera idea.
5. Se descartan bloques de código y tablas; los enlaces quedan en su texto, los enlaces sueltos en su dominio y las rutas de
   más de 24 caracteres en el último tramo. Si solo hay una tabla: "(tabla de N filas)" (sin el encabezado). Si no queda
   nada reconocible (solo código), se muestra el comienzo del mensaje.
6. **Armado:** primera idea, línea en blanco, puntos, línea en blanco, pendientes. Si pasa de 12 líneas, se prueba con
   viñetas de una sola línea (44 caracteres), luego con menos puntos (hasta 2) y un solo pendiente, y por último sin
   puntos. La primera idea y los pendientes mandan sobre los puntos. Los cortes llevan "…".

**Protocolo.** `read.mode` (`"full"` | `"summary"`, opcional), `text.mode` y `text.short` (opcionales; un puente anterior
no los manda y el mensaje cuenta como completo), y el ajuste `readerDefault` (`SettingChangeSchema` y `settings.readerDefault`
opcional en la vista; en `.companion/settings.json` valores inválidos o ausentes caen a `full`). Fixtures:
`console-read-summary`, `console-read-full`, `bridge-text-summary`, `bridge-text-summary-short`, `bridge-text-full-mode`,
`bridge-view-settings-reader-summary` y los inválidos `*-bad-mode`, `*-bad-short`, `*-bad-reader`. El generador del cliente
(`gen-view-fixtures.ts`) suma `reader/summary-*`, `text-mut/mode-*`, `text-mut/short-*` y `mut/settings-reader-*`.

**Consola (3DS).**

- **X** en el lector, con el texto a la vista: pide el otro modo, muestra "Cargando…" y empieza arriba. Cargando, X no hace
  nada. Con una tarjeta de permiso el lector ya está cerrado y X es el modo de permisos de siempre.
- **Cabecera:** "Resumen" (amarillo) o "Completo" (gris) entre el proyecto y la posición. **Pie:** "X: completo" /
  "X: resumen" (también se puede tocar; un arrastre no cuenta) y, si el resumen es el mensaje entero, "Mensaje corto · X:
  completo".
- **El pie cuesta una fila:** el lector pasa de 14 a **13 líneas** (12 con la barra "mensaje nuevo", 8 con la pregunta de 3
  líneas), y la página de L/R, de 13 a 12. El simulador hace las mismas cuentas.
- **A recarga en el modo que se está viendo** (también la barra "mensaje nuevo"); el modo viene del documento (`text.mode`) y,
  si un puente anterior no lo manda, es completo aunque se haya pedido el resumen.
- **Menú SELECT:** nueva entrada **"Abrir mensajes en: completo / resumen"** (A o izquierda/derecha alternan) entre
  "Preguntas en la 3DS" y "Agentes". El menú raíz pasa a 8 filas y la línea de ayuda del pie queda de 14 px (antes 26).
- **Guía ("Lo básico"):** "X: completo o resumen. B vuelve atrás."
- Código: `core/reading.c` (`mode`, `whole`), `core/msg.c` (`msg_read(..., mode)`, `msg_setting_reader_default`),
  `core/view.c` (`settings.reader_default`), `logic/reader.c` (`mode`, pie, `reader_shown_mode`), `logic/input_logic.c`
  (X, pie táctil, `IN_ACT_READ` lleva el modo en `flag`, `IN_ACT_SETTING_READER`), `logic/menu.c`, `render_reader.c`,
  `render_menu.c`.

**Simulador.** `reader.js` (evento `toggle`, `mode`, `readMessage`), `menu.js` (entrada `reader`), `bottom.js` (cabecera y pie),
`app.js` (tecla X y toque en el pie).

**Pruebas.** `summary.test.ts` (7 mensajes finales de ejemplo con la salida fijada a mano, y las reglas una por una),
`reader.test.ts`, `settings.test.ts`, `integration-sessions.test.ts` (consola real con `mode`), protocolo, simulador
(`reader.test.ts`, `menu.test.ts`) y C: `test_msg.c`, `test_session.c`, `test_view.c`, `test_reader.c` (X, tocar el pie,
modo por defecto, recarga en el mismo modo, puente anterior, tarjeta), `test_menu.c`, `test_input.c`.

### Decidido en el paso 5

- El resumen se arma sobre el markdown (`parseBlocks`), no sobre el texto ya plano: así se distinguen títulos, negritas,
  ítems y tablas. La salida pasa por `renderPlain` para que el sangrado de las viñetas sea el del lector.
- No hay encabezado "Queda abierto:" (cuesta una línea de las 12): los pendientes van tras una línea en blanco, al final.
- Un título como punto clave solo se usa si tiene prosa debajo; con lista debajo, la lista habla por él.
- `short` solo se manda en `true`; `mode` se manda siempre desde este puente (en `full` también). Para la consola, `mode` y
  `short` ausentes valen `full` y `0`.
- El modo completo se pide sin campo (`{"t":"read","sessionId":…}`, igual que antes); solo el resumen lleva `mode`.
- Cambiar de modo con X no se recuerda: el lector siempre abre en `readerDefault`.

### Qué mirar la primera vez

1. Abrir un mensaje largo con A: la cabecera dice "Completo" y el pie "X: resumen". Pulsar X: "Cargando…" y luego el resumen
   desde arriba, con "Resumen" en amarillo y el pie "X: completo".
2. ¿El resumen dice lo importante? Primera línea (la conclusión), 3 a 5 viñetas y, tras una línea en blanco, lo que falta o
   quedó sin probar. Probar con un mensaje con tabla o con código largo y con uno que termine en pregunta.
3. Un mensaje corto: X debe mostrarlo igual con "Mensaje corto · X: completo".
4. Que el pie de una fila no tape la última línea ni la barra de desplazamiento, y que tocar el pie alterne.
5. SELECT > "Abrir mensajes en: resumen": al abrir otro mensaje con A, entra directo en resumen; X vuelve al completo.
6. Mensaje nuevo mientras se lee: "mensaje nuevo · A recarga" y A recarga en el mismo modo.
7. Una tarjeta de permiso mientras se lee el resumen: cierra el lector y A / B siguen siendo aprobar / rechazar.
8. En la guía ("Lo básico") la línea "X: completo o resumen. B vuelve atrás." y que el menú raíz de 8 filas se lea bien.

## Paso 6 — Dar instrucciones a una sesión (texto)

**Estado (2026-11-15): escrito y probado en el PC (puente, protocolo, hook, simulador y consola 3DS compilada con sus pruebas de host); falta instalar el hook `Stop` en `~/.claude/settings.json`, reiniciar el puente y verlo en la consola.** La voz queda para después (prueba 0.6 y Fase 5a).

### Lo que probamos antes de diseñar (2026-11-15)

- **`claude -p` con un hook `Stop` de prueba:** responder `{"decision":"block","reason":"<texto>"}` hace que Claude siga con ese
  texto como instrucción (un segundo `Stop` llega con `stop_hook_active: true`).
- **App de escritorio, esta misma sesión, tres veces:** un hook `Stop` que espera ~40 s y luego entrega un texto funciona:
  Claude retoma solo (la app lo muestra como "Stop hook feedback" / "blocking error", es solo la etiqueta). **Pero mientras el
  hook espera, la sesión queda ocupada y el usuario no pudo escribir en el PC.** Por eso la espera no puede ser lo normal:
  solo en las sesiones donde el usuario la pide.

### Lo que hace

1. **Instrucción para después (sin espera).** Desde el detalle de una sesión, el usuario escribe un texto (teclado del
   sistema). El puente lo guarda en una cola por sesión y lo entrega **en el próximo `Stop`** de esa sesión, en el acto. Si
   la sesión trabaja, eso es al terminar su turno. Varias instrucciones se juntan en orden, separadas por línea en blanco.
2. **"Esperar mi respuesta" (por sesión, apagado por defecto).** Si está activo y hay consola conectada, al terminar el
   turno sin nada en cola el puente **retiene el `Stop`** y la consola muestra una tarjeta "Espera tu instrucción" en la
   cola de tarjetas (como permisos y preguntas: mismo orden, L/R, `pendingCount`, prioridad sobre avisos). La tarjeta ofrece
   **A: Escribir** (abre el teclado; lo escrito se entrega) y **Seguir en el PC** (libera sin instrucción). Se libera sola
   al desconectarse la consola, al terminar la sesión, al apagar el modo, o al cumplirse `instructWaitMax` (por defecto 10 min).
3. **Sesión ya terminada y sin el modo 2:** la instrucción queda en cola y la consola lo dice claro: "Se entrega cuando la
   sesión termine su próximo turno (escríbele desde el PC para que siga)". Se puede borrar desde el detalle.

### Hook (`packages/hooks/permission-hook.mjs`, rama por `hook_event_name === "Stop"`)

- Se agrega en `Stop` un hook **command** (además del http que ya existe para el estado), `timeout` 3600.
- `POST /stop` con `{session_id, cwd, stop_hook_active}`. Respuestas del puente: `{"decision":"instruct","text"}` →
  imprime `{"decision":"block","reason":"Instrucción desde la 3DS:\n<texto>"}`; `{"decision":"none"}` → sin salida.
- Misma regla de seguridad que los otros: ante cualquier fallo, sin salida y código 0 (Claude termina normal). Misma
  vigilancia del padre. Sin cola ni modo activo el puente responde en el acto, así que el hook no demora el fin de turno.
- `stop_hook_active: true` no corta: si hay otra instrucción en cola se entrega (solo las escribe el usuario, no hay bucle).

### Puente

- Cola por sesión (`instructions`, textos de hasta 400 caracteres, hasta 5 por sesión); se guarda en memoria (se pierde al
  reiniciar el puente: aceptable, se dice en la doc).
- Modo por sesión `waitForMe` (booleano), guardado por proyecto como `notify-modes.json` (mismo archivo o uno hermano).
- Solicitud de tipo `instruction` en la cola de tarjetas mientras retiene un `Stop`; el estado de la sesión es `ask` con la
  actividad "Espera tu instrucción".
- Ajuste global `instructWaitMax`: 5 · 10 · 30 minutos (por defecto 10), en SELECT ("Esperar instrucción hasta").
- `UserPromptSubmit` de esa sesión (el usuario escribió en el PC) libera una retención y **no** borra la cola.

### Protocolo (todo opcional, compatible hacia atrás)

- Consola → puente: `{"t":"instruct","sessionId","text"}` (encola o, si hay retención, entrega),
  `{"t":"instructClear","sessionId"}` (vacía la cola), `{"t":"release","requestId"}` (Seguir en el PC), y
  `{"t":"setting","key":"sessionWait","value":{sessionId,value:true|false}}` (como `sessionNotify`).
- Vista: `detail.instructions` (cuántas en cola y el comienzo de la primera, recortado), `detail.waitForMe` (booleano),
  `request.kind: "instruction"` para la tarjeta de espera, `settings.instructWaitMax`.
- Un mensaje inválido se ignora y se registra, no cierra la conexión. Textos validados (sin vacíos, ≤ 400, sin controles).

### Consola (3DS)

- **Detalle de sesión:** una fila/acción "Escribir instrucción" (tecla libre en el detalle, a elegir sin pisar A=leer,
  Y=modo; probablemente X) que manda `hold` y abre el teclado (hasta 400 caracteres). Debajo, si hay cola: "En cola: <comienzo>"
  y la opción de borrarla.
- **Menú de modo de la sesión (Y):** se agrega el interruptor "Esperar mi respuesta: sí/no".
- **Tarjeta "Espera tu instrucción":** agente · proyecto, el comienzo del último mensaje, y las filas "Escribir" y "Seguir
  en el PC". Mismas guardas que las otras tarjetas (500 ms; B nunca envía nada). Cede ante un permiso igual que las demás.
- Guía: una página corta "Instrucciones" con los tres casos.

### Simulador

Igual que la consola (texto con `prompt()` o un campo).

### Pruebas

- Hook: `instruct` → salida `block` con el texto; `none`/fallo → sin salida; `PermissionRequest` y preguntas sin cambios.
- Puente: cola (orden, tope, junta varias), entrega en el `Stop`, retención solo con modo y consola, liberaciones (consola
  fuera, sesión termina, modo apagado, tiempo máximo, `UserPromptSubmit`, `release`), validación de textos.
- Cliente C: parseo de `request.kind:"instruction"` y `detail.instructions` (fixtures del generador), navegación de la
  tarjeta, guardas.

### Qué quedó escrito (2026-11-15)

**Puente y protocolo.**

- `POST /stop` (`http-api.ts`): `{session_id, cwd, stop_hook_active, last_assistant_message}`. Responde `{"decision":"instruct","text"}` o
  `{"decision":"none"}`; si el hook cierra la conexión antes de la respuesta (Claude Code lo mató, el padre murió) se retira la retención.
- `store.ts`: cola por sesión (`enqueueInstruction`, `clearInstructions`, `instructionsOf`; hasta 5 textos, en memoria), `requestStop`
  (entrega la cola en el acto o, con `waitForMe` y consola, deja una solicitud de tipo `instruction` en la misma cola que los permisos y las
  preguntas), `releaseInstruction` (Seguir en el PC), `releaseSessionInstruction` (el usuario escribió en el PC, modo apagado) y
  `setSessionWait`. `decide` y `answerQuestion` no resuelven una `instruction`.
- Modo por proyecto en `.companion/wait-projects.json` (lista de nombres de proyecto; hermano de `notify-modes.json`). Ajuste global
  `instructWaitMax` (5, 10 o 30; por defecto 10) en `settings.json`; cambiarlo rearma el plazo de las retenciones en curso.
- Protocolo: `instruct`, `instructClear`, `release` y `setting` con `sessionWait` (sesión en `sessionId`, como `sessionNotify`) e `instructWaitMax`.
  Vista: `request.kind: "instruction"` (`lines` = comienzo del último mensaje, hasta 3 líneas; `expiresInS` siempre 0),
  `detail.instructions: {count, first}`, `detail.waitForMe` (solo se manda en `true`) y `settings.instructWaitMax`. Todo opcional.
  Textos validados en el puente (`InstructionTextSchema`: 1 a 400 caracteres, algo que no sea espacio, sin controles ni saltos): uno inválido
  se ignora y se registra sin cerrar la conexión.
- `face.ts`: la cara dice "Claude espera tu instrucción". Fixtures de protocolo nuevos y pruebas `instruction-flow.test.ts` (store, vista,
  hooks de estado) e `integration-instructions.test.ts` (HTTP y consola TCP).

**Cómo conviven el hook `command` y el hook http de `Stop`** (llegan a la vez, en cualquier orden):

- El de estado ya no retira la retención (`resolveElsewhere` salta las `instruction`) ni cambia la actividad: la sesión sigue en `ask` /
  "Espera tu instrucción" mientras está retenida. `UserPromptSubmit`, `SessionEnd`, la consola que se desconecta, apagar el modo, el
  plazo `instructWaitMax` y "Seguir en el PC" sí la liberan.
- Si hay instrucciones en cola, o se acaba de entregar una (ventana de 5 s: `stopContinues`), el hook de estado deja la sesión
  **trabajando** ("Siguiendo tu instrucción") en vez de "terminó". Al entregar, la sesión vuelve a trabajar; al liberarse sin
  instrucción, a "terminó".
- La retención suena como una pregunta (`chime` `ask`), salvo que el hook de estado ya la hubiera marcado terminada (ya sonó "terminó") o la sesión
  esté en silencio; al liberarse no deja una tarjeta de aviso.
- Un `Stop` retenido que se retira o se libera no hace globo en la cara ("Respondido en el PC" / "Permiso retirado" son de permisos).

**Hook (`permission-hook.mjs`).** Rama `hook_event_name === "Stop"`: manda `last_assistant_message` (hasta 8000 caracteres) a `/stop` y, con
`instruct`, imprime `{"decision":"block","reason":"Instrucción desde la 3DS:\n<texto>"}`. Cualquier otra cosa o fallo: sin salida y código 0.
Misma vigilancia del padre y sin plazo propio. `settings.example.json` trae la entrada (ver "Instalar el hook").

**Consola 3DS.**

- **Tarjeta "Espera tu instrucción"** (`logic/instruct.c`, `render_instruct.c`): su propia máquina de estados, como la de preguntas. Cabecera
  (título y "N de M"), el comienzo del último mensaje y dos filas: **Escribir** (manda `hold`, abre el teclado del sistema, hasta 400
  caracteres) y **Seguir en el PC** (`release`). Arriba/abajo o el lápiz marcan, A elige (guarda de 500 ms), **B no hace nada** (nunca envía,
  libera ni rechaza), L/R pasan a otra solicitud. Ni A, ni B, ni X, ni Y, ni el lápiz emiten una `decision`. Cede ante un permiso y el menú, la
  guía y el lector se cierran ante ella como ante un permiso.
- **Detalle de una sesión** (sin tarjeta, solo si el puente manda `instructWaitMax`): ver "Teclas del detalle". Dos franjas nuevas sobre las
  de "A: leer todo" / "Y: avisos" y, con cola, un recuadro "En cola (N): comienzo" con "Abajo: borrar" y una línea que dice cuándo sale
  ("Sale cuando termine este turno." o "Ya terminó: escríbele desde el PC para que siga.").
- **Menú SELECT:** entrada nueva **"Esperar instrucción hasta: 5 / 10 / 30 min"** (A o izquierda/derecha), entre "Abrir mensajes en" y
  "Agentes". El menú raíz pasa a **9 filas** (las dos primeras de 28 px, el resto de 17; el pie de ayuda sigue en 14 px).
- **Guía:** página nueva "Instrucciones" (la de conexión sigue siendo la última) y la de "Modos" aclara que en el detalle X escribe.
- Código: `core/view.c` (`kind instruction`, `detail.instructions`, `waitForMe`, `settings.instructWaitMax`), `core/msg.c` y `core/session.c`
  (`msg_instruct`, `msg_instruct_clear`, `msg_release`, `msg_setting_session_wait`, `msg_setting_instruct_wait`), `logic/instruct.c`,
  `logic/input_logic.c`, `logic/layout.c` (franjas y `footer_top`), `logic/menu.c`, `logic/guide.c`, `pairing.c` (`pairing_prompt_long_text`), `app.c`.

**Teclas del detalle** (elegidas sin pisar las que ya había):

| Tecla | Qué hace en el detalle de una sesión (sin tarjeta, con el puente nuevo) |
| :--- | :--- |
| **X** (o tocar "X: escribir instrucción") | escribirle una instrucción |
| **Izquierda / derecha** (o tocar "Izq/Der · Esperar: sí/no") | alternar "Esperar mi respuesta" de la sesión |
| **Abajo** (o tocar "Abajo: borrar") | borrar la cola de instrucciones (solo si hay) |
| A, Y, B, SELECT | como antes (leer todo, modo de aviso, volver, menú) |

`Y` no sirve: en el detalle ya cambia el modo de aviso (no abre un menú), y `X` era "modo de permisos". Por eso **en el detalle X deja de alternar
el modo de permisos**; sigue haciéndolo en agentes y sesiones, con una tarjeta de permiso en el detalle y con el botón táctil de la barra
("En fila" / "Elijo yo"). Si el puente es anterior (no manda `instructWaitMax`), el detalle queda como antes y X sigue siendo el modo.

**Simulador.** `instruct.js` (máquina pura, espejo de `instruct.c`), `bottom.js` (tarjeta y franjas), `menu.js`, `nav.js` (`bAction`), `app.js`
(teclas y `prompt()` como teclado). Mismas teclas que la consola: X, flechas izquierda/derecha y abajo en el detalle; la guía de teclas de
`index.html` las lista.

**Pruebas (al cerrar el paso).** `npm test`: 39 archivos, 988 pruebas, todas pasan; `npm run typecheck` limpio. Consola (host, gcc con UBSan):
25 ejecutables, 107 402 aserciones, 0 fallos (`test_instruct.c` nuevo, con 277 aserciones: estado, mensajes, vista, entrada, detalle, menú; más
`test_session.c`, `test_view.c`, `test_menu.c`, `test_guide.c` y las que ya tenían el menú de 8 filas). Compila con devkitARM:
`agent-companion.3dsx` de 322 412 bytes (antes 311 996). **Extremo a extremo con el hook real** (`npx tsx packages/bridge/scripts/e2e-instrucciones.mts`,
puente desechable en puertos efímeros y consola falsa por WebSocket): cola entregada como `block`, retención hasta `instruct`, `release`,
consola que se desconecta, sin consola y hook de estado en paralelo: 14 comprobaciones, todas bien. El simulador se vio en el navegador
(tarjeta, franjas del detalle, cola y alternar "Esperar").

### Decidido en el paso 6

- `sessionWait` lleva la sesión en `sessionId` (como `sessionNotify`), no dentro de `value`: `{"t":"setting","key":"sessionWait","sessionId":…,"value":true}`.
- `detail.waitForMe` solo se manda en `true` (ausente = apagado); así las vistas sin instrucciones no cambian. La consola decide si ofrece las
  instrucciones por la presencia de `settings.instructWaitMax` (el puente nuevo siempre la manda).
- La retención solo se arma con `waitForMe` **y** consola conectada; sin consola responde `none` en el acto. El plazo `instructWaitMax` no
  usa `requestTimeoutMs` (que por defecto no vence): la retención lo trae propio; por eso `expiresInS` va en 0 y no hay cuenta atrás.
- Entregar una instrucción a una retención le suma lo que hubiera en cola. Con la cola llena (5) una nueva se ignora y se registra.
- La consola limpia lo que escribe el teclado (controles y saltos a espacio, recorte, 400 caracteres); el puente además lo rechaza si trae
  controles. Una cola vacía por completo no manda nada y el teclado cancelado tampoco.
- La cola vive en memoria: se pierde al reiniciar el puente (el modo "Esperar" sí se recuerda por proyecto).
- En modo "Elijo yo" la tarjeta de instrucción solo aparece al abrir esa sesión en el detalle (como las demás solicitudes en ese modo);
  con el hook retenido hasta `instructWaitMax`.
- `stop_hook_active: true` no corta nada: solo las escribe el usuario.

### Instalar el hook

Agregar un segundo hook, `command`, a la entrada `Stop` de `~/.claude/settings.json` (junto al `http` que ya está; el script es el mismo de
`PermissionRequest`). **No se instaló nada: esto lo hace el usuario.**

```json
"Stop": [
  {
    "hooks": [
      { "type": "http", "url": "http://127.0.0.1:33335/hook/claude", "timeout": 2 },
      {
        "type": "command",
        "command": "node C:/Users/yo/developer/3ds-agent-companion/packages/hooks/permission-hook.mjs",
        "timeout": 3600
      }
    ]
  }
]
```

Después hay que **reiniciar el puente** (el que está en marcha no conoce `POST /stop`; mientras tanto el hook recibe 404 y no imprime nada:
es inofensivo) y abrir sesiones nuevas de Claude Code (o recargar los hooks). Con el `Stop` instalado pero sin "Esperar mi respuesta" ni
cola, el hook responde en el acto y no demora el fin de turno. **Con "Esperar mi respuesta" encendido la sesión no deja escribir en el PC
mientras espera tu instrucción** (lo medido en el diseño); siempre se libera con "Seguir en el PC", al cumplirse el plazo o al
desconectarse la consola.

### Qué mirar la primera vez

1. **Sin instalar nada más:** en el detalle de una sesión, X abre el teclado; escribir algo y "Enviar". Debajo del detalle aparece "En cola (1): …"
   con "Abajo: borrar" y la línea de cuándo sale. Probar Abajo (borra) y que X ya no cambie el modo en el detalle (sí en agentes y sesiones).
2. Con el hook instalado: dejar una instrucción en cola y pedirle algo corto a Claude: al terminar su turno debe seguir solo con
   "Instrucción desde la 3DS: …" (la app de escritorio la muestra como "Stop hook feedback"; es solo la etiqueta). La cola debe quedar vacía.
3. "Esperar mi respuesta" (izquierda/derecha en el detalle): al terminar el turno la consola debe mostrar la tarjeta "Espera tu instrucción"
   con el comienzo del último mensaje, sonar como pregunta/aviso y, en el PC, la sesión no deja escribir. **A: Escribir** entrega el texto y la
   sesión sigue; **Seguir en el PC** devuelve el PC en el acto.
4. La guarda: A no hace nada los primeros 500 ms de la tarjeta; B nunca hace nada ahí; L/R pasan a otra solicitud si hay más.
5. Apagar la consola (o sacarla de la red) con la tarjeta retenida: el PC debe quedar libre en unos segundos, sin esperar el plazo.
6. SELECT > "Esperar instrucción hasta": 5 / 10 / 30 min; con 5, dejar la tarjeta sin tocar y ver que se libera sola.
7. Que el detalle se lea bien con la cola y las dos franjas nuevas (el último mensaje puede perder líneas; A sigue abriendo el lector) y que el
   menú raíz de 9 filas y la página "Instrucciones" de la guía se lean sin cortarse.
8. Una tarjeta de permiso mientras se escribe o con la instrucción a la vista: el permiso manda y A / B siguen siendo aprobar / rechazar.

### Visto en la consola (2026-11-15)

- "Esperar mi respuesta" se activa con derecha en el detalle de la sesión y queda guardado (`.companion/wait-projects.json`).
- Al terminar el turno, el hook `Stop` quedó retenido y la 3DS mostró la tarjeta "Espera tu instrucción". Se escribió "di hola desde la 3ds" y llegó a la sesión como `Stop hook feedback` ("Instrucción desde la 3DS: …"), unos 40 s después. Claude siguió y respondió sin escribir nada en el PC.
- "Seguir en el PC" (2026-11-15): libera el fin de turno retenido y el PC vuelve a dejar escribir.
- Abajo borra la cola (2026-11-15): visto en la consola. Paso 6 completo en la consola.
- Cola con X (2026-11-15): con la sesión ya terminada se escribió "hola" con X en el detalle (`instruction_queued`, queued 1) ; quedó en cola hasta el siguiente turno (pedido desde el PC) y se entregó sola en su fin de turno, antes de la tarjeta de espera.
