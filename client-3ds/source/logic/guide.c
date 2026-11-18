#include "guide.h"

#include <stddef.h>

// Textos de la guía. Cada afirmación está contrastada con el código:
//  - A entra solo si no hay tarjeta; B vuelve solo si no hay tarjeta (input_frame). En el detalle, sin tarjeta, A abre
//    el lector del mensaje completo (reader_frame): cruceta arriba/abajo una línea, izquierda/derecha y L/R una página,
//    lápiz arrastra, B vuelve al detalle. Una tarjeta de permiso cierra el lector. X (o tocar el pie) alterna el mensaje
//    completo y su resumen (paso 5).
//  - Riesgo alto: retención de 1 s (APPROVE_HOLD_MS). Rechazar se decide al soltar B.
//  - L / R saltan solo en modo "en fila" y con más de un pendiente (nav_skip_wanted).
//  - Sin plazo configurado en el puente, la solicitud no vence (expiresInS = 0).
//  - Y fuera de la guía solo abre el teclado del código sin conexión o sin emparejar (input_settings_allowed); con una
//    tarjeta que ofrece "no volver a preguntar" (request.always) Y es ese gesto, con las reglas de A (input_frame).
//    En la última página de la guía Y escribe el código y X la IP (guide_frame).
//  - Avisos (Fase 2b, paso 3): Y en el detalle sin tarjeta de permiso cambia el modo de aviso de la sesión (input_frame);
//    con una tarjeta de aviso A solo la marca "Visto" (nada se manda al agente), L/R pasan entre avisos y "Leer todo" abre el
//    lector de esa sesión; los permisos siempre van antes y tapan los avisos.
//  - Instrucciones (paso 6): en el detalle de una sesión, sin tarjeta y si el puente las ofrece, X escribe una instrucción (se entrega en el
//    próximo fin de turno de esa sesión o, si espera en una tarjeta, en el acto), izquierda/derecha alternan "Esperar mi respuesta" y
//    abajo borra la cola (input_frame). La tarjeta "Espera tu instrucción": A elige Escribir o Seguir en el PC; B nunca envía ni libera.
//    En el detalle X ya no cambia el modo de permisos.
//  - SELECT abre el menú de configuración (menu.c), no la guía: la guía es su entrada "Guía de botones" y se abre encima
//    del menú; SELECT o B la cierran y se vuelve al menú.
static const GuidePage PAGES[GUIDE_PAGES] = {
    {"Lo básico",
     {"Arriba, la cara te avisa qué pasa.",
      "Abajo eliges: agente, sesión, detalle.",
      "",
      "Muévete con la cruceta o con el lápiz.",
      "A entra a lo que elegiste.",
      "En una sesión, A lee el mensaje entero:",
      "cruceta o lápiz mueven, L/R: página.",
      "X: completo o resumen. B vuelve atrás.",
      "SELECT: configuración. B cierra la guía."},
     0},
    {"Permisos",
     {"A aprueba. En riesgo alto, mantén A",
      "durante 1 segundo.",
      "Y: sí, no volver a preguntar (si la",
      "tarjeta lo ofrece); igual que A.",
      "B rechaza.",
      "L / R pasan al siguiente permiso sin",
      "responder (en fila, con varios).",
      "También puedes tocar los botones.",
      "Los permisos no vencen: esperan aquí."},
     0},
    {"Modos",
     {"X cambia el modo de permisos (o toca",
      "el botón de arriba a la derecha):",
      "",
      "En fila: el permiso más antiguo",
      "aparece solo, sin buscarlo.",
      "",
      "Elijo yo: tú entras a la sesión",
      "que quieres responder.",
      "(En el detalle de una sesión, X escribe)"},
     0},
    {"Avisos",
     {"Cada sesión tiene su aviso: Y en el",
      "detalle (o toca la franja) lo cambia:",
      "todo, lo importante, solo al terminar,",
      "silencio.",
      "",
      "Una tarjeta azul AVISO dice qué pasó.",
      "A: Visto (no le manda nada al agente).",
      "L / R: otro aviso. Leer todo: el texto.",
      "Los permisos siempre van primero."},
     0},
    {"Instrucciones",
     {"En el detalle de una sesión:",
      "X: escribirle una instrucción.",
      "Sale cuando termine su turno.",
      "Abajo: borrar las que esperan.",
      "",
      "Izq/der: Esperar mi respuesta. Si está",
      "en sí, al terminar su turno la sesión",
      "espera aquí tu instrucción (A: Escribir,",
      "Seguir en el PC la suelta)."},
     0},
    {"Conexión y ajustes",
     {"L+R 1 segundo: abre el diagnóstico.",
      "START: salir de la app.",
      "SELECT: menú de configuración.",
      "",
      "En esta página (la guía se cierra):",
      "Y: escribir el código de emparejamiento",
      "X: escribir la IP del puente a mano"},
     1},
};

void guide_init(Guide *g) {
  g->open = 0;
  g->page = 0;
}

void guide_open(Guide *g) {
  g->open = 1;
  g->page = 0;
}

void guide_close(Guide *g) {
  g->open = 0;
  g->page = 0;
}

int guide_move(Guide *g, int dx) {
  int p = g->page + (dx > 0 ? 1 : dx < 0 ? -1 : 0);
  if (p < 0) p = 0;
  if (p > GUIDE_PAGES - 1) p = GUIDE_PAGES - 1;
  int changed = p != g->page;
  g->page = p;
  return changed;
}

const GuidePage *guide_page_at(int index) { return index >= 0 && index < GUIDE_PAGES ? &PAGES[index] : NULL; }

const GuidePage *guide_current(const Guide *g) {
  const GuidePage *p = guide_page_at(g->page);
  return p != NULL ? p : &PAGES[0];
}

int guide_ip_here(const Guide *g) { return guide_current(g)->ip_action; }

int guide_hit_arrow(int x, int y) {
  if (y < GUIDE_ARROW_Y || y >= GUIDE_ARROW_Y + GUIDE_ARROW_H) return 0;
  if (x >= GUIDE_ARROW_PREV_X && x < GUIDE_ARROW_PREV_X + GUIDE_ARROW_W) return -1;
  if (x >= GUIDE_ARROW_NEXT_X && x < GUIDE_ARROW_NEXT_X + GUIDE_ARROW_W) return 1;
  return 0;
}

int guide_line_count(const GuidePage *p) {
  int n = 0;
  while (n < GUIDE_MAX_LINES && p->lines[n] != NULL) n++;
  return n;
}
