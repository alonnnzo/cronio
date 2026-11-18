// Mismos escenarios que packages/simulator/test/approve.test.ts.

#include "test.h"

#include "../source/core/approve.h"

typedef struct {
  char id[VIEW_ID_BYTES];
  int high;
  char owner[64];
  ViewText lines[VIEW_MAX_LINES];
  int count;
} Req;

static Req make_req(const char *id, int high, const char *owner, const char *line) {
  Req r;
  memset(&r, 0, sizeof r);
  strcpy(r.id, id);
  r.high = high;
  strcpy(r.owner, owner);
  strcpy(r.lines[0], line);
  r.count = 1;
  return r;
}

static Req X, Y;

typedef struct {
  Approve a;
  int emitted;
  int send_fails; // 1: el envío falla (no se marca respondida)
  char ids[8][VIEW_ID_BYTES];
} Rig;

static void got(Rig *r, int emitted, const char *id) {
  if (emitted && r->emitted < 8) strcpy(r->ids[r->emitted], id);
  if (emitted) r->emitted++;
  if (emitted && !r->send_fails) approve_decided(&r->a, id); // el envío salió: queda respondida
}

static void r_view(Rig *r, uint64_t now, const Req *q) {
  if (q == NULL) {
    approve_view(&r->a, now, NULL);
    return;
  }
  ApproveRequest ar = {q->id, q->high, q->owner, q->lines, q->count, NULL};
  approve_view(&r->a, now, &ar);
}
static void r_down(Rig *r, uint64_t now, ApproveSource s, int repeat) { approve_down(&r->a, now, s, repeat); }
static void r_up(Rig *r, uint64_t now, ApproveSource s) {
  char id[VIEW_ID_BYTES];
  got(r, approve_up(&r->a, now, s, id), id);
}
static void r_tick(Rig *r, uint64_t now) {
  char id[VIEW_ID_BYTES];
  got(r, approve_tick(&r->a, now, id), id);
}

static void ready(Rig *r, const Req *q, uint64_t at, int connected) {
  memset(r, 0, sizeof *r);
  approve_init(&r->a);
  approve_connection(&r->a, connected);
  r_view(r, at, q);
}

#define KEY APPROVE_SRC_BUTTON
#define PTR APPROVE_SRC_POINTER

static void test_review_scenario(void) {
  Rig r;
  ready(&r, &X, 0, 1);
  r_down(&r, 600, PTR, 0);
  r_tick(&r, 900);
  r_view(&r, 900, &Y); // cambia lo mostrado a mitad del gesto
  r_tick(&r, 1500);
  r_up(&r, 1800, PTR);
  CHECK_EQ_INT(r.emitted, 0);
  // y se puede volver a pulsar sobre Y una vez cumplida su guarda
  r_down(&r, 1000, PTR, 0);
  r_up(&r, 1100, PTR);
  CHECK_EQ_INT(r.emitted, 0); // Y apareció a los 900: aún dentro de la guarda
  r_down(&r, 1400, PTR, 0);
  r_up(&r, 1500, PTR);
  CHECK_EQ_INT(r.emitted, 1);
  CHECK_STR(r.ids[0], "y");

  // lo mismo con el botón físico
  ready(&r, &X, 0, 1);
  r_down(&r, 600, KEY, 0);
  r_view(&r, 900, &Y);
  r_up(&r, 1800, KEY);
  CHECK_EQ_INT(r.emitted, 0);
}

static void test_normal_risk(void) {
  Rig r;
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  CHECK_EQ_INT(r.emitted, 0);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 1);
  CHECK_STR(r.ids[0], "y");
  r_down(&r, 800, KEY, 0);
  r_up(&r, 900, KEY);
  CHECK_EQ_INT(r.emitted, 1); // ya respondida

  // empezar dentro de los 500 ms no aprueba aunque se suelte después
  ready(&r, &Y, 1000, 1);
  r_down(&r, 1300, PTR, 0);
  r_up(&r, 2500, PTR);
  CHECK_EQ_INT(r.emitted, 0);

  // justo a los 500 ms sí cuenta
  ready(&r, &Y, 1000, 1);
  r_down(&r, 1500, PTR, 0);
  r_up(&r, 1520, PTR);
  CHECK_EQ_INT(r.emitted, 1);
  ready(&r, &Y, 1000, 1);
  r_down(&r, 1499, PTR, 0);
  r_up(&r, 1520, PTR);
  CHECK_EQ_INT(r.emitted, 0);

  // mantener la tecla en la guarda y seguir con repeticiones no reinicia ni aprueba
  ready(&r, &Y, 0, 1);
  r_down(&r, 300, KEY, 0);
  r_down(&r, 700, KEY, 1);
  r_down(&r, 800, KEY, 1);
  r_up(&r, 900, KEY);
  CHECK_EQ_INT(r.emitted, 0);

  // cambiar de solicitud con el botón pulsado anula el gesto
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  Req z = Y;
  strcpy(z.id, "z");
  r_view(&r, 650, &z);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 0);

  // si la solicitud desaparece durante el gesto no se aprueba
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  r_view(&r, 650, NULL);
  r_view(&r, 660, &Y);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 0);

  // una vista repetida con lo mismo no reinicia la guarda ni anula el gesto
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  Req same = Y;
  r_view(&r, 650, &same);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 1);
}

static void test_high_risk(void) {
  Rig r;
  // soltar antes de 1 s no aprueba
  ready(&r, &X, 0, 1);
  r_down(&r, 600, KEY, 0);
  r_tick(&r, 1200);
  {
    float p = approve_hold_progress(&r.a, 1200);
    CHECK(p > 0.59f && p < 0.61f);
  }
  r_up(&r, 1500, KEY);
  CHECK_EQ_INT(r.emitted, 0);
  CHECK(approve_hold_progress(&r.a, 1500) == 0.0f);

  // completar 1 s aprueba una vez, sin esperar a soltar
  ready(&r, &X, 0, 1);
  r_down(&r, 600, PTR, 0);
  r_tick(&r, 600 + APPROVE_HOLD_MS - 1);
  CHECK_EQ_INT(r.emitted, 0);
  r_tick(&r, 600 + APPROVE_HOLD_MS);
  CHECK_EQ_INT(r.emitted, 1);
  CHECK_STR(r.ids[0], "x");
  r_tick(&r, 5000);
  r_up(&r, 5100, PTR);
  CHECK_EQ_INT(r.emitted, 1);
  CHECK(approve_hold_progress(&r.a, 5000) == 0.0f);

  // cambio de id a mitad de la retención la cancela aunque se siga pulsando
  ready(&r, &X, 0, 1);
  r_down(&r, 600, KEY, 0);
  r_tick(&r, 1000);
  Req x2 = X;
  strcpy(x2.id, "x2");
  r_view(&r, 1100, &x2);
  r_tick(&r, 3000);
  CHECK_EQ_INT(r.emitted, 0);
  CHECK(approve_hold_progress(&r.a, 3000) == 0.0f);
  r_up(&r, 3100, KEY);
  CHECK_EQ_INT(r.emitted, 0);

  // cambia el dueño o las líneas con el mismo id: es otra solicitud y cancela el gesto
  for (int which = 0; which < 2; which++) {
    Req changed = X;
    if (which == 0) strcpy(changed.owner, "Claude · otro");
    else strcpy(changed.lines[0], "rm -rf b");
    ready(&r, &X, 0, 1);
    r_down(&r, 600, KEY, 0);
    r_view(&r, 700, &changed);
    r_tick(&r, 2000);
    CHECK_EQ_INT(r.emitted, 0);
    // la guarda de 500 ms se reinició
    r_up(&r, 2100, KEY);
    r_down(&r, 900, KEY, 0);
    CHECK(!approve_ready(&r.a, 900));
    CHECK(approve_ready(&r.a, 1200));
  }

  // empezar dentro de la guarda no acumula retención
  ready(&r, &X, 0, 1);
  r_down(&r, 100, KEY, 0);
  r_tick(&r, 2000);
  CHECK_EQ_INT(r.emitted, 0);

  // cancel (el lápiz salió del botón o se perdió el foco) reinicia la retención
  ready(&r, &X, 0, 1);
  r_down(&r, 600, PTR, 0);
  approve_cancel(&r.a);
  r_tick(&r, 3000);
  CHECK_EQ_INT(r.emitted, 0);
}

static void test_connection_and_other_paths(void) {
  Rig r;
  // sin conexión no se emite
  ready(&r, &Y, 0, 0);
  r_down(&r, 600, KEY, 0);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 0);
  CHECK(!approve_ready(&r.a, 700));

  // perder la conexión durante el gesto lo anula
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  approve_connection(&r.a, 0);
  approve_connection(&r.a, 1);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 0);

  // rechazar (decided) impide aprobar después la misma solicitud
  ready(&r, &Y, 0, 1);
  approve_decided(&r.a, "y");
  r_down(&r, 700, KEY, 0);
  r_up(&r, 800, KEY);
  CHECK_EQ_INT(r.emitted, 0);
  CHECK(!approve_ready(&r.a, 800));

  // soltar otra fuente no termina el gesto
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  r_up(&r, 650, PTR);
  CHECK_EQ_INT(r.emitted, 0);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 1);

  // approve_ready respeta la guarda de 500 ms y la llave distingue id, riesgo, dueño y líneas
  ready(&r, &Y, 1000, 1);
  CHECK(!approve_ready(&r.a, 1499));
  CHECK(approve_ready(&r.a, 1500));
  Req v[5];
  for (int i = 0; i < 5; i++) v[i] = Y;
  strcpy(v[1].id, "q");
  v[2].high = 1;
  strcpy(v[3].owner, "o");
  strcpy(v[4].lines[0], "l");
  uint8_t keys[5][32];
  for (int i = 0; i < 5; i++) {
    ApproveRequest ar = {v[i].id, v[i].high, v[i].owner, v[i].lines, v[i].count, NULL};
    approve_request_key(&ar, keys[i]);
  }
  for (int i = 0; i < 5; i++) {
    for (int j = i + 1; j < 5; j++) CHECK(memcmp(keys[i], keys[j], 32) != 0);
  }
  Req same = Y;
  ApproveRequest ar = {same.id, same.high, same.owner, same.lines, same.count, NULL};
  uint8_t again[32];
  approve_request_key(&ar, again);
  CHECK_MEM(again, keys[0], 32);
}

// Una decisión que no salió no deja la tarjeta bloqueada: tras reconectar, el mismo X se puede aprobar de nuevo.
static void test_lost_decision_does_not_lock(void) {
  Rig r;
  ready(&r, &Y, 0, 1);
  r.send_fails = 1;
  r_down(&r, 600, KEY, 0);
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 1); // se pidió aprobar, pero el envío falló: no se marcó respondida
  CHECK(!approve_is_decided(&r.a, "y"));
  // cae la sesión, se limpia y se vuelve a ver la misma tarjeta
  approve_reset(&r.a);
  CHECK(!r.a.connected && !r.a.has_decided && !r.a.has_shown && !r.a.has_gesture);
  approve_connection(&r.a, 1);
  r_view(&r, 5000, &Y);
  r.send_fails = 0;
  r_down(&r, 5100, KEY, 0);
  r_up(&r, 5200, KEY);
  CHECK_EQ_INT(r.emitted, 1); // la guarda de 500 ms cuenta desde que se vuelve a ver la tarjeta
  CHECK(!approve_ready(&r.a, 5400));
  r_down(&r, 5500, KEY, 0);
  r_up(&r, 5600, KEY);
  CHECK_EQ_INT(r.emitted, 2);
  CHECK(approve_is_decided(&r.a, "y"));
  // con el envío correcto, repetir sobre la misma solicitud no sale
  r_down(&r, 5700, KEY, 0);
  r_up(&r, 5800, KEY);
  CHECK_EQ_INT(r.emitted, 2);
  CHECK(!approve_ready(&r.a, 5800));

  // riesgo alto: la retención completa emite una vez; si el envío falla, se puede repetir tras reiniciar
  ready(&r, &X, 0, 1);
  r.send_fails = 1;
  r_down(&r, 600, PTR, 0);
  r_tick(&r, 600 + APPROVE_HOLD_MS);
  CHECK_EQ_INT(r.emitted, 1);
  CHECK(!approve_is_decided(&r.a, "x"));
  approve_reset(&r.a);
  approve_connection(&r.a, 1);
  r_view(&r, 9000, &X);
  r.send_fails = 0;
  r_down(&r, 9600, PTR, 0);
  r_tick(&r, 9600 + APPROVE_HOLD_MS);
  CHECK_EQ_INT(r.emitted, 2);
  CHECK(approve_is_decided(&r.a, "x"));
}

static void test_cancel_by_source(void) {
  Rig r;
  ready(&r, &Y, 0, 1);
  r_down(&r, 600, KEY, 0);
  approve_cancel_source(&r.a, PTR); // el lápiz no es dueño de este gesto
  r_up(&r, 700, KEY);
  CHECK_EQ_INT(r.emitted, 1);

  ready(&r, &Y, 0, 1);
  r_down(&r, 600, PTR, 0);
  approve_cancel_source(&r.a, KEY);
  r_up(&r, 700, PTR);
  CHECK_EQ_INT(r.emitted, 1);

  ready(&r, &Y, 0, 1);
  r_down(&r, 600, PTR, 0);
  approve_cancel_source(&r.a, PTR); // sí es suyo
  r_up(&r, 700, PTR);
  CHECK_EQ_INT(r.emitted, 0);
}

static void test_key_has_no_ambiguity(void) {
  // el reparto en líneas y entre dueño y líneas cambia la llave aunque el texto concatenado sea el mismo
  Req a = make_req("i", 0, "", "ab"), b = make_req("i", 0, "", "a");
  strcpy(a.lines[1], "c");
  a.count = 2;
  strcpy(b.lines[1], "bc");
  b.count = 2;
  uint8_t ka[32], kb[32];
  ApproveRequest ra = {a.id, a.high, a.owner, a.lines, a.count, NULL}, rb = {b.id, b.high, b.owner, b.lines, b.count, NULL};
  approve_request_key(&ra, ka);
  approve_request_key(&rb, kb);
  CHECK(memcmp(ka, kb, 32) != 0);
  Req c = make_req("i", 0, "x", "y"), d = make_req("i", 0, "", "x");
  strcpy(d.lines[1], "y");
  d.count = 2;
  ApproveRequest rc = {c.id, c.high, c.owner, c.lines, c.count, NULL}, rd = {d.id, d.high, d.owner, d.lines, d.count, NULL};
  approve_request_key(&rc, ka);
  approve_request_key(&rd, kb);
  CHECK(memcmp(ka, kb, 32) != 0);
  // owner NULL equivale a ""
  ApproveRequest rn = {d.id, d.high, NULL, d.lines, d.count, NULL};
  approve_request_key(&rn, ka);
  approve_request_key(&rd, kb);
  CHECK_MEM(ka, kb, 32);
}

// ---- "sí, no volver a preguntar": el mismo gesto con la bandera always ----

static ViewText ALW = "Bash(ls)";

static void a_view(Rig *r, uint64_t now, const Req *q, const char *always) {
  ApproveRequest ar = {q->id, q->high, q->owner, q->lines, q->count, always};
  approve_view(&r->a, now, &ar);
}
static int a_up(Rig *r, uint64_t now, ApproveSource s, int always, int *flag) {
  char id[VIEW_ID_BYTES];
  int e = always ? approve_up_always(&r->a, now, s, id) : approve_up(&r->a, now, s, id);
  if (e) *flag = approve_emitted_always(&r->a);
  got(r, e, id);
  return e;
}
static void a_rig(Rig *r) {
  memset(r, 0, sizeof *r);
  approve_init(&r->a);
  approve_connection(&r->a, 1);
}

static void test_always_normal_risk(void) {
  Rig r;
  int flag = -1;
  a_rig(&r);
  a_view(&r, 0, &Y, ALW);
  approve_down_always(&r.a, 600, KEY, 0);
  CHECK(approve_gesture_is_always(&r.a));
  CHECK_EQ_INT(a_up(&r, 700, KEY, 1, &flag), 1);
  CHECK_EQ_INT(flag, 1);
  CHECK_STR(r.ids[0], "y");
  // ya respondida: ni siempre ni aprobar la repiten
  approve_down_always(&r.a, 800, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 900, KEY, 1, &flag), 0);
  approve_down(&r.a, 1000, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 1100, KEY, 0, &flag), 0);
  CHECK_EQ_INT(r.emitted, 1);
}

static void test_always_guard_and_offer(void) {
  Rig r;
  int flag;
  char id[VIEW_ID_BYTES];
  // dentro de la guarda de 500 ms no emite
  a_rig(&r);
  a_view(&r, 0, &Y, ALW);
  approve_down_always(&r.a, 400, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 450, KEY, 1, &flag), 0);
  // una tarjeta que no la ofrece no la acepta aunque se pulse (ni en riesgo alto con retención)
  a_view(&r, 1000, &X, NULL);
  approve_down_always(&r.a, 2000, KEY, 0);
  CHECK_EQ_INT(approve_tick(&r.a, 4000, id), 0);
  CHECK_EQ_INT(a_up(&r, 4100, KEY, 1, &flag), 0);
  CHECK_EQ_INT(r.emitted, 0);
  // sin conexión tampoco
  a_view(&r, 5000, &Y, ALW);
  approve_connection(&r.a, 0);
  approve_down_always(&r.a, 6000, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 6100, KEY, 1, &flag), 0);
}

static void test_always_high_risk_hold(void) {
  Rig r;
  int flag = -1;
  char id[VIEW_ID_BYTES];
  a_rig(&r);
  a_view(&r, 0, &X, ALW);
  // soltar antes de 1 s no aprueba
  approve_down_always(&r.a, 600, KEY, 0);
  CHECK(approve_hold_progress(&r.a, 1100) > 0.4f);
  CHECK_EQ_INT(approve_tick(&r.a, 1100, id), 0);
  CHECK_EQ_INT(a_up(&r, 1200, KEY, 1, &flag), 0);
  // completar la retención aprueba una sola vez, con la bandera
  approve_down_always(&r.a, 2000, KEY, 0);
  CHECK_EQ_INT(approve_tick(&r.a, 2999, id), 0);
  CHECK_EQ_INT(approve_tick(&r.a, 3000, id), 1);
  CHECK_STR(id, "x");
  CHECK_EQ_INT(approve_emitted_always(&r.a), 1);
  approve_decided(&r.a, id);
  CHECK_EQ_INT(a_up(&r, 3100, KEY, 1, &flag), 0);
  // un gesto de aprobar normal deja la bandera en 0
  a_view(&r, 4000, &Y, ALW);
  approve_down(&r.a, 5000, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 5100, KEY, 0, &flag), 1);
  CHECK_EQ_INT(flag, 0);
}

static void test_always_other_button_does_not_end_gesture(void) {
  Rig r;
  int flag = -1;
  a_rig(&r);
  a_view(&r, 0, &Y, ALW);
  approve_down(&r.a, 600, KEY, 0);        // A abajo
  approve_down_always(&r.a, 610, KEY, 0); // Y mientras tanto: ignorada
  CHECK_EQ_INT(a_up(&r, 650, KEY, 1, &flag), 0); // soltar Y no termina el gesto de A
  CHECK_EQ_INT(a_up(&r, 700, KEY, 0, &flag), 1);
  CHECK_EQ_INT(flag, 0);
  CHECK_EQ_INT(r.emitted, 1);
  // al revés: Y abajo, soltar A no emite y el gesto de Y sigue
  Req z = make_req("z", 0, "Claude · tres", "pwd");
  a_view(&r, 1100, &z, ALW);
  approve_down_always(&r.a, 1700, KEY, 0);
  CHECK_EQ_INT(a_up(&r, 1750, KEY, 0, &flag), 0);
  CHECK_EQ_INT(a_up(&r, 1800, KEY, 1, &flag), 1);
  CHECK_EQ_INT(flag, 1);
}

static void test_always_changed_request_cancels(void) {
  Rig r;
  int flag;
  a_rig(&r);
  a_view(&r, 0, &Y, ALW);
  // cambia la etiqueta (misma solicitud, otra cosa que quedaría permitida): es "otra tarjeta"
  approve_down_always(&r.a, 600, KEY, 0);
  a_view(&r, 650, &Y, "Bash(rm -rf x)");
  CHECK_EQ_INT(a_up(&r, 700, KEY, 1, &flag), 0);
  // la tarjeta deja de ofrecer siempre a mitad del gesto
  a_view(&r, 1000, &Y, ALW);
  approve_down_always(&r.a, 1600, KEY, 0);
  a_view(&r, 1650, &Y, NULL);
  CHECK_EQ_INT(a_up(&r, 1700, KEY, 1, &flag), 0);
  // otra solicitud
  a_view(&r, 2000, &Y, ALW);
  approve_down_always(&r.a, 2600, KEY, 0);
  a_view(&r, 2650, &X, ALW);
  CHECK_EQ_INT(a_up(&r, 2700, KEY, 1, &flag), 0);
  CHECK_EQ_INT(r.emitted, 0);
}

static void test_always_key_differs_by_label(void) {
  // la etiqueta entra en la identidad de lo mostrado
  uint8_t k1[SHA256_DIGEST_LEN], k2[SHA256_DIGEST_LEN], k3[SHA256_DIGEST_LEN];
  ApproveRequest a = {Y.id, Y.high, Y.owner, Y.lines, Y.count, NULL};
  ApproveRequest b = {Y.id, Y.high, Y.owner, Y.lines, Y.count, "Bash(ls)"};
  ApproveRequest c = {Y.id, Y.high, Y.owner, Y.lines, Y.count, "Bash(pwd)"};
  approve_request_key(&a, k1);
  approve_request_key(&b, k2);
  approve_request_key(&c, k3);
  CHECK(memcmp(k1, k2, sizeof k1) != 0);
  CHECK(memcmp(k2, k3, sizeof k2) != 0);
}

static void test_time_going_backwards(void) {
  // un reloj que retrocede no debe aprobar por envolver la resta
  Rig r;
  ready(&r, &Y, 5000, 1);
  r_down(&r, 100, KEY, 0);
  r_up(&r, 200, KEY);
  CHECK_EQ_INT(r.emitted, 0);
  CHECK(!approve_ready(&r.a, 100));
}

int main(void) {
  TEST_BEGIN("approve: gesto de aprobar (mismos escenarios que approve.test.ts)");
  X = make_req("x", 1, "Claude · uno", "rm -rf a");
  Y = make_req("y", 0, "Claude · dos", "ls");
  RUN(test_review_scenario);
  RUN(test_normal_risk);
  RUN(test_high_risk);
  RUN(test_connection_and_other_paths);
  RUN(test_lost_decision_does_not_lock);
  RUN(test_cancel_by_source);
  RUN(test_key_has_no_ambiguity);
  RUN(test_always_normal_risk);
  RUN(test_always_guard_and_offer);
  RUN(test_always_high_risk_hold);
  RUN(test_always_other_button_does_not_end_gesture);
  RUN(test_always_changed_request_cancels);
  RUN(test_always_key_differs_by_label);
  RUN(test_time_going_backwards);
  TEST_END();
}
