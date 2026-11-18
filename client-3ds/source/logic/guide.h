// Guía de botones (pantalla inferior, local): qué hace cada botón y cómo se usa la app. Se abre desde el menú de
// configuración (SELECT > "Guía de botones") y se cierra con SELECT o B, que vuelven al menú. Mientras está abierta se traga todas las entradas (la lógica está en input_logic.c); aquí viven el
// estado (abierta, página), los textos como tabla de datos y las zonas táctiles de las flechas. Sin libctru.
#ifndef LOGIC_GUIDE_H
#define LOGIC_GUIDE_H

#define GUIDE_PAGES 6
#define GUIDE_MAX_LINES 9
#define GUIDE_MAX_CHARS 40       // caracteres (no bytes) por línea de texto: cabe en 304 px a la escala de la guía
#define GUIDE_MAX_TITLE_CHARS 28

// Flechas táctiles (pantalla de 320x240): abajo a los lados.
#define GUIDE_ARROW_Y 202
#define GUIDE_ARROW_W 64
#define GUIDE_ARROW_H 34
#define GUIDE_ARROW_PREV_X 6
#define GUIDE_ARROW_NEXT_X 250

typedef struct {
  const char *title;
  const char *lines[GUIDE_MAX_LINES]; // "" deja una línea en blanco; las que sobran son NULL
  int ip_action;                      // en esta página, X escribe la IP del puente a mano e Y el código de emparejamiento
} GuidePage;

typedef struct {
  int open;
  int page; // 0..GUIDE_PAGES-1
} Guide;

void guide_init(Guide *g);
// Abre en la primera página.
void guide_open(Guide *g);
void guide_close(Guide *g);
// Cambia de página sin dar la vuelta (se queda en los extremos). Devuelve 1 si cambió.
int guide_move(Guide *g, int dx);
// Página actual (siempre válida).
const GuidePage *guide_current(const Guide *g);
const GuidePage *guide_page_at(int index); // NULL fuera de rango
// 1 si en la página actual X escribe la IP y Y el código de emparejamiento.
int guide_ip_here(const Guide *g);
// Flecha bajo el punto (x, y): -1 anterior, +1 siguiente, 0 ninguna.
int guide_hit_arrow(int x, int y);
// Líneas de texto usadas por la página (hasta la última no NULL).
int guide_line_count(const GuidePage *p);

#endif
