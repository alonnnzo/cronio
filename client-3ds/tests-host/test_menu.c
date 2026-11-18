// Menú de configuración (logic/menu.c): cursor, valores que cambia cada entrada, entradas sin conexión y geometría.
// El comportamiento con teclas y tarjetas de permiso (input_logic.c) está en test_input.c.
#include "test.h"

#include "../source/logic/menu.h"
#include "../source/logic/palette.h"

static void v_reset(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
}

static void v_settings(View *v, NotifyMode nd, int ack, unsigned hidden_mask) {
  v->has_settings = 1;
  v->settings.notify_default = nd;
  v->settings.notify_ack = ack;
  v->settings.hidden_count = 0;
  for (int i = 0; i < AGENT_COUNT; i++) {
    if (hidden_mask & (1u << i)) v->settings.hidden[v->settings.hidden_count++] = (AgentKind)i;
  }
}

static void go_to(Menu *m, int row) {
  menu_open(m);
  for (int i = 0; i < row; i++) menu_move(m, 1);
}

// "Actualizar app": abre la pantalla de actualización (A, no izquierda/derecha); sirve sin conexión, como el tema.
static void test_update_entry(void) {
  Menu m;
  go_to(&m, MENU_E_UPDATE);
  CHECK_EQ_INT(MENU_E_UPDATE, MENU_E_THEME + 1);
  CHECK_EQ_INT(MENU_E_UPDATE, MENU_ROOT_ENTRIES - 1); // la última
  CHECK_STR(menu_entry_title(MENU_E_UPDATE), "Actualizar app");
  CHECK(menu_entry_enabled(MENU_E_UPDATE, NULL));
  CHECK_EQ_INT(menu_activate(&m, NULL, 1, 0).kind, MENU_OUT_UPDATE);
  CHECK_EQ_INT(menu_activate(&m, NULL, -1, 1).kind, MENU_OUT_NONE); // izquierda/derecha no abren nada
  CHECK(m.open); // el menú sigue abierto debajo: al cerrar la pantalla se vuelve a él
}

static void test_open_close_cursor(void) {
  Menu m;
  menu_init(&m);
  CHECK(!m.open);
  menu_open(&m);
  CHECK(m.open);
  CHECK_EQ_INT(m.level, MENU_ROOT);
  CHECK_EQ_INT(m.cursor, 0);
  menu_move(&m, -1); // no da la vuelta
  CHECK_EQ_INT(m.cursor, 0);
  for (int i = 1; i < MENU_ROOT_ENTRIES; i++) {
    menu_move(&m, 1);
    CHECK_EQ_INT(m.cursor, i);
  }
  menu_move(&m, 1);
  CHECK_EQ_INT(m.cursor, MENU_ROOT_ENTRIES - 1);
  menu_close(&m);
  CHECK(!m.open);
  menu_open(&m);
  CHECK_EQ_INT(m.cursor, 0); // siempre abre arriba
}

static void test_notify_cycles(void) {
  View v;
  v_reset(&v);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  Menu m;
  go_to(&m, MENU_E_NOTIFY);
  // A (y derecha): todo -> lo importante -> solo al terminar -> silencio -> todo
  MenuOut o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_NOTIFY);
  CHECK_EQ_INT(o.value, NOTIFY_END);
  v_settings(&v, NOTIFY_SILENT, 1, 0);
  o = menu_activate(&m, &v, 1, 1);
  CHECK_EQ_INT(o.kind, MENU_OUT_NOTIFY);
  CHECK_EQ_INT(o.value, NOTIFY_ALL); // da la vuelta
  // izquierda va al revés
  v_settings(&v, NOTIFY_ALL, 1, 0);
  o = menu_activate(&m, &v, -1, 1);
  CHECK_EQ_INT(o.value, NOTIFY_SILENT);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  o = menu_activate(&m, &v, -1, 1);
  CHECK_EQ_INT(o.value, NOTIFY_ALL);
  // etiquetas
  CHECK_STR(menu_notify_label(NOTIFY_ALL), "todo");
  CHECK_STR(menu_notify_label(NOTIFY_IMPORTANT), "lo importante");
  CHECK_STR(menu_notify_label(NOTIFY_END), "solo al terminar");
  CHECK_STR(menu_notify_label(NOTIFY_SILENT), "silencio");
}

static void test_ack_toggles(void) {
  View v;
  v_reset(&v);
  Menu m;
  go_to(&m, MENU_E_ACK);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  MenuOut o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_ACK);
  CHECK_EQ_INT(o.value, 0);
  v_settings(&v, NOTIFY_IMPORTANT, 0, 0);
  o = menu_activate(&m, &v, -1, 1);
  CHECK_EQ_INT(o.kind, MENU_OUT_ACK);
  CHECK_EQ_INT(o.value, 1);
}

static void test_sound_toggles(void) {
  View v;
  v_reset(&v);
  Menu m;
  go_to(&m, MENU_E_SOUND);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  v.settings.sound = 1;
  MenuOut o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_SOUND);
  CHECK_EQ_INT(o.value, 0);
  v.settings.sound = 0;
  o = menu_activate(&m, &v, -1, 1);
  CHECK_EQ_INT(o.kind, MENU_OUT_SOUND);
  CHECK_EQ_INT(o.value, 1);
  CHECK_STR(menu_entry_title(MENU_E_SOUND), "Sonido");
  CHECK(!menu_entry_enabled(MENU_E_SOUND, NULL));
}

static void test_questions_toggles(void) {
  View v;
  v_reset(&v);
  Menu m;
  go_to(&m, MENU_E_QUESTIONS);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  v.settings.questions = 1;
  MenuOut o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_QUESTIONS);
  CHECK_EQ_INT(o.value, 0);
  v.settings.questions = 0;
  o = menu_activate(&m, &v, -1, 1);
  CHECK_EQ_INT(o.kind, MENU_OUT_QUESTIONS);
  CHECK_EQ_INT(o.value, 1);
  CHECK_STR(menu_entry_title(MENU_E_QUESTIONS), "Preguntas en la 3DS");
  CHECK(!menu_entry_enabled(MENU_E_QUESTIONS, NULL));
  CHECK_EQ_INT(MENU_E_QUESTIONS, MENU_E_SOUND + 1);
  CHECK_EQ_INT(MENU_ROOT_ENTRIES, 11); // paso 6: "Esperar instrucción hasta"; luego "Tema" y "Actualizar app"
}

static void test_reader_default_toggles(void) {
  View v;
  v_reset(&v);
  Menu m;
  go_to(&m, MENU_E_READER);
  CHECK_EQ_INT(MENU_E_READER, MENU_E_QUESTIONS + 1);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 0);
  v.settings.reader_default = READ_MODE_FULL;
  MenuOut o = menu_activate(&m, &v, 1, 0); // A: completo -> resumen
  CHECK_EQ_INT(o.kind, MENU_OUT_READER);
  CHECK_EQ_INT(o.value, READ_MODE_SUMMARY);
  v.settings.reader_default = READ_MODE_SUMMARY;
  o = menu_activate(&m, &v, -1, 1); // izquierda/derecha también alternan
  CHECK_EQ_INT(o.kind, MENU_OUT_READER);
  CHECK_EQ_INT(o.value, READ_MODE_FULL);
  CHECK_STR(menu_entry_title(MENU_E_READER), "Abrir mensajes en");
  CHECK(!menu_entry_enabled(MENU_E_READER, NULL)); // sin conexión
  CHECK(menu_entry_enabled(MENU_E_READER, &v));
  v.has_settings = 0;
  o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_NONE);
}

static void test_agents_submenu(void) {
  View v;
  v_reset(&v);
  v_settings(&v, NOTIFY_IMPORTANT, 1, 1u << AGENT_GEMINI);
  Menu m;
  go_to(&m, MENU_E_AGENTS);
  // izquierda/derecha no entran al submenú; A sí
  CHECK_EQ_INT(menu_activate(&m, &v, 1, 1).kind, MENU_OUT_NONE);
  CHECK_EQ_INT(m.level, MENU_ROOT);
  CHECK_EQ_INT(menu_activate(&m, &v, 1, 0).kind, MENU_OUT_NONE);
  CHECK_EQ_INT(m.level, MENU_AGENTS);
  CHECK_EQ_INT(m.cursor, 0);
  // Claude visible -> ocultarlo: máscara con Claude y Gemini
  MenuOut o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_HIDDEN);
  CHECK_EQ_INT((unsigned)o.value, (1u << AGENT_CLAUDE) | (1u << AGENT_GEMINI));
  // Gemini oculto -> mostrarlo (con derecha también)
  menu_move(&m, 1);
  CHECK_EQ_INT(m.cursor, 1);
  o = menu_activate(&m, &v, 1, 1);
  CHECK_EQ_INT(o.kind, MENU_OUT_HIDDEN);
  CHECK_EQ_INT((unsigned)o.value, 0u);
  // recorre los cinco y no pasa de ahí
  for (int i = 0; i < 10; i++) menu_move(&m, 1);
  CHECK_EQ_INT(m.cursor, AGENT_COUNT - 1);
  o = menu_activate(&m, &v, 1, 0);
  CHECK_EQ_INT((unsigned)o.value, (1u << AGENT_GEMINI) | (1u << AGENT_HERMES));
  // B vuelve a la raíz sobre "Agentes"; otra B cierra
  o = menu_back(&m);
  CHECK_EQ_INT(o.kind, MENU_OUT_NONE);
  CHECK_EQ_INT(m.level, MENU_ROOT);
  CHECK_EQ_INT(m.cursor, MENU_E_AGENTS);
  o = menu_back(&m);
  CHECK_EQ_INT(o.kind, MENU_OUT_CLOSE);
}

static void test_without_connection(void) {
  View none;
  v_reset(&none); // vista sin settings (un puente anterior)
  Menu m;
  CHECK(!menu_entry_enabled(MENU_E_NOTIFY, NULL));
  CHECK(!menu_entry_enabled(MENU_E_ACK, NULL));
  CHECK(!menu_entry_enabled(MENU_E_AGENTS, NULL));
  CHECK(!menu_entry_enabled(MENU_E_NOTIFY, &none));
  CHECK(menu_entry_enabled(MENU_E_GUIDE, NULL));
  CHECK(menu_entry_enabled(MENU_E_DIAG, NULL));
  const View *views[2] = {NULL, &none};
  for (int k = 0; k < 2; k++) {
    for (int row = MENU_E_NOTIFY; row <= MENU_E_AGENTS; /* incluye el sonido */ row++) {
      go_to(&m, row);
      CHECK_EQ_INT(menu_activate(&m, views[k], 1, 0).kind, MENU_OUT_NONE);
      CHECK_EQ_INT(menu_activate(&m, views[k], -1, 1).kind, MENU_OUT_NONE);
      CHECK_EQ_INT(m.level, MENU_ROOT); // y "Agentes" no entra al submenú
    }
    // la guía y el diagnóstico siguen usables
    go_to(&m, MENU_E_GUIDE);
    CHECK_EQ_INT(menu_activate(&m, views[k], 1, 0).kind, MENU_OUT_GUIDE);
    go_to(&m, MENU_E_DIAG);
    CHECK_EQ_INT(menu_activate(&m, views[k], 1, 0).kind, MENU_OUT_DIAG);
  }
  // izquierda/derecha no abren la guía ni el diagnóstico
  go_to(&m, MENU_E_GUIDE);
  CHECK_EQ_INT(menu_activate(&m, NULL, 1, 1).kind, MENU_OUT_NONE);
  go_to(&m, MENU_E_DIAG);
  CHECK_EQ_INT(menu_activate(&m, NULL, -1, 1).kind, MENU_OUT_NONE);
  CHECK_EQ_INT((int)menu_hidden_mask(NULL), 0);
  CHECK_EQ_INT((int)menu_hidden_mask(&none), 0);
}

// "Tema": preferencia local de la consola; sirve sin conexión (sin vista) y alterna con A o izquierda/derecha.
static void test_theme_toggles(void) {
  Menu m;
  go_to(&m, MENU_E_THEME);
  CHECK_EQ_INT(MENU_E_THEME, MENU_E_DIAG + 1);
  CHECK_STR(menu_entry_title(MENU_E_THEME), "Tema");
  CHECK(menu_entry_enabled(MENU_E_THEME, NULL)); // sin conexión también
  pal_set_dark(0);
  MenuOut o = menu_activate(&m, NULL, 1, 0);
  CHECK_EQ_INT(o.kind, MENU_OUT_THEME);
  CHECK_EQ_INT(o.value, 1); // claro -> oscuro
  pal_set_dark(1);
  o = menu_activate(&m, NULL, -1, 1); // izquierda/derecha también cambian el valor
  CHECK_EQ_INT(o.kind, MENU_OUT_THEME);
  CHECK_EQ_INT(o.value, 0); // oscuro -> claro
  pal_set_dark(0);
  View v;
  v_reset(&v);
  v_settings(&v, NOTIFY_ALL, 0, 0);
  CHECK_EQ_INT(menu_activate(&m, &v, 1, 0).kind, MENU_OUT_THEME); // con conexión, igual
  CHECK_EQ_INT(m.level, MENU_ROOT);                              // no entra a ningún submenú
}

static void test_layout_and_hits(void) {
  for (int lv = 0; lv < 2; lv++) {
    MenuLevel level = lv == 0 ? MENU_ROOT : MENU_AGENTS;
    MenuLayout l;
    menu_layout(level, &l);
    CHECK_EQ_INT(l.count, level == MENU_ROOT ? MENU_ROOT_ENTRIES : MENU_AGENT_ROWS);
    for (int i = 0; i < l.count; i++) {
      CHECK(l.rows[i].x >= 0 && l.rows[i].x + l.rows[i].w <= LAYOUT_W);
      CHECK(l.rows[i].y >= 32 && l.rows[i].y + l.rows[i].h <= LAYOUT_H);
      if (i > 0) CHECK(l.rows[i].y >= l.rows[i - 1].y + l.rows[i - 1].h); // sin solaparse
      CHECK_EQ_INT(menu_hit_row(level, l.rows[i].x + l.rows[i].w / 2, l.rows[i].y + l.rows[i].h / 2), i);
    }
    CHECK(l.hint.y > l.rows[l.count - 1].y + l.rows[l.count - 1].h);
    CHECK(l.hint.y + l.hint.h <= LAYOUT_H);
    CHECK(l.hint.h >= (level == MENU_ROOT ? 14 : 26)); // la raíz (diez filas) deja una línea de ayuda; el submenú, las dos suyas
    CHECK(l.back.x + l.back.w <= LAYOUT_W && l.back.y + l.back.h < 32);
    CHECK(menu_hit_back(level, l.back.x + 2, l.back.y + 2));
    CHECK_EQ_INT(menu_hit_row(level, l.back.x + 2, l.back.y + 2), -1); // el botón no es una fila
    CHECK_EQ_INT(menu_hit_row(level, 2, 100), -1);                      // fuera de las filas
    CHECK(!menu_hit_back(level, 10, 150));
  }
}

int main(void) {
  TEST_BEGIN("menu: menú de configuración (cursor, valores, sin conexión, geometría)");
  RUN(test_open_close_cursor);
  RUN(test_notify_cycles);
  RUN(test_ack_toggles);
  RUN(test_sound_toggles);
  RUN(test_questions_toggles);
  RUN(test_reader_default_toggles);
  RUN(test_agents_submenu);
  RUN(test_without_connection);
  RUN(test_theme_toggles);
  RUN(test_update_entry);
  RUN(test_layout_and_hits);
  TEST_END();
}
