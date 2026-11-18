#include "app.h"

#include <3ds.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "core/approve.h"
#include "core/handshake.h"
#include "core/nav.h"
#include "core/session.h"
#include "diag_state.h"
#include "led.h"
#include "logic/chime.h"
#include "logic/diag.h"
#include "logic/intro.h"
#include "logic/input_logic.h"
#include "logic/layout.h"
#include "logic/netplan.h"
#include "logic/palette.h"
#include "logic/stereo.h"
#include "logic/pause.h"
#include "logic/rng_mix.h"
#include "logic/theme.h"
#include "logic/utf8util.h"
#include "net.h"
#include "pairing.h"
#include "render_bottom.h"
#include "render_diag.h"
#include "render_guide.h"
#include "render_intro.h"
#include "render_menu.h"
#include "render_instruct.h"
#include "render_question.h"
#include "render_reader.h"
#include "render_top.h"
#include "render_update.h"
#include "sound.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"
#include "updater.h"

#define NOTICE_MS 6000

// La versión de la app sale del Makefile (APP_VERSION := 0.2.0, pasada con -DAPP_VERSION). Sin ella (otro sistema de compilación) no hay versión que comparar.
#ifndef APP_VERSION
#define APP_VERSION "0.0.0"
#endif
// Título de esta app (UniqueId 0xF7A3C de cia/agent-companion.rsf): para reiniciarla tras actualizarse si APT no dice el suyo.
#define APP_TITLE_ID 0x000400000F7A3C00ULL
#define RECV_ROUNDS 8

// ---------- estado ----------

static struct {
  Config cfg;
  uint8_t key[HS_KEY_LEN]; // clave activa: la guardada o la recién derivada de un código
  int have_key;
  int pending_pair;        // la clave activa es nueva y todavía no se guardó (solo tras un welcome)
  int auth_error;          // el puente rechazó la clave: no se reintenta hasta que el usuario actúe
  int auth_was_pairing;
  char notice[72];
  uint64_t notice_until;

  Net net;
  Session session;        // 37 KB: estático, no en la pila
  int session_active;
  int ready_seen;
  int unsaved;             // READY sin guardar todavía: se guarda con la primera vista válida
  uint32_t seen_seq;
  uint64_t last_rx, last_ping;

  InputLogic in;           // navegación, gestos de aprobar y rechazar, lápiz, L+R (logic/input_logic.c)
  int quit;
  char card_owner[VIEW_TEXT_BYTES + 16];
  uint64_t request_deadline;
  int scroll;
  BottomLayout layout;

  int ps_ok;
  uint32_t rng_counter;
  uint64_t start_ms;
  uint64_t view_at;      // reloj de la consola cuando llegó la última vista (para el tiempo en el estado actual de cada sesión)
  PauseClock clock;        // reloj virtual: las pausas del bucle (teclado del sistema, HOME) no se ven
  aptHookCookie apt_cookie;
  volatile int wake_pending; // lo levanta el callback de aptHook al despertar del reposo

  UpdaterStatus up;        // progreso de la descarga e instalación de una actualización (updater.c)

  ChimeGate chime_gate;    // cuándo suena un `chime` de la vista (logic/chime.c)
  FaceView status_face;
  char sbuf[STATUS_MAX_LINES + STATUS_MAX_HINTS][96];
} A;

// ---------- utilidades ----------

// Lectura del reloj virtual: después del teclado del sistema, del menú HOME o del reposo el tiempo no salta.
static uint64_t tick(void) { return pause_step(&A.clock, osGetTime()); }

// Callback de aptHook (corre en el hilo principal, dentro de aptMainLoop): solo cuenta y levanta una bandera que
// consume el bucle; no toca sockets ni estado de la sesión.
static void apt_event(APT_HookType hook, void *param) {
  (void)param;
  if (hook == APTHOOK_ONSLEEP) {
    g_diag.apt_sleeps++;
  } else if (hook == APTHOOK_ONWAKEUP) {
    g_diag.apt_wakes++;
    A.wake_pending = 1;
  }
}

static void set_notice(const char *text, uint64_t now) {
  snprintf(A.notice, sizeof A.notice, "%s", text);
  A.notice_until = now + NOTICE_MS;
}

// Tema claro u oscuro: preferencia local de la consola (no pasa por el puente). Se aplica al instante y se guarda en config.ini.
static void set_theme(int dark, uint64_t now) {
  dark = dark != 0;
  pal_set_dark(dark);
  if (A.cfg.dark == dark) return;
  A.cfg.dark = dark;
  if (config_save(&A.cfg) != 0) set_notice("No se pudo guardar el tema en la tarjeta SD", now);
}

// Azar: el servicio ps del sistema; si no abre, SHA-256 de (ciclos, hora, device_id, contador).
static void random_bytes(uint8_t *out, size_t n) {
  if (A.ps_ok && R_SUCCEEDED(PS_GenerateRandomBytes(out, n))) return;
  uint8_t h[32];
  rng_mix(svcGetSystemTick(), osGetTime(), A.cfg.device_id, A.rng_counter++, h);
  memcpy(out, h, n > sizeof h ? sizeof h : n);
}

static const View *live_view(void) {
  if (!A.session_active || A.session.state != SESSION_READY) return NULL;
  return session_view(&A.session);
}

static void load_saved_key(void) {
  A.have_key = config_has_key(&A.cfg) && hex_decode(A.cfg.key_hex, 64, A.key, HS_KEY_LEN) == 0;
}

static void sync_net_flags(void) { net_set_allow_connect(&A.net, A.have_key && !A.auth_error); }

// ---------- sesión ----------

static int session_ready(void) { return A.session_active && A.session.state == SESSION_READY; }

static void execute(const InputActions *acts, uint64_t *now);

static void end_session(const char *cause, uint64_t now) {
  diag_close(&g_diag, cause, now);
  A.session_active = 0;
  A.ready_seen = 0;
  A.unsaved = 0;
  input_session_end(&A.in); // el gesto y lo respondido se limpian: una conexión nueva empieza de cero
  A.card_owner[0] = '\0';
  chime_gate_reset(&A.chime_gate); // la conexión siguiente vuelve a tomar su punto de partida sin sonar
}

static void start_session(uint64_t now) {
  uint8_t nonce[HS_NONCE_LEN];
  random_bytes(nonce, sizeof nonce);
  session_init(&A.session, A.cfg.device_id, A.key, nonce);
  session_set_app(&A.session, APP_VERSION, envIsHomebrew() ? 0 : 1); // el puente avisa si hay una versión nueva
  Transport t = {net_transport_send, &A.net};
  session_on_connected(&A.session, t);
  A.session_active = 1;
  chime_gate_reset(&A.chime_gate);
  A.ready_seen = 0;
  A.seen_seq = session_view_seq(&A.session);
  A.last_rx = now;
  A.last_ping = now;
}

// La sesión falló (error de protocolo, de autenticación o al enviar): se cierra el socket y se decide qué sigue.
// Un fallo de autenticación no detiene los reintentos por sí solo (puede ser un impostor en la red): la política de
// logic/netplan.c lo cuenta por host y solo da por mala la clave cuando responde la IP guardada o se agotan los intentos.
static void on_session_failure(uint64_t now) {
  SessionError e = A.session.error;
  int is_auth = e == SESSION_ERR_AUTH;
  char reason[56];
  if (is_auth) {
    snprintf(reason, sizeof reason, "%s no autenticó (%d)", A.net.target_host, netplan_auth_fails(&A.net.plan, A.net.target_host) + 1);
  } else {
    snprintf(reason, sizeof reason, "Error de protocolo: %s", session_error_name(e));
  }
  int was_pairing = A.pending_pair;
  end_session(session_error_name(e), now);
  NpFailVerdict v = net_session_failed(&A.net, is_auth, was_pairing, reason, now);
  if (is_auth && v.action == NP_FAIL_AUTH_STOP) {
    A.auth_error = 1;
    A.auth_was_pairing = was_pairing;
    if (v.discard_pairing) {
      A.pending_pair = 0;
      load_saved_key(); // el código nuevo no sirvió: la clave guardada sigue intacta y se vuelve a ella, si la hay
    }
    sync_net_flags();
  }
}

// Cualquier recepción o envío puede dejar la sesión en FAILED: se cierra y se reconecta de inmediato.
static void check_session_failed(uint64_t now) {
  if (A.session_active && input_session_failed(&A.session)) on_session_failure(now);
}

// Primera vez en READY: reinicia los reintentos. Lo aprendido (clave, IP y puerto) se guarda en la SD recién con la
// primera vista válida (on_first_view): un servidor que solo sabe saludar no cambia la configuración.
static void on_ready(uint64_t now) {
  A.ready_seen = 1;
  A.unsaved = 1;
  net_mark_ready(&A.net);
  A.auth_error = 0;
  InputActions acts;
  input_session_ready(&A.in, &acts); // el puente nuevo no sabe qué detalle teníamos abierto
  execute(&acts, &now);
}

// Primera vista válida tras READY (trama sellada correcta): ahora sí se guarda la clave nueva, la IP y el puerto.
static void on_first_view(uint64_t now) {
  A.unsaved = 0;
  int changed = 0;
  if (A.pending_pair) {
    hex_encode(A.key, HS_KEY_LEN, A.cfg.key_hex);
    A.pending_pair = 0;
    changed = 1;
  }
  if (strcmp(A.cfg.host, A.net.target_host) != 0) {
    snprintf(A.cfg.host, sizeof A.cfg.host, "%s", A.net.target_host);
    changed = 1;
  }
  if (A.cfg.port != A.net.target_port) {
    A.cfg.port = A.net.target_port;
    changed = 1;
  }
  if (changed && config_save(&A.cfg) != 0) set_notice("No se pudo guardar en la tarjeta SD", now);
  net_confirm_saved(&A.net);
}

// Vista nueva: navegación, gesto de aprobar y el focus que pida la navegación.
static void on_new_view(const View *v, uint64_t now) {
  A.view_at = now;
  diag_rev(&g_diag, v->rev);
  // sonido: una vez por `seq` nuevo del aviso (el primero tras conectar es el punto de partida); el ajuste manda
  int sound_on = sound_ready() && (!v->has_settings || v->settings.sound);
  int chime = chime_gate_step(&A.chime_gate, v->has_chime, v->chime.kind, v->chime.seq, sound_on, now);
  if (chime >= 0) sound_play((ChimeKind)chime);
  if (A.unsaved) on_first_view(now);
  theme_card_owner(v, A.card_owner, sizeof A.card_owner);
  if (v->has_request) A.request_deadline = now + (uint64_t)v->request.expires_in_s * 1000u; // con 0 no se usa (sin límite)
  InputActions acts;
  input_view_changed(&A.in, v, A.card_owner, now, &acts);
  execute(&acts, &now);
}

static void receive_all(uint64_t now) {
  static uint8_t buf[4096];
  for (int i = 0; i < RECV_ROUNDS && A.session_active; i++) {
    int n = net_recv(&A.net, buf, sizeof buf, now);
    if (n < 0) { // el socket se cerró: net ya pasó a WAITING
      end_session(A.net.reason[0] ? A.net.reason : "socket cerrado", now);
      return;
    }
    if (n == 0) break;
    A.last_rx = now;
    if (session_on_data(&A.session, buf, (size_t)n) < 0) {
      on_session_failure(now);
      return;
    }
    if (!A.ready_seen && A.session.state == SESSION_READY) on_ready(now);
  }
  check_session_failed(now);
}

static void service_view_and_timers(uint64_t now) {
  if (!A.session_active) return;
  if (netplan_rx_timed_out(A.last_rx, now)) {
    end_session("sin respuesta (15 s)", now);
    net_session_failed(&A.net, 0, A.pending_pair, "El puente dejó de responder", now);
    return;
  }
  const View *v = live_view();
  if (v != NULL) {
    uint32_t seq = session_view_seq(&A.session);
    if (seq != A.seen_seq) {
      A.seen_seq = seq;
      on_new_view(v, now);
      if (!A.session_active) return;
    }
  }
  if (A.session.state == SESSION_READY && netplan_ping_due(A.last_ping, now)) {
    A.last_ping = now;
    session_send_ping(&A.session);
    check_session_failed(now);
    if (!A.session_active) return;
  }
  if (reader_active(&A.in.reader)) { // la respuesta a read pasa el lector de "Cargando..." a mostrar el texto
    reader_on_doc(&A.in.reader, session_reading(&A.session), session_read_seq(&A.session));
  }
  InputActions acts; // plazo del detalle sin confirmar y retención de riesgo alto
  input_tick(&A.in, live_view(), now, &acts);
  execute(&acts, &now);
}

// ---------- reposo ----------

// Despertó del reposo: se cierra la sesión y la red recrea los sockets (sin reiniciar soc) y reconecta.
static void on_wake(uint64_t now) {
  if (A.session_active) end_session("reposo", now);
  net_wake(&A.net, now);
}

// ---------- acciones ----------

static void restart_connection(uint64_t now) {
  if (A.session_active) end_session("reintento manual", now);
  A.auth_error = 0;
  net_release(&A.net);
  sync_net_flags();
  net_kick(&A.net, now);
}

static void do_pair_code(uint64_t *now) {
  uint8_t key[HS_KEY_LEN];
  PromptResult r = pairing_prompt_code(A.cfg.device_id, key);
  *now = tick();
  if (r == PROMPT_OK) {
    memcpy(A.key, key, sizeof A.key);
    A.have_key = 1;
    A.pending_pair = 1;
    A.notice[0] = '\0';
    restart_connection(*now);
  } else if (r == PROMPT_INVALID) {
    set_notice("Código inválido: son 16 letras y números", *now);
  }
  memset(key, 0, sizeof key);
}

static void do_manual_ip(uint64_t *now) {
  char host[CONFIG_HOST_BYTES];
  NpBeacon nb;
  const char *current = A.net.plan.saved_host[0] ? A.net.plan.saved_host : netplan_best_beacon(&A.net.plan, *now, &nb) ? nb.host : "";
  PromptResult r = pairing_prompt_ip(current, host);
  *now = tick();
  if (r == PROMPT_OK) {
    net_set_manual(&A.net, host, config_port_or_default(&A.cfg)); // la IP escrita a mano manda sobre los avisos
    A.notice[0] = '\0';
    restart_connection(*now);
  } else if (r == PROMPT_INVALID) {
    set_notice("IP no válida: usa el formato 192.168.0.10", *now);
  }
}

// Tras el teclado del sistema (que congela la app): si el puente cortó la conexión por silencio, el texto no tiene a dónde ir y se
// perdería sin que nadie lo notara. Se atiende el socket (así se ve el corte) y, si la sesión ya no está lista, se avisa. Devuelve 1 si se puede enviar.
static int can_send_after_keyboard(uint64_t *now) {
  receive_all(*now);
  if (session_ready()) return 1;
  set_notice("Se cortó la conexión: vuelve a escribirlo", *now);
  return 0;
}

// "Otra…" de una pregunta: el teclado del sistema congela la app (no se dibuja ni se contesta al puente), así que antes se avisa con
// `hold` para que el puente no corte la conexión por silencio. Lo escrito es la respuesta de esa pregunta; si era la última, se envían todas.
static void do_question_other(uint64_t *now) {
  if (!session_ready()) return;
  session_send_hold(&A.session, 300);
  check_session_failed(*now);
  if (!A.session_active) return;
  static char text[MSG_OTHER_BYTES];
  int ok = pairing_prompt_text("Tu respuesta (hasta 200 caracteres)", text, sizeof text);
  *now = tick(); // el reloj virtual no cuenta lo que tardó el teclado
  if (!can_send_after_keyboard(now)) {
    memset(text, 0, sizeof text);
    return;
  }
  InputActions acts;
  input_question_text(&A.in, live_view(), *now, ok ? text : NULL, &acts);
  execute(&acts, now);
  memset(text, 0, sizeof text);
}

// Instrucción para una sesión (paso 6): el teclado del sistema congela la app, así que antes se avisa con `hold`. Lo escrito se limpia y
// se manda a la sesión (para su próximo fin de turno o, si espera en una tarjeta, en el acto).
static void do_instruct_write(const char *session_id, uint64_t *now) {
  if (!session_ready() || session_id == NULL || session_id[0] == '\0') return;
  char sid[VIEW_ID_BYTES];
  snprintf(sid, sizeof sid, "%s", session_id); // la acción puede cambiar mientras el teclado está abierto
  session_send_hold(&A.session, 300);
  check_session_failed(*now);
  if (!A.session_active) return;
  static char text[MSG_INSTRUCT_BYTES];
  int ok = pairing_prompt_long_text("Instrucci\xC3\xB3n para la sesi\xC3\xB3n (hasta 400 caracteres)", MSG_INSTRUCT_MAX_CHARS, "Enviar", text, sizeof text);
  *now = tick(); // el reloj virtual no cuenta lo que tardó el teclado
  if (!can_send_after_keyboard(now)) {
    memset(text, 0, sizeof text);
    return;
  }
  InputActions acts;
  input_instruct_text(&A.in, live_view(), sid, ok ? text : NULL, &acts);
  execute(&acts, now);
  memset(text, 0, sizeof text);
}

// ---------- actualizar la app ----------

// Terminó (bien o mal) la instalación y se vuelve a la app de siempre: lo que no se habló con el puente durante la descarga no es un silencio.
static void resume_after_update(uint64_t now) {
  A.last_rx = now;
  A.last_ping = now;
}

// El título de esta app: el que dice APT, y si no, el de cia/agent-companion.rsf.
static u64 own_title_id(void) {
  u64 id = 0;
  if (R_FAILED(APT_GetProgramID(&id)) || id == 0) id = APP_TITLE_ID;
  return id;
}

// «A: Actualizar»: la app no habla con el puente mientras instala (y no dibuja ni contesta pings), así que antes se avisa con `hold` para que no
// corte la conexión por silencio, como con el teclado del sistema. Después empieza la descarga; si ni eso se puede, es un error.
static void do_update_start(uint64_t *now) {
  Update *u = &A.in.update;
  if (session_ready()) {
    session_send_hold(&A.session, 300);
    check_session_failed(*now);
  }
  char url[VIEW_UPDATE_URL_MAX + 1];
  snprintf(url, sizeof url, "%s", u->url);
  // la descarga solo vale del PC con el que se habla (A.net.target_host), con el tamaño y el SHA-256 que anunció la vista
  if (updater_start(url, A.net.target_host, u->offer_size, u->offer_sha, *now, &A.up) != 0) {
    update_fail(u, A.up.error, *now);
    resume_after_update(*now);
  }
}

// Reinicia la app al salir: con aptSetChainloader a su propio título (en la SD) la consola abre la versión nueva en cuanto este proceso termina.
// 1 si quedó configurado (el programa se cierra solo); 0 si no se puede (.3dsx desde el Homebrew Launcher): entonces el texto pide cerrar y abrir Cronio.
static int prepare_restart(void) {
  if (envIsHomebrew()) return 0;
  aptSetChainloader(own_title_id(), MEDIATYPE_SD);
  return 1;
}

// Ejecuta lo que pidió la lógica de entradas. Los envíos informan su resultado (una decisión solo queda respondida
// si salió) y, si la sesión quedó fallida, se cierra de inmediato; el resto de las acciones de ese envío se omite.
static void execute(const InputActions *acts, uint64_t *now) {
  for (int i = 0; i < acts->n; i++) {
    const InputAction *a = &acts->a[i];
    int on_session = a->kind == IN_ACT_DECISION || a->kind == IN_ACT_FOCUS || a->kind == IN_ACT_UNFOCUS ||
                     a->kind == IN_ACT_SKIP || a->kind == IN_ACT_MODE || a->kind == IN_ACT_READ ||
                     a->kind == IN_ACT_SETTING_NOTIFY || a->kind == IN_ACT_SETTING_ACK || a->kind == IN_ACT_SETTING_HIDDEN ||
                     a->kind == IN_ACT_SETTING_SOUND || a->kind == IN_ACT_SETTING_QUESTIONS || a->kind == IN_ACT_SETTING_READER || a->kind == IN_ACT_ANSWER ||
                     a->kind == IN_ACT_ANSWER_PC ||
                     a->kind == IN_ACT_ACK || a->kind == IN_ACT_SKIP_NOTICE || a->kind == IN_ACT_SESSION_NOTIFY ||
                     a->kind == IN_ACT_INSTRUCT_SEND || a->kind == IN_ACT_INSTRUCT_CLEAR || a->kind == IN_ACT_RELEASE ||
                     a->kind == IN_ACT_SESSION_WAIT || a->kind == IN_ACT_SETTING_INSTRUCT_WAIT;
    if (on_session && !session_ready()) continue; // la sesión se cerró en este mismo cuadro
    int rc = 0;
    switch (a->kind) {
      case IN_ACT_DECISION: rc = session_send_decision(&A.session, a->id, a->flag); break;
      case IN_ACT_FOCUS: rc = session_send_focus(&A.session, a->id); break;
      case IN_ACT_UNFOCUS: rc = session_send_focus(&A.session, NULL); break;
      case IN_ACT_SKIP: rc = session_send_skip(&A.session); break;
      case IN_ACT_ACK: rc = session_send_ack(&A.session, a->id); break;
      case IN_ACT_SKIP_NOTICE: rc = session_send_skip_notice(&A.session); break;
      case IN_ACT_SESSION_NOTIFY: rc = session_send_session_notify(&A.session, a->id, a->flag); break;
      case IN_ACT_MODE: rc = session_send_mode(&A.session, a->flag); break;
      case IN_ACT_READ: rc = session_send_read(&A.session, a->id, a->flag); break;
      case IN_ACT_SETTING_NOTIFY: rc = session_send_setting_notify_default(&A.session, a->flag); break;
      case IN_ACT_SETTING_ACK: rc = session_send_setting_notify_ack(&A.session, a->flag); break;
      case IN_ACT_SETTING_SOUND: rc = session_send_setting_sound(&A.session, a->flag); break;
      case IN_ACT_SETTING_QUESTIONS: rc = session_send_setting_questions(&A.session, a->flag); break;
      case IN_ACT_SETTING_READER: rc = session_send_setting_reader_default(&A.session, a->flag); break;
      case IN_ACT_ANSWER: rc = session_send_answer(&A.session, a->id, A.in.question.answers, A.in.question.answer_count); break;
      case IN_ACT_ANSWER_PC: rc = session_send_answer_pc(&A.session, a->id); break;
      case IN_ACT_QUESTION_OTHER: do_question_other(now); break;
      case IN_ACT_INSTRUCT_WRITE: do_instruct_write(a->id, now); break;
      case IN_ACT_INSTRUCT_SEND: rc = session_send_instruct(&A.session, a->id, A.in.instruct_text); break;
      case IN_ACT_INSTRUCT_CLEAR: rc = session_send_instruct_clear(&A.session, a->id); break;
      case IN_ACT_RELEASE: rc = session_send_release(&A.session, a->id); break;
      case IN_ACT_SESSION_WAIT: rc = session_send_setting_session_wait(&A.session, a->id, a->flag); break;
      case IN_ACT_SETTING_INSTRUCT_WAIT: rc = session_send_setting_instruct_wait(&A.session, a->flag); break;
      case IN_ACT_SETTING_HIDDEN: rc = session_send_setting_hidden_agents(&A.session, (unsigned)a->flag); break;
      case IN_ACT_THEME: set_theme(a->flag, *now); break;
      case IN_ACT_UPDATE_START: do_update_start(now); break;
      case IN_ACT_PAIR_CODE: do_pair_code(now); break;
      case IN_ACT_MANUAL_IP: do_manual_ip(now); break;
      case IN_ACT_RETRY: restart_connection(*now); break;
      case IN_ACT_QUIT: A.quit = 1; break;
    }
    input_action_done(&A.in, a, rc);
    if (on_session) check_session_failed(*now);
  }
}

// ---------- entradas ----------

static uint32_t map_keys(u32 k) {
  uint32_t m = 0;
  if (k & KEY_A) m |= IN_KEY_A;
  if (k & KEY_B) m |= IN_KEY_B;
  if (k & KEY_X) m |= IN_KEY_X;
  if (k & KEY_Y) m |= IN_KEY_Y;
  if (k & KEY_L) m |= IN_KEY_L;
  if (k & KEY_R) m |= IN_KEY_R;
  if (k & KEY_START) m |= IN_KEY_START;
  if (k & KEY_SELECT) m |= IN_KEY_SELECT;
  if (k & KEY_UP) m |= IN_KEY_UP;
  if (k & KEY_DOWN) m |= IN_KEY_DOWN;
  if (k & KEY_LEFT) m |= IN_KEY_LEFT;
  if (k & KEY_RIGHT) m |= IN_KEY_RIGHT;
  if (k & KEY_TOUCH) m |= IN_KEY_TOUCH;
  return m;
}

static void handle_input(uint64_t *now) {
  hidScanInput();
  u32 held = hidKeysHeld();
  touchPosition tp;
  if (held & KEY_TOUCH) hidTouchRead(&tp);
  else tp.px = tp.py = 0;

  InputFrame f;
  memset(&f, 0, sizeof f);
  f.now = *now;
  f.down = map_keys(hidKeysDown());
  f.up = map_keys(hidKeysUp());
  f.held = map_keys(held);
  f.rep = map_keys(hidKeysDownRepeat());
  f.touch_x = tp.px;
  f.touch_y = tp.py;
  f.view = live_view();
  f.layout = &A.layout;
  f.can_retry = f.view == NULL && A.auth_error && A.have_key; // "A: reintentar"
  if (session_ready()) {
    f.doc = session_reading(&A.session); // mensaje completo (lector); NULL si no llegó ninguno
    f.read_seq = session_read_seq(&A.session);
  }
  InputActions acts;
  input_frame(&A.in, &f, &acts);
  execute(&acts, now);
}

// ---------- pantallas sin vista ----------

static void set_face(const char *l1, const char *l2) {
  FaceView *f = &A.status_face;
  memset(f, 0, sizeof *f);
  f->kind = AGENT_NONE;
  f->mood = MOOD_IDLE;
  utf8_clip(l1, f->lines[0], sizeof f->lines[0], VIEW_MAX_TEXT);
  f->line_count = 1;
  if (l2 != NULL && l2[0] != '\0') {
    utf8_clip(l2, f->lines[1], sizeof f->lines[1], VIEW_MAX_TEXT);
    f->line_count = 2;
  }
}

static const char *sfmt(int slot, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static const char *sfmt(int slot, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(A.sbuf[slot], sizeof A.sbuf[slot], fmt, ap);
  va_end(ap);
  return A.sbuf[slot];
}

static void add_line(StatusScreen *s, const char *text) {
  if (s->line_count < STATUS_MAX_LINES) s->lines[s->line_count++] = text;
}
static void add_hint(StatusScreen *s, const char *text) {
  if (s->hint_count < STATUS_MAX_HINTS) s->hints[s->hint_count++] = text;
}

static void build_status(uint64_t now, StatusScreen *s) {
  memset(s, 0, sizeof *s);
  s->title_rgb = pal()->ink;
  s->notice = now < A.notice_until ? A.notice : NULL;
  const char *bridge_line = NULL;
  NpBeacon nb;
  if (netplan_best_beacon(&A.net.plan, now, &nb)) bridge_line = sfmt(0, "Puente encontrado en %s", nb.host);
  const char *saved_ip = A.net.plan.saved_host;
  const char *hint_ip = "SELECT: guía (ahí, X escribe la IP)";
  const char *hint_code = "Y: escribir código de emparejamiento";

  if (A.auth_error) {
    s->title = "Error de autenticación";
    s->title_rgb = pal()->bad_text;
    set_face("Error de autenticación", "Y: escribir código nuevo");
    add_line(s, A.auth_was_pairing ? "El código no coincide con el puente." : "El puente no reconoce esta clave.");
    add_line(s, "Genera un código en el PC con:");
    add_line(s, "npm run companion -- pair");
    add_hint(s, hint_code);
    if (A.have_key) add_hint(s, "A: reintentar con la clave guardada");
    add_hint(s, hint_ip);
    return;
  }
  if (!A.have_key) {
    s->title = "Falta emparejar";
    s->title_rgb = pal()->sky_text;
    set_face("Falta emparejar", "Y: escribir el código");
    add_line(s, "En el PC ejecuta:");
    add_line(s, "npm run companion -- pair");
    add_line(s, "y escribe aquí el código que muestra.");
    add_line(s, A.net.state == NET_NO_SOC ? "Sin red: enciende el Wi-Fi de la consola." : bridge_line ? bridge_line : "Buscando el puente en la red...");
    add_hint(s, hint_code);
    add_hint(s, hint_ip);
    return;
  }
  switch (A.net.state) {
    case NET_NO_SOC:
      s->title = "Sin red";
      set_face("Sin red", "Enciende el Wi-Fi");
      add_line(s, "La consola no tiene Wi-Fi activo.");
      add_line(s, "Reintentando...");
      break;
    case NET_SEARCHING:
      s->title = "Buscando el puente...";
      set_face("Buscando el puente...", saved_ip[0] ? sfmt(1, "Última IP: %s", saved_ip) : "");
      add_line(s, "Enciende el puente en el PC:");
      add_line(s, "npm run companion -- start");
      if (bridge_line) add_line(s, bridge_line);
      else if (saved_ip[0]) add_line(s, sfmt(1, "Si no aparece, pruebo con %s", saved_ip));
      break;
    case NET_CONNECTING:
      s->title = A.pending_pair ? "Emparejando..." : "Conectando...";
      set_face(s->title, sfmt(1, "%s:%u", A.net.target_host, (unsigned)A.net.target_port));
      add_line(s, sfmt(2, "Con el puente en %s", A.net.target_host));
      if (A.pending_pair) add_line(s, "Probando el código nuevo.");
      break;
    case NET_WAITING:
      s->title = "Sin conexión";
      set_face("Sin conexión", sfmt(1, "Reintento en %d s", net_retry_in_s(&A.net, now)));
      add_line(s, A.net.reason[0] ? A.net.reason : "No hay conexión con el puente.");
      add_line(s, sfmt(2, "Reintentando en %d s", net_retry_in_s(&A.net, now)));
      break;
    case NET_CONNECTED:
      if (A.session_active && A.session.state == SESSION_READY) {
        s->title = "Conectado";
        s->title_rgb = pal()->ok_text;
        set_face("Conectado", "Esperando datos del puente");
        add_line(s, "Esperando la vista del puente...");
      } else {
        s->title = A.pending_pair ? "Emparejando..." : "Saludando al puente...";
        set_face(s->title, "Comprobando la clave");
        add_line(s, "Comprobando la clave con el puente.");
      }
      break;
  }
  add_hint(s, hint_ip);
  add_hint(s, hint_code);
}

// ---------- diagnóstico ----------

// Copia el estado actual al Diag (los errno, resultados y contadores los anotan net.c, led.c y este archivo).
static void update_diag(uint64_t now) {
  Diag *d = &g_diag;
  d->net_state = net_state_name(A.net.state);
  d->session_state = A.session_active ? session_state_name(A.session.state) : "sin sesion";
  d->net_failures = A.net.failures;
  diag_set_target(d, A.net.target_host, A.net.target_port, netplan_origin_name(A.net.target_origin));
  diag_frame(d, now);
}

// ---------- dibujo ----------

static void draw_frame(const AppTargets *tg, uint64_t now) {
  const View *v = live_view();
  BottomModel m;
  memset(&m, 0, sizeof m);
  m.now_ms = now;
  m.view_at_ms = A.view_at;
  const FaceView *face;
  const Update *up = &A.in.update;
  int upd_busy = up->phase == UPD_RUN || up->phase == UPD_DONE; // instalando o «Listo»: las dos pantallas son de la actualización
  if (upd_busy) {
    set_face(up->phase == UPD_RUN ? "Actualizando Cronio" : "Listo", up->phase == UPD_RUN ? "No apagues la consola" : up->can_restart ? "Cronio se reinicia" : "Cierra y abre Cronio");
    face = &A.status_face;
  } else if (v != NULL) {
    face = &v->face;
    m.view = v;
    m.nav = &A.in.nav;
    m.card_owner = A.card_owner;
    m.countdown_s = v->has_request ? view_countdown_s(&v->request, A.request_deadline, now) : -1; // -1: sin límite
    m.hold = approve_hold_progress(&A.in.approve, now);
    m.hold_always = approve_gesture_is_always(&A.in.approve);
    m.approve_ready = approve_ready(&A.in.approve, now);
    m.ack_ready = approve_ready(&A.in.ack, now);
    m.scroll = A.scroll;
  } else {
    build_status(now, &m.status);
    face = &A.status_face;
  }
  if (!upd_busy) render_bottom_layout(&m, &A.layout);
  A.scroll = m.scroll;

  C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
  ui_text_begin_frame();
  // pantalla de arriba: con el 3D activo van los dos ojos, con el deslizador y los desplazamientos de la cara
  float slider = osGet3DSliderState();
  for (int e = 0; e < 2; e++) {
    C3D_RenderTarget *t = e == 0 ? tg->top_left : tg->top_right;
    C2D_TargetClear(t, C2D_Color32(0x0d, 0x0e, 0x13, 0xff));
    C2D_SceneBegin(t);
    render_top_draw(face, (double)(now - A.start_ms), e == 0 ? STEREO_LEFT : STEREO_RIGHT, slider);
  }
  C2D_TargetClear(tg->bottom, C2D_Color32(0xff, 0xff, 0xff, 0xff));
  C2D_SceneBegin(tg->bottom);
  ui_bg_bottom(); // fondo claro de la marca Cronio (degradado y rayitas); cada pantalla dibuja encima
  if (A.in.guide.open) {
    render_guide_draw(&A.in.guide);
  } else if (A.in.diag_on) {
    static char dl[DIAG_LINES][DIAG_LINE_BYTES];
    int dn = diag_format(&g_diag, now, dl);
    render_diag_draw((const char (*)[DIAG_LINE_BYTES])dl, dn);
  } else if (up->phase != UPD_IDLE) { // instalando, «Listo», error o la pantalla del menú (encima de él)
    UpdateScreen us;
    update_screen(up, now, &us);
    render_update_draw(&us);
  } else if (A.in.menu.open) {
    render_menu_draw(&A.in.menu, v, A.in.diag_on, sound_ready(), up);
  } else if (up->shown && update_card_visible(up, v)) { // hay una versión nueva y nada más pide atención
    UpdateScreen us;
    update_screen(up, now, &us);
    render_update_draw(&us);
  } else if (view_has_instruction_card(v)) {
    InstructModel im = {v, &A.in.instruct, instruct_ready(&A.in.instruct, now), v->mode == MODE_QUEUE && v->pending_count > 1};
    render_instruct_draw(&im);
  } else if (view_has_question_card(v)) {
    QuestionModel qm = {v, &A.in.question, question_ready(&A.in.question, now), v->mode == MODE_QUEUE && v->pending_count > 1};
    render_question_draw(&qm);
  } else if (reader_active(&A.in.reader) && v != NULL) {
    ReaderModel rm = {v, &A.in.reader, session_reading(&A.session), now};
    render_reader_draw(&rm);
  } else {
    render_bottom_draw(&m, &A.layout);
  }
  C3D_FrameEnd(0);
}

// ---------- ciclo de vida ----------

// Pantalla de aviso al inicio (antes del bucle): una o dos líneas en las dos pantallas. Un cuadro basta: queda hasta el siguiente.
static void draw_splash(const AppTargets *tg, const char *l1, const char *l2) {
  C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
  ui_text_begin_frame();
  for (int e = 0; e < 2; e++) { // el texto va en el plano de la pantalla (profundidad 0): igual en los dos ojos
    C3D_RenderTarget *t = e == 0 ? tg->top_left : tg->top_right;
    C2D_TargetClear(t, ui_rgb(pal()->bubble_fill, 1.0f));
    C2D_SceneBegin(t);
    ui_text_draw(l1, 200, 100, S_HEAD, S_MIN, 380, ui_rgb(pal()->ink, 1.0f), UI_ALIGN_CENTER);
  }
  C2D_TargetClear(tg->bottom, C2D_Color32(0xff, 0xff, 0xff, 0xff));
  C2D_SceneBegin(tg->bottom);
  ui_bg_bottom();
  ui_text_draw(l1, 160, 80, S_BODY, S_MIN, 300, ui_rgb(pal()->ink, 1.0f), UI_ALIGN_CENTER);
  if (l2 != NULL && l2[0] != '\0') ui_text_draw(l2, 160, 112, S_SMALL, S_MIN, 300, ui_rgb(pal()->mute, 1.0f), UI_ALIGN_CENTER);
  C3D_FrameEnd(0);
}

// Sonido al inicio: si falta el firmware se extrae del sistema (con su pantalla) y se inicia ndsp. Si algo falla se sigue sin
// sonido, se dice el motivo una vez en pantalla (se cierra sola o con un botón) y queda en el diagnóstico.
static void init_sound(const AppTargets *tg) {
  if (sound_needs_extraction()) draw_splash(tg, "Preparando el sonido…", "Un momento, solo pasa la primera vez.");
  SoundInit si;
  sound_init(&si);
  g_diag.sound_rc = si.rc;
  g_diag.sound_state = si.status == SOUND_READY ? DIAG_SOUND_OK : si.status == SOUND_NO_FIRM ? DIAG_SOUND_NO_FIRM : DIAG_SOUND_ERROR;
  if (si.msg[0] == '\0') return;
  const char *tail = si.status == SOUND_ERROR && si.extracted ? "Sin sonido por ahora." : "La app sigue sin sonido.";
  uint64_t until = osGetTime() + 4000;
  while (aptMainLoop() && osGetTime() < until) {
    draw_splash(tg, si.msg, tail);
    hidScanInput();
    if (hidKeysDown() & (KEY_A | KEY_B | KEY_START | KEY_TOUCH)) break;
  }
}

// Animación de entrada (logic/intro.c): ~2 s antes de todo lo demás, solo al abrir la app (no al volver del reposo). Cualquier
// botón o toque la salta. El tiempo lo lleva osGetTime(); la intro no espera a nada ni toca la red.
static void run_intro(const AppTargets *tg) {
  int logo = render_intro_init(); // sin logo la intro sigue igual, solo falta la imagen de abajo
  (void)logo;
  IntroTarget fin = intro_target_default();
  uint32_t face_rgb = theme_agent_rgb(AGENT_NONE); // todavía no hay agente conectado: la cara llega en gris neutro
  hidScanInput();
  u32 ignore = hidKeysHeld(); // teclas ya apretadas al abrir la app (p. ej. la Y de 3dslink): no cuentan hasta soltarlas
  uint64_t t0 = osGetTime();
  double shift = 0.0; // lo que adelanta el salto (ms): la intro pasa a la cara ya hecha, que se funde al color real
  int skipped = 0;
  while (aptMainLoop()) {
    hidScanInput();
    ignore &= hidKeysHeld();
    double t = (double)(osGetTime() - t0);
    if (!skipped && (hidKeysDown() & ~ignore) != 0) { // KEY_TOUCH va incluido en hidKeysDown
      skipped = 1;
      shift = intro_skip(t) - t;
    }
    t += shift;
    IntroFrame f;
    intro_frame(t, &fin, &f);
    if (f.over) break;

    C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
    ui_text_begin_frame();
    float slider = osGet3DSliderState();
    for (int e = 0; e < 2; e++) {
      C3D_RenderTarget *rt = e == 0 ? tg->top_left : tg->top_right;
      C2D_TargetClear(rt, C2D_Color32(0, 0, 0, 0xff));
      C2D_SceneBegin(rt);
      render_intro_top(&f, e == 0 ? STEREO_LEFT : STEREO_RIGHT, slider, face_rgb);
    }
    C2D_TargetClear(tg->bottom, C2D_Color32(0xff, 0xff, 0xff, 0xff));
    C2D_SceneBegin(tg->bottom);
    ui_bg_bottom(); // fondo del tema actual (config.ini ya está cargado)
    render_intro_bottom(&f);
    C3D_FrameEnd(0);
  }
  render_intro_exit();
}

void app_init(const AppTargets *tg) {
  uint64_t now = tick();
  A.start_ms = now;
  diag_init(&g_diag);
  aptHook(&A.apt_cookie, apt_event, NULL); // reposo y despertar: ver apt_event
  Result ps_rc = psInit();
  g_diag.ps_tried = 1;
  g_diag.ps_rc = (uint32_t)ps_rc;
  A.ps_ok = R_SUCCEEDED(ps_rc);
  hidSetRepeatParameters(20, 5);
  chime_gate_init(&A.chime_gate);
  config_load(&A.cfg); // antes de la intro y del aviso de sonido: el tema ya vale en esas pantallas
  pal_set_dark(A.cfg.dark);
  run_intro(tg);
  init_sound(tg);
  now = tick(); // la intro y el aviso de sonido pudieron tardar: el reloj virtual no lo cuenta como tiempo de la app

  if (!config_device_id_valid(A.cfg.device_id)) {
    uint8_t r[4];
    random_bytes(r, sizeof r);
    config_make_device_id(r, A.cfg.device_id);
    if (config_save(&A.cfg) != 0) set_notice("No se pudo escribir en la tarjeta SD", now);
  }
  load_saved_key();

  input_init(&A.in);
  input_set_app(&A.in, APP_VERSION, !envIsHomebrew()); // sin esto no hay versión que comparar
  net_init(&A.net, now);
  net_set_saved(&A.net, A.cfg.host, config_port_or_default(&A.cfg));
  sync_net_flags();
  led_init();
}

int app_frame(const AppTargets *tg) {
  uint64_t now = tick();
  if (A.wake_pending) { // aptHook avisó: despertó del reposo
    A.wake_pending = 0;
    on_wake(now);
  }

  // instalando una actualización (o mostrando «Listo» antes de reiniciar): la app no atiende al puente ni a las entradas; START no sale
  if (A.in.update.phase == UPD_RUN || (A.in.update.phase == UPD_DONE && A.in.update.can_restart)) {
    Update *u = &A.in.update;
    if (u->phase == UPD_RUN) {
      UpdaterResult r = updater_step(&A.up, now);
      update_set_step(u, A.up.step);
      update_set_progress(u, A.up.done, A.up.total);
      if (r == UPR_FAILED) {
        update_fail(u, A.up.error, now);
        resume_after_update(now);
      } else if (r == UPR_DONE) {
        update_done(u, prepare_restart(), now);
      }
    } else if (update_restart_due(u, now)) {
      return 0; // sale de la app: aptSetChainloader ya dejó dicho qué abrir
    }
    draw_frame(tg, now);
    return 1;
  }

  handle_input(&now);
  if (A.quit) return 0;

  if (net_update(&A.net, now)) {
    if (A.session_active) end_session("nueva conexión", now);
    start_session(now);
  }
  if (!A.session_active && A.net.state == NET_CONNECTED) net_session_failed(&A.net, 0, 0, "Conexión sin sesión", now);
  if (A.session_active && A.net.state != NET_CONNECTED) end_session("red cerró el socket", now); // net cerró el socket por su cuenta
  receive_all(now);
  service_view_and_timers(now);

  update_diag(now);
  draw_frame(tg, now);

  const View *v = live_view();
  led_set(v != NULL ? v->led : VIEW_LED_OFF);
  return 1;
}

void app_exit(void) {
  updater_cancel(); // si se sale a media instalación (HOME y cerrar), se cancela: la versión instalada no queda a medias
  aptUnhook(&A.apt_cookie);
  led_exit();
  sound_exit();
  net_exit(&A.net);
  if (A.ps_ok) psExit();
  memset(A.key, 0, sizeof A.key);
}
