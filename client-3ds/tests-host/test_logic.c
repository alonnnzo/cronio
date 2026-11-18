// Lógica pura de la aplicación: UTF-8, etiquetas, plazos de red, patrones del LED, azar de respaldo y cara.
#include "test.h"

#include <math.h>

#include "../source/core/view.h"
#include "../source/logic/face_math.h"
#include "../source/logic/led_pattern.h"
#include "../source/logic/netplan.h"
#include "../source/logic/rng_mix.h"
#include "../source/logic/theme.h"
#include "../source/logic/utf8util.h"

// ---------- utf8util ----------

static void test_utf8_count_prefix(void) {
  CHECK_EQ_INT(utf8_cp_count(""), 0);
  CHECK_EQ_INT(utf8_cp_count("abc"), 3);
  CHECK_EQ_INT(utf8_cp_count("¿Qué pasó?"), 10);
  CHECK_EQ_INT(utf8_cp_count("a…b"), 3);
  CHECK_EQ_INT(utf8_cp_count("😀x"), 2); // emoji fuera del plano básico: 4 bytes, 1 punto de código
  CHECK_EQ_INT(utf8_prefix_bytes("¿Qué", 2), 3);
  CHECK_EQ_INT(utf8_prefix_bytes("abc", 10), 3);
  CHECK_EQ_INT(utf8_prefix_bytes("😀x", 1), 4);
  CHECK_EQ_INT(utf8_prefix_bytes("abc", 0), 0);
}

static void test_utf8_clip(void) {
  char out[64];
  CHECK_EQ_INT(utf8_clip("hola", out, sizeof out, 10), 0);
  CHECK_STR(out, "hola");
  CHECK_EQ_INT(utf8_clip("abcdefghij", out, sizeof out, 5), 1);
  CHECK_STR(out, "abcd…");
  CHECK_EQ_INT((int)utf8_cp_count(out), 5);
  CHECK_EQ_INT(utf8_clip("áéíóúñ", out, sizeof out, 4), 1);
  CHECK_STR(out, "áéí…");
  CHECK_EQ_INT(utf8_clip("abc", out, sizeof out, 3), 0);
  CHECK_STR(out, "abc");
  // el destino manda: nunca se pasa ni parte una secuencia
  char small[8];
  CHECK_EQ_INT(utf8_clip("áéíóúñáéíóú", small, sizeof small, 100), 1);
  CHECK_STR(small, "áé…");
  CHECK(strlen(small) < sizeof small);
  char tiny[3];
  utf8_clip("abcdef", tiny, sizeof tiny, 100);
  CHECK_EQ_INT(tiny[0], 0);
  char one[1] = {'x'};
  utf8_clip("abc", one, 1, 100);
  CHECK_EQ_INT(utf8_clip("abc", one, 0, 100), 0);
  // todos los destinos posibles con emoji: siempre UTF-8 completo
  for (size_t cap = 1; cap < 20; cap++) {
    char b[20];
    memset(b, 'Z', sizeof b);
    utf8_clip("a😀b😀c😀d", b, cap, 100);
    size_t n = strlen(b);
    CHECK(n < cap);
    CHECK_EQ_INT((int)(utf8_prefix_bytes(b, 1000)), (int)n);
    // el último byte no es el inicio de una secuencia incompleta
    if (n > 0) CHECK(((unsigned char)b[n - 1] < 0x80) || ((unsigned char)b[n - 1] & 0xC0) == 0x80);
  }
}

static void test_utf8_drop(void) {
  char s[16] = "aé😀";
  CHECK_EQ_INT(utf8_drop_last(s), 3);
  CHECK_STR(s, "aé");
  CHECK_EQ_INT(utf8_drop_last(s), 1);
  CHECK_EQ_INT(utf8_drop_last(s), 0);
  CHECK_EQ_INT(utf8_drop_last(s), 0);
}

// ---------- theme ----------

static void test_theme(void) {
  CHECK_STR(theme_agent_name(AGENT_CLAUDE), "Claude");
  CHECK_STR(theme_agent_name(AGENT_HERMES), "Hermes");
  CHECK_STR(theme_agent_name(AGENT_NONE), "Agente");
  CHECK_STR(theme_agent_name((AgentKind)99), "Agente");
  CHECK_EQ_INT(theme_agent_rgb(AGENT_CLAUDE), 0xee7446);
  CHECK_EQ_INT(theme_agent_rgb(AGENT_GEMINI), 0x5b8cff);
  CHECK_EQ_INT(theme_agent_rgb(AGENT_CODEX), 0x2fd08a);
  CHECK_EQ_INT(theme_agent_rgb(AGENT_CURSOR), 0xc9ced9);
  CHECK_EQ_INT(theme_agent_rgb(AGENT_HERMES), 0xf6c544);
  CHECK_EQ_INT(theme_agent_rgb(AGENT_NONE), THEME_NEUTRAL_RGB);
  CHECK_STR(theme_state_label(STATE_ASK), "te espera");
  CHECK_STR(theme_state_label(STATE_DONE), "terminó");
  CHECK_STR(theme_mode_label(MODE_QUEUE), "En fila");
  CHECK_STR(theme_mode_label(MODE_MANUAL), "Elijo yo");
}

static View V;

static void add_session(const char *id, AgentKind k, const char *title, AgentState st) {
  SessionView *s = &V.sessions[V.session_count++];
  memset(s, 0, sizeof *s);
  strcpy(s->id, id);
  s->kind = k;
  strcpy(s->title, title);
  s->state = st;
}

static void test_summary_and_owner(void) {
  memset(&V, 0, sizeof V);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "sin sesiones");
  add_session("a", AGENT_CLAUDE, "mi-portal", STATE_IDLE);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "inactivo");
  add_session("b", AGENT_CLAUDE, "otro", STATE_DONE);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "terminó");
  add_session("c", AGENT_CLAUDE, "x", STATE_WORKING);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "trabajando");
  add_session("d", AGENT_CLAUDE, "y", STATE_ERROR);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "error");
  add_session("e", AGENT_CLAUDE, "z", STATE_ASK);
  CHECK_STR(theme_kind_summary(&V, AGENT_CLAUDE), "te espera");
  CHECK_STR(theme_kind_summary(&V, AGENT_GEMINI), "sin sesiones");

  char owner[200];
  theme_card_owner(&V, owner, sizeof owner);
  CHECK_STR(owner, "");
  V.has_request = 1;
  strcpy(V.request.id, "r1");
  strcpy(V.request.session_id, "e");
  strcpy(V.request.title, "título de la solicitud");
  theme_card_owner(&V, owner, sizeof owner);
  CHECK_STR(owner, "Claude · z");
  strcpy(V.request.session_id, "no-existe");
  theme_card_owner(&V, owner, sizeof owner);
  CHECK_STR(owner, "título de la solicitud");
  // título al máximo (38 emoji = 152 bytes): cabe en el búfer de la app
  strcpy(V.request.session_id, "e");
  V.sessions[4].kind = AGENT_CURSOR;
  size_t n = 0;
  for (int i = 0; i < 38; i++) {
    memcpy(V.sessions[4].title + n, "😀", 4);
    n += 4;
  }
  V.sessions[4].title[n] = '\0';
  char big[VIEW_TEXT_BYTES + 16];
  theme_card_owner(&V, big, sizeof big);
  CHECK(strncmp(big, "Cursor · ", 10) == 0);
  CHECK_EQ_INT((int)utf8_cp_count(big), 6 + 3 + 38);
  // destino pequeño: recorta sin partir
  char small[12];
  theme_card_owner(&V, small, sizeof small);
  CHECK(strlen(small) < sizeof small);
}

// ---------- netplan ----------

static void test_netplan(void) {
  CHECK_EQ_INT(netplan_backoff_ms(0), 1000);
  CHECK_EQ_INT(netplan_backoff_ms(1), 1000);
  CHECK_EQ_INT(netplan_backoff_ms(2), 2000);
  CHECK_EQ_INT(netplan_backoff_ms(3), 4000);
  CHECK_EQ_INT(netplan_backoff_ms(4), 5000);
  CHECK_EQ_INT(netplan_backoff_ms(1000), 5000);
  CHECK_EQ_INT(netplan_backoff_ms(-5), 1000);

  CHECK(!netplan_search_expired(1000, 3999));
  CHECK(netplan_search_expired(1000, 4000));
  CHECK(!netplan_connect_expired(0, 3999));
  CHECK(netplan_connect_expired(0, 4000));
  CHECK(netplan_beacon_fresh(1000, 1000));
  CHECK(netplan_beacon_fresh(1000, 6999));
  CHECK(!netplan_beacon_fresh(1000, 7000));
  CHECK(!netplan_beacon_fresh(5000, 1000)); // reloj hacia atrás: no sirve
  CHECK(!netplan_ping_due(100, 5099));
  CHECK(netplan_ping_due(100, 5100));
  CHECK(!netplan_rx_timed_out(0, 14999));
  CHECK(netplan_rx_timed_out(0, 15000));
  CHECK(!netplan_udp_stale(1000, 10999));
  CHECK(netplan_udp_stale(1000, 11000));
  CHECK(!netplan_udp_stale(5000, 1000)); // reloj hacia atrás: no es obsoleto
  CHECK(!netplan_sock_restart_due(0));
  CHECK(!netplan_sock_restart_due(2));
  CHECK(netplan_sock_restart_due(3));
  CHECK(netplan_sock_restart_due(4));
  // tiempos enormes (osGetTime es ms desde 1900): sin desbordes
  uint64_t big = 3900000000000ull;
  CHECK(netplan_ping_due(big, big + 5000));
  CHECK(!netplan_ping_due(big, big + 4999));
}

// ---------- led ----------

static void test_led(void) {
  CHECK_EQ_INT(led_ticks_from_ms(40), 19);   // 512 * 40 / 1000 = 20, menos 1
  CHECK_EQ_INT(led_ticks_from_ms(0), 1);
  CHECK_EQ_INT(led_ticks_from_ms(1), 1);
  CHECK_EQ_INT(led_ticks_from_ms(100000), 255);
  LedFrames f;
  for (int p = 0; p < VIEW_LED_COUNT; p++) {
    led_pattern_build((LedPattern)p, &f);
    CHECK_MSG(f.ticks_per_frame != 0, "patrón %d", p);
  }
  led_pattern_build(VIEW_LED_OFF, &f);
  for (int i = 0; i < LED_FRAMES; i++) CHECK(f.r[i] == 0 && f.g[i] == 0 && f.b[i] == 0);
  CHECK_EQ_INT(f.transition_delay, 0);

  led_pattern_build(VIEW_LED_WORKING, &f);
  int max_b = 0, min_b = 255;
  for (int i = 0; i < LED_FRAMES; i++) {
    if (f.b[i] > max_b) max_b = f.b[i];
    if (f.b[i] < min_b) min_b = f.b[i];
    CHECK(f.b[i] >= f.r[i] && f.b[i] >= f.g[i]); // dominante azul
  }
  CHECK_EQ_INT(max_b, 255);
  CHECK_EQ_INT(min_b, 0);
  CHECK_EQ_INT(f.transition_delay, f.ticks_per_frame); // interpolación lineal = pulso suave
  CHECK(f.ticks_per_frame > led_ticks_from_ms(40));    // más lento que el parpadeo

  led_pattern_build(VIEW_LED_ASK, &f);
  int on = 0, off = 0;
  for (int i = 0; i < LED_FRAMES; i++) {
    if (f.r[i] || f.g[i]) on++;
    else off++;
    CHECK(f.b[i] == 0);
  }
  CHECK(on == 16 && off == 16);
  CHECK(f.r[0] == 255 && f.g[0] == 180);

  led_pattern_build(VIEW_LED_DONE, &f);
  for (int i = 0; i < LED_FRAMES; i++) CHECK(f.g[i] == 255 && f.r[i] == 0 && f.b[i] == 60);

  led_pattern_build(VIEW_LED_ERROR, &f);
  on = 0;
  for (int i = 0; i < LED_FRAMES; i++) {
    if (f.r[i]) on++;
    CHECK(f.g[i] == 0 && f.b[i] == 0);
  }
  CHECK_EQ_INT(on, 16);
  CHECK(f.ticks_per_frame < led_ticks_from_ms(40)); // más rápido que "ask"
}

// ---------- rng_mix ----------

static void test_rng_mix(void) {
  uint8_t a[32], b[32], c[32], d[32];
  rng_mix(1000, 2000, "3ds-aaaaaaaa", 1, a);
  rng_mix(1000, 2000, "3ds-aaaaaaaa", 1, b);
  CHECK_MEM(a, b, 32); // determinista
  rng_mix(1001, 2000, "3ds-aaaaaaaa", 1, c);
  CHECK(memcmp(a, c, 32) != 0);
  rng_mix(1000, 2000, "3ds-aaaaaaaa", 2, c);
  CHECK(memcmp(a, c, 32) != 0);
  rng_mix(1000, 2001, "3ds-aaaaaaaa", 1, c);
  CHECK(memcmp(a, c, 32) != 0);
  rng_mix(1000, 2000, "3ds-bbbbbbbb", 1, d);
  CHECK(memcmp(a, d, 32) != 0);
  rng_mix(1000, 2000, NULL, 1, d);
  CHECK(memcmp(a, d, 32) != 0);
  // ningún byte fijo en mil mezclas distintas (un contador que sube): todas distintas entre sí
  uint8_t prev[32], cur[32];
  rng_mix(5, 6, "x", 0, prev);
  int same = 0;
  for (uint32_t i = 1; i < 1000; i++) {
    rng_mix(5, 6, "x", i, cur);
    if (memcmp(prev, cur, 16) == 0) same++;
    memcpy(prev, cur, 32);
  }
  CHECK_EQ_INT(same, 0);
}

// ---------- cara ----------

static void test_face_compute(void) {
  FaceLocal l;
  FaceFrame f;
  face_local_init(&l);
  // primera vez: el color salta al destino (sin transición) y el brillo sale del ánimo
  face_compute(&f, &l, AGENT_CLAUDE, MOOD_WORKING, 0);
  CHECK_EQ_INT(f.bg_r, 0xee);
  CHECK_EQ_INT(f.bg_g, 0x74);
  CHECK_EQ_INT(f.bg_b, 0x46);
  CHECK_EQ_INT(f.mood, MOOD_WORKING);
  CHECK(f.ask_alpha == 0.0f);
  CHECK(f.shake == 0.0f);
  face_local_init(&l);
  face_compute(&f, &l, AGENT_CLAUDE, MOOD_IDLE, 0);
  CHECK_EQ_INT(f.bg_r, (int)lroundf(0xee * 0.55f));
  face_local_init(&l);
  face_compute(&f, &l, AGENT_CLAUDE, MOOD_ERROR, 0);
  CHECK_EQ_INT(f.bg_r, (int)lroundf(0xee * 0.8f));
  face_local_init(&l);
  face_compute(&f, &l, AGENT_NONE, MOOD_IDLE, 0);
  CHECK_EQ_INT(f.bg_r, (int)lroundf(0x3a * 0.55f));

  // transición: de Claude a Gemini el rojo baja poco a poco y converge
  face_local_init(&l);
  face_compute(&f, &l, AGENT_CLAUDE, MOOD_WORKING, 0);
  float prev_r = (float)f.bg_r;
  face_compute(&f, &l, AGENT_GEMINI, MOOD_WORKING, 1000.0 / 60);
  CHECK(f.bg_r < prev_r && f.bg_r > 0x5b);
  // un cuadro de 1/60 s mueve el 8 %
  CHECK_EQ_INT(f.bg_r, (int)lroundf(0xee + (0x5b - 0xee) * 0.08f));
  double t = 1000.0 / 60;
  for (int i = 0; i < 400; i++) {
    t += 1000.0 / 60;
    face_compute(&f, &l, AGENT_GEMINI, MOOD_WORKING, t);
  }
  CHECK_EQ_INT(f.bg_r, 0x5b);
  CHECK_EQ_INT(f.bg_b, 0xff);
  // un salto de tiempo enorme cuenta como 250 ms (la transición no se come de golpe por otra razón que el dt)
  face_local_init(&l);
  face_compute(&f, &l, AGENT_CLAUDE, MOOD_WORKING, 0);
  face_compute(&f, &l, AGENT_GEMINI, MOOD_WORKING, 1e9);
  double k = 1 - pow(1 - 0.08, 250.0 / (1000.0 / 60));
  CHECK_EQ_INT(f.bg_r, (int)lroundf((float)(0xee + (0x5b - 0xee) * k)));
}

static void test_face_motion(void) {
  FaceLocal l;
  FaceFrame f;
  face_local_init(&l);
  // pide permiso: velo pulsante entre 0 y 0.2, ojos que saltan hacia arriba, sin mirada lateral
  float amin = 1, amax = -1, jmin = 0;
  for (int t = 0; t < 3000; t += 7) {
    face_compute(&f, &l, AGENT_CODEX, MOOD_ASK, t);
    if (f.ask_alpha < amin) amin = f.ask_alpha;
    if (f.ask_alpha > amax) amax = f.ask_alpha;
    float jump = f.eye_y - (FACE_EYE_Y + f.bob);
    if (jump < jmin) jmin = jump;
    CHECK(jump <= 0.001f && jump >= -6.001f);
    CHECK(f.look == 0.0f);
  }
  CHECK(amin >= -0.001f && amin < 0.02f);
  CHECK(amax <= 0.2001f && amax > 0.18f);
  CHECK(jmin < -5.5f);
  // error: temblor dentro de +-3, sin salto
  float smax = 0;
  for (int t = 0; t < 2000; t++) {
    face_compute(&f, &l, AGENT_CODEX, MOOD_ERROR, t);
    if (fabsf(f.shake) > smax) smax = fabsf(f.shake);
    CHECK(f.ask_alpha == 0.0f);
  }
  CHECK(smax > 2.9f && smax <= 3.0001f);
  // trabajando: mirada de +-9
  float lmax = 0;
  for (int t = 0; t < 2000; t++) {
    face_compute(&f, &l, AGENT_CODEX, MOOD_WORKING, t);
    if (fabsf(f.look) > lmax) lmax = fabsf(f.look);
  }
  CHECK(lmax > 8.9f && lmax <= 9.0001f);
  // flotación +-3 y la boca la sigue
  face_compute(&f, &l, AGENT_CODEX, MOOD_DONE, 1414.0);
  CHECK(fabsf(f.bob) <= 3.0001f);
  CHECK(fabsf(f.mouth_y - (FACE_MOUTH_Y + f.bob)) < 0.001f);
  // parpadeo: cerrado los últimos 130 ms de cada 3600
  face_compute(&f, &l, AGENT_CODEX, MOOD_WORKING, 3469);
  CHECK(!f.blink);
  face_compute(&f, &l, AGENT_CODEX, MOOD_WORKING, 3471);
  CHECK(f.blink);
  face_compute(&f, &l, AGENT_CODEX, MOOD_WORKING, 3600);
  CHECK(!f.blink);
  face_compute(&f, &l, AGENT_CODEX, MOOD_WORKING, 3600.0 * 5 + 3550);
  CHECK(f.blink);
  // ánimo fuera de rango: queda en idle
  face_compute(&f, &l, AGENT_CODEX, (Mood)77, 10);
  CHECK_EQ_INT(f.mood, MOOD_IDLE);
}

static void test_bubble_anim(void) {
  FaceLocal l;
  face_local_init(&l);
  BubbleAnim a = face_bubble_anim(&l, MOOD_ASK, "Claude necesita permiso", "rm -rf build · web", 1000);
  CHECK(a.age == 0.0f && fabsf(a.scale - 0.9f) < 1e-5f && a.alpha == 0.0f);
  a = face_bubble_anim(&l, MOOD_ASK, "Claude necesita permiso", "rm -rf build · web", 1090);
  CHECK(fabsf(a.age - 0.5f) < 1e-4f);
  CHECK(fabsf(a.scale - 0.95f) < 1e-4f);
  a = face_bubble_anim(&l, MOOD_ASK, "Claude necesita permiso", "rm -rf build · web", 1500);
  CHECK(a.age == 1.0f && a.scale == 1.0f && a.alpha == 1.0f);
  // el mismo texto con otro ánimo reinicia la entrada
  a = face_bubble_anim(&l, MOOD_DONE, "Claude necesita permiso", "rm -rf build · web", 2000);
  CHECK(a.age == 0.0f);
  // una línea y NULL
  a = face_bubble_anim(&l, MOOD_IDLE, "Todo tranquilo", NULL, 3000);
  CHECK(a.age == 0.0f);
  a = face_bubble_anim(&l, MOOD_IDLE, "Todo tranquilo", NULL, 3500);
  CHECK(a.age == 1.0f);
  // texto máximo (dos líneas de 38 emoji): no desborda el búfer de la clave
  char big[VIEW_TEXT_BYTES];
  for (int i = 0; i < 38; i++) memcpy(big + 4 * i, "😀", 4);
  big[152] = '\0';
  a = face_bubble_anim(&l, MOOD_WORKING, big, big, 4000);
  CHECK(a.age == 0.0f);
  a = face_bubble_anim(&l, MOOD_WORKING, big, big, 4100);
  CHECK(a.age > 0.0f); // misma clave: no se reinicia
}

static void test_face_boxes(void) {
  // el globo va abajo sin tapar ojos ni boca (igual que la comprobación del simulador)
  FRect eyes = face_eyes_box(), mouth = face_mouth_box(), bubble = face_bubble_box();
  CHECK(!face_boxes_overlap(bubble, mouth));
  CHECK(!face_boxes_overlap(bubble, eyes));
  CHECK(!face_boxes_overlap(eyes, mouth));
  CHECK(bubble.x >= 0 && bubble.x + bubble.w <= FACE_SCREEN_W);
  CHECK(bubble.y + bubble.h <= FACE_SCREEN_H);
  CHECK(eyes.x >= 0 && eyes.x + eyes.w <= FACE_SCREEN_W && eyes.y >= 0);
}

static void test_face_boxes_question(void) {
  // el globo de 3 y 4 líneas (la pregunta) crece hacia arriba con el pie fijo, sin tapar ojos ni boca y dentro de la pantalla
  FRect eyes = face_eyes_box(), mouth = face_mouth_box();
  for (int n = 1; n <= VIEW_MAX_FACE_LINES; n++) {
    FRect b = face_bubble_box_lines(n);
    CHECK(!face_boxes_overlap(b, mouth));
    CHECK(!face_boxes_overlap(b, eyes));
    CHECK(b.x >= 0 && b.x + b.w <= FACE_SCREEN_W);
    CHECK(b.y >= 0 && b.y + b.h <= FACE_SCREEN_H);
  }
  FRect b1 = face_bubble_box_lines(1), b2 = face_bubble_box_lines(2), b3 = face_bubble_box_lines(3), b4 = face_bubble_box_lines(4);
  CHECK(b1.y == b2.y && b1.h == b2.h); // 1 y 2 líneas: el globo de siempre
  CHECK(b3.h > b2.h && b4.h > b3.h);
  CHECK(b4.y < b3.y);
  float cy, h;
  face_bubble_geom(4, &cy, &h);
  CHECK(cy + h / 2 == (float)FACE_BUBBLE_TALL_BOTTOM);
  FRect old = face_bubble_box();
  CHECK(old.y == b2.y && old.h == b2.h);
}

int main(void) {
  TEST_BEGIN("lógica pura de la app: utf8, etiquetas, red, LED, azar y cara");
  RUN(test_utf8_count_prefix);
  RUN(test_utf8_clip);
  RUN(test_utf8_drop);
  RUN(test_theme);
  RUN(test_summary_and_owner);
  RUN(test_netplan);
  RUN(test_led);
  RUN(test_rng_mix);
  RUN(test_face_compute);
  RUN(test_face_motion);
  RUN(test_bubble_anim);
  RUN(test_face_boxes);
  RUN(test_face_boxes_question);
  TEST_END();
}
