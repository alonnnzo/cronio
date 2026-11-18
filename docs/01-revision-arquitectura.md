# Revisión de arquitectura — 3DS Agent Companion

Revisión del documento generado en Antigravity (`00-plan-original-antigravity.md`), hecha el 2026-11-11.
El plan corregido está en `02-plan-de-trabajo.md`.

## Veredicto

La idea es viable y la forma general es correcta: un puente en el PC que habla con los agentes, y la 3DS como
cliente liviano por la red local. Las decisiones de base (puente en Node/TypeScript, cliente en C con
`libctru` + `citro2d`, hooks como canal principal, Whisper local, simulador web) se mantienen.

Lo que falla es que el documento describe un producto terminado, no un camino para llegar a él:

- Tiene un problema de seguridad serio que no menciona.
- Deja para la Fase 3 todo lo que nunca se ha probado (la consola real), que es donde están los riesgos.
- Afirma varias cosas del hardware y de los agentes que son incorrectas o no están verificadas.
- Intenta cubrir 5 agentes × 4 canales + voz + RPG + tienda + 3D desde el inicio.

## Decisiones que se mantienen

| Decisión | Por qué se mantiene |
| :--- | :--- |
| Puente en el PC + cliente liviano en la 3DS | La 3DS no puede hablar TLS moderno ni ver procesos del PC. |
| Node.js + TypeScript para el puente | SDK de MCP, WebSocket y simulador en un mismo lenguaje. |
| C + `libctru` + `citro2d` | Acceso a micrófono, LED y reposo; rinde en la Old 3DS. |
| Hooks como canal principal de permisos | Es el único canal que realmente detiene al agente. |
| Whisper local, pulsar para hablar, confirmar con A | Sin costo de API; la confirmación evita enviar texto mal transcrito. |
| Mascota sin castigo (no muere, no pierde nivel) | Decidido en la entrevista; no cambia. |
| Estética anime, personajes masculinos y femeninos | Decidido en la entrevista; no cambia. |

## Decisiones que se corrigen

### 1. Seguridad: el canal a la 3DS no puede ir sin autenticar (crítico)

El plan usa TCP en claro, sin autenticación, y por ese canal se aprueban permisos y se inyecta texto en la
terminal de los agentes. Cualquier equipo en la misma Wi-Fi podría aprobar un `rm -rf` o escribir comandos.
Además la 3DS solo soporta WPA2 en 2,4 GHz, así que la red donde viva será la menos protegida de la casa.

**Corrección:**
- Emparejamiento una sola vez: el puente muestra un código de 6 dígitos en el PC, se escribe en la 3DS, y de ahí
  sale una clave compartida que se guarda en la SD y en el PC.
- Cada conexión hace desafío-respuesta con HMAC-SHA256, y cada mensaje lleva contador + HMAC (evita repetir
  mensajes capturados).
- El puerto de hooks y MCP escucha solo en `127.0.0.1`. Solo el puerto de la consola escucha en la LAN.
- Riesgo aceptado para v1: el contenido viaja sin cifrar (alguien en la red podría leer los comandos, no
  aprobarlos). Cifrado con mbedTLS-PSK queda como mejora posterior.
- Los permisos de riesgo alto (borrados, `git push --force`, etc.) piden mantener A un segundo, para evitar
  aprobaciones por un botón apretado sin querer.

### 2. Los hooks deben fallar hacia el terminal, no colgar al agente

El plan dice que el hook "pausa al agente hasta que presionas A o B". Si la consola está apagada, sin batería o
fuera de la Wi-Fi, el agente queda colgado hasta el timeout del hook.

**Corrección:** si no hay consola emparejada y conectada, o pasa el plazo (configurable, 45 s por defecto), el
hook devuelve "preguntar" y el permiso aparece en el terminal como siempre. Si el usuario responde en el
terminal primero, el puente le avisa a la 3DS que retire la solicitud. Cada solicitud lleva un id; una decisión
se aplica una sola vez.

### 3. Los hooks no son iguales en todos los agentes

El plan trata `PreToolUse`, `Stop` y `Notification` como si existieran igual en Claude Code, Gemini CLI y Codex.
Son eventos de Claude Code. Además:

- En Claude Code, `PreToolUse` corre en **todas** las llamadas a herramientas, incluso las ya permitidas. El
  evento correcto para "el agente pide permiso" es `PermissionRequest`; `PreToolUse` solo sirve para registrar
  actividad.
- Gemini CLI y Cursor tienen sus propios sistemas de hooks, con otros nombres y otro formato de respuesta.
  Codex CLI es más limitado. Antigravity no es Gemini CLI. Hermes hay que revisarlo aparte.

**Corrección:** un adaptador por agente detrás de una interfaz común, y una **matriz de capacidades** (qué puede
hacer cada agente: ver estado, aprobar permisos, hacer preguntas, recibir instrucciones). La interfaz de la 3DS
muestra solo lo que cada agente soporta. Se empieza con Claude Code completo y los demás se suman uno a uno,
verificando cada uno contra su documentación vigente (los nombres exactos de eventos no están verificados en
esta revisión).

### 4. Pedir permiso por MCP no es un control real

`request_3ds_approval` como herramienta MCP depende de que el agente decida llamarla. No detiene nada. MCP se
usa para lo que sí sirve: preguntas de grill-me (`ask_user`) y reportes de estado. Los permisos van solo por
hooks. También hay que manejar el plazo máximo de las herramientas MCP: una pregunta que espera al usuario
varios minutos puede vencer del lado del agente.

### 5. Una sola fuente de verdad: el PC (se elimina el "guardado híbrido")

Guardar el progreso en la SD y en el PC y "sincronizar" crea conflictos (¿cuál gana?) sin dar nada a cambio,
porque la 3DS no hace nada útil sin el puente.

**Corrección:** el estado de la mascota (XP, monedas, desbloqueos) vive solo en el puente. La SD guarda
configuración: IP conocida, clave de emparejamiento, volumen. Toda la lógica (economía, estados de ánimo, colas)
está en el puente; la 3DS dibuja lo que le mandan y devuelve entradas.

### 6. Cliente tonto y modelo de vista compartido, para no escribir la app dos veces

Un simulador "idéntico" en Canvas más un cliente en C son dos implementaciones de la misma interfaz que se van a
separar con el tiempo.

**Corrección:** el puente envía un *modelo de vista* (qué escena, qué retrato y expresión, qué lista, qué
botones, con el texto ya cortado al ancho de pantalla). El simulador y la 3DS solo lo dibujan. El protocolo se
define una vez como esquema, con mensajes de ejemplo que se prueban tanto en TypeScript como en el parser en C.
El simulador sirve para desarrollar el puente y los flujos; no reemplaza las pruebas en consola real.

### 7. Protocolo: tramas con largo, no NDJSON + base64

Mezclar audio en base64 dentro de líneas JSON infla el audio un 33 % y obliga a la 3DS a parsear líneas enormes.

**Corrección:** tramas binarias `[tipo: 1 byte][largo: 2 bytes][contenido]`. Tipo JSON para mensajes, tipo audio
para PCM crudo. Tamaño máximo de trama fijo (por ejemplo 8 KB) para que la 3DS use búferes estáticos. Versión
del protocolo en el saludo inicial.

### 8. Afirmaciones de hardware incorrectas o sin verificar

| Lo que dice el plan | Realidad |
| :--- | :--- |
| Micrófono a 16 kHz, "el formato exacto que pide Whisper" | `mic:u` ofrece 32730, 16360, 10910 y 8180 Hz. Se captura a 16360 y el puente remuestrea a 16000. |
| LED por `news:u` / `ptm` | El LED se controla por `ptm:sysm` con una llamada IPC que `libctru` no envuelve. Requiere permisos de servicio (bien en `.3dsx` con Luma; en `.cia` hay que declararlo). `news:u` es otra cosa. |
| 3D estereoscópico en "todas" las consolas | Old 2DS y New 2DS XL no tienen 3D. Debe ser opcional y cuesta dibujar la pantalla superior dos veces. |
| "Menos de 15 MB y 60 FPS constantes" | Sin medir. El límite real es la memoria de texturas: máximo 1024×1024 por textura y pocos MB de VRAM. Varios personajes × 6 retratos grandes no caben cargados a la vez; hay que cargar por demanda. |
| El LED avisa aunque mires el monitor | Cierto solo con la tapa abierta; al cerrarla la consola entra en reposo y se corta la Wi-Fi. Decidido: la app exige tapa abierta. |

Ninguna de estas cosas se sabe hasta probarla en la consola. Por eso el plan corregido empieza con pruebas de
hardware.

### 9. Wrapper de terminal (`3ds-run`): se pospone y se acota

Es el canal más frágil: `node-pty` en Windows depende de ConPTY y de binarios nativos; inyectar texto en
interfaces de terminal modernas es poco fiable; y mostrar "las últimas líneas" exige interpretar secuencias
ANSI con un emulador de terminal sin pantalla. Aporta poco frente a los hooks.

**Corrección:** pasa a fase opcional tardía. Las "instrucciones rápidas" de las primeras fases usan lo que cada
agente ofrece de forma oficial.

### 10. Escáner de procesos: solo presencia, no fuente de datos

Leer cada 2 segundos formatos internos de sesión (`~/.claude`, base de datos de Cursor) se rompe con cada
actualización, y listar procesos en Windows a esa frecuencia es caro.

**Corrección:** el modelo activo, el proyecto y el estado llegan por los hooks (inicio de sesión, notificación,
fin de turno), que son datos oficiales. El escáner queda como detección de presencia de mejor esfuerzo ("hay un
Cursor abierto"), cada 10 s, y se marca en la interfaz como dato estimado.

### 11. Descubrimiento en la red

El aviso UDP se mantiene (la 3DS recibe difusión sin problema; `3dslink` funciona así). En Windows hay que
emitirlo por cada interfaz de red (VPN, WSL e Hyper-V desvían la difusión) y crear la regla de firewall en la
instalación. La 3DS recuerda la última IP y prueba esa primero.

### 12. Arte: es un carril propio, no un punto de la última fase

"Generar avatares anime" esconde el trabajo más largo del proyecto: mantener un mismo personaje reconocible en 6
expresiones, a tamaños de 3DS, dentro del presupuesto de texturas. Además "como Hermes" debe ser inspiración de
estilo; los personajes tienen que ser originales.

**Corrección:** marcadores de posición desde el primer día, una especificación de arte (tamaños, paleta, formato
de textura) que sale de las pruebas de memoria, y un carril de arte paralelo que entrega primero **un** personaje
completo. Tienda, trajes y habitaciones vienen después.

### 13. Orden de las fases

El plan original construye puente + simulador + todos los agentes + voz antes de tocar la consola. Si en la Fase
3 resulta que el micrófono, el LED o la memoria no dan, hay que rehacer protocolo e interfaz.

**Corrección:** primero pruebas cortas en hardware real, luego un corte vertical completo (un permiso real de
Claude Code aprobado con A en la consola), y recién después ampliar: grill-me, más agentes, voz, mascota.

## Qué queda fuera de la v1

- Cifrado del canal (solo autenticación).
- Paquete `.cia` (primero `.3dsx`).
- Wrapper de terminal, salvo que las fases anteriores muestren que hace falta.
- Tienda, trajes y habitaciones (la v1 trae XP, nivel y un personaje).

## Lo que no se verificó en esta revisión

- Nombres y formato exactos de los hooks de Gemini CLI, Codex, Cursor y Hermes: se revisan al integrar cada uno.
- Que el LED y los sockets funcionen en el emulador Azahar: se asume que no y se prueba en consola.
- Compatibilidad con Old 3DS y 2DS: la única consola de prueba es una New 3DS XL.
- devkitPro no está instalado en este PC (`C:\devkitPro` no existe); instalarlo es el primer paso del plan.
