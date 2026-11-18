# Identidad visual — agentes como puntos

Decisión del 2026-11-11: **ir a lo simple.** Se descartan todas las exploraciones de personaje (anime, criaturas,
cursor, animales, personas, caricatura por capas). Las muestras quedan en `art/` solo como registro.

> **Actualización del 2026-11-12:** la pantalla superior ya no muestra una fila de puntos. Es **una sola cara a
> pantalla completa** que toma el color del agente del que habla y avisa con globos de texto; los agentes como
> puntos pasan a la pantalla inferior, donde se eligen y se ven sus sesiones. Prototipo aprobado en
> `art/cara/index.html`; detalle en `07-fase-1b-cara-y-sesiones.md`. Los colores y la idea de "identidad por
> color y movimiento" siguen vigentes; las firmas de movimiento por agente de la tabla de abajo ya no se usan.

## Dirección vigente (aprobada el 2026-11-11)

Cada agente es **un punto con ojos**. No hay personaje ni mascota que dibujar: la identidad está en el color y
en cómo se mueve cada punto. Prototipo interactivo en `art/dots/index.html`.

### Qué distingue a cada agente

| Agente | Color | Firma de movimiento |
| :--- | :--- | :--- |
| Claude | Naranja | Chispas que respiran a su alrededor |
| Gemini | Azul y violeta | Son dos: un gemelo gira alrededor del otro |
| Codex | Verde | Tres puntitos al lado, como si escribiera |
| Cursor | Gris claro | Cuadrado; se mueve a saltos y parpadea como un cursor |
| Hermes | Dorado | Dos alitas; flota más alto y más rápido |

### Qué comunica cada estado

| Estado | Comportamiento | Ojos |
| :--- | :--- | :--- |
| Inactivo | Chico, apagado, flota lento | Cerrados |
| Trabajando | Tres puntos blancos en órbita | Abiertos |
| Pide permiso | Crece, salta, emite ondas y muestra un signo de pregunta; los demás lo miran | Grandes |
| Terminó | Estallido de puntos | Sonrientes |
| Error | Se pone rojo, tiembla, caen puntos | En cruz |

### Por qué encaja con el proyecto

- En la 3DS son círculos y rectángulos: casi no usa memoria ni texturas y corre igual en cualquier modelo.
- No depende de ilustración, que fue lo que no convenció en cinco rondas.
- Cada punto puede ir a distinta profundidad con el efecto 3D de la pantalla superior.
- El simulador web y la consola dibujan lo mismo con el mismo código de movimiento.

## Pendiente

| Tema | Estado |
| :--- | :--- |
| Referencias | El usuario mencionó "grokbot" y "los de Codex" como ejemplos de algo diferenciador; no se revisaron esas referencias. Si el prototipo no va por ahí, pedir captura o enlace |
| Mascota, XP, tienda | Sin definir en esta dirección: decidir si se mantienen (por ejemplo, accesorios para los puntos) o se eliminan |
| Nombre del producto | Sin definir |
| Tipografía, sonido, icono | Sin definir |

## Skills disponibles para esta etapa

La búsqueda de skills nuevas no devolvió resultados. Las ya instaladas que sirven:

| Skill | Para qué |
| :--- | :--- |
| `design:design-system` / `design-skills:design-systems` | Documentar colores, tipografía y componentes de la aplicación |
| `design:ux-copy` / `design-skills:ux-writing` | Textos de la interfaz |
| `marketing:brand-review` | Revisar piezas contra la guía de marca una vez escrita |
| `frontend-design:frontend-design` | Diseño del simulador web |
| `logo-maker` (plugin) | Logos en imagen; consume créditos de una cuenta externa y no entrega vectores |
| Adobe, Canva, Figma | Requieren autorizar la conexión antes de usarse |
