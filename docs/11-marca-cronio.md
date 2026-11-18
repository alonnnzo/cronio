# Marca: Cronio

Decidido con el usuario el 2026-11-16. Manda sobre `05-marca-e-identidad.md` donde haya diferencia. Tablero de
referencia: `art/marca/index.html`.

## Decisiones

- **Nombre:** Cronio. Reemplaza a "Agent Companion" en todo lo que ve el usuario (ventana, bandeja, acceso directo,
  menú HOME, banner, web). Los nombres internos (paquetes npm, carpetas, ids) no cambian por ahora.
- **Mascota:** la cara de la pantalla principal de la app de la 3DS: **la pantalla entera** del color del agente
  (naranja `#EE7446` para Claude) con dos ojos oscuros (`#12131A`, elipses verticales con un brillo blanco arriba a
  la izquierda). **Nunca un círculo ni una bolita**: siempre un rectángulo lleno, sin margen. Nada de personajes: se
  descartaron tres rondas (anime, anime "hecho de 3DS" y cabezones).
- **Logo (elegido el 2026-11-16, opción 1 de `art/marca/logos.html`): "La palabra es la cara".**
  - *Logo completo*: «CRONIO» en mayúsculas, letra **Dela Gothic One**, color tinta `#12131A`, dentro de un
    rectángulo naranja `#EE7446` con esquinas de ~12 px (proporción del alto: radio ≈ 0,27 del cuerpo de letra). Las
    dos «O» no son letras: son los **ojos** de la mascota (elipse vertical tinta de 0,42 × 0,66 del cuerpo de letra,
    con brillo blanco al 85 % arriba a la izquierda). El nombre se lee y a la vez es la cara.
  - *Ícono*: el rectángulo naranja lleno (cuadrado, sin margen ni borde claro) con los dos ojos, sin letras. Va en el
    menú HOME, la bandeja de Windows, el acceso directo, la ventana y la pestaña del navegador.
  - Sobre fondo oscuro el logo no cambia (el naranja ya contrasta). Nunca se cambia el naranja del logo por el color
    de otro agente: el logo es Claude/Cronio; la cara de la app sí cambia de color.
- **Letras:** Dela Gothic One para el logo y los títulos grandes (en mayúsculas o normal); M PLUS Rounded 1c para
  todo lo demás.
- **Estética:** la de las consolas portátiles, sin usar nada de Nintendo (ni logos, ni letras, ni nombres, ni Mii).

## Sistema visual

| Token | Valor | Uso |
| :--- | :--- | :--- |
| Plata | `#E6E9EE` | carcasa, fondos, barras |
| Blanco | `#FFFFFF` | pantallas, tarjetas |
| Grafito | `#2F343C` | texto |
| Gris | `#6B737F` | texto secundario |
| Línea | `#C9CFD8` | bordes |
| Naranja Cronio | `#EE7446` | **solo** el logo, el ícono y la cara de Claude |
| Tinta | `#12131A` | ojos y letras del logo |
| Celeste | `#3FB0E6` (oscuro `#1F8FC8`) | botones de acción, selección, foco |
| Rojo | `#E5383B` | descargar, peligro, errores |
| Verde ok | `#3DBE6B` | comprobaciones ✓ |

- **Fondo:** degradado vertical muy suave de blanco a plata con rayitas diagonales finas (135°, blanco sobre plata),
  como el menú HOME.
- **Letra:** Dela Gothic One (Google Fonts, OFL) para logo y títulos; M PLUS Rounded 1c (OFL) 400/500/700/800 para
  el resto, en PC y web. En la 3DS, la letra del sistema para el texto y el logo como imagen.
- **Botones:** píldora o esquinas de 12 px, degradado claro arriba → un poco más oscuro abajo, sombra inferior de
  2 px del color oscuro (relieve), se hunde 2 px al pulsar. Primario celeste con texto blanco; secundario blanco con
  borde plata.
- **Tarjetas:** blanco 85 %, borde Línea, radio 18 px, brillo interior de 1 px blanco arriba. Sin sombras grises
  difusas.
- **Selección:** borde celeste de 3 px, como el cursor del menú HOME.
- **Movimiento:** solo el punto se mueve (respira, salta al avisar). Respeta `prefers-reduced-motion`.
- **Tono:** español claro, frases cortas, sin tecnicismos; cada paso dice qué hace, por qué y cómo saber que quedó.

## Dónde se aplica

1. Programa del PC (`packages/installer`): tema claro con estos tokens, nombre e ícono.
2. Página de descarga (sesión aparte).
3. App de la 3DS: primero en el simulador (`packages/simulator`), y cuando se apruebe ahí, en el cliente C.

## Cómo se ve en la 3DS (marca Cronio)

Referencia para portar al cliente C lo que ya está en el simulador (`packages/simulator/public/styles.css`). La
pantalla de arriba (la cara) **no cambia**: color del agente a pantalla completa, ojos oscuros con brillo. Solo el
globo cambia. Todo se dibuja con rectángulos, círculos, líneas y texto; los relieves son un rectángulo de 2 px.

**Pantalla de arriba (400x240)**
- Globo: relleno `#FFFFFF`, borde 2 px `#C9CFD8` (el mismo rectángulo redondeado, radio 14, 2 px más grande, debajo),
  punta igual con borde. Título grafito `#2F343C` en negrita 16-17 px; segunda línea gris `#6B737F` 13 px.

**Pantalla de abajo (320x240)**
- Fondo: degradado vertical blanco `#FFFFFF` a plata `#E6E9EE` (franjas de 10 px) y rayitas 135° blancas al 55 %,
  2 px cada 9 px. Texto base grafito `#2F343C` 12 px; secundario gris `#6B737F` 10-11 px.
- Barra superior: alto 22 px, degradado `#FFFFFF` a `#EEF1F4`, línea inferior 1 px `#C9CFD8`. Título 13 px
  negrita grafito; subtítulo 11 px gris.
- Filas, fichas de agente y filas del menú: rectángulo redondeado radio 10-12, degradado `#FFFFFF` a `#E8ECF1`,
  borde 1 px `#C9CFD8`, relieve: rectángulo `#B9C0CA` desplazado 2 px abajo.
- Selección (cursor): borde celeste `#3FB0E6` de 3 px por dentro de la fila. Fila con permiso pendiente: borde 2 px
  del color del agente.
- Punto del agente en la ficha: círculo de 32 px del color del agente con dos óvalos oscuros `#2F343C`
  (5x7 px) y una franja inferior de 3 px negra al 14 % (dos círculos, sin sombra).
- Insignia con cantidad: círculo/píldora celeste `#3FB0E6`, texto blanco 10 px negrita.
- Botón normal: radio 12, degradado `#FFFFFF` a `#E4E8EE`, borde `#B9C0CA`, relieve 2 px `#B9C0CA`; al pulsar
  baja 2 px y pierde el relieve. Aprobar (A): degradado `#6FDC95` a `#3DBE6B`, relieve `#2A9150`, texto blanco 12 px
  negrita. Rechazar (B): `#FF7B7E` a `#E5383B`, relieve `#A8191C`, texto blanco. Primario (Visto, modo "Elijo yo"):
  `#5CC4F2` a `#1F8FC8`, relieve `#176F9C`, texto blanco. "Sí, no volver a preguntar": blanco, borde 2 px `#3DBE6B`,
  texto `#2A9150`. Barra de "mantener A": rectángulo blanco al 55 % que crece de izquierda a derecha.
- Tarjeta de permiso: radio 14, fondo blanco al 92 % (usar `#FFFFFF`), borde 2 px del color del agente, relieve
  `#B9C0CA`. Riesgo alto: borde `#E5383B`, fondo `#FDEEEE`, relieve `#A8191C`, cartel rojo `#E5383B` con texto
  blanco. Comando: caja `#F1F3F6`, borde 1 px `#C9CFD8`, radio 6, texto grafito monoespaciado 11 px.
- Aviso: fondo `#EAF6FC`, borde 3 px celeste; etiqueta "AVISO" celeste oscuro `#1F8FC8` 10.5 px; título 15 px negrita
  verde `#2A9150` (terminó), celeste oscuro `#1F8FC8` (pide), rojo `#E5383B` (error), gris `#6B737F` (inactivo).
- Pregunta: tarjeta blanca con borde 3 px celeste; encabezado 11 px negrita `#1F8FC8`; opciones como botones
  normales de 18 px de alto, radio 9.
- Estados en texto: pide permiso `#1F8FC8`, error `#E5383B`, terminó `#2A9150`. Franja informativa: fondo
  `#DFF2FB`, borde 1 px celeste, texto `#1F8FC8` 11 px negrita.

**Marco (solo simulador, no se dibuja en la 3DS):** carcasa plata, bisel `#1B1E24` de 7 px, LED en celeste/verde/rojo.

**Lo que no mapea directo a citro2d**
- Degradados de botones y filas: usar C2D_DrawRectangle con dos colores arriba y abajo (los cuatro vértices admiten
  color distinto); el degradado de fondo igual, o bandas.
- Esquinas redondeadas: dos rectángulos y cuatro cuartos de círculo (como el globo); el borde 2-3 px se dibuja con
  la forma más grande debajo. La selección de 3 px puede ser un anillo con esa misma técnica.
- Las rayitas diagonales son líneas (`C2D_DrawLine`) cada 9 px; si pesan, pintarlas una vez en una textura.
- Tipografía: en la 3DS va la del sistema (`C2D_TextFont` del sistema); sus anchos difieren algo de M PLUS Rounded.
- Parpadeo del LED y del resplandor de "pide permiso": solo cambio de opacidad; sin sombra luminosa.
