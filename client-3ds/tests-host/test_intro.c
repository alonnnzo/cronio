// Animación de entrada (logic/intro.c): curvas, línea de tiempo, empalme con la cara final y valores sanos.
#include <math.h>

#include "test.h"

#include "../source/logic/intro.h"

static IntroFrame at(double t) {
  IntroFrame f;
  intro_frame(t, NULL, &f);
  return f;
}

static void test_curves(void) {
  CHECK(intro_ease_out_back(0.0, 1.7) == 0.0);
  CHECK(fabs(intro_ease_out_back(1.0, 1.7) - 1.0) < 1e-12);
  CHECK(intro_ease_out_back(0.8, 1.7) > 1.0); // sobrepaso
  CHECK(fabs(intro_ease_out_cubic(1.0) - 1.0) < 1e-12 && intro_ease_out_cubic(0.5) > 0.5);
  CHECK(fabs(intro_ease_in_out_cubic(0.5) - 0.5) < 1e-12);
  CHECK(intro_ease_in_out_cubic(0.25) < 0.25 && intro_ease_in_out_cubic(0.75) > 0.75);
  CHECK(intro_ease_out_back(-3.0, 1.7) == 0.0 && fabs(intro_ease_out_back(9.0, 1.7) - 1.0) < 1e-12); // se acota
}

static void test_start_and_end(void) {
  IntroFrame f = at(0);
  CHECK(!f.square_visible && f.scale == 0.0f && f.w == 0.0f && f.h == 0.0f && !f.eyes_visible);
  CHECK(f.bg_cover == 1.0f && f.logo_alpha == 0.0f && f.text_alpha == 0.0f && !f.done && !f.over);
  f = at(100); // 0-120: solo negro
  CHECK(!f.square_visible && f.w == 0.0f);
  f = at(INTRO_DONE_MS);
  CHECK(f.done && !f.over);
  f = at(INTRO_END_MS);
  CHECK(f.done && f.over && f.color_mix == 1.0f);
  CHECK(!at(INTRO_DONE_MS - 1).done);
}

static void test_overshoot(void) {
  CHECK(at(450).scale > 1.0f);
  float peak = 0;
  for (double t = 120; t <= 520; t += 5) {
    float s = at(t).scale;
    if (s > peak) peak = s;
  }
  CHECK_MSG(peak > 1.02f && peak < 1.2f, "pico %.3f", (double)peak);
  CHECK(fabs(at(520).scale - 1.0f) < 1e-6);
  // aplastamiento al aterrizar: a 400 ms más ancho que alto en proporción al tamaño
  IntroFrame f = at(400);
  CHECK(f.w / f.h > 1.0f);
  CHECK(fabs(at(600).w - 96.0f) < 0.01f && fabs(at(600).h - 96.0f) < 0.01f);
}

static void test_eyes_open_blink_look(void) {
  CHECK(!at(449).eyes_visible && at(450).eyes_visible);
  CHECK(at(451).eye[0].scale_y < 0.05f);
  CHECK(at(520).eye[0].scale_y > at(520).eye[1].scale_y); // el izquierdo abre antes
  CHECK(fabs(at(750).eye[0].scale_y - 1.0f) < 1e-5 && fabs(at(750).eye[1].scale_y - 1.0f) < 1e-5);
  float lo = 9;
  for (double t = 800; t <= 900; t += 1) {
    float s = at(t).eye[0].scale_y;
    if (s < lo) lo = s;
  }
  CHECK_MSG(fabs(lo - 0.1f) < 0.02f, "mínimo %.3f", (double)lo);
  CHECK(fabs(at(900).eye[1].scale_y - 1.0f) < 1e-5);
  // mirada: -5 a 1050-1150, +5 a 1250, 0 a 1350
  CHECK(fabs(at(1100).eye[0].dx + 5.0f) < 1e-5);
  CHECK(fabs(at(1250).eye[0].dx - 5.0f) < 1e-5);
  CHECK(fabs(at(1350).eye[0].dx) < 1e-5);
  CHECK(at(1000).eye[0].dx < 0.0f && at(1200).eye[0].dx > -5.0f);
  CHECK(fabs((at(1100).eye[1].cx - at(1100).eye[0].cx) - (at(900).eye[1].cx - at(900).eye[0].cx)) < 1e-3); // los dos se mueven igual
}

static void test_jump(void) {
  float y0 = at(1340).y, top = y0;
  for (double t = 1350; t < 1520; t += 1) {
    float y = at(t).y;
    if (y < top) top = y;
  }
  CHECK_MSG(fabs((y0 - top) - 12.0f) < 0.6f, "altura %.2f", (double)(y0 - top));
  CHECK(at(1520).w > at(1520).h); // aplastado al tocar el suelo (X 1.06 / Y 0.94)
  CHECK(fabs(at(1520).w - 96.0f * 1.06f) < 0.5f && fabs(at(1520).h - 96.0f * 0.94f) < 0.5f);
}

static void test_final_face(void) {
  IntroTarget tg = intro_target_default();
  IntroFrame f = at(INTRO_DONE_MS);
  CHECK(f.x == 0.0f && f.y == 0.0f && f.w == 400.0f && f.h == 240.0f && f.radius == 0.0f);
  CHECK(f.eye[0].cx == tg.eye_lx && f.eye[1].cx == tg.eye_rx_c);
  for (int i = 0; i < 2; i++) {
    CHECK(f.eye[i].cy == tg.eye_cy && f.eye[i].rx == tg.eye_rx && f.eye[i].ry == tg.eye_ry && f.eye[i].scale_y == 1.0f);
    CHECK(f.eye[i].glint_dx == tg.glint_dx && f.eye[i].glint_dy == tg.glint_dy && f.eye[i].glint_r == tg.glint_r);
  }
  CHECK(f.depth_bg == 0.0f && f.depth_eyes == 5.0f && f.depth_glint == 6.0f);
  // otro destino: los ojos coinciden con él
  IntroTarget o = tg;
  o.eye_lx = 100;
  o.eye_cy = 90;
  IntroFrame g;
  intro_frame(INTRO_DONE_MS, &o, &g);
  CHECK(g.eye[0].cx == 100.0f && g.eye[0].cy == 90.0f);
  // profundidades al principio
  f = at(1000);
  CHECK(f.depth_bg == 3.0f && f.depth_eyes == 6.0f && f.depth_glint == 7.0f);
  // la expansión es monótona en tamaño
  float prev = 0;
  for (double t = 1620; t <= 1880; t += 10) { // hasta 1620 el aplastamiento del aterrizaje aún se recupera
    float w = at(t).w;
    CHECK(w >= prev - 1e-3f);
    prev = w;
  }
}

static void test_bottom(void) {
  IntroFrame f = at(150);
  CHECK(f.bg_cover < 1.0f && f.bg_cover > 0.0f);
  CHECK(at(300).bg_cover == 0.0f);
  CHECK(at(600).logo_alpha == 0.0f && fabs(at(600).logo_y - 134.0f) < 1e-4);
  CHECK(fabs(at(750).logo_alpha - 1.0f) < 1e-6);
  CHECK(fabs(at(1000).logo_y - 104.0f) < 1e-4);
  float over = 0;
  for (double t = 600; t <= 1000; t += 5) {
    float y = at(t).logo_y;
    if (104.0f - y > over) over = 104.0f - y; // rebasa hacia arriba
  }
  CHECK(over > 1.0f);
  CHECK(at(1100).text_alpha > 0.0f && at(1100).text_alpha < 1.0f && at(1200).text_alpha == 1.0f);
  CHECK(at(1800).logo_alpha < 1.0f && at(1800).logo_alpha > 0.0f);
  CHECK(at(INTRO_DONE_MS).logo_alpha == 0.0f && at(INTRO_DONE_MS).text_alpha == 0.0f);
}

static void test_skip(void) {
  CHECK(at(intro_skip(0)).done);
  CHECK(at(intro_skip(900)).done);
  CHECK(intro_skip(1950) == 1950.0);
  CHECK(intro_skip(INTRO_END_MS) == INTRO_END_MS);
}

static int sane(float v, float lo, float hi) { return isfinite(v) && v >= lo && v <= hi; }

static void test_all_finite_on_screen(void) {
  int bad = 0;
  for (double t = -50; t <= 2600; t += 1) {
    IntroFrame f = at(t);
    if (!sane(f.x, 0, 400) || !sane(f.y, 0, 240) || !sane(f.w, 0, 400) || !sane(f.h, 0, 240) || !sane(f.radius, 0, 100)) bad++;
    if (f.x + f.w > 400.01f || f.y + f.h > 240.01f) bad++;
    if (!sane(f.scale, 0, 1.2f) || !sane(f.color_mix, 0, 1) || !sane(f.bg_cover, 0, 1) || !sane(f.logo_alpha, 0, 1) ||
        !sane(f.text_alpha, 0, 1) || !sane(f.logo_y, 0, 240))
      bad++;
    if (!sane(f.depth_bg, 0, 10) || !sane(f.depth_eyes, 0, 10) || !sane(f.depth_glint, 0, 10)) bad++;
    for (int i = 0; i < 2; i++) {
      const IntroEye *e = &f.eye[i];
      if (!sane(e->cx, 0, 400) || !sane(e->cy, 0, 240) || !sane(e->rx, 0, 100) || !sane(e->ry, 0, 100) || !sane(e->scale_y, 0, 1.5f) ||
          !sane(e->glint_dx, -50, 50) || !sane(e->glint_dy, -50, 50) || !sane(e->glint_r, 0, 20))
        bad++;
    }
  }
  CHECK_EQ_INT(bad, 0);
  IntroFrame f;
  intro_frame(NAN, NULL, &f); // entradas raras no rompen nada
  CHECK(sane(f.x, 0, 400) && !f.done);
  intro_frame(1e12, NULL, &f);
  CHECK(f.done && f.over);
}

int main(void) {
  TEST_BEGIN("intro: animación de entrada (curvas, línea de tiempo, cara final)");
  RUN(test_curves);
  RUN(test_start_and_end);
  RUN(test_overshoot);
  RUN(test_eyes_open_blink_look);
  RUN(test_jump);
  RUN(test_final_face);
  RUN(test_bottom);
  RUN(test_skip);
  RUN(test_all_finite_on_screen);
  TEST_END();
}
