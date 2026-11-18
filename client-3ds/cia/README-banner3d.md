# Banner 3D de Cronio: app de prueba

El banner 3D que armaba `gen-banner3d.py` **congeló el menú HOME** de una New 3DS XL real al seleccionar el ícono (hubo que
forzar el apagado). Hoy el `.cia` real usa el banner plano. Para probar banners sin arriesgar la app real hay una **app de
prueba aparte**: cinco `.cia` con otro `UniqueId`, otro `ProductCode` y otro nombre. La app real (`UniqueId 0xF7A3C`,
`cia/agent-companion.rsf`, `make cia`) no se toca.

## Qué se quiere ver

**Solo el rectángulo de Cronio** (la placa naranja redondeada con «CR NI» y las dos O como ojos), con sus animaciones y nada
más: sin fondo plateado ni otros elementos. Lo que no es logo no se dibuja, así que se ve el fondo propio del menú HOME.

## Qué causó el congelamiento (hipótesis)

El issue [skyfloogle/pycgfx#2](https://github.com/skyfloogle/pycgfx/issues/2), de alguien que lo probó en una New 3DS real:

1. **Alineación a 128 bytes.** pycgfx alinea el bloque de imágenes (IMAG) a 16 bytes. Con texturas en offsets múltiplos de 128
   el menú funcionaba; con 48 o 112 mod 128 se congelaba. El mantenedor no está convencido de que sea la causa.
2. **Giro.** El menú HOME hace girar todo banner 3D sobre el eje vertical. Arreglo reportado: cada hueso con billboard
   `ScreenViewpoint` (4) y las banderas `IsLocalMatrixCalculate` (0x80) e `IsWorldMatrixCalculate` (0x100), cada malla hija
   directa de la raíz sin transformación y los vértices ya en espacio de escena. Con eso solo la escala se anima con seguridad.
3. **Texturas.** RGBA4 sale con bandas; RGB8 se ve mejor (donde no hace falta alfa).
4. **Animación.** La esquelética con piel congeló otra consola; la rígida de nodos funciona.

El banner 3D viejo (`cia/banner3d/banner.cgfx`) tiene las **cuatro texturas en 48 mod 128**: justo el patrón del reporte. En
cambio el banner plano de bannertool, que sí funciona, las trae en 0 mod 128 (lo muestra `verificar-banner.py`). Es un indicio,
no una prueba.

## Variantes (de menor a mayor riesgo)

| Variante | Archivo | UniqueId | Nombre en HOME | Qué lleva |
|---|---|---|---|---|
| A | `cronio-banner-test-a.cia` | `0xF7A3D` | Banner A | **Control**: el banner plano actual (`cia/banner.png`). Valida la app de prueba. |
| B | `cronio-banner-test-b.cia` | `0xF7A3E` | Banner B | Solo la placa del logo completo (placa, letras y ojos en **una** textura RGB8), estática, centrada, 77,5 % del ancho visible. |
| C | `cronio-banner-test-c.cia` | `0xF7A3F` | Banner C | El logo en capas, estático: sombra (z -0,8), placa con las letras (z 0) y dos ojos con brillo (z +2,5, sobresalen con el 3D). Huesos en el origen, sin transformación, vértices en espacio de escena (la regla del reporte). |
| D | `cronio-banner-test-d.cia` | `0xF7A40` | Banner D | C con animación rígida **solo de escala**: los ojos parpadean (escala Y, cada 4 s) y la placa «respira» (1 → 1,03 → 1). Versión estricta del reporte. |
| E | `cronio-banner-test-e.cia` | `0xF7A41` | Banner E | D más lo que el reporte marca como riesgoso: cada pieza con su **hueso trasladado a su centro** (pivote propio), un **saltito** de la placa entera (traslación Y de 5 px, cada 6 s) y los ojos **mirando a un lado y al otro** (traslación X de 4 px). Ciclo de 12 s. Si gira o se deforma, hay que quedarse con D. |

Los cinco `.cia` llevan el mismo `.elf` y el ícono real, `Logo: Homebrew` y `-exefslogo`, y el sonido de siempre. Abrir uno
abre Cronio igual que la app real; la configuración vive en la SD (`sdmc:/3ds/agent-companion`), la misma que usa la real.

### Vistas previas

`make cia-banner-test` deja en `client-3ds/build/banner-test/` un `<variante>.png` por variante (A es el `banner.png`): cómo
debería verse de frente, dibujado con un proyector en Python (la cámara del banner, perspectiva y z-buffer) a partir de los
vértices e índices que **quedaron en el CGFX**, no del glTF de entrada. El damero marca lo transparente. Sirve para ver encuadre
y capas, no el efecto estereoscópico ni el resultado real en la consola.

### Detalles del generador (`gen-banner3d-v2.py`; no modifica el clon de pycgfx)

- **Alineación.** Reemplaza en memoria las tablas de pycgfx (`StringTable`): la de IMAG rellena cada blob a 128 bytes y la tabla
  de cadenas rellena para que el contenido de IMAG empiece en múltiplo de 128. Al terminar **lee el `.cgfx` generado** e imprime
  `offset % 128` de IMAG y de cada textura; si alguno no es 0, el script falla.
- **Billboard y jerarquía plana.** Cada pieza es un nodo hijo directo de la raíz; todos los huesos (menos el raíz) con
  `ScreenViewpoint` + banderas 0x80 y 0x100. En B, C y D sin transformación y con los vértices en espacio de escena; solo en E
  cada hueso lleva traslación propia y la malla queda alrededor de su centro.
- **Sin alfa: la forma redonda va en la geometría.** Ninguna textura lleva alfa (RGBA4 sale con bandas, RGBA8 está roto en el
  menú HOME según pycgfx). La placa es un abanico de triángulos con esquinas redondeadas de 8 segmentos (37 vértices) y los ojos
  son óvalos de 24 lados (25 vértices), todos con textura **RGB8 opaca**: bordes nítidos y naranja limpio. El brillo del ojo va en
  su textura. Texturas: `placa` 256×128, `ojo` 64×128, `sombra` 8×8 (color liso) y, en B, `logo` 256×128; potencias de 2, máximo 256.
- **Pivote (D).** Los huesos de D están en el origen y ahí pivota la escala. Para que escalar los ojos en Y no los mueva, el logo
  de C y D se coloca con los ojos exactamente en y = 0 (la placa queda unos 12 px más abajo del centro visible). B y E están
  centrados en el centro visible.
- **Encuadre.** Cámara del banner (en (0, 1, 44,786), fov vertical 30°): en z = 0 se ven 40 × 24 unidades; la placa mide 31 (77,5 %
  del ancho). Los ojos, más cerca de la cámara, se achican y se acercan al eje para calzar con sus huecos; el logo no se corta.
- **Tamaño.** Entre 105 y 147 KB (máximo 512 KB). Dentro del `.bnr` el CGFX va comprimido (LZ11) por bannertool.

## Cómo generarlos

Desde `client-3ds/`, en la shell de devkitPro:

```
make cia-banner-test
```

Deja `cronio-banner-test-a.cia` … `-e.cia` junto al `Makefile` (están en `.gitignore`, como todo `.cia`) y las vistas previas en
`build/banner-test/`. Las texturas salen de `cia/banner3d/*.png`; para redibujarlas con Electron:
`python cia/gen-banner3d-v2.py --texturas c salida.cgfx`. Requiere Python con `gltflib`, `pillow` y `numpy`.

Para ver qué lleva cada uno (también sobre un `.bnr` o un `.cgfx` suelto):

```
python cia/verificar-banner.py build/banner-test/a.bnr build/banner-test/b.bnr build/banner-test/c.bnr build/banner-test/d.bnr build/banner-test/e.bnr
```

Imprime tamaño, número de texturas, formato, dimensiones, offsets (y `% 128`), huesos con su modo billboard y banderas, y si hay
animaciones y de qué tipo. Sale con código 1 si alguna textura no está alineada a 128.

## Cómo instalarlas en la consola

Instálalas **de a una**, en orden, y prueba cada una antes de pasar a la siguiente.

**Por URL desde el PC (FBI → Remote Install):**

1. En el PC: `node client-3ds/cia/servir-pruebas.mjs`. Muestra la URL de cada variante con la IP del PC en la red local
   (puerto 33338). El PC y la 3DS deben estar en la misma red. Si ya estaba corriendo de antes, reinícialo (la E es nueva).
2. En la 3DS: FBI → **Remote Install** → **Enter URL**, y escribe la dirección de la variante (por ejemplo
   `http://192.168.1.20:33338/cronio-banner-test-a.cia`). Confirma la instalación.

**Por QR:** genera un QR con esa misma URL (cualquier generador) y úsalo en FBI → Remote Install → Scan QR Code.

**Por tarjeta SD:** copia el `.cia` a la SD y, en FBI → SD → el archivo → Install.

El puente del programa del PC solo sirve `agent-companion.cia`; por eso las pruebas usan `servir-pruebas.mjs`.

## Orden de prueba

A → B → C → D → E. Si una falla, **no sigas con las siguientes**: la anterior dice qué ya funciona.

1. **A** debe funcionar. Si falla, el problema es la app de prueba (RSF, ProductCode), no el banner.
2. **B**: una malla texturizada con alineación y billboard.
3. **C**: varias mallas a distinta profundidad.
4. **D**: animación de escala con huesos en el origen.
5. **E**: huesos con traslación propia y animación de posición. Si en E gira o se deforma, la respuesta es quedarse con D.

En cada una: instálala, vuelve al menú HOME, **sin pasar el cursor por el ícono de prueba** mira el resto, y luego selecciona
el ícono. Mira la pantalla de arriba con el regulador 3D arriba y abajo.

## Si el menú HOME se congela

1. Mantén pulsado el **botón de encendido** hasta que la consola se apague.
2. Al volver, **no pases el cursor por el ícono de prueba**: muévete por el menú sin tocarlo (con la cruceta o desde otra
   carpeta) hasta salir del menú HOME.
3. Entra a **FBI → Titles**, busca el título de prueba («Banner B», etc.) y bórralo.
4. Anota qué variante fue y vuelve a la lista de abajo.

## Qué anotar en cada prueba

- Variante (A–E), modelo de consola (New 3DS XL, etc.) y versión del sistema.
- ¿Se instaló sin errores? ¿Aparece el ícono con el nombre esperado?
- Al pasar el cursor por el ícono: ¿congela? ¿cuánto tarda (de inmediato o tras unos segundos)?
- ¿Se ve el logo? ¿Se ve el fondo del menú HOME alrededor (sin recuadro ni fondo propio)? ¿Gira sobre el eje vertical o queda de frente?
- Con el regulador 3D: ¿las capas se ven a distinta profundidad (sombra atrás, ojos adelante)?
- Colores y bordes: ¿bandas en el naranja? ¿esquinas redondeadas limpias? ¿los ojos calzan en sus huecos?
- En D: ¿parpadean los ojos? ¿se mueven de sitio al parpadear (no deberían)? ¿«respira» la placa?
- En E: ¿hace el saltito? ¿miran a los lados? ¿alguna pieza se separa, gira o se deforma?
- ¿Abre la app al pulsar A? ¿Suena el sonido del banner?
- Cualquier otra rareza (parpadeos, texturas rotas, lentitud).

## Qué no se sabe sin la consola

- Si la causa del congelamiento era la alineación (el mantenedor de pycgfx duda) o algo del banner viejo (jerarquía, animación
  del grupo `logo`, billboard apagado, texturas con alfa).
- Si el billboard solo en los huesos hijos basta o también hay que ponerlo en la raíz (el reporte dice que en la raíz sola no
  hace efecto).
- Si 128 es el valor mínimo necesario; el reporte lo probó, pero dice que quizá uno menor también funciona.
- Si el menú HOME dibuja el banner sin fondo propio (que lo transparente deje ver el fondo del menú).
- Si los óvalos y las esquinas de la geometría se ven bien con el 3D, y si E gira o se deforma con las traslaciones.
