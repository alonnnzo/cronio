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

1. **Portada y recorrido de producto** (`tour.js`). Una sección de unas 8 pantallas con un escenario fijo. La consola es
   HTML y CSS en 3D (dos mitades con grosor, bisagra, pantallas, cruceta, A/B/X/Y, LED) y una «cámara» (un `transform` sobre el
   contenedor) pasa por 9 planos según el scroll: cerrada con titular y botón de descarga, se abre, cara de arriba, tarjeta de
   permiso, botones A y B (A se hunde y la tarjeta se aprueba), vista lateral con la cara en capas, LED y bisagra, sesiones en
   tema oscuro y plano general con la descarga. Los fotogramas clave están en `KF` (escritorio) y `MOB` (móvil).
2. **Menú de funciones** (`home.js`). Dos pantallas apiladas: abajo, 8 canales con cursor celeste (ratón, toque, flechas, Tab,
   Enter o A); arriba, el banner de la función elegida. Es un `tablist` con `aria-selected`.
3. **Cómo funciona.** Diagrama PC ↔ puente ↔ 3DS y tres pasos. Todo local.
4. **Demo interactiva** (`app.js`). Una consola que responde a botones, teclado y toques.
5. **Descarga e instalación.** Botón a `releases/latest`, huellas SHA-256, código y SECURITY.md.
6. **Seguridad y privacidad** y **Preguntas frecuentes** (`<details>`).
7. Pie con enlaces y descargo de marcas.

## Archivos

- `pieces.js`: agentes, tarjetas de la pantalla de abajo (mismos textos que la app) y la cara en DOM por capas.
- `tour.js`, `home.js`, `app.js`: recorrido, menú y demo. Scripts clásicos que comparten `window.Cronio`.
- `og.png`: imagen para redes (1200x630). Se genera con `node_modules\electron\dist\electron.exe art\marca\og\gen-og.cjs`.
- `icon.svg`: el ícono (cuadrado naranja con los dos ojos).

## Detalles

- Sin servicios externos: fuentes (OFL) en `fonts/` y CSP estricta (`'self'`; `style-src` lleva `'unsafe-inline'` por los
  `style=""` de la demo). Scroll suave con [Lenis](https://github.com/darkroomengineering/lenis) 1.1.13 (MIT) en `vendor/`; si
  no carga, la página funciona igual. La versión (0.3.1) está fija en el HTML: no se llama a la API de GitHub.
- La cámara solo anima `transform` y `opacity`. Los textos de cada plano son HTML real; la consola va con `aria-hidden`.
- Con `prefers-reduced-motion` no hay cámara ni Lenis: cada plano es un bloque estático con su encuadre y su texto.
- En menos de 900 px los encuadres son otros (`MOB`) y el texto va en una tarjeta abajo.

## Pendiente

- Video o GIF para el README: grabar el recorrido.
- La versión del HTML (0.3.1) se actualiza a mano en cada release.
