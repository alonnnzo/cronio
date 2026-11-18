# Fase 7 — Programa del PC (instalador y puente)

Decidido el 2026-11-16 con el usuario:

- **Programa de escritorio** (Electron), no una página local ni una guía sola.
- **La 3DS se instala con un `.cia` y un QR** que se escanea con FBI. El `.3dsx` queda como alternativa.
- Herramientas para el `.cia`: `makerom` 0.19.0 (3DSGuy/Project_CTR) y `bannertool` 1.2.0 (diasurgical/bannertool),
  descargadas con permiso a `C:/devkitPro/tools/bin`. No entran al repo.

## Qué es

Una sola app del PC, **Agent Companion**, que:

1. Muestra el paso a paso de la configuración inicial y hace cada paso con un botón (**"Hacerlo por mí"**), siempre
   mostrando antes qué va a cambiar.
2. Mantiene el puente corriendo: lo arranca como proceso hijo, muestra su estado y queda en la bandeja del sistema.
   Reemplaza la ventana "Puente 3DS" de PowerShell.
3. Muestra el QR del `.cia` para instalarlo desde FBI (el puente lo sirve por la red local, siempre; ver "Actualizar desde la 3DS").

Todo en español, con lenguaje simple: cada paso dice **qué hace, por qué hace falta y cómo saber que quedó bien**.

## Pasos de la app

Barra lateral con los pasos y una marca ✓ en cada uno cuando la comprobación pasa. Cada paso se puede rehacer.

### 1. Bienvenida — qué necesitas

- PC con Windows, Claude Code instalado y Node 22 o superior (los hooks corren con `node`). La app comprueba
  `node --version` y, si falta, explica cómo instalarlo (enlace a nodejs.org).
- New 3DS / 3DS con **firmware personalizado** (Luma3DS, Homebrew Launcher y FBI). La app no lo instala: enlaza a
  la guía pública `https://3ds.hacks.guide/es_ES/` y explica en una frase para qué sirve.
- La 3DS y el PC en la misma red Wi-Fi.

### 2. Claude Code — los hooks

- Lee `~/.claude/settings.json` (si no existe, parte de `{}`).
- Muestra la lista de entradas que va a agregar (las mismas de `packages/hooks/settings.example.json`), con una
  frase por evento: "PermissionRequest: los permisos y preguntas llegan a la 3DS", etc.
- **Agregar**: copia `permission-hook.mjs` a `%APPDATA%/agent-companion/hooks/` (ruta estable, no depende de dónde
  esté el repo), guarda un respaldo `settings.json.bak-companion-AAAAMMDD-HHMMSS` y fusiona:
  - no borra ni cambia hooks ajenos;
  - no duplica: una entrada es "nuestra" si su `url` es `http://127.0.0.1:33335/hook/claude` o su `command`
    termina en `permission-hook.mjs`; las nuestras se reemplazan por la versión actual;
  - escribe con la misma sangría (2 espacios) y deja el resto del archivo igual.
- **Quitar**: retira solo las entradas nuestras (con respaldo).
- Comprobación ✓: las entradas están y apuntan a un archivo que existe.
- Aviso: las sesiones de Claude Code ya abiertas toman los hooks al reiniciarse.
- **Dónde se activa** (para que no sea intrusivo). Los hooks se instalan una sola vez en `~/.claude/settings.json`, pero solo
  actúan en las carpetas que el usuario elija. Sección "Dónde se activa" del paso: opción "En todas las carpetas" o
  "Solo en las carpetas que elija", lista de carpetas con **Quitar** y botón **Agregar carpeta…** (diálogo de carpeta de
  Electron, por la función con nombre `hooksCarpetaAgregar` del preload). Una carpeta cubre sus subcarpetas. Debajo,
  la caja "Tu privacidad": todo pasa en el PC (Claude Code → puente en 127.0.0.1 → 3DS por la red local), sin servidor
  propio, sin guardar datos fuera del PC y sin enviar nada a internet (la única excepción es la casilla opcional de GitHub, ver «Actualizar el programa del PC»); y una línea: las sesiones en otras carpetas
  funcionan como siempre, sin la 3DS.
  - **Archivo** `%APPDATA%/agent-companion/carpetas.json` (carpeta cambiable con la variable `AGENT_COMPANION_CONFIG_DIR`,
    usada en pruebas): `{ "modo": "todas" | "elegidas", "carpetas": ["C:/Users/yo/repo"] }`.
  - **Sin archivo = "todas"**: quien ya tenía todo instalado sigue igual. Al agregar los hooks por primera vez (sin avisos
    nuestros previos y sin archivo) la app escribe `"elegidas"` con la lista vacía: las instalaciones nuevas son opt-in
    y la sección avisa que aún no hay carpetas elegidas. Si ya había avisos o archivo, no cambia el modo.
  - **Archivo corrupto** (existe pero no se entiende): no se activa en **ninguna** carpeta, el puente deja un aviso en su log
    y la app lo muestra en rojo; elegir un modo o agregar una carpeta lo reescribe.
  - **Comparación de rutas**: sin distinguir mayúsculas, `/` y `\` son lo mismo, sin separador final ni barras repetidas;
    se compara el `cwd` que trae cada hook. Lógica compartida y sin dependencias en `packages/hooks/carpetas.mjs`
    (el instalador la copia junto a `permission-hook.mjs` en `%APPDATA%/agent-companion/hooks/`).
  - **Se aplica en dos lugares**: (1) `permission-hook.mjs` sale con 0 y sin salida antes de contactar al puente si el `cwd`
    no está permitido (permisos, preguntas y `Stop`); (2) el puente (`/hook/claude`, `/permission`, `/question`, `/stop`)
    ignora esas sesiones: no las registra y responde "sin decisión" (`ask` / `none`). El puente lee el archivo en cada
    petición, así que los cambios valen sin reiniciarlo. Un aviso sin `cwd` solo se acepta si la sesión ya estaba registrada.

- **Entrevistas (grill-me).** Sección del mismo paso que instala la skill `packages/hooks/skills/grill-me/SKILL.md` en
  `~/.claude/skills/grill-me/SKILL.md` (botones **Instalar** / **Quitar**; muestra antes el archivo que va a escribir).
  Es nuestra si su frontmatter trae `metadata:` con `creador: cronio`; una carpeta `grill-me` ajena no se pisa ni se quita
  y la app lo avisa. ✓ si el archivo está y es el nuestro. Lógica en `src/setup/skills.ts` (el HOME llega por parámetro:
  las pruebas usan una carpeta temporal). Empaquetada viaja en `resources/skills/grill-me/SKILL.md`.

### 3. Este PC — puente, firewall e inicio

- **Puente**: botón Iniciar/Detener y estado en vivo (`GET /health`: puente, consola conectada, solicitudes).
- **Firewall**: regla de entrada para TCP 33334 (consola) y TCP 33337 (descarga del `.cia`), solo perfil privado.
  Necesita administrador: la app lanza `netsh advfirewall firewall add rule ...` elevado (Windows muestra su
  aviso de UAC). Comprobación ✓: `netsh advfirewall firewall show rule name="Agent Companion"`.
- **Iniciar con Windows**: `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`. Con `--hidden` la app
  arranca en la bandeja y levanta el puente sin abrir la ventana (ni siquiera existe: ver «Segundo plano y bandeja»).

### 4. La 3DS — instalar la app

- **Con QR (recomendado)**: el **puente** sirve `/agent-companion.cia` en `0.0.0.0:33337` (ver más abajo); el paso elige
  la IP de la red local (IPv4 privada de la interfaz con puerta de enlace; si hay varias, deja elegir) y muestra el QR de
  `http://<ip>:33337/agent-companion.cia`. Instrucciones: en la 3DS abre FBI → *Remote Install* → *Scan QR Code*, apunta
  la cámara y confirma. El paso ya no levanta su propio servidor: consulta `/health` del puente (`cia.serving`).
  - Si el puente sirve el `.cia`, el paso lo dice ("el puente entrega el archivo mientras esté encendido").
  - Sin puente corriendo, el paso lo dice y pide iniciarlo en el paso 3 (no levanta nada: dos servidores no deben chocar en el puerto).
  - Si el puente que corre **no** sirve el `.cia` (uno de desarrollo o anterior, sin `COMPANION_CIA_PATH`), el paso levanta su propio
    servidor como **respaldo** mientras esté abierto y avisa. Si el puerto está ocupado, lo dice. La decisión está en
    `decidirOrigenCia` (`src/setup/cia.ts`).
- **Alternativa `.3dsx`**: botón "Mostrar el archivo" (abre la carpeta) e instrucciones: copiarlo a
  `SD:/3ds/agent-companion.3dsx` y abrirlo desde el Homebrew Launcher.
- Si el `.cia` no existe, el paso lo dice y explica cómo generarlo (`make cia` en `client-3ds`).

### 5. Emparejar y probar

- Abre la app en la 3DS: el paso muestra el código de emparejamiento y espera a que la consola se conecte
  (estado en vivo desde `/health`).
- **Probar**: manda un evento de prueba (`POST /event`) y pide confirmar que se vio en la 3DS.

## Estructura

```
packages/installer/          app Electron
  package.json               "main": "dist/main.js" o tsx en desarrollo; script "start"
  src/main.ts                ventana (se destruye al cerrar), bandeja y su menú, IPC, puente hijo, servidor del .cia
  src/setup/bandeja.ts       menú de la bandeja, tooltip y variante del ícono (puro, con pruebas)
  src/preload.ts             expone window.companion (contextBridge), nada más
  src/setup/*.ts             lógica pura y probada: fusión de settings, comandos netsh, IP local, rutas
  renderer/index.html, app.js, styles.css   la interfaz (sin framework)
  test/*.test.ts             vitest
client-3ds/
  Makefile                   objetivo nuevo `cia`
  cia/agent-companion.rsf    plantilla RSF (UniqueId de homebrew, ProductCode CTR-H-AGCP)
  cia/banner.png, banner.wav, icon.png   arte del menú HOME
```

- **Puente**: en desarrollo se lanza como hijo con `node --import tsx packages/bridge/src/cli.ts start` (el mismo
  comando que hoy). Su salida va a un log en `%APPDATA%/agent-companion/logs/`.
- **Puentes sueltos y versiones**: ningún puente suelto debe tapar al bueno.
  - `GET /health` dice quién es: `version` (la del `package.json` del puente; en el bundle la inyecta esbuild con `define`, y
    `bundle:bridge` deja además `bridge/cli.version` junto a `cli.mjs`), `pid` y `startedBy` (`cronio` si lo lanzó el programa,
    con `COMPANION_STARTED_BY`; si no, `manual`). **Al subir la versión de Cronio, súbela también en `packages/bridge/package.json`.**
  - `POST /shutdown` (solo desde 127.0.0.1, sin `Origin`, con la cabecera `X-Cronio: shutdown`) responde 202 y cierra el puente de
    forma ordenada (servidores y sockets; las solicitudes pendientes pasan a «decide el PC»).
  - Al arrancar, si el 33335 ya responde, decide `decidirPuenteExistente` (`src/setup/puente-viejo.ts`): misma versión que el
    bundle → lo usa («ya estaba corriendo», también un puente de desarrollo de la misma versión); otra versión o sin `version`
    → le pide `/shutdown`, espera hasta 5 s a que suelte el puerto y arranca el propio; si no responde a `/shutdown` (uno viejo de
    verdad), el paso 3 muestra «Hay un puente viejo corriendo (PID n) que no es de esta versión» con el botón **Detener puente
    viejo**. El PID sale de `netstat -ano` (`parsearNetstat`) y solo se cierra con `taskkill /PID n /F` si sigue escuchando en el
    33335 y es `node.exe` o `Cronio.exe` (`evaluarCierrePid`, con `tasklist`); si no, avisa y no hace nada. Después arranca el suyo.
  - **«Salir»** (bandeja o cualquier cierre que pase por `before-quit`) detiene el puente hijo: `POST /shutdown` y, si no sale en
    3 s, `kill`. Solo el que lanzó el programa (el `/shutdown` se manda si el PID de `/health` es el del hijo). `will-quit` y
    `exit` matan al hijo si todavía vive.
  - **Sin huérfanos**: el programa pasa su PID en `COMPANION_PARENT_PID`; el puente comprueba cada 5 s con `process.kill(pid, 0)`
    y, si ya no existe, se cierra ordenadamente (`watchParent`, `packages/bridge/src/lifecycle.ts`). Lanzado a mano no hace nada.
- **El .cia y el respaldo del paso 4**: el servidor de respaldo solo se levanta con un puente **ajeno** que, según `/health`, no
  sirve el `.cia`, y nunca mientras el puente hijo está arrancando ni con el hijo propio (`decidirOrigenCia` con `propio` y
  `arrancando`; si el hijo no tiene el puerto, el paso dice que está esperando). Si el 33337 está ocupado al arrancar, el puente
  arranca igual y **reintenta cada 5 s** hasta poder; las consolas que se conectan después reciben el aviso de versión.
- **Seguridad**: `contextIsolation: true`, `nodeIntegration: false`, CSP estricta; el renderer solo llama a
  funciones con nombre del preload (no hay "ejecutar comando" genérico). El servidor del `.cia` solo responde esa
  ruta y solo con `GET`.
- **Empaquetado** (`npm run dist:installer`; `npm run dist:installer:local` además anota la carpeta `release` como origen local, solo para quien desarrolla): genera `packages/installer/release/Cronio-Setup-<versión>.exe` (NSIS, por usuario,
  sin firma de código: Windows SmartScreen avisará de editor desconocido). El puente se empaqueta con esbuild en
  `build/bridge/cli.mjs` (ESM, un solo archivo) y viaja en `resources/bridge/`; empaquetado se lanza con el propio
  `Cronio.exe` como Node (`ELECTRON_RUN_AS_NODE=1`) y guarda sus datos en `%APPDATA%/agent-companion/bridge`.
  Junto a él van, en `resources/`, los hooks, el simulador, el `.cia`, el `.3dsx` y el `.ico`. Todas las rutas se
  resuelven en `src/paths.ts` (modo empaquetado o desarrollo). Para generarlo hacen falta `client-3ds/agent-companion.cia` y `.3dsx`.

## Segundo plano y bandeja

Cronio puede vivir en la bandeja de Windows **sin molestar y gastando lo mínimo**. Dos ideas: sin ventana no hay proceso de interfaz, y todo lo
que corre en segundo plano vive en el proceso principal.

### La ventana se destruye, no se oculta

- Cerrar con la X **destruye** el `BrowserWindow` (no hay `hide()`): desaparece el proceso renderer. Arrancar con `--hidden` (inicio con Windows)
  tampoco crea ninguna ventana. Se crea solo cuando el usuario la pide: doble clic o clic en el ícono, «Abrir Cronio», o abrir el programa otra vez
  (`requestSingleInstanceLock` + `second-instance`, que ya existía). La interfaz lee todo del proceso principal al abrirse, así que queda igual.
- **Qué vive en el proceso principal** (nada depende de la ventana): el puente hijo y su estado, la bandeja y su menú, la búsqueda de actualizaciones
  (`Actualizador`: 10 s después de abrir y luego según el origen; con carpeta local cada 60 s, con GitHub cada 6 h; el reloj late cada 30 s con
  `unref`) y las notificaciones. La ventana solo pinta y pide cosas por IPC.
- **Sondeos**: con la ventana abierta, el estado del puente se pide cada 2 s y las actualizaciones cada 3 s (la interfaz no sondea con la ventana
  minimizada u oculta: `document.hidden`). Las comprobaciones caras ya no corren «de fondo» siempre: `netsh` (firewall) solo en Inicio y en el paso 3,
  `node --version` solo en Inicio y en el paso 1, y la red (`Get-NetRoute`/`Get-NetConnectionProfile` por PowerShell) solo al entrar a Inicio y en el
  paso 4. **Sin ventana no hay ninguno.** Lo único que corre sin ventana es **un `GET /health` a 127.0.0.1 cada 20 s** (para el menú y el ícono de la
  bandeja) y la revisión de actualizaciones con su regla de siempre; con la ventana abierta la bandeja reutiliza lo que la ventana ya sondeó.
- **Ajuste «Al cerrar la ventana»** (Ajustes): «Seguir en la bandeja» (por defecto) o «Salir del todo» (cerrar la ventana cierra el programa y detiene el
  puente propio). Se guarda en `app.json` como `alCerrar: "bandeja" | "salir"`.
- **Primera vez que se cierra la ventana** con «seguir en la bandeja»: una notificación única, «Cronio sigue en la bandeja…». Queda anotada en
  `app.json` (`avisoBandejaMostrado: true`) para no repetirla.
- **Notificaciones del sistema**: solo tres, y sin repetir. Versión nueva (una vez por versión, ya existía), puente caído sin que nadie lo pidiera
  (se confirma 2 s después con otro `/health`; no se avisa si se detuvo desde la ventana, desde la bandeja o en una pausa) y el aviso único de arriba.
  Las acciones del menú además confirman con una notificación breve («Puente detenido: la 3DS no recibirá avisos.», pausa activada) o avisan si fallan.

### Menú de la bandeja

Clic derecho en el ícono. En Windows lo natural es que **el clic simple y el doble clic abran la ventana** (como Discord o Steam) y que el menú sea el clic derecho,
así que es lo que hace. El menú se reconstruye solo cuando algo cambia (clave de plantilla + tooltip + ícono). La plantilla es una **función pura**
(`plantillaMenu` en `src/setup/bandeja.ts`, con pruebas en `test/bandeja.test.ts`: estado → elementos); `main.ts` solo la convierte en un `Menu` y cada
elemento llama a una función con nombre (`ejecutarAccion`, sin nada genérico; las dos URL son fijas).

```
Cronio 0.3.3                          (deshabilitado)
Puente: en marcha / detenido / en pausa hasta las 15:30
3DS: conectada (app 0.3.3) / sin conexión
─────────
Abrir Cronio
─────────
Detener el puente   |   Iniciar el puente   |   Reactivar los avisos ahora (en pausa)
Pausar avisos por…  ▸ 30 minutos · 1 hora · Hasta que lo reactive
─────────
Actualizar a x.y.z                    (si hay una nueva; abre la ventana: el instalador necesita que se vea)
Buscar actualizaciones                (o «Actualizaciones: desactivadas» + «Configurar…» si el origen es ninguno)
─────────
Mostrar el QR de instalación          (abre la ventana en el paso 4)
☐ Iniciar con Windows
Ver el registro del puente
Página web y ayuda  ▸ Página web de Cronio · Ayuda y reportes
─────────
Salir                                 (cierra todo, también el puente propio)
```

- «Detener el puente» solo se ofrece activo si **lo lanzó Cronio**: uno ajeno (de otra terminal) se muestra pero no se toca. **Pausar** detiene el puente y un
  temporizador (en memoria) lo vuelve a iniciar al cumplirse el plazo; «hasta que lo reactive» no tiene plazo. Si Cronio se cierra durante una pausa, al volver
  a abrirlo el puente arranca normal.
- **Ícono**: `crearIconoPng(tam, { apagado, punto })` en `src/icon.ts`. Normal = la cara naranja; **apagado** (gris, ojos oscuros) cuando el puente está
  detenido o en pausa; **punto** azul con aro blanco arriba a la derecha cuando hay una versión nueva. **Tooltip**: «Cronio · puente en marcha · 3DS conectada»
  (o «puente detenido», «avisos en pausa hasta las 15:30», y al final «hay una versión nueva (x.y.z)»).
- «Actualizar a x.y.z» y «Mostrar el QR» abren la ventana con una **orden** (`ordenPendiente` en el proceso principal): la interfaz la pide al abrirse
  (`ordenPendiente()`) o cuando se le avisa por `companion:orden`, y hace lo mismo que el botón de la ventana (con su pantalla de progreso).

### Menos procesos y memoria (medido)

Medido con `electron-builder --dir` (`win-unpacked`), `--user-data-dir` y `AGENT_COMPANION_CONFIG_DIR` temporales, puertos propios del puente
(`CRONIO_PUERTOS_PRUEBA`, ver abajo), working set con `Get-CimInstance Win32_Process`, 25–35 s después de abrir. «Antes» es la 0.3.3 tal como salió (el
puente de la medición de antes es el del usuario reutilizado: se suma aparte su medida suelta, 58 MB, lanzado con las mismas banderas).

| Estado | Antes (programa + puente suelto) | Después |
|---|---|---|
| Ventana abierta | principal 117 + GPU 100 + utility 51 + renderer 83 = **351** (+58 puente ≈ 409), 4 procesos | principal 143 + renderer 86 + puente 63 = **292**, 3 procesos |
| Ventana cerrada (bandeja) | principal 113 + GPU 95 + utility 51 + renderer 75 = **334** (+58 ≈ 392), 4 procesos (la ventana solo se ocultaba) | principal 138 + puente 56 = **194**, 2 procesos |
| Arrancado con `--hidden` | principal 113 + GPU 95 + utility 51 + renderer 82 = **340** (+58 ≈ 398), 4 procesos | principal 90 + puente 71 = **162**, 2 procesos |

CPU en reposo en la bandeja: 0,0 a 0,3 % de un núcleo (15–30 ms en 10–20 s); con la ventana abierta, ~1–2 % por su sondeo de 2 s. En los tres estados el
renderer solo existe con la ventana abierta.

**Banderas de Chromium que se quedaron** (en `main.ts`, antes de `ready`; cada una medida en la 0.3.3 con la ventana abierta, solo el programa):

| Bandera | Resultado | Decisión |
|---|---|---|
| ninguna (línea base) | 351 MB, 4 procesos | |
| `--disable-gpu` solo | 316 MB; el proceso GPU baja de 100 a 66 MB pero sigue ahí | insuficiente |
| `--in-process-gpu` solo | 301 MB, 3 procesos (sin GPU; el principal sube a 167) | sirve |
| `--enable-features=NetworkServiceInProcess2` solo | 293 MB, 3 procesos (sin el «utility» de 51 MB, que era el **servicio de red** de Chromium, `network.mojom.NetworkService`) | sirve |
| `--disable-gpu` + `NetworkServiceInProcess2` | 251 MB, 3 procesos | |
| **`disableHardwareAcceleration()` + `--in-process-gpu` + `NetworkServiceInProcess2`** | **220 MB, 2 procesos** (principal + renderer) | **la que quedó** |

La interfaz (sombras, degradados, fuentes) se dibuja igual sin GPU: se comprobó con `--debug-shots`. Sin GPU de hardware y con el servicio de red dentro del
principal no hay actividad de red del programa en segundo plano salvo el `/health` local y la revisión de actualizaciones.

**Banderas del puente** (el propio `Cronio.exe` como Node, 58 MB suelto): `--max-old-space-size=48` 58 MB, `--optimize-for-size` 62, `--max-semi-space-size=1`
58, `--single-threaded` 59, `--jitless` 56, `--lite-mode` 55 (y 55 combinadas). Ninguna baja más de ~3 MB (5 %) y `--lite-mode`/`--jitless` apagan el compilador que
acelera el cifrado y el protocolo, así que **no se usó ninguna**: el piso de un proceso Node está ahí.

### Probar la bandeja sin tocar nada real

Dos variables de entorno, solo para quien desarrolla (sin ellas el programa se comporta como siempre):

- `CRONIO_PUERTOS_PRUEBA=api,consola,udp,ws` (cuatro puertos, p. ej. `43335,43334,43333,43340`): el programa y el puente hijo usan puertos propios, así que no
  chocan con un Cronio instalado ni lo detienen (sin esto, un puente de otra versión en el 33335 se cerraría).
- `CRONIO_PRUEBA_BANDEJA=<carpeta>`: el menú, el tooltip y el estado se vuelcan en `<carpeta>/bandeja.json`; se ejecuta el `AccionBandeja` que se escriba en
  `<carpeta>/accion.txt` (`abrir`, `puente-detener`, `pausa-30`, …) con las mismas funciones que el clic; las notificaciones van a `notificaciones.log`, las URL a
  `urls.log` y «Iniciar con Windows» es una variable en memoria. Con `--debug-shots` no hay bandeja ni se ejecuta ninguna acción.

## Actualizar desde la 3DS (QR ya no hace falta)

La app de la consola se actualiza sola, sin QR ni FBI:

- **Versión**: `APP_VERSION := 0.2.0` en `client-3ds/Makefile` es la única fuente. Va al código C (`-DAPP_VERSION`), a makerom
  (`-major/-minor/-micro`) y a `client-3ds/agent-companion.version` (texto `0.2.0`, ignorado en git como el `.cia`), que `make cia` deja
  junto al `.cia`. Aviso: el makerom 0.19.0 de devkitPro **no escribe el `-minor`** en la versión del título del TMD (0.2.0 queda en 0 y
  1.2.3 en 1.0.3), así que la versión que cuenta es la del `.version` y la del saludo, no la del TMD.
- **Saludo**: la consola agrega `appVersion` e `install` (`cia` si está instalada, `3dsx` si corre desde el Homebrew Launcher, por
  `envIsHomebrew()`) al `hello`. No entran en el MAC y son opcionales: un cliente anterior cuenta como versión desconocida y no recibe avisos.
- **Puente**: con `COMPANION_CIA_PATH` (la pone el programa del PC; en modo empaquetado es `resources/client-3ds/agent-companion.cia`, y por
  eso `extraResources` lleva también el `.version`) sirve `GET`/`HEAD` de `/agent-companion.cia` en `0.0.0.0:33337`, con `Content-Length`;
  cualquier otra ruta es 404 y otro método 405. La versión sale del `.version` que está al lado. `/health` informa `cia: { serving, port, version }`.
  Si el puerto está ocupado, el puente arranca igual y lo registra.
- **Vista**: a la consola con una versión menor se le agrega `update: { version, url, size, sha256 }` (la URL usa la IP del socket por el que llegó:
  `http://<ip del PC en la red de la consola>:33337/agent-companion.cia`; `size` y `sha256` —hex de 64 caracteres— son los del `.cia` que el puente
  sirve). Sin versión del `.cia`, igual o mayor, no se manda. El puente lee el `.cia` ENTERO a memoria al cargar la fuente (`loadCia`), calcula ahí
  el hash y el tamaño y sirve esos mismos bytes desde memoria: no hay carrera entre el hash que avisa y el archivo que entrega. Si el archivo
  cambia en disco (mtime o tamaño) se recarga, y el `update` se recalcula en cada vista.
- **Consola** (`logic/update.c`, `updater.c`, `render_update.c`): tarjeta «Hay una versión nueva de Cronio (0.3.0). Tienes la 0.2.0.» con
  A: Actualizar / B: Ahora no (hasta el próximo arranque); detrás de las solicitudes y los avisos con «Visto», con la guarda de 500 ms. Entrada
  «Actualizar app» en el menú SELECT. Como `.3dsx` solo explica que hay que instalarla como `.cia` (paso 4). La instalación baja el `.cia`
  por HTTP con sockets ENTERO a memoria (unos 370 KB; tope 8 MB; un corte de red nunca toca AM) y solo después lo instala (`amInit`,
  `AM_StartCiaInstall(MEDIATYPE_SD)`, `FSFILE_Write` en trozos de 256 KB con `FS_WRITE_FLUSH`, `AM_FinishCiaInstall`). La barra tiene dos
  tramos: 0-80 % descarga, 80-100 % instalación. **Verificación (auditoría 2026-11-17)**: el HTTP va en claro, así que antes de tocar AM la consola exige
  (1) que el host de la dirección sea el del puente al que está conectada (`A.net.target_host`), (2) `Content-Length == size` y (3) que el SHA-256
  de lo descargado (`core/sha256.c`) sea el de la vista, comparado en tiempo constante. Si no, falla con «El archivo descargado no coincide con el que
  anunció el PC.» sin abrir AM y mantiene la versión actual. Una vista con `update` sin `size`/`sha256` válidos (puente viejo) se acepta pero
  NO ofrece instalar. **Ya no se borra la app ni se reintenta**: la instalación sobre el título en ejecución funciona sin borrarlo (probado en la
  consola real, 0.2.2 → 0.2.9). Si AM falla, `AM_CancelCIAInstall` (si había manejador abierto), error en pantalla con la función y su código
  (p. ej. «FSFILE_Write C8A08BF4 en el byte 0») y «Se mantiene la versión actual»; desaparecen el paso de reintento y el texto de «app desinstalada».
  Máquina de estados en `logic/updflow.c`. Antes manda `hold` de 300 s para que el puente no corte la conexión; START no
  sale mientras dura. Al terminar: «Listo. Cronio se va a reiniciar.» y `aptSetChainloader(<título propio>, MEDIATYPE_SD)` con salida limpia.
  El RSF agrega `am:net` a `ServiceAccessControl` (13 servicios; el máximo de makerom es 34).
- **Simulador**: muestra la tarjeta solo como aviso («Actualizar» dice «Solo en la consola»).

## Actualizar el programa del PC

El programa se actualiza solo, pero **nunca sin que el usuario lo pida**: ofrece «Actualizar» y no hace nada más. Con la app en la
bandeja (`--hidden`) solo notifica. No hay servidor propio. La 3DS se entera sola de la app nueva porque el `.cia` va dentro del instalador
(ver «Actualizar desde la 3DS»).

- **Ajustes**: `%APPDATA%/agent-companion/app.json` (`AGENT_COMPANION_CONFIG_DIR` lo cambia; lo usan las pruebas):
  `{ "actualizaciones": { "origen": "ninguno" | "local" | "github", "carpeta"?: "C:/..." }, "ultimaVersionAvisada"?: "0.3.0", "alCerrar"?: "bandeja" | "salir", "avisoBandejaMostrado"?: true }`.
  Código en `src/setup/app-ajustes.ts`. Un archivo ausente, roto o con otro origen vuelve al valor por defecto.
- **Valor por defecto** (cuando `app.json` no trae `actualizaciones`): origen «ninguno». Solo el instalador de quien desarrolla (`npm run dist:installer:local`, que pone `CRONIO_ORIGEN_LOCAL=1`) parte con origen «local» y la carpeta `release` **de la máquina donde se construyó**, y solo si esa carpeta existe. Cómo se detecta: `scripts/dist.mjs` escribe `build/origen-local.json` (`{ "carpeta": "<paquete>/release" }` con esa variable; `{}` sin ella, que es el instalador público) y
  `extraResources` lo lleva a `resources/origen-local.json`; el programa instalado lo lee y comprueba que la carpeta exista en este PC. Es más limpio que
  fijar una ruta de usuario en el código o adivinar dónde está el repo, y en el PC de otra persona (donde esa ruta no existe) cae solo en «ninguno».
  La versión de desarrollo (`npm start`) nunca parte con origen local. **GitHub nunca es el valor por defecto.**
- **Revisión automática**: 10 s después de abrir y cada 6 horas (`Actualizador.iniciarRevisiones`); con «ninguno» o sin versiones publicadas no hace nada.
  «Buscar ahora» la fuerza.
- **Interfaz**: sección «Actualizaciones» al final del paso 3 (versión instalada, selector «Ninguno / Carpeta local / GitHub (consulta internet)», «Elegir carpeta…»
  con el diálogo de Electron, «Buscar ahora» y el estado: Al día / Hay una versión nueva (x.y.z) + Actualizar o Descargar / Descargando… n % / Reiniciar y actualizar /
  Error: …). Además, una franja arriba en todas las pantallas («Hay una versión nueva de Cronio (x.y.z) · Actualizar») y una notificación del sistema **una sola vez
  por versión** (`ultimaVersionAvisada`, `debeNotificar`). IPC con nombre en el preload: `actualizacion*`.
- **Privacidad**: con el origen en «ninguno» o «local» no sale nada a internet por las actualizaciones; `electron-updater` ni siquiera se carga (`require` perezoso, solo
  con origen GitHub y dueño definido). Elegir «GitHub» es la casilla de consentimiento y lo dice: «Solo consulta si hay una versión nueva; no envía datos tuyos.» El texto de
  «Tu privacidad» del paso 2 lo menciona.

### Origen «local» (para quien desarrolla)

Lógica pura en `src/setup/actualizaciones.ts`; orquestación en `src/actualizador.ts`. electron-updater solo habla HTTP(S), así que se hace a mano.

1. Lee `<carpeta>/latest.yml` (el de electron-builder: `version`, `path`, `sha512`; sin dependencias, solo las claves de primer nivel; `path` debe ser un nombre de `.exe`, sin carpetas).
2. `decidirOferta`: si `version` > `app.getVersion()` ofrece actualizar (comparación x.y.z con `-pre` opcional, `compararVersiones`; no reutiliza la de `@companion/protocol`
   porque esa no admite `-pre` y el instalador no lleva ese paquete dentro).
3. Al pulsar «Actualizar» vuelve a leer `latest.yml`, copia el `.exe` a una carpeta temporal (`%TEMP%/cronio-update-*`) y verifica el `sha512` (base64); si no coincide, borra la copia y muestra el error.
4. Mientras copia y verifica, la app **tapa su ventana con un aviso** («Actualizando Cronio a la x.y.z», barra en movimiento, los pasos reales —«Copiando la versión nueva…»,
   «Comprobando el archivo…», «Cerrando Cronio: verás la barra de instalación y se abrirá solo al terminar.»—). Los pasos los lleva `Actualizador` (`pasos` en el estado; la
   interfaz lo consulta cada 250 ms). Si algo falla antes de cerrar (carpeta o sha512), el aviso muestra el error con «Volver».
5. Lanza el instalador copiado con `spawn(instalador, ["--updated"], { detached: true, stdio: "ignore" })`: **sin `/S`** y **sin `windowsHide`**, para que se vea su propia
   barra de progreso. Tras una pausa de 0,9 s llama a `app.quit()`; `before-quit` detiene el puente propio como siempre.
6. Solo en la app instalada: la de desarrollo busca pero no instala.

### La barra de progreso es la del instalador (oneClick)

Antes la ventana de progreso era un script de PowerShell (`instalar-cronio.ps1`, WinForms). En el PC real fallaba dos veces: el proceso lanzado desde Node con `-WindowStyle Hidden` y
`windowsHide` creaba el formulario oculto (o moría), Cronio se cerraba y no se instalaba nada. Se quitó (`ventana-instalacion.ts` y sus pruebas) y ahora la ventana es la del
instalador NSIS de electron-builder en modo **un clic**, que no depende de PowerShell:

- `nsis`: `oneClick: true`, `perMachine: false`, `createDesktopShortcut`, `createStartMenuShortcut`, `shortcutName: "Cronio"`, `runAfterFinish: true`, `deleteAppDataOnUninstall: false`.
  Se quitó `allowToChangeInstallationDirectory`: con `oneClick: true` electron-builder lo rechaza («makes sense only for assisted installer»). Ya no hay pantallas de licencia ni de carpeta:
  solo una ventana pequeña con el ícono y una barra de progreso.
- **Reabrir Cronio**: en el instalador de un clic, `runAfterFinish` abre la app al terminar si el instalador **no es silencioso** (`${ifNot} ${Silent}`) o si recibe `--force-run`. Como
  lanzamos sin `/S`, **no hace falta `--force-run`**. Se abre con `--updated`, como siempre.
- **Esperar a que Cronio se cierre**: al arrancar, el instalador revisa si hay un proceso de Cronio dentro de la carpeta de instalación. Con `--updated` espera 0,3 s, y si todavía hay uno
  espera 1 s más y **lo cierra** (primero `Stop-Process` normal, luego a la fuerza), reintentando. No espera para siempre a que salga solo, pero como la app llama a `app.quit()` 0,9 s
  después de lanzarlo, normalmente ya terminó; si no, el instalador la cierra. Por eso se lanza **antes** de `quit()` (un instalador lanzado después de salir no tendría quién lo lance
  desde la app ya muerta, y `detached` no depende de ella).
- **Nombre de la carpeta en instalaciones nuevas**: con `oneClick` y por usuario, electron-builder usa el `name` del package.json (`@companion/installer` quedaría como
  `@companioninstaller`) en vez del nombre del producto. Se fijó `build.extraMetadata.name = "cronio"` para que una instalación nueva quede en `%LOCALAPPDATA%ProgramsCronio`.
  El `appId` (`cl.cronio.app`) no cambia, así que el GUID del registro es el mismo; `app.setName("Cronio")` fija el nombre de la app, así que los datos de usuario no se mueven.
- **De `oneClick: false` (0.2.7 y anteriores) a `true`**: mismo `appId` → misma clave de desinstalación en el registro. Al instalar encima, el instalador (`uninstallOldVersion`) lee del registro
  la ruta del desinstalador y de la instalación anteriores (`InstallLocation`; en modo por usuario reutiliza esa carpeta, o sea `%LOCALAPPDATA%ProgramsCronio`, en lugar de calcular una),
  copia el desinstalador viejo a una carpeta temporal y lo corre en silencio con `/S /KEEP_APP_DATA --updated` (y `--keep-shortcuts` si procede); luego instala los archivos nuevos y recrea los
  accesos. Los datos del usuario (`%APPDATA%Cronio`) no se tocan. Esto lo hace igual un instalador asistido que uno de un clic; el cambio de modo no exige nada manual. **No se probó en
  una máquina real** (ver «Pendiente de verificar» abajo).

### Origen «GitHub» (para usuarios)

- Config de build: `publish: { provider: "github", owner: "alonnnzo", repo: "cronio" }` en `packages/installer/package.json`. electron-builder deja `latest.yml` en `release/` y
  `resources/app-update.yml` en el paquete; `scripts/dist.mjs` usa `--publish never` (no sube nada). El dueño es `alonnnzo` y el repo `cronio`; es el único lugar donde está ese nombre (el sitio lo repite en `site/app.js`).
- Si `owner` volviera a ser `POR_DEFINIR` (`leerConfigGithub` lee `app-update.yml`), el origen muestra «Todavía no hay versiones publicadas» y **no consulta nada**.
- Con dueño definido: `autoUpdater` con `autoDownload = false` y `autoInstallOnAppQuit = false`. Encuentra versión → «Descargar» → progreso → «Reiniciar y actualizar»
  (misma barra de progreso que en la carpeta local: lanza con `--updated` el instalador que electron-updater dejó en su caché, `downloadedFile` del evento `update-downloaded`; elegido a propósito en vez de `quitAndInstall` para tener un solo camino —con la pausa y el paso «Cerrando Cronio…»— y poder probarlo. Si no se conoce esa ruta, cae en `quitAndInstall(false, true)`: no silencioso, con la barra, y reabre la app). Para publicar: subir a un release de GitHub `Cronio-Setup-<v>.exe`, su `.blockmap` y `latest.yml`.

## `.cia`

- `make cia` en `client-3ds`: `bannertool makebanner` (imagen 256×128 + audio WAV corto) y `bannertool makesmdh`,
  luego `makerom -f cia -target t -elf agent-companion.elf -rsf cia/agent-companion.rsf -icon ... -banner ...`.
- La app ya funciona igual como `.cia`: se revisa que no dependa del Homebrew Launcher (rutas `sdmc:`, salida con
  START, `aptMainLoop`).
- Instalarla de nuevo con el QR la actualiza (mismo UniqueId). `make cia` también escribe `agent-companion.version` (ver arriba).

**Pendiente de verificar (0.2.8)**: instalar encima de la 0.2.7 y ver que aparece la barra, que Cronio se reabre solo y que los accesos directos y los datos quedan. El instalador no se ejecutó al preparar esta versión.

## Auditoría de seguridad (2026-11-17)

- **Simulador**: el programa empaquetado lanza el puente con `COMPANION_SIMULATOR=0`; el puente no levanta el WebSocket del simulador (puerto 33340).
  La carpeta `resources/simulator` sigue en el paquete pero ya no se sirve. En desarrollo no cambia nada. Ver `docs/06-fase-1-diseno.md`, punto 3.
- **Token local de la API**: `/pair`, `/shutdown` y los `/event` de la prueba mandan `X-Cronio-Token`, leído de `%APPDATA%/agent-companion/api-token` en cada llamada
  (`src/token-api.ts`; sin archivo no se manda nada y un puente anterior, que no lo exige, responde igual). El paso 2 detecta ahora una copia vieja del hook
  (`revisarHooks` compara con la del programa) y ofrece «Actualizar». `bridge.log` rota a `bridge.log.1` al pasar de 5 MB (`src/registro-rotativo.ts`). Ver `docs/06-fase-1-diseno.md`, puntos 2 y 4.
