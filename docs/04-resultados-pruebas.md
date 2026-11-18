# Resultados de las pruebas de la Fase 0

Estado al 2026-11-11.

| # | Prueba | Estado |
| :-- | :--- | :--- |
| 0.1 | Repositorio y estructura | Hecho (sin commit inicial todavía) |
| 0.2 | devkitPro + "hola mundo" en la consola | **Hecho:** corre en la New 3DS XL (envío con IP manual) |
| 0.3 | Red: aviso UDP, TCP, firewall | **Hecho:** aviso UDP recibido y TCP en ambas direcciones |
| 0.4 | LED de aviso | **Hecho:** funciona por `mcu::HWC` |
| 0.5 | Reposo: cerrar y abrir la tapa | **Hecho, con conclusión:** la consola como servidor no se recupera del reposo; como cliente sí. Se usa la consola como cliente |
| 0.6 | Micrófono → whisper.cpp | Parcial: captura y envío resueltos (ganancia ≈ 110); falta transcribir |
| 0.7 | Memoria y FPS | Pendiente: requiere 0.2. Con puntos en vez de retratos el riesgo es bajo |
| 0.8 | Hooks de Claude Code | Parcial: lógica probada; falta la prueba con Claude Code real |

## 0.3 a 0.6 — Red, LED, reposo y micrófono (primera ronda, 2026-11-12)

Programa en `spikes/red-3ds/`; lado PC en `red-pc.mjs`; registro en `registro-pc-1.log`.

| Prueba | Resultado |
| :--- | :--- |
| Conexión PC → consola (TCP 33334) | **Funciona.** Conectó al instante |
| Latencia | 88 pings: mínimo 28 ms, medio 102 ms, máximo 576 ms. Alta para una red local, suficiente para aprobar con un botón |
| LED de aviso (0.4) | **Funciona**, confirmado por el usuario. El acceso es por el servicio `mcu::HWC` (`MCUHWC_SetInfoLedPattern` de libctru), no por `ptm:sysm` como decía la revisión |
| Conexión inversa consola → PC (TCP 33336) | **Funciona, aunque la consola mostró "fallo".** El PC recibió siete conexiones desde `192.168.0.30`. El error estaba en cómo el programa de la consola comprobaba la conexión (`poll` + `SO_ERROR`), no en la red ni en el firewall |
| Reposo (0.5) | **Sin resultado.** Al cerrar la tapa se cortó la conexión, como se esperaba, pero el lado PC tenía un error que le impedía reintentar. No se sabe aún si la consola vuelve a aceptar conexiones al despertar; sí se sabe que su red vuelve, porque la conexión inversa funcionó después del reposo |
| Micrófono (0.6) | **Parcial.** Llegaron 2,91 s de audio (95 198 bytes a 16 364 Hz, la tasa esperada), pero casi en silencio: pico del 1 %. Falta ajustar la ganancia |
| Avisos UDP por difusión | Sin dato: no se anotó el contador de la consola |

Correcciones hechas para la segunda ronda: reintento de conexión en el lado PC; comprobación de la conexión
inversa por envío; ganancia del micrófono ajustable con la cruceta y mostrada en pantalla; estado del puerto de
escucha visible en la consola y reutilización del puerto al reabrir.

### Segunda ronda (2026-11-12, registro en `registro-pc-2.log`)

| Prueba | Resultado |
| :--- | :--- |
| Conexión inversa consola → PC | **Funciona de punta a punta.** El PC recibió la conexión y el texto enviado por la consola |
| Latencia | 162 pings: mínimo 22 ms, medio 85 ms, máximo 191 ms |
| Micrófono, ganancia | **Resuelto.** Con la ganancia por defecto (43) el pico es del 1 %; con 53, 2 %; con 113, 44 %. Hay que subir la ganancia a un valor cercano a 110 al iniciar |
| Reposo | **Parcial.** Tras cerrar la tapa, el PC se reconectó a los 29,4 s (incluye el tiempo con la tapa cerrada). Tres segundos después la conexión quedó muda y no volvió en los 3 minutos restantes |
| Avisos UDP | **Funciona.** La consola recibió 69 avisos desde `192.168.0.10`. La búsqueda automática sí sirve cuando el PC emite desde la interfaz de la Wi-Fi; lo que fallaba con `3dslink` era que no elige interfaz |
| Escucha TCP tras el reposo | **Falla.** La consola mostró "FALLO (errno 0)": después de despertar no pudo volver a crear el socket de escucha |

Causa del corte tras el reposo, confirmada con ese dato: al despertar, la consola no logra reabrir su puerto de
escucha, así que el PC no tiene a dónde reconectarse. No se investigó por qué falla la creación del socket
(posiblemente haya que reiniciar el servicio de red de la consola al despertar).

Lo que sí está demostrado: después del reposo la consola puede abrir conexiones nuevas hacia el PC (primera
ronda), y eso no depende de reabrir ningún puerto.

Pendiente de 0.6: transcribir una grabación con whisper.cpp para medir el tiempo total. Requiere descargar
whisper.cpp y un modelo, que el usuario debe aprobar.

### Lo que esto cambia en el diseño

- **Las dos direcciones de conexión funcionan en esta red.** Recomendación tras la segunda ronda: **la consola se
  conecta al puente**, como en el plan original. Es la dirección que se recupera sola del reposo; la contraria
  obliga a la consola a reabrir un puerto de escucha, que es justo lo que falló. Costo: el puente necesita que
  el firewall de Windows permita la entrada (en este PC ya la permite para Node.js).
- **La búsqueda automática queda confirmada:** el puente emite el aviso UDP desde la interfaz de la Wi-Fi y la
  consola lo recibe. La consola toma de ahí la IP del PC y se conecta. La IP manual y la última IP guardada en
  la SD quedan como respaldo.
- Queda validado el diseño original: aviso UDP del PC + conexión TCP de la consola al puente.
- Al despertar del reposo, la consola debe descartar todos sus sockets y abrir una conexión nueva; conviene
  probar reiniciar el servicio de red (`socExit` / `socInit`) en ese momento.
- La ganancia del micrófono se fija al iniciar (alrededor de 110) y conviene dejarla ajustable.
- La latencia media de 100 ms apunta a que la consola solo atiende la red una vez por cuadro y a que el Wi-Fi
  de la 3DS ahorra energía. Para la Fase 2: hilo de red propio en la consola y desactivar el retardo de envío.

## Fase 2 — Primera ejecución del cliente en la New 3DS XL (2026-11-12)

Versión enviada: compilación intermedia de `client-3ds` (antes de terminar las correcciones de la revisión).

| Qué | Resultado |
| :--- | :--- |
| Arranque y dibujo | **Funciona.** Las dos pantallas, el texto en español con acentos y la fuente del sistema |
| Emparejamiento | **Funciona.** Código de 16 caracteres escrito con el teclado del sistema; el puente registró "dispositivo emparejado: 3ds-1a2b3c4d" |
| Saludo y conexión | **Funciona.** El puente registró "consola conectada" |
| Corte tras el teclado | **Fallo.** Justo después de emparejar, la consola mostró "No se pudo conectar (error -115)" y "Buscando el puente…" durante un rato. Luego se reconectó sola |
| Vista | **Funciona.** Cara "Todo tranquilo", cuadrícula de los cinco agentes, sesiones de la demostración |
| Aprobar | **Funciona.** Desde la consola se aprobaron los dos permisos de la demostración: uno normal y uno de riesgo alto manteniendo A. El puente recibió `allow` en ambos |

Hipótesis del corte, sin confirmar: el teclado del sistema detiene el bucle varios segundos; al volver, la
detección de reposo por salto de tiempo lo toma por un despertar y reinicia el servicio de red. Corrección en
curso: detectar el reposo con `aptHook` y, al despertar, cerrar y reabrir sockets sin reiniciar el servicio.

Sin probar todavía en la consola: rechazar con B, saltar con L/R, cambiar de modo, el táctil, el LED, cerrar y
abrir la tapa, apagar el puente, y la IP escrita a mano.

Las sesiones reales de Claude Code no aparecen porque los hooks no están instalados en la configuración del
usuario. Hay una carpeta de prueba con los hooks ya configurados: `C:\Users\tu-usuario\developer\3ds-prueba-hooks`.

## 0.8 — Hooks de Claude Code

Código en `spikes/hooks-claude-code/`.

### Formato confirmado en la documentación oficial

Fuente: referencia de hooks de Claude Code (code.claude.com/docs/en/hooks), consultada el 2026-11-11.

- El evento correcto es `PermissionRequest`: corre solo cuando Claude Code está por pedir permiso. Recibe
  `session_id`, `cwd`, `permission_mode`, `tool_name` y `tool_input`.
- Aprobar: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
- Rechazar: igual, con `"behavior":"deny"` y un `"message"`.
- El código de salida 2 no sirve para rechazar en este evento; hay que usar el objeto `decision`.
- Las reglas de denegar y preguntar del usuario se siguen evaluando aunque el hook apruebe.
- El plazo de un hook de comando va en segundos (`timeout`); por defecto son 600.
- También corre en modo no interactivo (`claude -p`): ahí, si ningún hook decide, la llamada se deniega.
- Existe el hook de tipo `http`, que evitaría el script intermedio. Un fallo de conexión no bloquea.
- El modelo activo solo llega en `SessionStart` (campo `model`, opcional). `Notification` trae `message` y
  `notification_type`; `Stop` trae `last_assistant_message`.
- `PreToolUse` corre en todas las llamadas, necesiten permiso o no: sirve para registrar actividad, no para
  permisos.

### Lo que se probó

`node spikes/hooks-claude-code/test.mjs` ejecuta el hook contra un puente simulado. Los seis casos pasan:

| Caso | Resultado | Tiempo |
| :--- | :--- | :--- |
| Aprobado en la consola | Devuelve `allow` | 339 ms |
| Rechazado en la consola | Devuelve `deny` | 327 ms |
| Sin consola conectada | Sin salida: decide el terminal | 112 ms |
| Puente apagado | Sin salida: decide el terminal | 123 ms |
| Nadie responde, vence el plazo del puente | Sin salida: decide el terminal | 425 ms |
| Nadie responde, vence el plazo del hook | Sin salida, y el puente retira la solicitud | 376 ms |

Los tiempos de los dos primeros incluyen una espera simulada de 200 ms; los plazos se acortaron a 300 ms para
la prueba.

### Lo que falta verificar

La prueba con Claude Code real no se pudo hacer desde esta sesión: `claude -p` respondió "Not logged in" en
la terminal automatizada. Quedan dos supuestos sin confirmar en la práctica:

1. Que cuando el hook no imprime nada, Claude Code muestra su diálogo normal. La documentación lo da a
   entender, pero no lo dice de forma explícita para este evento.
2. Qué pasa si se alcanza el `timeout` del hook. Por eso el script usa un plazo propio menor (50 s contra 60 s).

Prueba manual (dos terminales):

1. Terminal 1: `node spikes/hooks-claude-code/mock-bridge.mjs`
2. Terminal 2, en una carpeta de prueba:
   `claude --settings C:/Users/yo/developer/3ds-agent-companion/spikes/hooks-claude-code/settings.example.json`
3. Pedirle a Claude que cree un archivo. En la terminal 1 debe aparecer la solicitud: `a` aprueba, `b` rechaza.
4. Cerrar el puente (`q`) y repetir: el diálogo de permiso debe aparecer en la terminal 2 sin demora.

### Decisiones para la Fase 1

- El adaptador de Claude Code usa `PermissionRequest`, no `PreToolUse`.
- La regla de caída al terminal queda como está en el script: ante cualquier fallo, sin salida y código 0.
- El puente retira la solicitud cuando el hook cierra la conexión; la consola debe recibir ese retiro.
- Evaluar el hook de tipo `http` en la Fase 2: elimina el script, pero hay que confirmar que respeta el mismo
  plazo y la misma caída.

## 0.2 — devkitPro y "hola mundo"

- devkitPro quedó instalado en `C:\devkitPro` (devkitARM, libctru, citro2d, citro3d, 3dslink, tex3ds).
- `spikes/hola-3ds/` compila sin errores a `hola-3ds.3dsx` (150 KB). Dibuja los cinco puntos de los agentes
  con `citro2d` en la pantalla superior y texto en la inferior, con el uso de CPU y GPU por cuadro.
- Las variables `DEVKITPRO` y `DEVKITARM` no están definidas en la terminal normal; se compila desde el
  bash de devkitPro:

  ```bash
  /c/devkitPro/msys2/usr/bin/bash.exe -lc 'export DEVKITPRO=/opt/devkitpro DEVKITARM=/opt/devkitpro/devkitARM PATH=/opt/devkitpro/tools/bin:$PATH; cd "$(cygpath -u "C:/Users/yo/developer/3ds-agent-companion/spikes/hola-3ds")" && make'
  ```

- Envío a la consola: el primer intento con `3dslink` respondió "No response from 3DS!" porque la consola no
  estaba esperando. Hay que abrir Homebrew Launcher, pulsar Y (queda esperando por red) y entonces ejecutar
  `3dslink.exe hola-3ds.3dsx`. Si no la encuentra sola, agregar `-a <IP de la consola>`.

- Segundo intento, con el usuario indicando que la consola estaba lista: de nuevo "No response from 3DS!".
  Ninguno de los cuatro equipos vecinos de la Wi-Fi (`192.168.0.x`) tenía abierto el puerto 17491, que es donde
  escucha la consola cuando espera un envío. Falta la IP que muestra la 3DS para enviar con `-a`.

### Hallazgos de red en este PC (importan para la prueba 0.3)

- El PC tiene cuatro interfaces: Wi-Fi (`192.168.0.10/24`), WSL, VirtualBox ("Ethernet 2") y una VPN de malla. Un aviso
  por difusión puede salir por la interfaz equivocada, como se anticipó en la revisión. El puente tendrá que
  emitir por la interfaz Wi-Fi de forma explícita.
- La Wi-Fi está marcada en Windows como red **pública**, donde el firewall bloquea más conexiones entrantes.
  El puerto del puente necesitará una regla de firewall propia, o pasar la red a privada (lo decide el usuario).

- Tercer intento, con la IP de la consola (`192.168.0.30`): **envío correcto.**
  `3dslink.exe -a 192.168.0.30 hola-3ds.3dsx` transfirió los 150 520 bytes (69 345 comprimidos).
- Conclusión: la conexión TCP directa PC → 3DS funciona; lo que falla en este PC es la búsqueda automática por
  difusión. No se determinó si es por las interfaces adicionales o por el firewall en red pública. La IP
  manual y recordar la última IP pasan de ser un respaldo a ser necesarias.

- **Confirmado por el usuario (2026-11-12): el programa corre en la New 3DS XL y se ven los puntos.** La cadena
  de compilación, `citro2d` y las dos pantallas funcionan. No se anotaron los porcentajes de CPU y GPU.
