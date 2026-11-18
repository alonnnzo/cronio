# Plan de trabajo corregido — 3DS Agent Companion

Reemplaza la sección 7 del plan original. Las razones de cada cambio están en `01-revision-arquitectura.md`.

## Principios

1. **Primero el riesgo.** Lo que nunca se ha probado (consola real) va antes que lo conocido (servidor web).
2. **Corte vertical antes que amplitud.** Un agente y un flujo completos antes de sumar agentes y funciones.
3. **El puente decide, la consola dibuja.** Toda la lógica y el estado viven en el PC.
4. **Nunca colgar al agente.** Sin consola o sin respuesta, el permiso vuelve al terminal.
5. **Cada fase termina con algo que se puede usar** y con un criterio de salida comprobable.

## Estructura del repositorio

```text
3ds-agent-companion/
├── docs/                      # Revisión, plan, especificación del protocolo, resultados de pruebas
├── packages/
│   ├── protocol/              # Esquemas de mensajes, tramas, mensajes de ejemplo (fuente única)
│   ├── bridge/                # Demonio: estado, colas, modelo de vista, transporte, emparejamiento
│   │   └── src/adapters/      # Un adaptador por agente (claude-code, gemini-cli, cursor, codex, hermes)
│   ├── mcp-server/            # Proceso MCP por stdio que reenvía al demonio
│   ├── hooks/                 # Scripts de hook mínimos + instalador por agente
│   └── simulator/             # Simulador web: solo dibuja el modelo de vista
├── client-3ds/                # App nativa (C, libctru, citro2d)
│   ├── source/                # net, proto (parser de tramas), render_top, render_bottom, input, led, mic
│   ├── gfx/                   # Hojas de sprites (.t3s)
│   └── tests-host/            # Pruebas del parser compiladas en el PC con los mensajes de ejemplo
├── spikes/                    # Pruebas desechables de la Fase 0
└── art/                       # Fuentes de arte y especificación
```

Monorepo con workspaces de npm; pruebas con Vitest. Repositorio git propio en esta carpeta.

## Fase 0 — Entorno y pruebas de hardware

Objetivo: saber qué funciona de verdad en la consola antes de diseñar el protocolo.

| # | Tarea | Resultado esperado |
| :-- | :--- | :--- |
| 0.1 | `git init`, workspaces, estructura de carpetas | Repositorio base |
| 0.2 | Instalar devkitPro (`3ds-dev`), compilar un ejemplo, enviarlo con `3dslink` a la consola | "Hola mundo" corriendo en la 3DS real |
| 0.3 | Prueba de red: aviso UDP desde el PC, conexión TCP, eco de tramas; regla de firewall de Windows | Latencia y estabilidad medidas; reconexión tras suspender |
| 0.4 | Prueba de LED por `ptm:sysm` | Patrón de color visible, o descartado con motivo |
| 0.5 | Prueba de reposo: cerrar y abrir la tapa con la app conectada | La app se reconecta sola al abrir y recupera las solicitudes pendientes |
| 0.6 | Prueba de micrófono: 3 s a 16360 Hz → PC → remuestreo → whisper.cpp en español | Texto transcrito y tiempo total medido |
| 0.7 | Prueba de memoria: cargar retratos de 256×256 y un fondo de 400×240, con y sin 3D, en la New 3DS XL | Presupuesto de texturas y FPS reales |
| 0.8 | Prueba de hooks de Claude Code: `PermissionRequest` que espera a un servidor local, con plazo y caída al terminal | Formato de entrada y salida confirmado |

**Salida:** `docs/04-resultados-pruebas.md` con cada resultado y las decisiones (voz sí/no, LED sí/no, 3D
sí/no). Si 0.2 o 0.3 fallan, se detiene y se replantea.

La única consola de prueba es una New 3DS XL. El código se escribe para toda la familia (sin funciones
exclusivas de New 3DS, 3D opcional, presupuesto de memoria de la Old 3DS), pero la compatibilidad con Old 3DS y
2DS queda **sin verificar** hasta conseguir una.

Las tareas 0.2–0.7 necesitan la consola en la mano; 0.8 se puede hacer en paralelo.

## Fase 1 — Protocolo v1 y núcleo del puente

**Estado (2026-11-12): hecha**, en la rama `fase-1`. El diseño real está en `06-fase-1-diseno.md` y
`07-fase-1b-cara-y-sesiones.md`, que mandan sobre esta sección donde haya diferencia. Cambios principales
respecto de lo planeado aquí:

- La pantalla superior es una sola cara que avisa con globos; los agentes y sus sesiones van en la inferior.
- Varias sesiones por agente y varios permisos a la vez, con dos modos (en fila / elijo yo).
- Código de emparejamiento de 16 caracteres en vez de 6 dígitos.
- El adaptador de Claude Code (eventos de sesión, actividad y último mensaje) se adelantó a esta fase; queda
  sin verificar con Claude Code real.

Objetivo: el puente funciona de punta a punta contra el simulador, con un agente falso.

- `protocol`: esquemas de mensajes, tramas `[tipo][largo][contenido]`, versión en el saludo, mensajes de ejemplo.
- Emparejamiento por código de 6 dígitos y autenticación HMAC por mensaje.
- `bridge`: registro de agentes y sesiones; cola de solicitudes con id, plazo y cancelación; registro de
  eventos (base para XP más adelante); generación del modelo de vista con texto ya cortado.
- Transporte TCP para la consola (LAN) y WebSocket para el simulador; API local en `127.0.0.1` para hooks.
- `simulator`: dos pantallas a tamaño real, botones, pantalla de permiso y pantalla de estado.
- `docs/protocol-spec.md` generado desde los esquemas.

**Salida:** un script que simula un agente pide un permiso → aparece en el simulador → se aprueba o rechaza →
el script recibe la decisión. Casos probados: plazo vencido, cancelación, cliente sin emparejar rechazado,
mensaje repetido rechazado.

## Fase 2 — Corte vertical: Claude Code en la consola real

**Estado (2026-11-13): código terminado y fusionado en `main`; faltan pruebas que dependen del usuario.**
Diseño en `08-fase-2-cliente-3ds.md`; resultados en `04-resultados-pruebas.md`.

- Visto en la New 3DS XL: emparejamiento, conexión automática (sin volver a emparejar tras actualizar la
  app), cara, lista de agentes y sesiones, aprobar permisos de prueba normales y de riesgo alto, también con
  la versión sin vencimiento.
- Hecho y cubierto por tests, sin confirmar en la consola: rechazar con B, saltar con L/R, cambiar de modo con
  X, táctil, LED por estado, reconexión tras cerrar la tapa, diagnóstico (L+R 1 s), guía de botones (SELECT;
  la IP manual está en su página 4, con X).
- Cierre: suite completa (480 tests del puente, 91 450 aserciones del cliente, compilación sin advertencias)
  y revisión del delta; sus hallazgos están corregidos (el diagnóstico ya no deja pasar A/B, los permisos solo
  se retiran si coincide la herramienta, el hook vigila a su proceso padre).
- **Pendientes que se arrastran:**
  1. Probar con Claude Code real desde `C:\Users\tu-usuario\developer\3ds-prueba-hooks`: que la sesión aparezca y,
     sobre todo, si la terminal deja responder mientras el permiso espera en la consola. Si no lo deja, poner
     un plazo largo de emergencia en vez de "sin límite". Hasta entonces los hooks no se instalan en la
     configuración general del usuario.
  2. Confirmar en la consola la lista de arriba (B, L/R, X, táctil, guía). La consola ya tiene el último
     `.3dsx` (252 620 bytes), enviado el 2026-11-13.
  3. Instalador de hooks que no pise la configuración existente (pasa a la Fase 7).
  4. Caídas del Wi-Fi de la consola (ver la sesión de pruebas de abajo): juntar más casos antes de tocar nada.

**Sesión de pruebas en la consola (2026-11-13, noche).**

- Con el último `.3dsx`: conexión automática y dos permisos de prueba aprobados (normal y de riesgo alto);
  esperaron en cola varios minutos sin vencer, también durante dos caídas de red.
- Dos caídas de conexión, las dos al mantener L+R. Diagnóstico de la consola: `recv:115` y `socket:-115`
  (ENETDOWN), `apt dor/des 0/0` (no hubo reposo), `cierre: La red no está lista`, `soc reinicios 28`,
  `fps 59.8`. Del lado del puente: sin datos 15 s, corte, y reconexión sola unos 25 s después; en una de las
  dos la consola tampoco respondía al ping. Conclusión: se cayó el enlace Wi-Fi de la consola, no la app ni el
  puente. La relación con L+R no está demostrada (después se abrió el diagnóstico con L+R sin caída y la
  conexión siguió estable); en el código, L+R solo cambia lo que se dibuja. Si se repite, revisar si los 28
  reinicios de `soc` alargan la caída.
- Resuelto el "puente tarda en notar que la consola salió": no era lentitud, la pestaña del simulador también
  contaba como consola. `/health` devuelve ahora `device` (consola real por TCP) y `simulator` además de
  `console`. Antes de lanzar una prueba se comprueba `device: true`.
- El puente registra cada desconexión de la consola con hora y causa (`[puente HH:MM:SS] consola
  desconectada: <id> (<causa>) tras <n> s`). Ese registro no tiene test propio.
- `demo.mjs` y `fake-agent.mjs` esperan la respuesta del permiso sin límite (antes `fetch` cortaba a los 5
  minutos y el permiso se retiraba).
- Estados de la consola al coordinar pruebas: "en el menú" (Homebrew Launcher), "esperando con Y" (lista para
  `3dslink`) y "app abierta".
- Sospecha sin probar: en la página 4 de la guía, X abre el teclado del sistema; mientras está abierto la app
  no envía nada y el puente corta a los 15 s.

- Tercera opción de permiso, añadida tras la prueba con Claude Code real: el diálogo del terminal ofrece "Sí" /
  "Sí, y no volver a preguntar" / "No", y la 3DS solo tenía aprobar y rechazar. Ahora el hook reenvía
  `permission_suggestions` al puente; si trae alguna, la tarjeta ofrece **Y: sí, siempre · <qué quedaría permitido>**
  (franja táctil o tecla Y, con las mismas reglas que A: guarda de 500 ms, retención de 1 s en riesgo alto y el
  mismo gesto anulado si la tarjeta cambia). La consola envía `decision: "allow_always"` (campo opcional
  `request.always` en la vista) y el hook responde `allow` con `updatedPermissions` (las sugerencias, sin tocar).
  Pendiente: probarlo con Claude Code real y en la consola.

**Sesión del 2026-11-15.**

- Hooks instalados en `~/.claude/settings.json` (copia previa en `settings.json.bak-antes-hooks-3ds`), con
  aprobación del usuario. Todas las sesiones de Claude Code, también las de la app de escritorio, aparecen en
  la consola.
- El puente corre en su propia ventana ("Puente 3DS"); lanzado desde una sesión de Claude moría con ella.
- Claude envía el `.3dsx` con `3dslink`; el usuario solo abre el Homebrew Launcher y pulsa Y.
- Confirmado en la consola: Y ("sí, siempre") guarda la regla y Claude Code no vuelve a preguntar.
- Confirmado en la consola: una sesión de la app de escritorio que termina el turno con pregunta (cuadro de fin
  de turno) aparece como "te espera" (los campos `tool_input.ask` del hook son los reales). La pregunta se ve
  en los tres lugares: globo de arriba (hasta 3 líneas), fila de la lista y recuadro "Te pregunta:" dentro de
  la sesión; los avisos pasajeros ya no la tapan. Con `AskUserQuestion` la sesión muestra "Te hace una
  pregunta" (visto en otra sesión); falta verla dibujada completa.
- Y fuera de una tarjeta ya no abre el teclado del código (lo abría sin querer y congelaba la app); emparejar
  con código está en la última página de la guía.
- Sin confirmar todavía: que la app de Claude deje responder mientras el permiso espera en la consola.

**Siguiente paso:** confirmar esos dos puntos, fusionar `permiso-siempre` en `main` y empezar la Fase 2b.

Objetivo: aprobar un permiso real con el botón A.

- Adaptador de Claude Code: hooks de solicitud de permiso, inicio de sesión, notificación y fin de turno.
  Instalador que los agrega a la configuración sin pisar lo existente.
- Caída al terminal cuando no hay consola o vence el plazo; retiro de la solicitud si se responde en el terminal.
- Cliente 3DS mínimo: descubrimiento, emparejamiento, parser de tramas (probado en PC con los mensajes de
  ejemplo), pantalla de permiso (agente, proyecto, comando), A/B, mantener A para riesgo alto, LED, reconexión.
- Referencias para portar a C, ya escritas y probadas en el simulador: `face.js` (dibujo de la cara),
  `nav.js` (navegación de la pantalla inferior), `approve.js` (gesto de aprobar) y
  `packages/bridge/test/fake-console.ts` (saludo y sellado de tramas, con `handshake.json` como caso de prueba).
- Antes de empezar: probar a mano con Claude Code real el hook de permisos y los hooks de eventos
  (`packages/hooks/README.md`).
- Los puntos de los agentes, dibujados con `citro2d` según el prototipo.

**Salida:** con Claude Code trabajando en un proyecto real, el permiso aparece en la 3DS, se aprueba con A y el
agente continúa. Con la consola apagada, el permiso aparece en el terminal sin demora perceptible. Usarlo un día
completo de trabajo antes de seguir.

## Fase 2b — Seguir el trabajo desde la consola

Pedido por el usuario el 2026-11-15: saber desde la 3DS en qué quedó cada sesión sin mirar la terminal, y
poder responderle. Va antes de la Fase 3 porque usa lo que ya existe (hooks de fin de turno, último mensaje,
estados) y es lo que hace útil la consola en el día a día.

Hoy el puente guarda hasta 2000 caracteres del último mensaje (`Stop` → `last_assistant_message`), pero la
vista lo corta a 4 líneas de 38 caracteres (`MAX_DETAIL_LINES`).

Se hace en este orden, cada paso probado en la consola antes del siguiente:

1. **Mensaje completo.** Pantalla de lectura con el último mensaje entero, con desplazamiento por cruceta y
   lápiz. El puente manda el texto ya cortado en líneas y por páginas (la consola no parte texto). Revisar si
   2000 caracteres alcanzan o si se guarda más.
2. **Configuración (SELECT).** SELECT abre un menú de configuración en vez de la guía; la guía de botones
   pasa a ser una entrada de ese menú, igual que emparejar con código y la IP manual, para no saturarlo.
   Pedido por el usuario el 2026-11-15. Contenido:
   - **Por defecto:** modo de aviso para las sesiones nuevas (ver paso 3), y si los avisos piden acuse de
     recibo o no.
   - **Agentes:** cuáles se muestran en la lista (Claude, Gemini, Codex, Cursor, Hermes) y cuáles avisan. Un
     agente oculto no aparece ni avisa, pero sus permisos **sí** llegan (si no, se quedarían esperando sin que
     nadie los vea); para que no lleguen, se quitan sus hooks.
   - **Idioma:** español o inglés. Todo el texto lo genera el puente (la consola no tiene textos propios salvo
     la guía y los mensajes de conexión), así que el idioma vive en el puente y la consola recibe el texto ya
     traducido; la guía y los mensajes propios del cliente necesitan su propia tabla.
   - Guía de botones, emparejar con código, IP manual y diagnóstico.

   Las preferencias las guarda el puente (en `.companion/`), así sobreviven a reinstalar la app. Navegación
   con cruceta y A, como la lista de agentes; B vuelve.
3. **Modo de aviso por sesión.** Cada sesión tiene su modo, que se cambia desde la consola en la ficha de la
   sesión (por defecto, el de la configuración). Pedido por el usuario el 2026-11-15:
   - **Todo:** globo de la cara por cada cambio (empieza a trabajar, qué herramienta usa, permiso, pregunta,
     terminó) y sonido en lo importante.
   - **Lo importante:** solo permisos, preguntas, "espera tu respuesta", errores y fin de turno, con LED y
     sonido.
   - **Solo al terminar:** un único aviso cuando la sesión termina el turno o queda esperando, **con sonido**.
     Los permisos y preguntas siguen apareciendo igual (nunca se ocultan), pero sin sonido.
   - **Silencio:** la sesión se ve en la lista y no avisa.

   El globo lleva el nombre del proyecto. El modo lo guarda el puente, que decide qué avisar; la consola solo
   suena y dibuja. Sonido con `ndsp`, que requiere `sdmc:/3ds/dspfirm.cdc` (firmware de sonido de Nintendo: no se
   puede distribuir con la app). Decidido con el usuario el 2026-11-15: si falta, **la app lo extrae sola** al
   arrancar, del sistema de la propia consola, como hace DSP1 (código abierto; revisar de qué título lo saca y
   cómo, antes de portarlo). Si la extracción falla, la app lo dice en pantalla con el motivo, el diagnóstico
   lo muestra y se sigue sin sonido. Si hace falta que el usuario haga algo (por ejemplo reiniciar la app), la
   consola se lo pide. El aviso por voz (frase hablada por los parlantes) queda para la Fase 5c.

   **Tarjetas de aviso con acuse de recibo.** Los avisos importantes y los de fin de turno aparecen abajo como
   tarjetas, igual que los permisos: agente, proyecto y qué pasó (terminó, espera tu respuesta, error, con el
   comienzo del último mensaje). Se cierran con **A: "Visto"**, con el mismo cuidado que aprobar (guarda contra
   pulsaciones de antes de que apareciera). Se acumulan en cola como los permisos, con L/R para pasar entre
   ellas; los permisos y preguntas van siempre antes que los avisos. Opcional: en la configuración se elige si
   los avisos piden acuse (tarjeta que queda hasta marcar "Visto") o no (solo globo, sonido y LED, sin
   tarjeta). Un aviso de una sesión que vuelve a trabajar o se cierra se retira solo. El acuse es solo para la
   consola: no se le manda nada al agente.
4. **Preguntas con alternativas (grill-me).** Cuando Claude usa `AskUserQuestion`, la pregunta aparece en la
   consola: texto arriba, hasta 4 opciones abajo con su descripción y la recomendada marcada; cruceta, lápiz o
   A para elegir; varias si la pregunta lo permite; "Otra" abre el teclado del sistema. Es la vía oficial: un
   hook `PreToolUse` responde `allow` con `updatedInput` que repite `questions` y agrega `answers`
   (`{"<texto de la pregunta>": "<etiqueta elegida>"}`; varias se unen con comas). Reemplaza el `ask_user` por
   MCP de la Fase 3 y sirve para cualquier skill, grill-me incluido. Antes de abrir el teclado la consola avisa
   al puente para que no corte la conexión (el teclado congela la app). Decidido con el usuario el 2026-11-15.
   El cuadro de fin de turno de la app de escritorio (botones de respuesta) no se puede responder por hook:
   solo se muestra como "espera tu respuesta"; responderlo es el paso de instrucciones.
5. **Versión resumida.** Un botón alterna entre el mensaje completo y un resumen corto. El resumen se genera en
   el puente al terminar el turno, con un modelo pequeño, para que el cambio sea instantáneo. Decidir aquí cómo
   se paga ese uso (lo mismo que en la Fase 5b).
6. **Dar instrucciones a una sesión.** Primero por texto (teclado del sistema de la 3DS), después por voz
   (depende de la prueba 0.6 y de la Fase 5a). Es lo más incierto: los hooks informan pero no escriben en la
   sesión. Antes de diseñar, una prueba con Claude Code real del mecanismo oficial: el hook `Stop` puede
   responder `decision: "block"` con un `reason`, y Claude sigue trabajando con ese texto como instrucción.
   Si no sirve (por ejemplo, porque el hook tendría que quedarse esperando), las opciones son el wrapper de
   terminal (`3ds-run`, Fase 7) o lo que Claude Code ofrezca para mandar mensajes a una sesión abierta.

**Salida:** al terminar un turno la consola avisa según el modo de esa sesión, con tarjeta y "Visto" si así se
configuró; se lee el mensaje completo o resumido con un botón; se responde una sesión de grill-me desde la
consola; y se le manda a una sesión una instrucción escrita desde la 3DS que Claude ejecuta. Todo configurable
desde SELECT, incluido el idioma y qué agentes se ven.

## Fase 3 — Grill-me y panel de agentes

- `mcp-server` con `ask_user` (pregunta, opciones, recomendada) y `report_status`; manejo del plazo máximo.
- Comando o skill "grill-me en la 3DS" para Claude Code que dirige las preguntas a esa herramienta.
- Consola: pantalla de pregunta (texto arriba, opciones abajo, táctil y cruceta), "Otra" con el teclado del
  sistema, cola cuando hay varias solicitudes.
- Pestaña de agentes: proyecto, modelo, estado y tiempo, con datos de los hooks.
  **Hecho (2026-11-16): modelo y tiempo en cada ficha** de la lista de sesiones (consola y simulador):
  - **Modelo corto:** el puente manda `model` ya abreviado (`shortModel`, `packages/bridge/src/model.ts`):
    `claude-opus-5-5` → «Opus 5.5», `claude-sonnet-4-20250514` → «Sonnet 4», `opus[1m]` → «Opus»; lo que no reconoce
    queda como llegó. Va en la primera línea, a la derecha, junto al estado («Opus 5.5 · Trabajando»).
  - **Tiempo en el estado actual:** el store guarda el instante del último cambio de estado (`stateSince`; el mismo
    estado repetido o un cambio de actividad no lo reinician) y la vista manda `sinceS` por sesión (segundos, de 0 a
    99 días). La consola no usa la hora del PC: le suma su propio reloj desde que recibió la vista
    (`elapsed_total_s` / `elapsedTotalS`). El formato es una función pura probada en C (`logic/elapsed.c`) y en el
    simulador (`elapsed.js`): «ahora» (menos de 5 s), «hace 12 s», «hace 3 min», «hace 2 h», «hace 4 d».
  - **Disposición:** la ficha (34 px) queda igual; el tiempo va en la segunda línea, en gris (`pal()->mute`) y a la
    derecha, y la actividad se acorta para dejarle sitio. Un puente anterior (sin `sinceS`) deja la ficha como antes.
- Pestaña de comandos rápidos, limitada a lo que el agente soporta de forma oficial.
  **Hecho (2026-11-16): comandos rápidos en la tarjeta «espera tu respuesta».** En vez de una pestaña, la tarjeta de
  instrucción trae antes de «Escribir» y «Seguir en el PC» hasta 4 atajos de un toque que mandan un texto fijo por el mismo
  camino que «Escribir» (`{"t":"instruct", ...}`; al puente le da igual de dónde viene el texto):
  - **De fábrica:** «Sigue» → «Sigue con lo que estabas haciendo.»; «Corre las pruebas» → «Corre las pruebas y arregla lo
    que falle.»; «Haz commit» → «Haz commit de los cambios con un mensaje claro.»; «Resume» → «Resume en pocas líneas qué
    hiciste y qué falta.»
  - **Dónde viven:** en los ajustes del puente (`.companion/settings.json`, clave `quickCommands`: lista de
    `{label, text}`; una lista vacía los quita; se editan en el archivo, la consola no los edita). Se limpian al leerlos:
    una línea, etiqueta de hasta 20 caracteres, texto de hasta 120, máximo 4.
  - **En la vista:** `request.quick` (opcional, solo con `kind: "instruction"`), `[{label, text}]`, con los mismos topes
    (`MAX_QUICK_COMMANDS`, `MAX_QUICK_LABEL`, `MAX_QUICK_TEXT` en `packages/protocol/src/viewmodel.ts`).
  - **Consola, simulador y pruebas:** se eligen con cruceta y A o con el lápiz; izquierda/derecha pasan al atajo de al lado.
    El cursor empieza en «Escribir» (un A suelto abre el teclado, no manda una orden) y vale la misma guarda de 500 ms
    (`INSTRUCT_GUARD_MS`). Si el envío falla, se puede volver a elegir.
  - **Disposición (320x240) con 4 atajos:** encabezado y «Último mensaje» arriba (3 líneas de 13 px), los atajos en dos
    columnas de 150 px y 24 px de alto, «Escribir» y «Seguir en el PC» de 26 px debajo, y abajo una línea con lo que hace la
    fila marcada (de un atajo, el texto que va a mandar) y la ayuda de teclas. Sin atajos la tarjeta es la de antes.

**Salida:** una sesión completa de grill-me respondida desde la 3DS, y dos sesiones de Claude Code visibles a
la vez en el panel.

## Fase 4 — Más agentes

Uno por vez, cada uno con su adaptador, su instalador y su fila en la matriz de capacidades:

1. Gemini CLI (hooks propios).
2. Cursor (hooks + MCP).
3. Codex CLI.
4. Hermes Agent (MCP; revisar qué más ofrece).
5. Escáner de presencia de mejor esfuerzo para lo que no tenga integración.

**Salida por agente:** su fila de la matriz probada de punta a punta; la consola oculta lo que ese agente no
soporta.

## Fase 5 — Voz y asistente general

Decidido con el usuario el 2026-11-13: la consola también es un asistente general al que se le pide algo
directamente (revisar correos, redactar una respuesta, agenda, recordatorios, preguntas rápidas). Absorbe la
fase de voz. El asistente vive en el puente; la consola solo capta el pedido, muestra la respuesta y aprueba.

Se construye en tres pasos, cada uno probado en la consola antes del siguiente:

**5a — Voz a texto.** Pendiente de la prueba 0.6 (transcripción con whisper.cpp; requiere descargar un modelo).

- Consola: mantener un botón para hablar, tramas de audio (`AUDIO`, ya reservado en el protocolo), indicador
  de nivel. Alternativa: teclado del sistema para pedidos cortos.
- Puente: remuestreo, whisper.cpp como proceso que queda cargado, modelo multilingüe.
- Vista previa del texto en la consola y confirmación con A antes de enviarlo.

**5b — Asistente de solo lectura.**

- Antes de nada: **cifrar el canal** consola ↔ puente (hoy autenticado pero sin cifrar; el contenido de
  correos no debe viajar en claro por la red).
- Puente: un agente Claude (Agent SDK) como una sesión más, de tipo "asistente", con los conectores del
  usuario (correo, calendario). Decidir aquí cómo se paga el uso (suscripción o API).
- Pedidos cortos y respuestas resumidas: la cara responde en el globo y el texto completo va abajo con
  desplazamiento. La pantalla no es para leer correos largos.
- Memoria entre conversaciones (lo que el usuario pidió, sus preferencias), para que no responda igual el
  día uno que el día cien.

**5c — Acciones con aprobación.**

- Todo lo que envíe o modifique algo (enviar un correo, crear un evento) aparece como tarjeta de permiso y
  se aprueba con el mismo gesto de la Fase 1b. Nunca se ejecuta sin esa aprobación.
- Respuesta por voz por los parlantes, opcional.

**Salida:** dictar "resume mis correos de hoy" y ver el resumen en la consola; dictar una respuesta, ver el
borrador y enviarlo aprobando con A. Con el PC apagado la consola lo dice con claridad.

Contexto de mercado (2026-11-13): existe Claude Desktop Buddy, de Anthropic (plaquita ESP32 por Bluetooth que
muestra estado y aprueba permisos). Este proyecto se diferencia por dos pantallas, táctil, varios agentes y
este asistente. Lo que evita que estos aparatos terminen en un cajón es la personalidad con memoria; enlaza
con la Fase 6.

## Fase 6 — Mascota

Alcance por decidir al llegar aquí: con puntos en vez de personaje, hay que resolver si XP, monedas y tienda se
mantienen (por ejemplo, accesorios y efectos para los puntos) o se eliminan.

- XP y nivel calculados desde el registro de eventos (ya existe desde la Fase 1), si se mantienen.
- Cada punto a distinta profundidad con el 3D estereoscópico, opcional y apagado en consolas sin 3D.
- Sonidos por estado.

**Salida:** los puntos usan la profundidad 3D y el sonido, y la decisión sobre XP y tienda está tomada y aplicada.

## Fase 7 — Empaquetado

- Instalador único en el PC: puente como servicio al iniciar sesión, hooks, MCP, regla de firewall.
- Guía de instalación del `.3dsx`; `.cia` si hay interés.
- Decidir aquí si el wrapper de terminal (`3ds-run`) hace falta; si sí, va como fase propia.

## Arte

**Ya no hay carril de arte.** La dirección aprobada es "agentes como puntos" (`05-marca-e-identidad.md`,
prototipo en `art/dots/index.html`): cada agente es un punto con ojos que se distingue por color y movimiento.
Se dibuja con círculos y rectángulos, sin ilustraciones ni hojas de sprites.

Lo que queda de este carril es código, y entra en las fases normales:

1. Fase 1: el movimiento y los estados de los puntos se definen una vez como datos en `packages/protocol`, y el
   simulador los dibuja (se parte del prototipo).
2. Fase 2: el cliente 3DS dibuja los mismos puntos con `citro2d`. No hay marcadores de posición: es el arte final.
3. Fase 6: profundidad 3D por punto, sonidos y lo que se decida sobre XP y accesorios.

## Orden y paralelismo

```text
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 2b ──► Fase 3 ──► Fase 4 ──► Fase 5 ──► Fase 6 ──► Fase 7
```

- Dentro del repositorio, un solo implementador de código a la vez. `packages/` y `client-3ds/` pueden avanzar
  en paralelo solo cuando el protocolo de esa fase ya está fijado.
- Cada tarea corre sus propias pruebas; la suite completa corre una vez al cerrar cada fase.
- Las fases 4 y 5 son independientes entre sí y se pueden invertir.
- La voz de la Fase 2b (paso 6) espera a la Fase 5a; el resto de la 2b no depende de nada nuevo.

## Riesgos principales

| Riesgo | Cómo se detecta temprano | Plan si ocurre |
| :--- | :--- | :--- |
| Wi-Fi inestable o reconexión lenta tras el reposo | Pruebas 0.3 y 0.5 | Reconexión agresiva; el permiso vuelve al terminal mientras tanto |
| No funciona en Old 3DS / 2DS | No se puede detectar sin esa consola | Se declara "probado en New 3DS XL" hasta conseguir una |
| LED inaccesible | Prueba 0.4 | Aviso por sonido y pantalla |
| Voz demasiado lenta | Prueba 0.6 | Modelo más chico o dejar solo teclado |
| Memoria insuficiente para retratos | Prueba 0.7 | Retratos más chicos, carga por demanda, sin 3D |
| Hooks de otros agentes no permiten aprobar | Fase 4, agente por agente | Ese agente queda en "solo estado" en la matriz |

## Decisiones tomadas (2026-11-11)

1. **Consola de prueba:** New 3DS XL. Compatibilidad con el resto de la familia como objetivo de diseño, sin
   verificar.
2. **Tapa abierta obligatoria.** La app solo funciona con la tapa abierta; al cerrarla la consola entra en
   reposo normal y al abrirla se reconecta. El trabajo en el PC nunca depende de la 3DS: sin consola, todo
   vuelve al terminal.
3. **Identidad visual: agentes como puntos**, dibujados por código. Ver `05-marca-e-identidad.md`. Se
   descartaron los personajes ilustrados (`03-arte-con-ia.md`).
4. **Canal autenticado y sin cifrar en la v1.** Nadie en la red puede aprobar ni inyectar nada; sí podría leer
   el texto de los comandos. El cifrado queda como mejora posterior.
