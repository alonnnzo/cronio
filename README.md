# Cronio

**Estado: beta.** · Página y demo: <https://alonnnzo.github.io/cronio/>

Cronio convierte tu Nintendo 3DS en un compañero de escritorio para tus agentes de código: muestra qué está haciendo cada sesión,
te deja aprobar o rechazar permisos, contestar preguntas y mandar instrucciones desde la consola, y avisa cuando algo termina.
Es un programa para Windows (el puente) más una app homebrew para la New 3DS que se hablan por tu red local.

> **Video de demostración:** _(pendiente: aquí va el recorrido de la consola; mientras tanto, la [página del proyecto](site/README.md) tiene una demo interactiva)_

## Qué necesitas

- **PC:** Windows 10 u 11 y [Node.js](https://nodejs.org/) 22 o superior (lo usan los hooks de Claude Code).
- **Agente:** [Claude Code](https://claude.com/claude-code). El programa instala los hooks por ti.
- **Consola:** una New 3DS (probada en New 3DS XL; Old 3DS y 2DS sin probar) con firmware personalizado: Luma3DS y FBI.
  La guía para prepararla está en <https://3ds.hacks.guide/es_ES/>.
- **Red:** la consola y el PC en la misma red Wi-Fi, de preferencia una de confianza (ver [SECURITY.md](SECURITY.md)).

## Instalación

1. Descarga `Cronio-Setup-<versión>.exe` desde los [Releases oficiales](https://github.com/alonnnzo/cronio/releases) y ábrelo
   (mira el aviso de más abajo: el instalador no tiene firma de código).
2. En el programa, sigue los pasos: **Claude Code** (pulsa _Hacerlo por mí_ y elige en qué carpetas se activa) y **Este PC**
   (enciende el puente y abre en el firewall los puertos de la 3DS, solo en redes privadas).
3. **La 3DS:** el programa muestra un código QR. En la consola abre FBI, elige _Remote Install_, luego _Scan QR Code_ y apúntalo.
4. **Emparejar:** abre Cronio en la consola (menú HOME), pide el código en el programa, escríbelo en la 3DS y listo.

### Cómo se actualiza

Cronio no actualiza nada sin que lo pidas. En **Ajustes → Actualizaciones** eliges dónde buscar versiones nuevas:

- **Ninguno** (el valor por defecto): no se consulta nada.
- **GitHub:** pregunta a los Releases de este repositorio si hay una versión nueva, con electron-updater. Es opcional y solo
  pregunta; no envía datos tuyos.
- **Carpeta local:** una carpeta con el instalador y su `latest.yml`. Úsala solo con carpetas que controles tú.

La app de la consola se actualiza sola desde el PC: cuando el programa tiene un `.cia` más nuevo, la 3DS lo avisa y lo descarga por
la red local, verificando su tamaño y su SHA-256.

## Seguridad y privacidad

Cronio no usa servidores propios: todo pasa entre tu PC y tu consola. Solo consulta GitHub si activas las actualizaciones automáticas.
El detalle y los límites conocidos están en [SECURITY.md](SECURITY.md).

- **Puertos.** El puente escucha en `127.0.0.1:33335` (API local para los hooks y el programa) y `127.0.0.1:33340` (simulador web, solo
  si está activo). En toda la red local escucha `33334/TCP` (la consola) y, mientras el paso de la 3DS lo sirve, `33337/TCP` (descarga
  del `.cia`, solo lectura). Además emite un aviso UDP por `33333` para que la consola encuentre el PC. La regla del firewall abre
  `33334` y `33337` solo en redes privadas y solo para la subred local.
- **Emparejamiento con código.** Una consola nueva solo entra con un código de un solo uso (16 caracteres, vale 5 minutos) que el
  programa muestra en el PC. Del código sale una clave propia de cada consola, y los intentos tienen límite de ritmo.
- **Tráfico cifrado y autenticado.** La consola y el puente hablan con ChaCha20 y autenticación _encrypt-then-MAC_ con esa clave.
  Las llamadas de la API local que deciden algo llevan además un token local que se regenera en cada arranque.
- **Qué se guarda y dónde.** Todo queda en tu PC y en la SD de tu consola. En el PC, en `%APPDATA%\agent-companion\`: ajustes del
  programa, carpetas elegidas, copia del hook, y en `bridge\` las claves de las consolas emparejadas (`devices.json`), los ajustes
  del puente y un registro de eventos (sesiones, nombres de herramienta y estados; no el contenido de tus comandos). En la consola,
  `sdmc:/3ds/agent-companion/config.ini` con la última IP del puente. Puedes **olvidar una consola** en Ajustes, o con
  `npm run companion -- devices forget <id>`: se borra su clave y se corta su conexión.
- **GitHub es opcional.** Solo se consulta si eliges «GitHub» como origen de actualizaciones.
- **El firmware de sonido no se distribuye.** El audio de la consola necesita el firmware DSP, que la app extrae de **tu propia
  3DS** y deja en tu SD (`sdmc:/3ds/dspfirm.cdc`). Este repositorio no lo incluye.

### El instalador no tiene firma de código

Windows SmartScreen avisará de «editor desconocido». Descarga el instalador **solo** desde los
[Releases oficiales](https://github.com/alonnnzo/cronio/releases) y verifica su SHA-256 con el que se publica en las notas de la versión:

```powershell
Get-FileHash .\Cronio-Setup-<versión>.exe -Algorithm SHA256
```

Si no coincide, no lo ejecutes.

## Desarrollo

Requisitos: Node.js 22+ y `npm install` en la raíz (es un monorepo de npm workspaces).

| Qué | Cómo |
| --- | --- |
| **Puente** (con simulador web en `http://127.0.0.1:33340/`) | `npm run companion -- start` |
| Sesiones de ejemplo en el simulador | `node packages/bridge/scripts/demo.mjs` |
| **Programa del PC** (Electron, en desarrollo) | `npm run installer` |
| Instalador de Windows (`packages/installer/release/`) | `npm run dist:installer` |
| Igual, anotando la carpeta `release` como origen de actualizaciones local (solo para quien desarrolla) | `npm run dist:installer:local` |
| **Cliente de la 3DS** (`.3dsx`) | `make` en `client-3ds` |
| Instalable `.cia` | `make cia` en `client-3ds` |

El cliente de la consola necesita [devkitPro](https://devkitpro.org/) con devkitARM, libctru, citro2d y citro3d, y, para el `.cia`,
`makerom` y `bannertool` (no vienen con devkitPro; ver [docs/10-fase-7-instalador.md](docs/10-fase-7-instalador.md)).
El instalador de Windows empaqueta el `.3dsx` y el `.cia` que encuentre ya compilados.

Pruebas:

```bash
npm test                 # vitest: protocolo, puente, programa del PC, simulador y hooks
npm run typecheck        # tsc por paquete
make test                # en client-3ds/tests-host: núcleo del cliente en C (tarda varios minutos; se corre con el bash de devkitPro)
```

### Estructura

- `packages/protocol`: tramas, cifrado, mensajes y modelo de vista.
- `packages/bridge`: el puente (estado, cola de permisos, cara, API local para hooks, servidor para la consola, simulador, aviso UDP y emparejamiento).
- `packages/installer`: el programa de Windows (Electron): pasos de instalación, puente y `.cia` por QR.
- `packages/hooks`: hook de permisos de Claude Code y configuración de ejemplo.
- `packages/simulator`: simulador web de las dos pantallas.
- `client-3ds`: la app para la consola (C, devkitARM).
- `site`: página de presentación y descarga (estática, sin servicios externos).
- `docs`: diseño, decisiones y resultados de pruebas. `spikes` y `art`: pruebas de la Fase 0 y prototipos visuales.

## Estado del proyecto

Cronio está en **beta**: funciona, pero puede tener fallos y cambiar entre versiones. Versión 0.3.3: funciona de punta a punta con una New 3DS XL (estado de sesiones, permisos, preguntas, avisos con sonido,
lector del último mensaje e instrucciones). Es un proyecto personal en marcha: puede haber errores y cambios entre versiones.

| Agente | Estado |
| --- | --- |
| Claude Code | Soportado hoy |
| Gemini, Codex, Cursor, Hermes | Planeados: ya tienen su color en la interfaz, pero todavía no se conectan |

Más detalle en [docs/02-plan-de-trabajo.md](docs/02-plan-de-trabajo.md) y los demás documentos de [`docs/`](docs/).

## Hoja de ruta

Son planes, no promesas: sin fechas y pueden cambiar.

**Nuevas funciones**

- Más agentes: Gemini CLI, Cursor, Codex y Hermes, cada uno con su color de cara.
- Voz: hablarle a la consola para dar instrucciones.
- Asistente general: pedirle cosas rápidas desde la 3DS, como recordatorios o preguntas.
- Más personalidad para la cara: sonidos por estado y pequeños extras.
- Banner 3D en el menú de la consola.
- Versión en inglés.

**Cómo va a crecer**

- Más plataformas: el programa para macOS y Linux (hoy es Windows) y pruebas en Old 3DS y 2DS.
- Uso fuera de casa: un modo opcional, cifrado de punta a punta. El modo local sigue siendo la base.
- Instalación desde la propia consola, con las tiendas de homebrew de la comunidad.
- Instalador con firma de código, para que Windows no muestre la advertencia.
- Abierto a la comunidad: código GPL-3.0, y sugerencias y aportes bienvenidos.

## Cómo ayudar

- **Reporta problemas:** abre un [reporte](https://github.com/alonnnzo/cronio/issues) y cuenta qué pasó, tu versión y tu consola.
  Si es una vulnerabilidad, usa el canal privado de [SECURITY.md](SECURITY.md).
- **Prueba en otras consolas** (New 3DS, New 2DS XL, Old 3DS, 2DS) y cuenta cómo te fue en un reporte.
- **Sugiere ideas** en los reportes, y manda **pull requests**: las correcciones pequeñas son muy bienvenidas.

## Marcas y licencia

Nintendo 3DS es una marca de Nintendo. Claude es una marca de Anthropic. Cronio es un proyecto independiente, sin afiliación ni
respaldo de ninguna de las dos.

Cronio es software libre bajo la [GNU GPL v3 o posterior](LICENSE). Las licencias de las piezas de terceros (fuentes OFL,
dependencias MIT, libctru y citro2d/citro3d con licencia zlib) están en [THIRD-PARTY.md](THIRD-PARTY.md).
