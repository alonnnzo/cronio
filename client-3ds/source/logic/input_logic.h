// Decisiones de la app que no dependen de libctru: dado el estado previo, la vista, y los eventos del cuadro (botones,
// toque, resultado de los envíos), dice qué acciones ejecutar. app.c solo traduce libctru a estos eventos y ejecuta
// las acciones; aquí viven la navegación, el gesto de aprobar, el de rechazar, el lápiz y el atajo L+R.
//
// Uso por cuadro:
//   input_frame(...)        entradas -> acciones (enviar, abrir el teclado, reintentar, salir...)
//   input_view_changed(...) vista nueva -> navegación, tarjeta y el focus que pida la navegación
//   input_tick(...)         retención de riesgo alto y plazo del detalle -> acciones
//   input_action_done(...)  después de ejecutar cada acción, con su resultado (0 = salió)
//   input_session_*         conexión lista / sesión terminada
//
// Reglas de decisión:
//  - Aprobar: core/approve.c. Una decisión queda "respondida" solo si el envío devolvió 0 (input_action_done).
//  - "Sí, no volver a preguntar": Y (o la franja de la tarjeta) es el mismo gesto que A, con la bandera always de
//    core/approve.c: mismas guardas, misma retención en riesgo alto, mismas anulaciones. Solo si la tarjeta lo ofrece
//    (request.always); si no, Y no hace nada (solo sin vista abre el código de emparejamiento).
//  - Rechazar: se decide al soltar (lápiz sobre "Rechazar" o botón B) y solo si lo mostrado al soltar es lo mismo que
//    al empezar (misma llave que aprobar). La guarda de 500 ms no aplica a rechazar.
//  - El lápiz solo anula gestos de aprobar que son del lápiz.
//  - L / R saltan al soltar; mantener L+R juntos 1 s alterna la pantalla de diagnóstico y no salta.
//  - SELECT abre el menú de configuración (Fase 2b, paso 2; local; cancela el gesto de aprobar) y lo cierra. Dentro:
//    cruceta arriba/abajo (con repetición) elige, A (o izquierda/derecha en los valores) cambia, B sube un nivel o cierra,
//    el lápiz toca filas. Las entradas de ajustes del puente piden `settings` en la vista; si no hay, salen desactivadas.
//    "Guía de botones" abre la guía encima del menú; "Diagnóstico" alterna la pantalla de diagnóstico.
//    SEGURIDAD: el menú nunca tapa ni intercepta aprobar o rechazar. Una tarjeta de permiso lo cierra en el acto (y la
//    guía que abrió) y, con una tarjeta a la vista, SELECT no lo abre: primero se responde.
//  - Con la guía abierta solo valen SELECT/B (cerrar: se vuelve al menú), la cruceta izquierda/derecha y el toque en las
//    flechas (páginas), X/Y en la última página (IP y código; cierran guía y menú) y START; el resto se traga.
//    Con el diagnóstico abierto SELECT no hace nada (no pueden estar las dos a la vez).
//  - Lector del mensaje completo (Fase 2b, paso 1): en el detalle, sin tarjeta, A (o tocar "A: leer todo") lo abre y pide
//    `read`. Dentro: cruceta arriba/abajo una línea (con repetición), izquierda/derecha y L/R una página, lápiz arrastra,
//    B vuelve al detalle; A recarga si apareció un mensaje nuevo. X, Y y el resto se tragan. Una tarjeta de permiso lo
//    cierra en el acto (el lector nunca tapa ni intercepta aprobar o rechazar); SELECT abre la guía encima y el
//    diagnóstico lo tapa, como al resto de la app.
//  - Avisos (Fase 2b, paso 3): una tarjeta de aviso (view.notice, solo sin permisos pendientes) se marca con A (o el botón
//    "A: Visto"): mismo gesto y misma guarda de 500 ms que aprobar, pero en su propia máquina de estados (`ack`) y con su
//    propia acción (IN_ACT_ACK): nada de lo que se pulse sobre un aviso puede aprobar o rechazar, y una tarjeta de permiso que
//    llega mientras se pulsa anula el gesto del aviso. L/R pasan entre avisos; "Leer todo" abre el lector de esa sesión
//    (B vuelve al aviso); Y en el detalle (sin permiso) cambia el modo de aviso de la sesión. Menú, guía y lector ceden ante
//    un aviso igual que ante un permiso (se cierran; SELECT no abre el menú) salvo el lector abierto con "Leer todo".
//  - Preguntas con alternativas (Fase 2b, paso 4): una solicitud con kind == REQ_QUESTION no es un permiso. Tiene su propia pantalla y su
//    propia máquina de estados (logic/question.c): arriba/abajo (o el lápiz) marcan una fila y A (o tocar la fila) elige, B vuelve a la
//    pregunta anterior y NUNCA rechaza ni responde, L/R pasan a la siguiente solicitud (como con los permisos) y lo demás se traga. La
//    máquina de aprobar no la ve (approve_view recibe NULL) y de la consola sale `answer`, nunca `decision`. Misma guarda de 500 ms que
//    aprobar. El menú, la guía, el lector y los avisos ceden ante ella como ante un permiso.
//  - Instrucciones por texto (Fase 2b, paso 6): una sesión con "Esperar mi respuesta" que termina su turno deja una tarjeta con
//    request.kind == REQ_INSTRUCTION ("Espera tu instrucción"), con su propia pantalla y máquina de estados (logic/instruct.c): arriba/abajo
//    y el lápiz mueven, A (o tocar) elige "Escribir" (teclado del sistema) o "Seguir en el PC", B NUNCA envía, libera ni rechaza y L/R pasan a
//    otra solicitud. En el detalle de una sesión (sin tarjeta; solo si el puente manda `instructWaitMax`): X escribe una instrucción (para
//    el próximo fin de turno de la sesión o, si espera, en el acto), izquierda/derecha alternan "Esperar mi respuesta" y abajo borra la cola.
//    En el detalle X ya no alterna el modo de permisos (sigue el botón táctil de la barra y X en las demás pantallas).
//  - Actualizar la app (Fase 7, logic/update.c): cuando la vista trae `update` y nada más pide atención (ni solicitud ni aviso con "Visto"; el menú,
//    la guía, el diagnóstico y el lector la tapan) aparece una tarjeta a pantalla completa: A actualiza y B la oculta hasta el próximo
//    arranque (guarda de 500 ms, como aprobar; también los botones táctiles). La entrada «Actualizar app» del menú abre la misma pantalla
//    encima del menú. Con A la app (updater.c) descarga e instala: mientras dura, START no sale y las entradas no hacen nada.
//  - Con el diagnóstico abierto la tarjeta está tapada: A, B, X, Y, la cruceta, el toque y el salto con L/R se
//    tragan; solo valen START (salir) y el acorde L+R que lo cierra. Abrir o cerrar el diagnóstico anula los gestos en
//    curso (lápiz, A, B) y reinicia la guarda de 500 ms de aprobar.
#ifndef LOGIC_INPUT_LOGIC_H
#define LOGIC_INPUT_LOGIC_H

#include <stdint.h>

#include "../core/approve.h"
#include "../core/nav.h"
#include "../core/session.h"
#include "../core/view.h"
#include "../core/reading.h"
#include "guide.h"
#include "layout.h"
#include "menu.h"
#include "instruct.h"
#include "question.h"
#include "reader.h"
#include "update.h"

// Botones y toque (la app los traduce desde libctru).
enum {
  IN_KEY_A = 1u << 0,
  IN_KEY_B = 1u << 1,
  IN_KEY_X = 1u << 2,
  IN_KEY_Y = 1u << 3,
  IN_KEY_L = 1u << 4,
  IN_KEY_R = 1u << 5,
  IN_KEY_START = 1u << 6,
  IN_KEY_SELECT = 1u << 7,
  IN_KEY_UP = 1u << 8,
  IN_KEY_DOWN = 1u << 9,
  IN_KEY_LEFT = 1u << 10,
  IN_KEY_RIGHT = 1u << 11,
  IN_KEY_TOUCH = 1u << 12
};

#define INPUT_DIAG_HOLD_MS 1000

typedef enum {
  IN_ACT_DECISION,    // session_send_decision(id, flag: 1 aprobar, 2 aprobar y no volver a preguntar, 0 rechazar)
  IN_ACT_FOCUS,       // session_send_focus(id)
  IN_ACT_READ,        // session_send_read(id, flag = READ_MODE_*): pide el mensaje completo o el resumen de la sesión (lector, Fase 2b)
  IN_ACT_UNFOCUS,     // session_send_focus(NULL)
  IN_ACT_SETTING_NOTIFY, // session_send_setting_notify_default(flag = NotifyMode)
  IN_ACT_SETTING_ACK,    // session_send_setting_notify_ack(flag = 0/1)
  IN_ACT_SETTING_SOUND,  // session_send_setting_sound(flag = 0/1)
  IN_ACT_SETTING_QUESTIONS, // session_send_setting_questions(flag = 0/1)
  IN_ACT_SETTING_READER,    // session_send_setting_reader_default(flag = READ_MODE_*)
  IN_ACT_ANSWER,      // session_send_answer(id, in->question.answers, in->question.answer_count): respuestas a una pregunta (paso 4)
  IN_ACT_ANSWER_PC,   // session_send_answer_pc(id): "Responder en el PC"
  IN_ACT_QUESTION_OTHER, // mandar `hold`, abrir el teclado del sistema y devolver lo escrito con input_question_text
  IN_ACT_SETTING_HIDDEN, // session_send_setting_hidden_agents(flag = máscara de agentes ocultos)
  IN_ACT_INSTRUCT_WRITE, // paso 6: mandar `hold`, abrir el teclado del sistema (id = sesión) y devolver lo escrito con input_instruct_text
  IN_ACT_INSTRUCT_SEND,  // session_send_instruct(id = sesión, in->instruct_text)
  IN_ACT_INSTRUCT_CLEAR, // session_send_instruct_clear(id = sesión)
  IN_ACT_RELEASE,        // session_send_release(id = solicitud): "Seguir en el PC" del fin de turno retenido
  IN_ACT_SESSION_WAIT,   // session_send_setting_session_wait(id = sesión, flag = 0/1): "Esperar mi respuesta"
  IN_ACT_SETTING_INSTRUCT_WAIT, // session_send_setting_instruct_wait(flag = minutos: 5, 10 o 30)
  IN_ACT_UPDATE_START, // empezar a actualizar la app: avisar al puente con `hold`, y descargar e instalar (updater.c); la fase ya es UPD_RUN
  IN_ACT_THEME,       // tema de la consola (flag = 0 claro / 1 oscuro): se guarda en config.ini, no va al puente
  IN_ACT_SKIP,        // session_send_skip
  IN_ACT_ACK,         // session_send_ack(id): "Visto" de la tarjeta de aviso (solo la retira del puente)
  IN_ACT_SKIP_NOTICE, // session_send_skip_notice: otra tarjeta de aviso
  IN_ACT_SESSION_NOTIFY, // session_send_session_notify(id = sesión, flag = NotifyMode)
  IN_ACT_MODE,        // session_send_mode(manual)
  IN_ACT_PAIR_CODE,   // teclado del sistema: código de emparejamiento
  IN_ACT_MANUAL_IP,   // teclado del sistema: IP del puente (X en la última página de la guía)
  IN_ACT_RETRY,       // reintentar la conexión con la clave guardada (A tras un error de autenticación)
  IN_ACT_QUIT
} InputActionKind;

typedef struct {
  InputActionKind kind;
  char id[VIEW_ID_BYTES]; // DECISION y FOCUS
  int flag;               // DECISION: 1 aprobar, 2 aprobar y no volver a preguntar, 0 rechazar. MODE: 1 manual
} InputAction;

#define INPUT_MAX_ACTIONS 8
typedef struct {
  InputAction a[INPUT_MAX_ACTIONS];
  int n;
} InputActions;

typedef struct {
  Nav nav;
  Approve approve;
  Approve ack;              // gesto de "Visto" de la tarjeta de aviso: máquina aparte, no puede aprobar ni rechazar
  int diag_on;              // pantalla de diagnóstico activa (se alterna con L+R)
  Guide guide;              // guía de botones (entrada del menú): pantalla inferior local
  Menu menu;                // menú de configuración (SELECT); se cierra solo si aparece una tarjeta de permiso
  Instruct instruct;        // tarjeta "Espera tu instrucción" (paso 6): su propia máquina de estados, nunca aprueba ni rechaza
  int i_pen_active;         // el lápiz está sobre la tarjeta de instrucción
  int i_pen_row;            // fila bajo el lápiz al empezar (-1 ninguna)
  char instruct_text[MSG_INSTRUCT_BYTES]; // lo último escrito en el teclado, ya limpio: lo manda IN_ACT_INSTRUCT_SEND
  Question question;        // tarjeta de pregunta con alternativas (paso 4): su propia máquina de estados, nunca aprueba ni rechaza
  int q_pen_active;         // el lápiz está sobre la tarjeta de pregunta
  int q_pen_row;            // fila bajo el lápiz al empezar (-1 ninguna)
  Reader reader;            // lector del mensaje completo (A en el detalle); se cierra solo si aparece una tarjeta de permiso
  Update update;            // actualizar la app (tarjeta de aviso, pantalla del menú y progreso): su propia máquina de estados
  int u_pen;                // botón de la pantalla de actualización bajo el lápiz al apoyar (UpdHit); 0 ninguno

  // lápiz
  int pen_active, pen_on_approve, pen_zone_valid;
  int pen_always;           // el gesto del lápiz de aprobar es el de "no volver a preguntar"
  int pen_on_ack;           // el lápiz empezó sobre "A: Visto"
  ZoneKind pen_kind;
  int pen_index;
  int pen_x, pen_y;         // última posición vista (al soltar el sistema no la da)
  int deny_pen_armed;       // el toque empezó sobre "Rechazar" con una tarjeta visible
  uint8_t deny_pen_key[SHA256_DIGEST_LEN];

  // B como rechazar
  int deny_btn_armed;
  uint8_t deny_btn_key[SHA256_DIGEST_LEN];

  // L+R
  int lr_chord;             // en esta pulsación se vieron L y R a la vez
  int lr_fired;
  uint64_t lr_since;
} InputLogic;

typedef struct {
  uint64_t now;
  uint32_t down, up, held, rep; // máscaras IN_KEY_*
  int touch_x, touch_y;         // válido mientras IN_KEY_TOUCH está en held
  const View *view;             // vista viva (sesión lista y con vista) o NULL
  const BottomLayout *layout;   // la que se dibujó (sin zonas si no hay vista)
  int can_retry;                // sin vista, con error de autenticación y con clave guardada
  const ReadDoc *doc;           // último mensaje completo recibido (session_reading) o NULL
  uint32_t read_seq;            // session_read_seq: sube con cada respuesta a read
} InputFrame;

void input_init(InputLogic *in);
// La versión de esta app (APP_VERSION) y si corre como .cia instalada: sin esto no hay versión que comparar y no se ofrece nada.
void input_set_app(InputLogic *in, const char *version, int is_cia);

// Entradas del cuadro -> acciones.
void input_frame(InputLogic *in, const InputFrame *f, InputActions *out);
// Vista nueva (o primera): navegación + tarjeta de permiso. owner es el dueño de la tarjeta (theme_card_owner).
void input_view_changed(InputLogic *in, const View *v, const char *owner, uint64_t now, InputActions *out);
// Cada cuadro con vista viva: retención de riesgo alto y plazo de confirmación del detalle.
void input_tick(InputLogic *in, const View *v, uint64_t now, InputActions *out);
// La sesión llegó a READY: hay conexión; el puente nuevo no sabe qué detalle teníamos abierto.
void input_session_ready(InputLogic *in, InputActions *out);
// La sesión terminó (cualquier causa): el gesto y lo respondido se limpian; la navegación se conserva.
void input_session_end(InputLogic *in);
// Lo escrito en el teclado del sistema para "Otra…" (NULL o vacío = canceló). Si completa las respuestas, deja la acción de enviar.
void input_question_text(InputLogic *in, const View *v, uint64_t now, const char *text, InputActions *out);
// Lo escrito en el teclado del sistema para una instrucción a la sesión `session_id` (NULL o vacío = canceló). Se limpia y, si queda algo, deja
// la acción de mandarla (el texto queda en in->instruct_text).
void input_instruct_text(InputLogic *in, const View *v, const char *session_id, const char *text, InputActions *out);
// Resultado de ejecutar una acción. Una decisión con rc 0 queda respondida; con rc != 0, no.
void input_action_done(InputLogic *in, const InputAction *act, int rc);

// 1 si hay que cerrar la sesión de inmediato (cualquier recepción o envío puede dejarla en FAILED).
int input_session_failed(const Session *s);

// ¿Se pueden abrir los teclados del sistema (bloquean unos segundos)? Sin vista, o en agentes y sin tarjeta.
int input_settings_allowed(const InputLogic *in, const View *v);

#endif
