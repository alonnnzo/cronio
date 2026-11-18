// Paleta de la marca Cronio (docs/11-marca-cronio.md, "Cómo se ve en la 3DS"; mismos valores que
// packages/simulator/public/styles.css) y cálculos puros del dibujo: mezcla de colores, contraste y la forma del
// cuadrado del agente. Sin citro2d: se prueba en el PC.
#ifndef LOGIC_PALETTE_H
#define LOGIC_PALETTE_H

#include <stdint.h>

// base
#define PAL_WHITE 0xFFFFFFu
#define PAL_SILVER 0xE6E9EEu   // fondo, abajo
#define PAL_LINE 0xC9CFD8u     // bordes finos
#define PAL_INK 0x2F343Cu      // texto (grafito)
#define PAL_MUTE 0x6B737Fu     // texto secundario
#define PAL_EDGE 0xB9C0CAu     // relieve de 2 px de filas y botones
#define PAL_BAR_BOT 0xEEF1F4u  // barra superior, abajo
#define PAL_ROW_BOT 0xE8ECF1u  // filas y fichas, abajo
#define PAL_BTN_BOT 0xE4E8EEu  // botón normal, abajo
#define PAL_CMD_BG 0xF1F3F6u   // caja del comando
// celeste (selección, avisos, primario)
#define PAL_SKY 0x3FB0E6u
#define PAL_SKY_DK 0x1F8FC8u   // texto celeste
#define PAL_SKY_HI 0x5CC4F2u
#define PAL_SKY_EDGE 0x176F9Cu
#define PAL_SKY_BG 0xEAF6FCu   // fondo del aviso
#define PAL_SKY_STRIP 0xDFF2FBu // franja informativa
// aprobar (verde)
#define PAL_OK 0x3DBE6Bu
#define PAL_OK_HI 0x6FDC95u
#define PAL_OK_DK 0x2A9150u    // relieve y texto verde
// rechazar / riesgo (rojo)
#define PAL_BAD 0xE5383Bu
#define PAL_BAD_HI 0xFF7B7Eu
#define PAL_BAD_DK 0xA8191Cu
#define PAL_BAD_BG 0xFDEEEEu   // tarjeta de riesgo alto
// ojos del agente
#define PAL_EYE 0x2F343Cu

// ---------- paleta elegida al ejecutar (tema claro u oscuro) ----------
// Los PAL_* de arriba son el tema claro. El dibujo lee la paleta actual con pal(): los roles que cambian entre temas
// están aquí; los colores de botones (A verde, B rojo, primario celeste), el relleno de la selección, los ojos y el
// texto blanco sobre colores siguen siendo los PAL_* de arriba, iguales en los dos temas.
typedef struct {
  uint32_t bg_top, bg_bot;        // fondo de abajo (degradado vertical)
  uint32_t stripe;                // rayitas 135 grados
  float stripe_alpha;
  uint32_t bar_top, bar_bot;      // barra superior (HOME)
  uint32_t line;                  // bordes finos y línea de la barra
  uint32_t edge;                  // relieve de 2 px de filas y botones
  uint32_t row_top, row_bot;      // filas, fichas
  uint32_t row_alt;               // segundo tono de la ficha de sesión
  uint32_t pulse;                 // ficha que pide permiso, en el destello
  uint32_t btn_top, btn_bot;      // botón normal
  uint32_t btn_border;            // borde del botón normal y de las opciones
  uint32_t card;                  // tarjetas y campos (blanco en el claro)
  uint32_t ink, mute;             // texto y texto secundario
  uint32_t cmd_bg;                // caja del comando
  uint32_t sky_text, sky_bg, sky_strip; // texto celeste, fondo del aviso, franja informativa
  uint32_t ok_text, bad_text;     // texto verde y rojo
  uint32_t bad_bg;                // tarjeta de riesgo alto
  uint32_t bubble_fill, bubble_line, bubble_title, bubble_sub; // globo de la pantalla de arriba
} Palette;

// Paleta actual (clara hasta que se llame a pal_set_dark(1)).
const Palette *pal(void);
void pal_set_dark(int dark);
int pal_is_dark(void);
// Las dos instancias, para las pruebas.
const Palette *pal_light(void);
const Palette *pal_dark(void);

// Mezcla a -> b; t256 = 0..256 (0 = a, 256 = b).
uint32_t pal_lerp(uint32_t a, uint32_t b, int t256);
// Contraste WCAG de fg sobre bg, por 10 (45 = 4.5:1).
int pal_contrast_x10(uint32_t fg, uint32_t bg);

// Cuadrado del agente: cuadrado redondeado (radio 20 % del lado) con los dos ojos de la cara de arriba (óvalos
// verticales con brillo). Coordenadas relativas a la esquina superior izquierda.
typedef struct {
  float size, radius;
  float eye_rx, eye_ry;     // semiejes de cada ojo
  float eye_lx, eye_rx_c, eye_cy; // centros: izquierdo, derecho, y de ambos
  float glint_dx, glint_dy, glint_r; // brillo, respecto al centro del ojo (glint_r 0: sin brillo, muy chico)
} AgentSquare;
void pal_agent_square(float size, AgentSquare *g);

#endif
