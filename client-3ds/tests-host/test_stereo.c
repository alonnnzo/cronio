// 3D estereoscópico de la pantalla de arriba (logic/stereo.c): signo por ojo, escala con el deslizador y deslizador 0.
#include "test.h"

#include "../source/logic/stereo.h"

static void test_sign_per_eye(void) {
  CHECK(stereo_offset(STEREO_LEFT, 5.0f, 1.0f) > 0.0f);  // ojo izquierdo: a la derecha
  CHECK(stereo_offset(STEREO_RIGHT, 5.0f, 1.0f) < 0.0f); // ojo derecho: a la izquierda
  CHECK(stereo_offset(STEREO_LEFT, 5.0f, 1.0f) == 5.0f);
  CHECK(stereo_offset(STEREO_RIGHT, 5.0f, 1.0f) == -5.0f);
  // una profundidad negativa (detrás de la pantalla) invierte el signo
  CHECK(stereo_offset(STEREO_LEFT, -4.0f, 1.0f) == -4.0f);
  CHECK(stereo_offset(STEREO_RIGHT, -4.0f, 1.0f) == 4.0f);
}

static void test_scales_with_slider(void) {
  CHECK(stereo_offset(STEREO_LEFT, STEREO_DEPTH_BUBBLE, 0.5f) == STEREO_DEPTH_BUBBLE * 0.5f);
  CHECK(stereo_offset(STEREO_RIGHT, STEREO_DEPTH_BUBBLE, 0.25f) == -STEREO_DEPTH_BUBBLE * 0.25f);
  float a = stereo_offset(STEREO_LEFT, STEREO_DEPTH_EYES, 0.3f);
  float b = stereo_offset(STEREO_LEFT, STEREO_DEPTH_EYES, 0.6f);
  CHECK(b > a && a > 0.0f);
  CHECK(stereo_offset(STEREO_LEFT, 6.0f, 0.5f) == 3.0f);
}

static void test_slider_zero_is_zero(void) {
  const float depths[] = {STEREO_DEPTH_FACE, STEREO_DEPTH_EYES, STEREO_DEPTH_GLINT, STEREO_DEPTH_BUBBLE, -3.0f};
  for (size_t i = 0; i < sizeof depths / sizeof depths[0]; i++) {
    CHECK(stereo_offset(STEREO_LEFT, depths[i], 0.0f) == 0.0f);
    CHECK(stereo_offset(STEREO_RIGHT, depths[i], 0.0f) == 0.0f);
  }
  CHECK(1.0f / stereo_offset(STEREO_RIGHT, 5.0f, 0.0f) > 0.0f); // 0 positivo, no -0
}

static void test_face_plane_does_not_move(void) {
  for (float s = 0.0f; s <= 1.0f; s += 0.25f) {
    CHECK(stereo_offset(STEREO_LEFT, STEREO_DEPTH_FACE, s) == 0.0f);
    CHECK(stereo_offset(STEREO_RIGHT, STEREO_DEPTH_FACE, s) == 0.0f);
  }
}

static void test_layer_order_and_limit(void) {
  // el globo queda delante de los ojos, y estos delante del fondo
  CHECK(STEREO_DEPTH_FACE < STEREO_DEPTH_EYES && STEREO_DEPTH_EYES < STEREO_DEPTH_GLINT && STEREO_DEPTH_GLINT < STEREO_DEPTH_BUBBLE);
  CHECK(STEREO_DEPTH_BUBBLE <= STEREO_MAX_DEPTH);
  CHECK(stereo_offset(STEREO_LEFT, STEREO_DEPTH_BUBBLE, 1.0f) <= 10.0f);
  CHECK(stereo_offset(STEREO_LEFT, 40.0f, 1.0f) == STEREO_MAX_DEPTH);   // se acota
  CHECK(stereo_offset(STEREO_RIGHT, 40.0f, 1.0f) == -STEREO_MAX_DEPTH);
  CHECK(stereo_offset(STEREO_LEFT, -40.0f, 1.0f) == -STEREO_MAX_DEPTH);
}

static void test_slider_clamp(void) {
  CHECK(stereo_slider_clamp(-0.5f) == 0.0f);
  CHECK(stereo_slider_clamp(0.0f) == 0.0f);
  CHECK(stereo_slider_clamp(0.7f) == 0.7f);
  CHECK(stereo_slider_clamp(1.0f) == 1.0f);
  CHECK(stereo_slider_clamp(3.0f) == 1.0f);
  float nan = 0.0f / (volatile float){0.0f};
  CHECK(stereo_slider_clamp(nan) == 0.0f);
  CHECK(stereo_offset(STEREO_LEFT, 5.0f, 2.0f) == 5.0f); // un deslizador fuera de rango no pasa del tope
}

static void test_eyes_mirror(void) {
  for (float s = 0.0f; s <= 1.0f; s += 0.1f) {
    CHECK(stereo_offset(STEREO_LEFT, STEREO_DEPTH_GLINT, s) == -stereo_offset(STEREO_RIGHT, STEREO_DEPTH_GLINT, s));
  }
}

int main(void) {
  TEST_BEGIN("stereo: desplazamiento por ojo, profundidad y deslizador del 3D");
  RUN(test_sign_per_eye);
  RUN(test_scales_with_slider);
  RUN(test_slider_zero_is_zero);
  RUN(test_face_plane_does_not_move);
  RUN(test_layer_order_and_limit);
  RUN(test_slider_clamp);
  RUN(test_eyes_mirror);
  TEST_END();
}
