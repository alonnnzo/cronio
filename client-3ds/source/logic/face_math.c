#include "face_math.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "theme.h"

const float FACE_SHEEN_RADII[FACE_SHEEN_RADII_COUNT] = {30, 70, 115, 165, 225};

#define FRAME_MS (1000.0 / 60.0)
#define COLOR_EASE 0.08
#define MAX_DT 250.0
#define ASK_PULSE_PERIOD 180.0
#define ASK_PULSE_BASE 0.10
#define ASK_PULSE_AMPLITUDE 0.10
#define SHAKE_PERIOD 35.0
#define SHAKE_AMPLITUDE 3.0
#define BOB_PERIOD 900.0
#define BOB_AMPLITUDE 3.0
#define ASK_JUMP_PERIOD 260.0
#define ASK_JUMP_HEIGHT 6.0
#define LOOK_WORK_PERIOD 500.0
#define LOOK_WORK_AMPLITUDE 9.0
#define LOOK_IDLE_PERIOD 2300.0
#define LOOK_IDLE_AMPLITUDE 5.0
#define BLINK_PERIOD 3600
#define BLINK_MS 130
#define BUBBLE_POP_MS 180.0
#define BUBBLE_POP_FROM 0.9

static const float DIM[MOOD_COUNT] = {0.55f, 1.0f, 1.0f, 1.0f, 0.8f};

void face_local_init(FaceLocal *l) { memset(l, 0, sizeof *l); }

static void update_color(FaceLocal *l, const float target[3], double t) {
  if (!l->have_color) {
    for (int i = 0; i < 3; i++) l->rgb[i] = target[i];
    l->have_color = 1;
  } else {
    double dt = !l->have_last ? FRAME_MS : fmin(MAX_DT, fmax(0.0, t - l->last_ms));
    double k = 1.0 - pow(1.0 - COLOR_EASE, dt / FRAME_MS);
    for (int i = 0; i < 3; i++) l->rgb[i] += (float)((target[i] - l->rgb[i]) * k);
  }
  l->last_ms = t;
  l->have_last = 1;
}

void face_compute(FaceFrame *out, FaceLocal *local, AgentKind kind, Mood mood, double t) {
  if ((unsigned)mood >= (unsigned)MOOD_COUNT) mood = MOOD_IDLE;
  memset(out, 0, sizeof *out);
  out->mood = mood;

  uint32_t rgb = theme_agent_rgb(kind);
  float target[3] = {(float)((rgb >> 16) & 255), (float)((rgb >> 8) & 255), (float)(rgb & 255)};
  update_color(local, target, t);
  float dim = DIM[mood];
  out->bg_r = (int)lroundf(local->rgb[0] * dim);
  out->bg_g = (int)lroundf(local->rgb[1] * dim);
  out->bg_b = (int)lroundf(local->rgb[2] * dim);

  if (mood == MOOD_ASK) out->ask_alpha = (float)(ASK_PULSE_BASE + ASK_PULSE_AMPLITUDE * sin(t / ASK_PULSE_PERIOD));
  out->shake = mood == MOOD_ERROR ? (float)(sin(t / SHAKE_PERIOD) * SHAKE_AMPLITUDE) : 0.0f;
  out->bob = (float)(sin(t / BOB_PERIOD) * BOB_AMPLITUDE);
  float jump = mood == MOOD_ASK ? (float)(-fabs(sin(t / ASK_JUMP_PERIOD)) * ASK_JUMP_HEIGHT) : 0.0f;
  out->eye_y = FACE_EYE_Y + out->bob + jump;
  out->mouth_y = FACE_MOUTH_Y + out->bob;
  if (mood == MOOD_WORKING) out->look = (float)(sin(t / LOOK_WORK_PERIOD) * LOOK_WORK_AMPLITUDE);
  else if (mood == MOOD_ASK) out->look = 0.0f;
  else out->look = (float)(sin(t / LOOK_IDLE_PERIOD) * LOOK_IDLE_AMPLITUDE);
  uint64_t ti = t > 0 ? (uint64_t)t : 0;
  out->blink = (ti % BLINK_PERIOD) > (uint64_t)(BLINK_PERIOD - BLINK_MS);
}

BubbleAnim face_bubble_anim(FaceLocal *l, Mood mood, const char *line1, const char *line2, double t) {
  char key[sizeof l->bubble_key];
  snprintf(key, sizeof key, "%d\n%s\n%s", (int)mood, line1 ? line1 : "", line2 ? line2 : "");
  if (strcmp(key, l->bubble_key) != 0) {
    memcpy(l->bubble_key, key, sizeof key);
    l->bubble_since = t;
  }
  double age = (t - l->bubble_since) / BUBBLE_POP_MS;
  age = age < 0 ? 0 : age > 1 ? 1 : age;
  BubbleAnim a;
  a.age = (float)age;
  a.scale = (float)(BUBBLE_POP_FROM + (1.0 - BUBBLE_POP_FROM) * age);
  a.alpha = a.age;
  return a;
}

FRect face_mouth_box(void) {
  double pad = FACE_MOUTH_LINE_WIDTH / 2.0;
  double x0 = FACE_MOUTH_X - 12 - pad - SHAKE_AMPLITUDE, x1 = FACE_MOUTH_X + 12 + pad + SHAKE_AMPLITUDE;
  double y0 = FACE_MOUTH_Y - BOB_AMPLITUDE - 4 - pad, y1 = FACE_MOUTH_Y + BOB_AMPLITUDE + 8 + pad;
  FRect r = {(float)x0, (float)y0, (float)(x1 - x0), (float)(y1 - y0)};
  return r;
}

FRect face_eyes_box(void) {
  double rx = FACE_EYE_SPACING + FACE_EYE_RX * FACE_EYE_ASK_SCALE + FACE_EYE_LINE_WIDTH / 2.0 + LOOK_WORK_AMPLITUDE + SHAKE_AMPLITUDE;
  double top = FACE_EYE_Y - BOB_AMPLITUDE - ASK_JUMP_HEIGHT - FACE_EYE_RY * FACE_EYE_ASK_SCALE;
  double bottom = FACE_EYE_Y + BOB_AMPLITUDE + FACE_EYE_RY * FACE_EYE_ASK_SCALE;
  FRect r = {(float)(FACE_EYE_X - rx), (float)top, (float)(rx * 2), (float)(bottom - top)};
  return r;
}

void face_bubble_geom(int lines, float *cy, float *h) {
  if (lines <= 2) {
    *cy = FACE_BUBBLE_CY;
    *h = FACE_BUBBLE_H;
  } else {
    *h = (float)(FACE_BUBBLE_TALL_BASE_H + FACE_BUBBLE_TALL_PITCH * (lines - 1));
    *cy = FACE_BUBBLE_TALL_BOTTOM - *h / 2.0f;
  }
}

FRect face_bubble_box_lines(int lines) {
  float cy, h;
  face_bubble_geom(lines, &cy, &h);
  FRect r = {(float)(FACE_BUBBLE_CX - FACE_BUBBLE_W / 2.0), cy - h / 2.0f - FACE_BUBBLE_TAIL_H, (float)FACE_BUBBLE_W, h + FACE_BUBBLE_TAIL_H};
  return r;
}

FRect face_bubble_box(void) { return face_bubble_box_lines(2); }

int face_boxes_overlap(FRect a, FRect b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
