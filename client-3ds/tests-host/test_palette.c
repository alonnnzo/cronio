#include "test.h"
#include "../source/logic/palette.h"

static void test_lerp(void) {
  CHECK_EQ_INT(pal_lerp(0x000000u, 0xffffffu, 0), 0x000000);
  CHECK_EQ_INT(pal_lerp(0x000000u, 0xffffffu, 256), 0xffffff);
  CHECK_EQ_INT(pal_lerp(0xffffffu, PAL_SILVER, 256), (int)PAL_SILVER);
  CHECK_EQ_INT(pal_lerp(0x000000u, 0x80ff00u, 128), 0x407f00);
  CHECK_EQ_INT(pal_lerp(0x112233u, 0xffffffu, -5), 0x112233); // se acota
}

// El texto sobre las superficies claras: lo que se lee en la consola real. Mínimo 4.5:1 en el texto base y secundario.
static void test_contrast(void) {
  CHECK(pal_contrast_x10(PAL_INK, PAL_WHITE) >= 90);
  CHECK(pal_contrast_x10(PAL_INK, PAL_SILVER) >= 75);
  CHECK(pal_contrast_x10(PAL_MUTE, PAL_WHITE) >= 45);
  CHECK(pal_contrast_x10(PAL_MUTE, PAL_SILVER) >= 38); // sobre la plata (3.9:1) queda justo: texto secundario solo sobre filas blancas o en negrita
  CHECK(pal_contrast_x10(PAL_SKY_DK, PAL_WHITE) >= 35); // texto celeste: solo negritas
  CHECK(pal_contrast_x10(PAL_BAD, PAL_WHITE) >= 40);
  CHECK(pal_contrast_x10(PAL_OK_DK, PAL_WHITE) >= 35);
  CHECK(pal_contrast_x10(PAL_INK, PAL_EYE) >= 10);
  CHECK(pal_contrast_x10(PAL_WHITE, PAL_WHITE) == 10);
}

// Los dos temas: el texto principal se lee con 4.5:1 o más sobre fondo, filas, fichas, botón, barra y tarjetas; el
// secundario y los textos de color, con 3:1 o más sobre las superficies donde se dibujan.
static void check_theme(const Palette *p, const char *name) {
  const uint32_t surfaces[] = {p->bg_top, p->bg_bot, p->row_top, p->row_bot, p->row_alt, p->pulse, p->btn_top, p->btn_bot,
                               p->bar_top, p->bar_bot, p->card};
  for (size_t i = 0; i < sizeof surfaces / sizeof surfaces[0]; i++) {
    CHECK_MSG(pal_contrast_x10(p->ink, surfaces[i]) >= 45, "%s: texto sobre superficie %zu = %d", name, i, pal_contrast_x10(p->ink, surfaces[i]));
  }
  CHECK(pal_contrast_x10(p->ink, p->cmd_bg) >= 45);
  CHECK(pal_contrast_x10(p->ink, p->bad_bg) >= 45);
  CHECK(pal_contrast_x10(p->bubble_title, p->bubble_fill) >= 45);
  // secundario: sobre filas, fichas, botones, barra, tarjetas y fondo
  for (size_t i = 0; i < sizeof surfaces / sizeof surfaces[0]; i++) {
    CHECK_MSG(pal_contrast_x10(p->mute, surfaces[i]) >= 30, "%s: secundario sobre superficie %zu = %d", name, i, pal_contrast_x10(p->mute, surfaces[i]));
  }
  CHECK(pal_contrast_x10(p->mute, p->cmd_bg) >= 30);
  CHECK(pal_contrast_x10(p->bubble_sub, p->bubble_fill) >= 30);
  // celeste, verde y rojo: sobre filas, tarjetas, fondo, y los suyos (aviso, franja, riesgo alto)
  // (sin bg_bot: el celeste claro #1F8FC8 sobre la plata mide 2.9:1; el texto celeste va sobre filas, tarjetas y la parte alta del fondo)
  const uint32_t base[] = {p->bg_top, p->row_top, p->row_bot, p->card, p->bar_top, p->bar_bot};
  for (size_t i = 0; i < sizeof base / sizeof base[0]; i++) {
    CHECK_MSG(pal_contrast_x10(p->sky_text, base[i]) >= 30, "%s: celeste sobre %zu = %d", name, i, pal_contrast_x10(p->sky_text, base[i]));
    CHECK_MSG(pal_contrast_x10(p->ok_text, base[i]) >= 30, "%s: verde sobre %zu = %d", name, i, pal_contrast_x10(p->ok_text, base[i]));
    CHECK_MSG(pal_contrast_x10(p->bad_text, base[i]) >= 30, "%s: rojo sobre %zu = %d", name, i, pal_contrast_x10(p->bad_text, base[i]));
  }
  CHECK(pal_contrast_x10(p->sky_text, p->sky_bg) >= 30);
  CHECK(pal_contrast_x10(p->sky_text, p->sky_strip) >= 30);
  CHECK(pal_contrast_x10(p->ok_text, p->sky_bg) >= 30);
  CHECK(pal_contrast_x10(p->bad_text, p->sky_bg) >= 30);
  CHECK(pal_contrast_x10(p->bad_text, p->bad_bg) >= 30);
}

static void test_themes(void) {
  check_theme(pal_light(), "claro");
  check_theme(pal_dark(), "oscuro");
}

static void test_theme_switch(void) {
  pal_set_dark(0);
  CHECK(!pal_is_dark());
  CHECK(pal() == pal_light());
  CHECK_EQ_INT(pal()->ink, (int)PAL_INK);       // el claro son los PAL_* de siempre
  CHECK_EQ_INT(pal()->bg_bot, (int)PAL_SILVER);
  CHECK_EQ_INT(pal()->row_bot, (int)PAL_ROW_BOT);
  pal_set_dark(1);
  CHECK(pal_is_dark());
  CHECK(pal() == pal_dark());
  CHECK_EQ_INT(pal()->bg_top, 0x23272F);
  CHECK_EQ_INT(pal()->sky_text, 0x5CC4F2);
  CHECK(pal()->stripe_alpha <= 0.04f + 0.0001f);
  CHECK(pal_contrast_x10(pal()->bg_bot, pal()->ink) >= 45);
  pal_set_dark(0);
  CHECK(pal() == pal_light());
}

static void test_agent_square(void) {
  AgentSquare g;
  pal_agent_square(32.0f, &g);
  CHECK(g.radius > 6.3f && g.radius < 6.5f); // 20 % del lado
  CHECK(g.eye_ry > g.eye_rx);                // óvalos verticales
  CHECK(g.eye_lx < 16.0f && g.eye_rx_c > 16.0f);
  CHECK(g.eye_lx - g.eye_rx > 0.0f && g.eye_rx_c + g.eye_rx < 32.0f); // los ojos caben dentro
  CHECK(g.glint_r > 0.0f);
  AgentSquare s;
  pal_agent_square(16.0f, &s);
  CHECK(s.radius > 3.1f && s.radius < 3.3f);
  CHECK(s.eye_ry > s.eye_rx);
  CHECK(s.glint_r == 0.0f); // a 16 px el brillo no se ve
  CHECK(s.eye_lx > g.eye_lx * 0.49f && s.eye_lx < g.eye_lx * 0.51f); // escala con el lado
}

int main(void) {
  TEST_BEGIN("paleta Cronio: mezcla, contraste y cuadrado del agente");
  RUN(test_lerp);
  RUN(test_contrast);
  RUN(test_themes);
  RUN(test_theme_switch);
  RUN(test_agent_square);
  TEST_END();
}
