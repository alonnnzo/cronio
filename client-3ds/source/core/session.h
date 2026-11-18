// Máquina de estados del cliente sobre un transporte abstracto (no conoce sockets ni reloj). Referencia:
// packages/bridge/test/fake-console.ts. Hace el saludo (challenge -> hello -> welcome), abre las tramas selladas,
// guarda la última vista válida y arma los mensajes de la consola.
//
// Ante cualquier error de protocolo (etiqueta inválida, JSON inesperado, vista inválida, trama demasiado larga,
// fallo al enviar) la sesión pasa a SESSION_FAILED, deja el motivo en s->error y session_on_data devuelve < 0:
// la app debe cerrar el socket y, para reconectar, llamar de nuevo a session_init con un nonce nuevo.
//
// El tiempo no entra aquí: PING cada 5 s y el cierre tras 15 s sin recibir nada son cosa de la app (net.c).
#ifndef CORE_SESSION_H
#define CORE_SESSION_H

#include <stddef.h>
#include <stdint.h>

#include "frame.h"
#include "msg.h"
#include "reading.h"
#include "view.h"

typedef struct {
  int (*send)(void *ctx, const uint8_t *data, size_t len); // 0 si todo salió
  void *ctx;
} Transport;

typedef enum {
  SESSION_IDLE,
  SESSION_WAIT_CHALLENGE,
  SESSION_WAIT_WELCOME,
  SESSION_READY,
  SESSION_FAILED
} SessionState;

typedef enum {
  SESSION_ERR_NONE = 0,
  SESSION_ERR_AUTH,     // el puente rechazó el saludo o su welcome no coincide: clave equivocada, ofrecer emparejar de nuevo
  SESSION_ERR_FRAME,    // trama con largo mayor que el máximo
  SESSION_ERR_TAG,      // etiqueta de una trama sellada inválida (alterada, repetida, otra dirección)
  SESSION_ERR_PROTOCOL, // mensaje o tipo de trama inesperado para el estado
  SESSION_ERR_VIEW,     // la vista no pasa las comprobaciones de límites
  SESSION_ERR_SEND,     // el transporte falló al enviar
  SESSION_ERR_BAD_ARG   // device_id inválido o transporte ausente
} SessionError;

typedef struct {
  SessionState state;
  SessionError error;
  Transport transport;
  char device_id[65];
  char app_version[17]; // versión de la app para el saludo ("0.2.0"); vacía = no se manda
  int install;          // cómo corre: 1 .cia instalada, 0 .3dsx, -1 no se sabe (no se manda)
  uint8_t key[32];      // clave del dispositivo
  uint8_t nonce_c[16];
  uint8_t nonce_b[16];
  FrameDecoder decoder;
  FrameSealer sealer;   // consola -> puente (dir 2)
  FrameOpener opener;   // puente -> consola (dir 1)
  View view;            // última vista válida
  View staging;         // vista en análisis (no se pisa la buena si la nueva es inválida)
  int have_view;
  uint64_t last_rev;
  uint32_t view_seq;
  ReadDoc reading;      // último mensaje completo recibido (`text`); se pisa con cada respuesta
  int have_reading;
  uint32_t read_seq;
  char bridge_error[VIEW_ERROR_CODE_BYTES]; // último {"t":"error"} recibido ya autenticado
} Session;

// Deja la sesión en SESSION_IDLE, sin vista. Se llama una vez por conexión, con un nonce de 16 bytes nuevo
// (el azar entra como parámetro). Con un device_id inválido (1 a 64 de [A-Za-z0-9_.:-]) queda en FAILED/BAD_ARG.
void session_init(Session *s, const char *device_id, const uint8_t key[32], const uint8_t nonce_c[16]);
// La versión de la app y cómo corre (1 .cia instalada, 0 .3dsx), para el saludo: el puente avisa si hay una versión nueva. Se llama
// después de session_init y antes de session_on_connected. Una versión inválida (solo dígitos y puntos, hasta 16) no sale en el saludo.
void session_set_app(Session *s, const char *app_version, int install);
// El socket quedó conectado: pasa a esperar el challenge del puente.
void session_on_connected(Session *s, Transport t);
// Bytes recibidos del socket (cualquier fragmentación). 0 si todo bien; < 0 si hay que cerrar la conexión.
int session_on_data(Session *s, const uint8_t *data, size_t len);

// Última vista válida, o NULL si todavía no hay o la sesión no está lista.
const View *session_view(const Session *s);
// Sube cada vez que se reemplaza la vista: la app compara con el valor de la última consulta para saber si cambió.
uint32_t session_view_seq(const Session *s);
// Último mensaje completo (respuesta a session_send_read), o NULL si no llegó ninguno o la sesión no está lista.
// read_seq sube con cada `text` recibido: quien pidió compara con el valor que tenía al pedir.
const ReadDoc *session_reading(const Session *s);
uint32_t session_read_seq(const Session *s);

// Envíos (solo en SESSION_READY). 0 si salió; -1 si no se pudo (argumento inválido: no pasa nada; fallo del
// transporte: la sesión pasa a FAILED/SEND).
// allow: 0 rechazar, 1 aprobar, 2 aprobar y no volver a preguntar (ver msg_decision).
int session_send_decision(Session *s, const char *request_id, int allow);
int session_send_focus(Session *s, const char *session_id /* NULL = ninguno */);
int session_send_skip(Session *s);
int session_send_mode(Session *s, int manual);
// Pide el mensaje completo de la sesión; la respuesta llega por session_on_data (session_reading).
// `mode`: READ_MODE_FULL o READ_MODE_SUMMARY.
int session_send_read(Session *s, const char *session_id, int mode);
// Ajustes del puente (menú de configuración). El puente guarda y reenvía la vista; nada cambia hasta que llega.
int session_send_setting_notify_default(Session *s, int notify);
int session_send_setting_notify_ack(Session *s, int ack);
int session_send_setting_sound(Session *s, int on);
int session_send_setting_questions(Session *s, int on);
int session_send_setting_reader_default(Session *s, int mode);
int session_send_setting_hidden_agents(Session *s, unsigned hidden_mask);
// Avisos (Fase 2b, paso 3): "Visto" de una tarjeta de aviso, pasar a la siguiente y modo de aviso de una sesión.
int session_send_ack(Session *s, const char *notice_id);
int session_send_skip_notice(Session *s);
int session_send_session_notify(Session *s, const char *session_id, int notify);
// Preguntas con alternativas (Fase 2b, paso 4): las respuestas (una por pregunta, en orden) o "Responder en el PC", y el aviso de
// pausa antes de abrir el teclado del sistema (el puente no corta la conexión por silencio durante `seconds`, hasta 300).
int session_send_answer(Session *s, const char *request_id, const MsgAnswer *answers, int count);
int session_send_answer_pc(Session *s, const char *request_id);
int session_send_hold(Session *s, int seconds);
// Instrucciones por texto (paso 6): instrucción para una sesión, vaciar su cola, "Seguir en el PC" (libera el fin de turno retenido),
// "Esperar mi respuesta" de una sesión y minutos de espera (5, 10 o 30).
int session_send_instruct(Session *s, const char *session_id, const char *text);
int session_send_instruct_clear(Session *s, const char *session_id);
int session_send_release(Session *s, const char *request_id);
int session_send_setting_session_wait(Session *s, const char *session_id, int on);
int session_send_setting_instruct_wait(Session *s, int minutes);
int session_send_ping(Session *s);

const char *session_error_name(SessionError e);
const char *session_state_name(SessionState s);

#endif
