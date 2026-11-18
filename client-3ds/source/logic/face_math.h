// Cálculo de la cara (port de packages/simulator/public/face.js): constantes de movimiento y posiciones por
// cuadro, sin dibujar. render_top.c pinta con citro2d lo que sale de aquí. El tiempo entra en milisegundos
// (double, relativo al arranque de la app para no perder precisión en seno de números enormes).
#ifndef LOGIC_FACE_MATH_H
#define LOGIC_FACE_MATH_H

#include <stdint.h>

#include "../core/view.h"

#define FACE_SCREEN_W 400
#define FACE_SCREEN_H 240

#define FACE_SHEEN_X 110
#define FACE_SHEEN_Y 50
#define FACE_SHEEN_ALPHA 0.045f
#define FACE_SHEEN_RADII_COUNT 5
extern const float FACE_SHEEN_RADII[FACE_SHEEN_RADII_COUNT];

#define FACE_EYE_X 200
#define FACE_EYE_Y 78
#define FACE_EYE_SPACING 62
#define FACE_EYE_RX 15
#define FACE_EYE_RY 22
#define FACE_EYE_ASK_SCALE 1.18f
#define FACE_EYE_GLINT_DX (-5)
#define FACE_EYE_GLINT_DY (-8)
#define FACE_EYE_GLINT_R 4.5f
#define FACE_EYE_LINE_WIDTH 9
#define FACE_MOUTH_X 200
#define FACE_MOUTH_Y 120
#define FACE_MOUTH_LINE_WIDTH 5

#define FACE_BUBBLE_CX 200
#define FACE_BUBBLE_CY 196
#define FACE_BUBBLE_W 360
#define FACE_BUBBLE_H 60
#define FACE_BUBBLE_R 14
#define FACE_BUBBLE_TAIL_W 16
#define FACE_BUBBLE_TAIL_H 15
#define FACE_BUBBLE_TEXT_W 340
#define FACE_TEXT_MAX_CHARS 46
// Globo con 3 o 4 líneas (la pregunta que espera respuesta): el pie queda fijo y crece hacia arriba, sin tapar la boca.
#define FACE_BUBBLE_TALL_BOTTOM 232
#define FACE_BUBBLE_TALL_BASE_H 35
#define FACE_BUBBLE_TALL_PITCH 15

typedef struct {
  int have_color;
  float rgb[3];        // color de fondo actual (0..255), sin brillo
  double last_ms;
  int have_last;
  char bubble_key[VIEW_TEXT_BYTES * VIEW_MAX_FACE_LINES + 8];
  double bubble_since;
} FaceLocal;

typedef struct {
  Mood mood;
  int bg_r, bg_g, bg_b; // fondo ya con el brillo del ánimo
  float ask_alpha;      // velo blanco de "pide permiso" (0 si no aplica)
  float shake;          // temblor horizontal (error)
  float bob;            // flotación
  float look;           // mirada de lado a lado
  float eye_y;          // EYE_Y + flotación + salto
  float mouth_y;        // MOUTH_Y + flotación
  int blink;
} FaceFrame;

typedef struct {
  float age;   // 0..1
  float scale; // 0.9..1
  float alpha; // = age
} BubbleAnim;

typedef struct {
  float x, y, w, h;
} FRect;

void face_local_init(FaceLocal *l);
// kind AGENT_NONE: gris neutro. Actualiza la transición del color en `local`.
void face_compute(FaceFrame *out, FaceLocal *local, AgentKind kind, Mood mood, double t_ms);
// line2 puede ser NULL (globo de una línea). Reinicia la animación de entrada cuando cambia el texto o el ánimo.
BubbleAnim face_bubble_anim(FaceLocal *local, Mood mood, const char *line1, const char *line2, double t_ms);

FRect face_mouth_box(void);
FRect face_eyes_box(void);
FRect face_bubble_box(void);
// Centro vertical y alto del cuerpo del globo según sus líneas (1 y 2: el globo de siempre).
void face_bubble_geom(int lines, float *cy, float *h);
FRect face_bubble_box_lines(int lines);
int face_boxes_overlap(FRect a, FRect b);

#endif
