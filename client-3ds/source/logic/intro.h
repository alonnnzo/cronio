// Animación de entrada de la app ("intro", unos 2 s): la mascota de Cronio sale de la nada, parpadea, mira a los lados, da
// un saltito y se estira hasta ser la cara de pantalla completa; abajo sube el logo. Todo es lógica pura (sin citro2d, sin
// reloj): intro_frame(t) devuelve los valores ya calculados de un cuadro y render_intro.c solo los pinta. Se prueba en el PC.
//
// Pantalla de arriba: 400x240. Pantalla de abajo: 320x240. Tiempos en milisegundos desde que arranca la intro.
#ifndef LOGIC_INTRO_H
#define LOGIC_INTRO_H

// Hitos de la línea de tiempo (ms).
#define INTRO_DONE_MS 1880.0 // el cuadrado ya es la cara; abajo todo se fundió
#define INTRO_END_MS 2000.0  // fin del fundido del naranja al color de la cara real

// Curvas (entrada 0..1, se acota). ease_out_back usa sobrepaso `c1` (1.7 en la intro).
double intro_ease_out_back(double u, double c1);
double intro_ease_out_cubic(double u);
double intro_ease_in_out_cubic(double u);

// Cara de destino de la pantalla de arriba (la cara normal en reposo): el rectángulo es la pantalla entera.
typedef struct {
  float eye_lx, eye_rx_c, eye_cy; // centros de los ojos
  float eye_rx, eye_ry;           // semiejes
  float glint_dx, glint_dy, glint_r;
} IntroTarget;
// Los números de face_math.h en reposo (sin flotación).
IntroTarget intro_target_default(void);

typedef struct {
  float cx, cy;  // centro (ya con la mirada de lado y el salto)
  float rx, ry;  // semiejes con el cuadrado ya escalado; la altura dibujada es ry * scale_y
  float scale_y; // apertura: 0 cerrado, 1 abierto (pasa de 1 al abrirse con rebote; el parpadeo baja a 0.1)
  float dx;      // desplazamiento de mirada que ya lleva cx (informativo)
  float glint_dx, glint_dy, glint_r; // brillo, respecto al centro del ojo
} IntroEye;

typedef struct {
  // pantalla de arriba
  int square_visible;       // 0 mientras no hay nada que dibujar de la mascota (fondo negro)
  float x, y, w, h, radius; // rectángulo naranja (cuadrado -> pantalla entera) y radio de las esquinas
  float scale;              // escala uniforme del cuadrado (0..~1.05); 1 a partir del aterrizaje
  IntroEye eye[2];          // izquierdo, derecho
  int eyes_visible;
  float depth_bg, depth_eyes, depth_glint; // profundidad estéreo (px) de cada capa
  float color_mix;          // 0 naranja ... 1 color de la cara de destino (fundido de 1880 a 2000)
  // pantalla de abajo
  float bg_cover;           // opacidad del negro que tapa el fondo del tema (1 -> 0 en los primeros 300 ms)
  float logo_y;             // centro vertical del logo (centro horizontal: 160)
  float logo_alpha, text_alpha; // ya con el fundido de salida
  int done;                 // t >= INTRO_DONE_MS: el cuadrado ya es la cara normal
  int over;                 // t >= INTRO_END_MS: nada más que dibujar
} IntroFrame;

// Valores del cuadro en el instante t_ms. cara_final NULL: la de por defecto.
void intro_frame(double t_ms, const IntroTarget *cara_final, IntroFrame *out);
// Salto: el tiempo al que hay que ir si el usuario pulsa algo (INTRO_DONE_MS, o el mismo t si ya pasó).
double intro_skip(double t_ms);

#endif
