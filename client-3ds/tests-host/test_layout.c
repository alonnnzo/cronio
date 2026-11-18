// Disposición de la pantalla inferior y zonas táctiles.
#include "test.h"

#include "../source/logic/layout.h"

static int inside_screen(const Rect *r) { return r->x >= 0 && r->y >= 0 && r->w >= 0 && r->h >= 0 && r->x + r->w <= LAYOUT_W && r->y + r->h <= LAYOUT_H; }
static int overlap(const Rect *a, const Rect *b) {
  return a->x < b->x + b->w && b->x < a->x + a->w && a->y < b->y + b->h && b->y < a->y + a->h;
}

static LayoutInput input(LayoutLevel level, int count, int cursor) {
  LayoutInput in;
  memset(&in, 0, sizeof in);
  in.level = level;
  in.item_count = count;
  in.cursor = cursor;
  return in;
}

static void check_in_screen(const BottomLayout *l) {
  CHECK(inside_screen(&l->bar));
  CHECK(inside_screen(&l->content));
  CHECK(l->content.h > 0);
  for (int i = 0; i < l->zone_count; i++) CHECK_MSG(inside_screen(&l->zones[i].r), "zona %d", i);
  if (l->has_card) {
    CHECK(inside_screen(&l->card));
    CHECK(inside_screen(&l->btn_approve));
    CHECK(inside_screen(&l->btn_deny));
    CHECK(inside_screen(&l->card_lines));
    CHECK(inside_screen(&l->card_head));
    // la tarjeta no pisa el contenido
    CHECK(!overlap(&l->card, &l->content));
    CHECK(l->content.y + l->content.h <= l->card.y);
  }
}

static void test_card_height(void) {
  CHECK_EQ_INT(layout_card_height(0, 0, 0, 0), 3 + 14 + 4 + 24 + 3);
  CHECK(layout_card_height(6, 1, 1, 0) > layout_card_height(6, 0, 0, 0));
  CHECK_EQ_INT(layout_card_height(99, 0, 0, 0), layout_card_height(6, 0, 0, 0)); // topa en 6 líneas
  CHECK_EQ_INT(layout_card_height(-3, 0, 0, 0), layout_card_height(0, 0, 0, 0));
  CHECK_EQ_INT(layout_card_height(2, 0, 0, 1), layout_card_height(2, 0, 0, 0) + LAYOUT_CARD_ALWAYS_H + LAYOUT_CARD_ALWAYS_GAP);
}

static void test_all_card_combinations(void) {
  // Toda combinación de nivel, líneas, riesgo, cola y aviso: dentro de la pantalla, contenido mínimo, botones separados.
  for (int level = 0; level < 3; level++) {
    for (int lines = 0; lines <= 6; lines++) {
      for (int flags = 0; flags < 16; flags++) {
        LayoutInput in = input((LayoutLevel)level, 12, 11);
        in.has_card = 1;
        in.card_lines = lines;
        in.card_high = flags & 1;
        in.card_many = (flags >> 1) & 1;
        in.card_can_skip = (flags >> 2) & 1;
        in.card_always = (flags >> 3) & 1;
        in.has_banner = 1; // con tarjeta no hay aviso
        BottomLayout l;
        layout_compute(&in, &l);
        check_in_screen(&l);
        CHECK(!l.has_banner);
        CHECK_MSG(l.content.h >= LAYOUT_MIN_CONTENT_H, "nivel %d líneas %d flags %d: contenido %d", level, lines, flags, l.content.h);
        CHECK(!overlap(&l.btn_approve, &l.btn_deny));
        CHECK(l.btn_approve.w >= 100 && l.btn_deny.w >= 100);
        CHECK_EQ_INT(l.has_queue, in.card_many);
        CHECK_EQ_INT(l.has_risk, in.card_high);
        CHECK_EQ_INT(l.has_skip, in.card_many && in.card_can_skip);
        CHECK_EQ_INT(l.has_always, in.card_always);
        if (l.has_always) {
          // la franja de "siempre" va entre las líneas y los botones, sin solaparlos, y es una zona táctil
          CHECK(inside_screen(&l.btn_always));
          CHECK(!overlap(&l.btn_always, &l.btn_approve) && !overlap(&l.btn_always, &l.btn_deny));
          CHECK(l.btn_always.y >= l.card_lines.y + l.card_lines.h);
          CHECK(l.btn_always.y + l.btn_always.h <= l.btn_approve.y);
          const Zone *z = layout_hit(&l, l.btn_always.x + l.btn_always.w / 2, l.btn_always.y + l.btn_always.h / 2);
          CHECK(z != NULL && z->kind == ZONE_ALWAYS);
        }
        // los botones quedan dentro de la tarjeta, debajo de las líneas
        CHECK(l.btn_approve.y >= l.card_lines.y + l.card_lines.h);
        CHECK(l.btn_approve.y + l.btn_approve.h <= l.card.y + l.card.h);
        // las filas visibles de la lista caben en el contenido
        if (level == LAYOUT_SESSIONS) {
          CHECK(l.visible_rows >= 1);
          for (int i = 0; i < l.visible_rows; i++) {
            CHECK(l.rows[i].y + l.rows[i].h <= l.content.y + l.content.h);
          }
        }
        if (level == LAYOUT_AGENTS) {
          for (int i = 0; i < AGENT_COUNT; i++) {
            CHECK(l.tiles[i].y + l.tiles[i].h <= l.content.y + l.content.h);
            CHECK(l.tiles[i].w > 0 && l.tiles[i].h > 0);
          }
        }
      }
    }
  }
}

// Con agentes ocultos solo se dibujan y se tocan las casillas visibles: item_count manda.
static void test_agents_grid_hidden(void) {
  for (int count = 0; count <= AGENT_COUNT; count++) {
    LayoutInput in = input(LAYOUT_AGENTS, count, 0);
    BottomLayout l;
    layout_compute(&in, &l);
    check_in_screen(&l);
    int items = 0;
    for (int i = 0; i < l.zone_count; i++) {
      if (l.zones[i].kind == ZONE_ITEM) {
        items++;
        CHECK(l.zones[i].index >= 0 && l.zones[i].index < count);
      }
    }
    CHECK_EQ_INT(items, count);
    for (int i = 0; i < count; i++) {
      const Zone *z = layout_hit(&l, l.tiles[i].x + l.tiles[i].w / 2, l.tiles[i].y + l.tiles[i].h / 2);
      CHECK(z != NULL && z->kind == ZONE_ITEM && z->index == i);
    }
  }
  // 3 visibles: ocupan la primera fila; el lugar de la 4.ª casilla ya no responde
  LayoutInput in = input(LAYOUT_AGENTS, 3, 0);
  BottomLayout l;
  layout_compute(&in, &l);
  CHECK_EQ_INT(l.tiles[0].y, l.tiles[2].y);
  const Zone *z = layout_hit(&l, 20, l.tiles[0].y + l.tiles[0].h + 20);
  CHECK(z == NULL);
}

static void test_agents_grid(void) {
  LayoutInput in = input(LAYOUT_AGENTS, AGENT_COUNT, 0);
  BottomLayout l;
  layout_compute(&in, &l);
  check_in_screen(&l);
  CHECK(!l.has_back);
  CHECK(!l.tile_compact);
  // 5 casillas, ninguna se solapa, 3 columnas
  for (int i = 0; i < AGENT_COUNT; i++) {
    CHECK(inside_screen(&l.tiles[i]));
    for (int j = i + 1; j < AGENT_COUNT; j++) CHECK(!overlap(&l.tiles[i], &l.tiles[j]));
  }
  CHECK_EQ_INT(l.tiles[0].y, l.tiles[2].y);
  CHECK(l.tiles[3].y > l.tiles[0].y);
  CHECK_EQ_INT(l.tiles[3].x, l.tiles[0].x);
  // un toque en el centro de cada casilla da su índice
  for (int i = 0; i < AGENT_COUNT; i++) {
    const Zone *z = layout_hit(&l, l.tiles[i].x + l.tiles[i].w / 2, l.tiles[i].y + l.tiles[i].h / 2);
    CHECK(z != NULL && z->kind == ZONE_ITEM && z->index == i);
  }
  // con una tarjeta grande la cuadrícula se vuelve compacta
  in.has_card = 1;
  in.card_lines = 6;
  in.card_high = 1;
  in.card_many = 1;
  layout_compute(&in, &l);
  CHECK(l.tile_compact);
}

static void test_sessions_list(void) {
  LayoutInput in = input(LAYOUT_SESSIONS, 12, 0);
  BottomLayout l;
  layout_compute(&in, &l);
  check_in_screen(&l);
  CHECK(l.has_back);
  CHECK(l.visible_rows >= 5);
  CHECK_EQ_INT(l.scroll, 0);
  // cursor al final: la lista se desplaza lo justo
  in.cursor = 11;
  layout_compute(&in, &l);
  CHECK_EQ_INT(l.scroll, 12 - l.visible_rows);
  const Zone *z = layout_hit(&l, 20, l.rows[l.visible_rows - 1].y + 5);
  CHECK(z != NULL && z->kind == ZONE_ITEM);
  CHECK_EQ_INT(z->index, 11);
  // primera fila visible = sesión `scroll`
  z = layout_hit(&l, 20, l.rows[0].y + 5);
  CHECK(z != NULL && z->index == l.scroll);
  // desplazamiento persistente: con el cursor visible no se mueve
  in.scroll = l.scroll;
  in.cursor = l.scroll + 1;
  layout_compute(&in, &l);
  CHECK_EQ_INT(l.scroll, in.scroll);
  // pocas sesiones: sin zonas de más
  in = input(LAYOUT_SESSIONS, 2, 0);
  layout_compute(&in, &l);
  int items = 0;
  for (int i = 0; i < l.zone_count; i++) items += l.zones[i].kind == ZONE_ITEM;
  CHECK_EQ_INT(items, 2);
  // lista vacía
  in = input(LAYOUT_SESSIONS, 0, 0);
  layout_compute(&in, &l);
  items = 0;
  for (int i = 0; i < l.zone_count; i++) items += l.zones[i].kind == ZONE_ITEM;
  CHECK_EQ_INT(items, 0);
}

static void test_scroll_function(void) {
  CHECK_EQ_INT(layout_scroll_for_cursor(0, 0, 5, 12), 0);
  CHECK_EQ_INT(layout_scroll_for_cursor(0, 5, 5, 12), 1);
  CHECK_EQ_INT(layout_scroll_for_cursor(0, 11, 5, 12), 7);
  CHECK_EQ_INT(layout_scroll_for_cursor(7, 3, 5, 12), 3);
  CHECK_EQ_INT(layout_scroll_for_cursor(50, 11, 5, 12), 7);   // desplazamiento fuera de rango
  CHECK_EQ_INT(layout_scroll_for_cursor(-4, 0, 5, 12), 0);
  CHECK_EQ_INT(layout_scroll_for_cursor(3, 2, 5, 3), 0);      // cabe todo
  CHECK_EQ_INT(layout_scroll_for_cursor(0, 99, 5, 12), 7);    // cursor fuera de rango no se sale
  CHECK_EQ_INT(layout_scroll_for_cursor(0, 0, 0, 0), 0);
}

static void test_card_zones(void) {
  LayoutInput in = input(LAYOUT_DETAIL, 0, 0);
  in.has_card = 1;
  in.card_lines = 3;
  in.card_many = 1;
  in.card_can_skip = 1;
  BottomLayout l;
  layout_compute(&in, &l);
  check_in_screen(&l);
  const Zone *z = layout_hit(&l, l.btn_approve.x + 5, l.btn_approve.y + 5);
  CHECK(z != NULL && z->kind == ZONE_APPROVE);
  z = layout_hit(&l, l.btn_deny.x + l.btn_deny.w - 1, l.btn_deny.y + l.btn_deny.h - 1);
  CHECK(z != NULL && z->kind == ZONE_DENY);
  z = layout_hit(&l, l.skip_prev.x + 2, l.skip_prev.y + 2);
  CHECK(z != NULL && z->kind == ZONE_SKIP_PREV);
  z = layout_hit(&l, l.skip_next.x + 2, l.skip_next.y + 2);
  CHECK(z != NULL && z->kind == ZONE_SKIP_NEXT);
  // los bordes exteriores no son zona
  CHECK(layout_hit(&l, l.btn_approve.x - 1, l.btn_approve.y + 5) == NULL);
  CHECK(layout_hit(&l, 319, 239) == NULL);
  CHECK(layout_hit(&l, -1, 5) == NULL);
  // sin saltar (modo manual) no hay zonas de saltar
  in.card_can_skip = 0;
  layout_compute(&in, &l);
  CHECK(layout_hit(&l, l.skip_prev.x + 2, l.skip_prev.y + 2) == NULL || layout_hit(&l, l.skip_prev.x + 2, l.skip_prev.y + 2)->kind != ZONE_SKIP_PREV);
  // sin cola no hay "N de M"
  in.card_many = 0;
  layout_compute(&in, &l);
  CHECK(!l.has_queue && !l.has_skip);
}

static void test_bar_zones(void) {
  LayoutInput in = input(LAYOUT_DETAIL, 0, 0);
  BottomLayout l;
  layout_compute(&in, &l);
  const Zone *z = layout_hit(&l, l.back_btn.x + 3, l.back_btn.y + 3);
  CHECK(z != NULL && z->kind == ZONE_BACK);
  z = layout_hit(&l, l.mode_btn.x + 3, l.mode_btn.y + 3);
  CHECK(z != NULL && z->kind == ZONE_MODE);
  CHECK(!overlap(&l.back_btn, &l.mode_btn));
  CHECK(l.sub_x_max < l.back_btn.x);
  // en agentes no hay volver
  in = input(LAYOUT_AGENTS, AGENT_COUNT, 0);
  layout_compute(&in, &l);
  CHECK(!l.has_back);
  CHECK(layout_hit(&l, 180, LAYOUT_BAR_Y + 5) == NULL);
  CHECK(l.sub_x_max < l.mode_btn.x);
}

static void test_banner(void) {
  LayoutInput in = input(LAYOUT_AGENTS, AGENT_COUNT, 0);
  in.has_banner = 1;
  BottomLayout l, base;
  layout_compute(&in, &l);
  in.has_banner = 0;
  layout_compute(&in, &base);
  CHECK(l.has_banner);
  CHECK(inside_screen(&l.banner));
  CHECK_EQ_INT(l.content.y, base.content.y + LAYOUT_BANNER_H + 2);
  CHECK(!overlap(&l.banner, &l.content));
  CHECK(!overlap(&l.banner, &l.bar));
}

int main(void) {
  TEST_BEGIN("layout: pantalla inferior y zonas táctiles");
  RUN(test_card_height);
  RUN(test_all_card_combinations);
  RUN(test_agents_grid);
  RUN(test_agents_grid_hidden);
  RUN(test_sessions_list);
  RUN(test_scroll_function);
  RUN(test_card_zones);
  RUN(test_bar_zones);
  RUN(test_banner);
  TEST_END();
}
