# @companion/simulator

Simulador web de la consola: pantalla superior (400x240, la cara del agente a pantalla completa) e inferior
(320x240, agentes -> sesiones -> detalle, con la tarjeta de permiso encima). Es una página estática sin
compilación ni dependencias; el puente la sirve desde `public/`.

1. Arranca el puente: `npm run companion -- start`
2. Abre http://127.0.0.1:33340/
3. Prueba: `node packages/bridge/scripts/demo.mjs` (4 sesiones y dos permisos casi a la vez) o
   `node packages/bridge/scripts/fake-agent.mjs --session id --title "..." --kind gemini --project nombre --command "..."`.

## Teclas

| Tecla | Acción |
| :--- | :--- |
| `A` | aprobar (espera 500 ms tras cambiar de solicitud; en riesgo alto, mantener 1 s) |
| `Y` | "sí, no volver a preguntar" (solo si la tarjeta lo ofrece, con la etiqueta de lo que quedaría permitido); mismas reglas que `A`, envía `allow_always` |
| `B` | rechazar si hay tarjeta; si no, volver un nivel |
| flechas | mover el cursor (cuadrícula de agentes o lista de sesiones) |
| `Enter` | entrar |
| `L` / `R` (o `Q` / `W`) | modo "en fila": saltar al siguiente permiso |
| `M` | cambiar el modo: "En fila" / "Elijo yo" |

Todo también con clic o toque (botones `B Volver`, modo, `L`/`R`, `A`/`B`). Entrar al detalle de una sesión envía
`focus` al puente; salir envía `focus` con `null`. Riesgo alto (`--command "rm -rf dist"`): hay que mantener A un segundo.

## Módulos (`public/`)

- `face.js`: dibujo puro de la cara, `drawFace(ctx, face, timeMs, localState)` + `createLocalState()`. Solo usa
  operaciones simples del contexto 2D y tiene las constantes de movimiento nombradas: es la referencia para portar
  el dibujo a C en la 3DS. `bubbleBox()`, `mouthBox()` y `eyesBox()` dan las cajas que ocupa cada parte.
- `nav.js`: navegación de la pantalla inferior, pura: `reduce(state, view, action)` devuelve `{ state, messages }`.
- `bottom.js`: pantalla inferior (solo DOM). `approve-guard.js`: bloqueo de 500 ms al aprobar. `app.js`: conexión,
  entrada y bucle.

Prueba: `npx vitest run packages/simulator`.
