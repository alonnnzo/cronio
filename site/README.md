# Página de Cronio: presentación y descarga

Página estática (HTML, CSS y JS, sin compilar) que presenta Cronio. Sigue la marca de `docs/11-marca-cronio.md`: logo «La
palabra es la cara», Dela Gothic One en logo y títulos, M PLUS Rounded 1c en el resto, fondo plata con rayitas, botones con
relieve y tarjetas blancas con borde. Se publica sola en https://alonnnzo.github.io/cronio/.

## Verla en local

```bash
python -m http.server 4873 --directory site
```

Luego abre `http://localhost:4873/`.

## Secciones (en orden)

1. **Portada y recorrido de producto** (`tour.js`). Una sección de 6 pantallas de alto con un escenario fijo. La consola es
   HTML y CSS en 3D y una «cámara» (un `transform` sobre el contenedor) pasa por 10 planos según el scroll: cerrada con titular
   y botón de descarga, canto y bisagra, se abre, cara de arriba, tarjeta de permiso, botones A y B (A se hunde y la tarjeta se
   aprueba), vista lateral con la cara en capas, luces y ranuras del borde, sesiones en tema oscuro y plano general con la
   descarga. Los fotogramas clave están en `KF` (escritorio) y `MOB` (móvil). Puntos laterales saltan a cada plano.
2. **Menú de funciones** (`home.js`). Dos pantallas apiladas: abajo, 8 canales con cursor celeste (ratón, toque, flechas, Tab,
   Enter o A); arriba, el banner de la función elegida. Es un `tablist` con `aria-selected`.
3. **Cómo funciona.** Diagrama PC ↔ puente ↔ 3DS y tres pasos. Todo local.
4. **Demo interactiva** (`app.js`). Una consola que responde a botones, teclado y toques.
5. **Descarga e instalación.** Botón a `releases/latest`, nota de beta, enlaces a reportes y novedades, requisitos y tabla de
   **Compatibilidad** (consolas, agentes y PC: probado, sin probar, planeado).
6. **Seguridad y privacidad.**
7. **Lo que viene** (`#futuro`): hoja de ruta en dos columnas, como planes y sin fechas.
8. **Preguntas frecuentes** (`<details>`).
9. Pie con enlaces y descargo de marcas.

La barra de arriba lleva la insignia «Beta» junto al logo y el enlace «Código» (ícono propio en SVG) al repositorio.

## Archivos

- `pieces.js`: agentes, tarjetas de la pantalla de abajo (mismos textos que la app) y la cara en DOM por capas.
- `tour.js`, `home.js`, `app.js`: recorrido, menú y demo. Scripts clásicos que comparten `window.Cronio`.
- `og.png`: imagen para redes (1200x630). Se genera con `node_modules\electron\dist\electron.exe art\marca\og\gen-og.cjs`.
- `icon.svg`: el ícono (cuadrado naranja con los dos ojos).

## Detalles

- Sin servicios externos: fuentes (OFL) en `fonts/` y CSP estricta (`'self'`; `style-src` lleva `'unsafe-inline'` por los
  `style=""` de la demo y de la consola). No se llama a la API de GitHub: la versión es un dato fijo.
- El scroll es el nativo del navegador (rueda, barra, teclado y táctil). Antes se usaba Lenis, pero su interpolación
  (`lerp`) retrasaba cada movimiento y el recorrido «se sentía trabado»; se quitó. `tour.js` solo lee `scrollY` dentro de
  `requestAnimationFrame` y aplica `transform` y `opacity`. El fondo va en una capa `position: fixed` propia (con
  `background-attachment: fixed` se repintaba en cada scroll).
- La consola es maciza: cada mitad es una pila de láminas con la misma forma redondeada separadas en Z (base 44 de grosor,
  9,6 % del ancho, 26 láminas; tapa 26, 5,7 %, 19 láminas), dos tapas con el detalle, una bisagra de 12 caras con topes,
  gatillos traseros y piezas pegadas a los cantos (luces, jack, muesca, ranura, lápiz). Unos 240 elementos en total.
- La cámara solo anima `transform` y `opacity`. Los textos de cada plano son HTML real; la consola va con `aria-hidden`.
- Con `prefers-reduced-motion` no hay cámara: cada plano es un bloque estático con su encuadre y su texto.
- En menos de 900 px los encuadres son otros (`MOB`) y el texto va en una tarjeta abajo.

## Cómo se actualiza la versión

La versión vive en un solo lugar: el atributo `data-version` de `<html>` en `index.html`. Cambia ese número en cada release.
Los sitios donde se muestra son `<span data-v>` y `app.js` los rellena al cargar. Sin JavaScript se ve igual: cada `<span data-v>`
trae también el número escrito, así que si buscas «0.3.1» en `index.html` cambia el `data-version` y esos dos textos por defecto.

## Pendiente

- Video o GIF para el README: grabar el recorrido.
