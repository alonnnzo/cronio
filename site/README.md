# Página de Cronio: presentación y descarga

Página estática (HTML, CSS y JS, sin compilar) que presenta Cronio. Empieza con la consola cerrada; al hacer scroll la
tapa gira sobre la bisagra y las dos pantallas muestran las funciones una a una. Sigue la marca decidida el 2026-11-16
(`docs/11-marca-cronio.md`, rama `fase-7`): nombre Cronio; logo «La palabra es la cara» (CRONIO en Dela Gothic One sobre un rectángulo naranja, con las dos «O»
como ojos); la mascota es la cara rectangular, nunca una bolita; Dela Gothic One en el logo y los títulos grandes y
M PLUS Rounded 1c en el resto; fondo plata con rayitas, botones con relieve (celeste para acciones, rojo para descargar)
y tarjetas blancas con borde.

## Verla en local

```bash
npx --yes http-server@14.1.1 site -p 4321 -c-1
```

Luego abre `http://localhost:4321/`.

## Secciones

1. Portada: titular y la consola cerrada.
2. Recorrido (la consola se abre y queda fija mientras cambia el texto): estado de sesiones con la cara, tarjeta de
   permiso (aprobar, sí siempre, rechazar), «te espera» con la pregunta, lector del mensaje completo, menú SELECT,
   avisos con «Visto» y sonido, y preguntas con alternativas (llega en la próxima versión).
3. Demo interactiva: una segunda consola que responde. Cuatro botones simulan lo que pasa en el PC (permiso, fin de
   turno, pregunta con opciones, todo tranquilo) y se contesta con los botones dibujados, los de la página, el teclado
   (flechas, A, B, Y y S para SELECT, con la consola enfocada) o tocando la pantalla de abajo. El menú SELECT cambia de
   verdad los avisos, el "Visto" y el sonido de la demo.
4. Descarga, instalación en cuatro pasos y qué se necesita.

## Detalles

- `app.js` dibuja la pantalla de arriba en un canvas (la cara: la pantalla entera del color del agente con dos ojos) y
  arma la pantalla de abajo de cada paso con botones táctiles claros.
- `icon.svg` es el ícono: el cuadrado naranja lleno, de borde a borde, con los dos ojos.
- El logo está hecho en CSS (`.logo` en `styles.css`), sin imágenes. El naranja `#EE7446` es solo del logo, el ícono y
  la cara de Claude. Los demás agentes conservan su color en su carita rectangular.
- La consola está dibujada en CSS 3D: sin fotos, renders ni marcas de terceros.
- Scroll suave con [Lenis](https://github.com/darkroomengineering/lenis) 1.1.13 (MIT), copiado en `vendor/`. Si no carga, la
  página funciona igual.
- Sin servicios externos: las fuentes (OFL) están en `fonts/` y la página declara una CSP estricta (`<meta http-equiv>`: solo
  `'self'`; `style-src` lleva `'unsafe-inline'` porque la demo arma tarjetas con `style=""`). No hay CDN, Google Fonts ni analítica.
- Con `prefers-reduced-motion` la consola aparece abierta, sin Lenis ni giros, y los pasos cambian solo con fundidos.
- En móvil (menos de 900 px) la consola queda arriba y el texto de cada paso, fijo debajo.

## Pendiente

- **Enlace de Releases:** `RELEASES_URL` (primera constante de `app.js`) apunta a
  `https://github.com/alonnnzo/cronio/releases/latest`; sirve cuando exista la primera release.
- **Video o GIF para el README:** grabar el recorrido de la página.
- **Opcional, clips con IA (Higgsfield u otra):** usar capturas de esta consola (cerrada y abierta) como cuadros de inicio
  y fin, para que el clip conserve un diseño propio y no parezca una consola comercial.
