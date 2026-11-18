// Primitivas de dibujo sobre citro2d que comparten las dos pantallas: colores 0xRRGGBB con opacidad, líneas con
// extremos redondeados, arcos como segmentos, rectángulos redondeados sin solapes (para que la opacidad no se
// sume dos veces).
#ifndef UI_DRAW_H
#define UI_DRAW_H

#include <3ds.h>
#include <citro2d.h>

// 0xRRGGBB + opacidad 0..1 -> color de citro2d.
u32 ui_rgb(uint32_t rgb, float alpha);
u32 ui_rgb_i(int r, int g, int b, float alpha);

void ui_rect(float x, float y, float w, float h, u32 clr);
// Rectángulo con borde de `border` píxeles (dentro de la caja).
void ui_rect_border(float x, float y, float w, float h, float border, u32 clr);
// Línea gruesa con extremos redondos.
void ui_line_round(float x0, float y0, float x1, float y1, float width, u32 clr);
// Polilínea con extremos y uniones redondos. closed: une el último punto con el primero.
void ui_polyline(const float *xy, int n, float width, u32 clr, int closed);
// Arco de la elipse (rx, ry) desde a0 hasta a1 radianes (ángulos de canvas: crecen en sentido horario, y hacia abajo).
void ui_arc(float cx, float cy, float rx, float ry, float a0, float a1, float width, u32 clr);
// Elipse hueca.
void ui_ellipse_outline(float cx, float cy, float rx, float ry, float width, u32 clr);
// Rectángulo redondeado relleno, hecho de piezas que no se tocan.
void ui_rrect(float x, float y, float w, float h, float r, u32 clr);


// ---------- marca Cronio (pantalla inferior clara) ----------
// Fondo de la pantalla de abajo: degradado vertical blanco -> plata y rayitas diagonales (135 grados, 2 px cada 9 px).
void ui_bg_bottom(void);
// Rectángulo con degradado vertical top -> bot.
void ui_vgrad(float x, float y, float w, float h, uint32_t top, uint32_t bot);
// Rectángulo redondeado con degradado vertical top -> bot (el centro es un solo rectángulo de cuatro colores).
void ui_rrect_grad(float x, float y, float w, float h, float r, uint32_t top, uint32_t bot);
// Fila / ficha / botón: relieve (la forma `edge` 2 px más abajo, 0 = sin relieve), borde de `bw` px y relleno degradado.
// Una selección es el mismo panel con borde celeste de 3 px.
void ui_panel(float x, float y, float w, float h, float r, uint32_t top, uint32_t bot, uint32_t border, float bw, uint32_t edge);
// Cuadrado redondeado del agente con sus dos ojos (mini cara de la pantalla de arriba). x, y: esquina superior izquierda.
void ui_agent_square(float x, float y, float size, uint32_t rgb, float alpha);

typedef enum { UI_BTN_NORMAL = 0, UI_BTN_OK, UI_BTN_BAD, UI_BTN_PRIMARY } UiBtnKind;
// Botón de la marca: radio 12 (o menos si es bajo), degradado y relieve según el tipo; pressed baja 2 px y pierde el
// relieve. El texto va centrado (grafito en el normal, blanco en los de color) a `scale` y se encoge hasta S_MIN.
// border_rgb 0 = el borde del tipo. text_rgb 0 = el del tipo.
void ui_button(float x, float y, float w, float h, UiBtnKind kind, const char *label, float scale, int pressed, float alpha,
               uint32_t border_rgb, uint32_t text_rgb);

#endif
