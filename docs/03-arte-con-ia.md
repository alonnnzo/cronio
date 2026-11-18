# Arte con IA — cómo hacerlo con Fable 5.2

> **Reemplazado.** La dirección visual aprobada es "agentes como puntos" (`05-marca-e-identidad.md`). Este
> documento queda como registro de las exploraciones de personaje que se descartaron.

## Qué puede y qué no puede hacer Fable

Fable no pinta imágenes como un generador de ilustraciones. Lo que hace bien es **escribir código que dibuja**:
SVG, escenas 3D, sombreadores y scripts que exportan imágenes. Para este proyecto eso es una ventaja: el
problema difícil del arte con IA es que el personaje salga igual en cada expresión, y con arte hecho por código
el personaje es el mismo por construcción.

El límite: el resultado es anime limpio de colores planos (estilo novela visual moderna o Persona), no
ilustración pintada con texturas. A 200 px de alto en una pantalla de 3DS, ese estilo es el que mejor se lee.

## Opciones

### A. Personaje por capas en SVG (recomendada)

Cada personaje es un archivo con piezas separadas: cuerpo, ropa, pelo trasero, cara, cejas, ojos, boca, pelo
delantero, accesorios. Una expresión es una combinación de piezas (ojos "sorpresa" + boca "abierta" + gota de
sudor).

- Consistencia total entre expresiones: solo cambian ojos, cejas y boca.
- Trajes y colores de pelo para la tienda salen casi gratis: se cambia una capa o una paleta.
- Parpadeo y movimiento de boca al hablar con 2 o 3 piezas extra.
- Un script convierte cada combinación a PNG al tamaño exacto y arma las hojas de sprites para la 3DS; el
  simulador web usa los mismos PNG.
- Las capas separadas sirven directo para el 3D estereoscópico (pelo trasero, cuerpo y flequillo a distinta
  profundidad).

### B. Modelo 3D estilo anime, renderizado a sprites

Fable escribe el modelo (Three.js o un script de Blender) con sombreado de dos tonos y contorno. El PC lo
renderiza a imágenes desde las poses necesarias; la 3DS solo muestra sprites.

- Bueno para poses de cuerpo entero, giros y animaciones (teclear, celebrar).
- Las caras anime en 3D son lo más difícil de lograr por código; suelen verse peor que en 2D.
- Mejor uso: los **mini-ayudantes** (orbe de Claude, cristal de Gemini, dron de Cursor, cubo de Codex), que son
  formas geométricas y pueden girar en bucle, y los muebles de la habitación.

### C. Pixel art por código

Sprites pequeños (32–64 px) definidos como matrices con paleta fija. Se ve nativo en una 3DS y pesa muy poco.
Buen candidato para el personaje sentado en el escritorio y los iconos, no para el retrato grande.

### D. Generador de imágenes como referencia

Usar un modelo de imágenes para explorar diseños (peinado, ropa, paleta) y que Fable reconstruya el elegido
como personaje por capas. La imagen generada es referencia, no el arte final, porque no mantiene al personaje
igual entre expresiones.

## Recomendación

| Elemento | Método |
| :--- | :--- |
| Retratos con expresiones | A — capas en SVG |
| Personaje en el escritorio | A a tamaño chico, o C si se quiere aire retro |
| Mini-ayudantes y muebles | B — 3D renderizado a sprites en bucle |
| Habitación | A en capas (pared, ventana, escritorio) para la profundidad 3D |
| Exploración de diseños | D, opcional |

## Flujo de trabajo

```text
art/personajes/<nombre>/personaje.svg   (capas con nombre)
art/personajes/<nombre>/expresiones.json (qué piezas forman cada expresión)
        │  script de exportación (Node)
        ▼
PNG por expresión ──► simulador web
        │  tex3ds
        ▼
hojas .t3x ──► client-3ds/gfx
```

Tamaños de partida, a confirmar con la prueba de memoria de la Fase 0: retrato 192×240, personaje en escritorio
96×128, mini-ayudante 32×32 con 8 cuadros, fondo 400×240 en tres capas.

## Reglas

- Personajes originales. El estilo de Hermes es inspiración; no se copian sus personajes.
- Paleta limitada por personaje (unos 12 colores) para que el cambio de traje sea un cambio de paleta.
- Contorno de 2 px a tamaño final; por debajo de eso se pierde en la pantalla de la 3DS.

## Animación

La 3DS no ejecuta TypeScript, así que la animación llega a la consola de dos maneras:

- **Por piezas, con datos compartidos (principal).** Cada capa se mueve, rota y escala según una tabla de
  fotogramas clave (JSON). El simulador la reproduce en TypeScript y la 3DS con un intérprete pequeño en C sobre
  `citro2d`. Sirve para respirar, parpadear, mecer el pelo, saltar y mover la boca. Casi no usa memoria.
- **Horneada a cuadros.** Lo que no se puede hacer moviendo piezas (mini-ayudantes 3D girando, efectos) se anima
  en el PC con Three.js o GSAP y se exporta a hojas de sprites. Usa memoria de texturas; solo para bucles cortos.

Live2D y Spine quedan descartados para empezar: tienen editor y licencia propios y no hay reproductor para 3DS.

## Prueba de estilo

Hecha en `art/prueba-estilo/index.html` (se abre directo en el navegador, sin instalar nada). Muestra un
personaje por capas con tres expresiones (tranquilo, alerta, contento), animación de reposo por fotogramas clave
y parpadeo, dentro de una pantalla superior de 400×240 a tamaño real.

**Resultado (2026-11-11): el estilo anime fue rechazado.** Se busca un tono más cercano a los juegos de
consola portátil clásicos.

## Segunda ronda: alternativas

En `art/alternativas-estilo/index.html`, tres direcciones con personajes originales, animadas, cada una en una
pantalla de 320×240:

| Opción | Qué es | Encaje con el proyecto |
| :--- | :--- | :--- |
| A. Criatura compañera | Pixel art; la mascota es una criatura y cada agente otra criatura | El más nativo en 3DS y el más liviano; evoluciones por nivel |
| B. Vecino acogedor | Formas redondas y colores suaves; animal con ropa | Muy expresivo; calza con la mascota sin castigo y con la tienda de ropa y casa |
| C. Aventura vista desde arriba | Pixel art; el compañero recorre una sala, las tareas son misiones | Nivel, monedas y tienda calzan con el tema; pide más escenarios |

Los personajes deben ser originales en cualquier opción: se toma el tono de esos juegos, no sus personajes ni
su arte. Las opciones se pueden combinar (por ejemplo, criatura de A en la pantalla superior y sala de C en la
inferior).

Pendiente: elegir dirección. Lo decidido antes sobre capas, paletas y animación por fotogramas clave sigue
valiendo; en pixel art la animación es por cuadros, que en sprites tan chicos casi no ocupa memoria.
