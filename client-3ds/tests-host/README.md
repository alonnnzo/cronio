# Pruebas del núcleo portátil (`source/core`) y de la lógica pura de la app (`source/logic`)

Se compilan con el `gcc` nativo del PC (sin libctru) y corren en segundos.

## Correr

Desde el bash de devkitPro (MSYS2), donde hay `gcc` y `make`:

```sh
/c/devkitPro/msys2/usr/bin/bash.exe -lc 'cd "$(cygpath -u "C:/ruta/al/repo/client-3ds/tests-host")" && make test' </dev/null
```

`make test` compila un ejecutable por archivo `test_*.c` en `build/`, los corre todos y termina con
`TOTAL: N aserciones, M ejecutables con fallos`; sale con código distinto de cero si algo falla.
Se compila con `-std=c99 -Wall -Wextra -Werror`.

Sanitizadores: el `Makefile` prueba qué trae el `gcc`. Con AddressSanitizer + UBSan los usa; si no, usa UBSan en modo
«abortar» (`-fsanitize=undefined -fsanitize-undefined-trap-on-error`, no necesita librería de ejecución); si ni eso,
compila sin ellos. El `gcc` de devkitPro (Cygwin) no trae AddressSanitizer, así que en este entorno corre con UBSan
en modo trap y las entradas de las pruebas van pegadas a una página de guarda (`test.h`, `Guard`): leer o escribir un
byte fuera del búfer hace caer el programa.

## Qué hay

| Archivo | Prueba |
| :--- | :--- |
| `test_sha256.c` | SHA-256, HMAC y HKDF con vectores públicos (RFC 4231, RFC 5869, NIST) |
| `test_handshake.c` | código de emparejamiento, clave del dispositivo, MACs y clave de sesión de `handshake.json` |
| `test_chacha20.c` | ChaCha20 con los vectores del RFC 8439 (2.3.2 y 2.4.2) |
| `test_frame.c` | tramas, lectura en flujo, sellado cifrado y apertura (las tramas v2 de `handshake.json`, byte a byte), subclaves y contador |
| `test_json.c` | lector de JSON: escapes, `\uXXXX`, UTF-8, profundidad, tokens, prefijos, truncado de cadenas |
| `test_view.c` | `view_parse` contra todos los mensajes de `fixtures/views_fixture.h` (veredicto de zod y volcado canónico) |
| `test_msg.c` | mensajes de la consola, byte a byte como `JSON.stringify` |
| `test_approve.c` / `test_nav.c` | mismos escenarios que `approve.test.ts` y `nav.test.ts` |
| `test_session.c` | saludo completo, vistas, `rev`, errores, sellado y envíos contra un puente simulado |
| `test_config.c` | `config.ini` (lectura, escritura, valores inválidos, archivos hostiles), validación de IP y device_id, aviso UDP del puente |
| `test_layout.c` | disposición de la pantalla inferior y zonas táctiles: toda combinación de tarjeta, lista desplazable, toques |
| `test_logic.c` | UTF-8, etiquetas y dueño de la tarjeta, plazos de red, patrones del LED, azar de respaldo, cálculo de la cara |
| `test_fuzz.c` | mutaciones deterministas (semilla fija) de vistas y tramas: decenas de miles de entradas |

## Datos generados (`fixtures/`)

Los valores de `packages/protocol/fixtures/handshake.json`, los ejemplos de `fixtures/messages/` y las vistas
armadas por el puente real llegan a las pruebas en C sin copiarse a mano. Se generan con un script de Node desde la
raíz del repositorio (en la terminal normal, no en el bash de devkitPro, que no trae Node):

```sh
npx tsx packages/bridge/scripts/gen-view-fixtures.ts
```

Escribe:

- `fixtures/handshake_fixture.h`: código, id, nonces, clave, MACs y las tramas selladas del saludo.
- `fixtures/views_fixture.h`: cada mensaje del puente con el veredicto de los esquemas zod (`zod_valid`), el esperado
  para C (`c_valid`, igual salvo números como `1.0`, `1e2` o `-0` y los topes de tokens y profundidad, que C rechaza) y
  el volcado canónico de lo que debe leer `view_parse`; además los mensajes de la consola válidos del protocolo.
- `fixtures/views/*.json`: las vistas armadas por el puente real (vacía, una sesión, solicitud normal y de riesgo
  alto, modo manual con pendientes, detalle abierto, acentos, emoji y el marcador `�`, y 12 sesiones al máximo de texto).

Los archivos generados se commitean. Si cambia el protocolo o el puente, regenerar y volver a correr `make test`:
los veredictos de zod cambian solos y las pruebas de C dicen qué dejó de coincidir.
