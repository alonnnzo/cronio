// Texto con la fuente del sistema (C2D_Text). Un búfer de glifos que se limpia cada cuadro y otro de medida.
// Los textos llegan en UTF-8 (acentos, "…", "·", "¡", "¿", "�", emoji); un glifo que la fuente no tiene se dibuja
// como el glifo alterno de la fuente: no rompe nada.
#ifndef UI_TEXT_H
#define UI_TEXT_H

#include <3ds.h>

#define UI_TEXT_CELL_H 30.0f // alto de la celda de la fuente a escala 1

typedef enum { UI_ALIGN_LEFT = 0, UI_ALIGN_CENTER = 1, UI_ALIGN_RIGHT = 2 } UiAlign;

// 0 si falla (sin memoria).
int ui_text_init(void);
void ui_text_exit(void);
// Una vez por cuadro, antes de dibujar texto.
void ui_text_begin_frame(void);

// Ancho en píxeles del texto a esa escala.
float ui_text_width(const char *s, float scale);

// Dibuja s con la esquina superior izquierda (o el centro / borde derecho, según align) en x, y. Si max_w > 0 y el
// texto no cabe, baja la escala hasta min_scale y, si aun así no cabe, lo recorta con "…". Devuelve el ancho dibujado.
float ui_text_draw(const char *s, float x, float y, float scale, float min_scale, float max_w, u32 color, UiAlign align);

// Igual pero y es la línea base de la primera línea (para centrar a mano).
float ui_text_draw_baseline(const char *s, float x, float baseline, float scale, float min_scale, float max_w, u32 color,
                            UiAlign align);

#endif
