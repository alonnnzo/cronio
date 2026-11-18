# Banner 3D de Cronio: app de prueba

El banner 3D que armaba `gen-banner3d.py` **congeló el menú HOME** de una New 3DS XL real al seleccionar el ícono (hubo que
forzar el apagado). Hoy el `.cia` real usa el banner plano. Para probar banners sin arriesgar la app real hay una **app de
prueba aparte**: cuatro `.cia` con otro `UniqueId`, otro `ProductCode` y otro nombre. La app real (`UniqueId 0xF7A3C`,
`cia/agent-companion.rsf`, `make cia`) no se toca.

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
| B | `cronio-banner-test-b.cia` | `0xF7A3E` | Banner B | Un solo plano texturizado (el logo completo, RGB8), sin animación; alineación 128 y hueso en billboard. |
| C | `cronio-banner-test-c.cia` | `0xF7A3F` | Banner C | Capas a distinta Z: fondo (z -6, RGB8), sombra, placa (z 0) y dos ojos (z +2.5), RGBA4; sin animación; alineación 128, billboard, vértices en espacio de escena. |
| D | `cronio-banner-test-d.cia` | `0xF7A40` | Banner D | Como C, con animación rígida solo de escala: la placa «respira» (+2 %, ciclo de 4 s) y los ojos parpadean (escala en Y). |

Los cuatro `.cia` llevan el mismo `.elf` y el ícono real, `Logo: Homebrew` y `-exefslogo`, y el sonido de siempre. Abrir uno
de ellos abre Cronio igual que la app real; la configuración vive en la SD (`sdmc:/3ds/agent-companion`), así que
es la misma que usa la real.

Detalles del generador (`gen-banner3d-v2.py`, que no modifica el clon de pycgfx):

- **Alineación.** Reemplaza en memoria las tablas de pycgfx (`StringTable`): la de IMAG rellena cada blob a 128 bytes y la tabla
  de cadenas rellena para que el contenido de IMAG empiece en múltiplo de 128. Al terminar **lee el `.cgfx` generado** e imprime
  `offset % 128` de IMAG y de cada textura; si alguno no es 0, el script falla.
- **Billboard y jerarquía plana.** Cada capa es un nodo hijo directo de la raíz, sin transformación, con los vértices ya en
  escena; todos los huesos (menos el raíz) con `ScreenViewpoint` + banderas 0x80 y 0x100.
- **Pivote.** Los huesos quedan en el origen y ahí pivota la escala. Para que el parpadeo (escala en Y) apenas mueva los ojos,
  la placa de C y D está unos 1,5 unidades (15 px) más abajo que en el banner viejo: los ojos quedan en y ≈ 0,5.
- **Texturas.** RGB8 para fondo y logo; RGBA4 para sombra, placa y ojos (llevan alfa; RGBA8 no se usa: pycgfx lo marca como
  roto en el menú HOME). Potencias de 2, máximo 256 por lado.
- **Tamaño.** C y D pesan unos 262 KB (máximo 512 KB). Dentro del `.bnr` el CGFX va comprimido (LZ11) por bannertool.

## Cómo generarlos

Desde `client-3ds/`, en la shell de devkitPro:

```
make cia-banner-test
```

Deja `cronio-banner-test-a.cia` … `-d.cia` junto al `Makefile` (están en `.gitignore`, como todo `.cia`). Las texturas salen de
`cia/banner3d/*.png`; para redibujarlas con Electron: `python cia/gen-banner3d-v2.py --texturas c salida.cgfx`.

Para ver qué lleva cada uno (también sobre un `.bnr` o un `.cgfx` suelto):

```
python cia/verificar-banner.py build/banner-test/a.bnr build/banner-test/b.bnr build/banner-test/c.bnr build/banner-test/d.bnr
```

Imprime tamaño, número de texturas, formato, dimensiones, offsets (y `% 128`), huesos con su modo billboard, y si hay animaciones
y de qué tipo. Sale con código 1 si alguna textura no está alineada a 128.

## Cómo instalarlas en la consola

Instálalas **de a una**, en orden, y prueba cada una antes de pasar a la siguiente.

**Por URL desde el PC (FBI → Remote Install):**

1. En el PC: `node client-3ds/cia/servir-pruebas.mjs`. Muestra la URL de cada variante con la IP del PC en la red local
   (puerto 33338). El PC y la 3DS deben estar en la misma red.
2. En la 3DS: FBI → **Remote Install** → **Enter URL**, y escribe la dirección de la variante (por ejemplo
   `http://192.168.1.20:33338/cronio-banner-test-a.cia`). Confirma la instalación.

**Por QR:** genera un QR con esa misma URL (cualquier generador) y úsalo en FBI → Remote Install → Scan QR Code.

**Por tarjeta SD:** copia el `.cia` a la SD y, en FBI → SD → el archivo → Install.

El puente del programa del PC solo sirve `agent-companion.cia`; por eso las pruebas usan `servir-pruebas.mjs`.

## Orden de prueba

A → B → C → D. Si una falla, **no sigas con las siguientes**: la anterior dice qué ya funciona.

1. **A** debe funcionar. Si falla, el problema es la app de prueba (RSF, ProductCode), no el banner.
2. **B**: un plano 3D con alineación y billboard. Si congela, la alineación o el billboard no bastan.
3. **C**: capas (varias mallas, alfa, RGBA4, profundidad).
4. **D**: animación de escala.

En cada una: instálala, vuelve al menú HOME, **sin pasar el cursor por el ícono de prueba** mira el resto, y luego selecciona
el ícono. Mira la pantalla de arriba con el regulador 3D arriba y abajo.

## Si el menú HOME se congela

1. Mantén pulsado el **botón de encendido** hasta que la consola se apague.
2. Al volver, **no pases el cursor por el ícono de prueba**: muévete por el menú sin tocarlo (con la cruceta o desde otra
   carpeta) hasta salir del menú HOME.
3. Entra a **FBI → Titles**, busca el título de prueba («Banner B», etc.) y bórralo.
4. Anota qué variante fue y vuelve a la lista de abajo.

## Qué anotar en cada prueba

- Variante (A, B, C, D) y modelo de consola (New 3DS XL, etc.), versión del sistema.
- ¿Se instaló sin errores? ¿Aparece el ícono con el nombre esperado?
- Al pasar el cursor por el ícono: ¿congela? ¿cuánto tarda en congelar (de inmediato o tras unos segundos)?
- ¿Se ve el banner? ¿Gira sobre el eje vertical, o queda quieto de frente?
- Con el regulador 3D: ¿las capas se ven a distinta profundidad (fondo atrás, ojos adelante)?
- Colores: ¿bandas en la placa naranja? ¿el fondo plateado se ve limpio? ¿los ojos calzan en los huecos?
- En D: ¿parpadean los ojos? ¿se mueven de sitio al parpadear (deberían moverse muy poco)? ¿«respira» la placa?
- ¿Abre la app al pulsar A? ¿Suena el sonido del banner?
- Cualquier otra rareza (parpadeos, texturas rotas, lentitud).

## Qué no se sabe sin la consola

- Si la causa del congelamiento era la alineación (el mantenedor de pycgfx duda) o algo del banner viejo (jerarquía, animación
  del grupo `logo`, billboard apagado).
- Si el billboard solo en los huesos hijos basta o también hay que ponerlo en la raíz (el reporte dice que en la raíz sola no
  hace efecto).
- Si 128 es el valor mínimo necesario; el reporte lo probó, pero dice que quizá uno menor también funciona.
- Si el desplazamiento de los ojos al parpadear (pivote en el origen) se nota.
