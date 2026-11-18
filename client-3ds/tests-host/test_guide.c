// Guía de botones (logic/guide.c): estado, páginas y textos. Los textos son datos: se comprueba que ninguna línea pasa
// del máximo de caracteres (con margen para 304 px a la escala de la guía; los tests no tienen la fuente del sistema,
// así que se mide en caracteres) y que no quedan restos del SELECT antiguo.
#include "test.h"

#include "../source/logic/guide.h"

// Caracteres (puntos de código) de una cadena UTF-8.
static int chars(const char *s) {
  int n = 0;
  for (; *s; s++) {
    if (((unsigned char)*s & 0xC0) != 0x80) n++;
  }
  return n;
}

static void test_open_close_move(void) {
  Guide g;
  guide_init(&g);
  CHECK(!g.open);
  guide_open(&g);
  CHECK(g.open);
  CHECK_EQ_INT(g.page, 0);
  CHECK_EQ_INT(guide_move(&g, -1), 0); // no da la vuelta
  CHECK_EQ_INT(g.page, 0);
  for (int i = 1; i < GUIDE_PAGES; i++) {
    CHECK_EQ_INT(guide_move(&g, 1), 1);
    CHECK_EQ_INT(g.page, i);
  }
  CHECK_EQ_INT(guide_move(&g, 1), 0);
  CHECK_EQ_INT(g.page, GUIDE_PAGES - 1);
  CHECK_EQ_INT(guide_move(&g, 0), 0);
  guide_close(&g);
  CHECK(!g.open);
  guide_open(&g);
  CHECK_EQ_INT(g.page, 0); // siempre abre en la primera
}

static void test_arrows(void) {
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_PREV_X, GUIDE_ARROW_Y), -1);
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_PREV_X + GUIDE_ARROW_W - 1, GUIDE_ARROW_Y + GUIDE_ARROW_H - 1), -1);
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_NEXT_X, GUIDE_ARROW_Y), 1);
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_NEXT_X + GUIDE_ARROW_W - 1, GUIDE_ARROW_Y + GUIDE_ARROW_H - 1), 1);
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_PREV_X + GUIDE_ARROW_W, GUIDE_ARROW_Y), 0);
  CHECK_EQ_INT(guide_hit_arrow(GUIDE_ARROW_PREV_X, GUIDE_ARROW_Y - 1), 0);
  CHECK_EQ_INT(guide_hit_arrow(160, 100), 0);
  CHECK(GUIDE_ARROW_NEXT_X + GUIDE_ARROW_W <= 320); // dentro de 320x240
  CHECK(GUIDE_ARROW_Y + GUIDE_ARROW_H <= 240);
}

static void test_pages_are_data(void) {
  CHECK_EQ_INT(GUIDE_PAGES, 6);
  int ip_pages = 0;
  for (int i = 0; i < GUIDE_PAGES; i++) {
    const GuidePage *p = guide_page_at(i);
    CHECK(p != NULL);
    if (p == NULL) continue;
    CHECK(p->title != NULL && p->title[0] != '\0');
    CHECK_MSG(chars(p->title) <= GUIDE_MAX_TITLE_CHARS, "título de la página %d", i);
    int n = guide_line_count(p);
    CHECK_MSG(n >= 1 && n <= GUIDE_MAX_LINES, "página %d con %d líneas", i, n);
    for (int k = 0; k < n; k++) {
      const char *l = p->lines[k];
      CHECK_MSG(chars(l) <= GUIDE_MAX_CHARS, "página %d línea %d: %d caracteres: %s", i, k, chars(l), l);
      if (l[0] != '\0') CHECK_MSG(l[0] != ' ' && l[strlen(l) - 1] != ' ', "espacios sobrantes en página %d línea %d", i, k);
      CHECK_MSG(strchr(l, '\n') == NULL, "salto de línea en página %d", i);
      CHECK_MSG(strstr(l, "SELECT: escribir") == NULL, "texto antiguo de SELECT en página %d", i);
    }
    for (int k = n; k < GUIDE_MAX_LINES; k++) CHECK(p->lines[k] == NULL); // sin huecos
    ip_pages += p->ip_action;
  }
  CHECK(guide_page_at(-1) == NULL);
  CHECK(guide_page_at(GUIDE_PAGES) == NULL);
  CHECK_EQ_INT(ip_pages, 1);
  CHECK(guide_page_at(GUIDE_PAGES - 1)->ip_action); // la IP a mano está en la última página y solo ahí
}

static void test_ip_here(void) {
  Guide g;
  guide_init(&g);
  guide_open(&g);
  for (int i = 0; i < GUIDE_PAGES; i++) {
    CHECK_EQ_INT(guide_ip_here(&g), i == GUIDE_PAGES - 1);
    guide_move(&g, 1);
  }
}

static void test_text_is_simple_utf8(void) {
  for (int i = 0; i < GUIDE_PAGES; i++) {
    const GuidePage *p = guide_page_at(i);
    for (int k = 0; p != NULL && k < guide_line_count(p); k++) {
      const unsigned char *s = (const unsigned char *)p->lines[k];
      for (; *s; s++) {
        if (*s >= 0x80) { // solo latín de 2 bytes (acentos, ñ): sin emoji ni símbolos que la fuente pueda no tener
          CHECK_MSG(*s == 0xC3 && s[1] >= 0x80 && s[1] < 0xC0, "byte inesperado en página %d línea %d", i, k);
          s++;
        }
      }
    }
  }
}

int main(void) {
  TEST_BEGIN("guide: estado, páginas y textos de la guía de botones");
  RUN(test_open_close_move);
  RUN(test_arrows);
  RUN(test_pages_are_data);
  RUN(test_ip_here);
  RUN(test_text_is_simple_utf8);
  TEST_END();
}
