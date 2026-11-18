// La máquina de estados de la actualización (logic/updflow.c): descarga a memoria, verificación contra lo que anunció el PC,
// instalación en trozos y, si AM falla, cancelar y terminar con el error (sin borrar ni reintentar). Sin libctru: la prueba hace de AM.
#include "test.h"

#include "../source/core/sha256.h"
#include "../source/logic/updflow.h"

#define TOTAL 370000u // unos 361 KB: dos trozos de 256 KB (el segundo de 107 KB)

// Un AM de mentira: dice qué resultado tiene cada llamada. En 0 = sale bien.
typedef struct {
  int32_t start_rc;
  int32_t write_rc;        // error de FSFILE_Write en el trozo `write_chunk`
  int write_chunk;         // índice del trozo que falla (-1: ninguno)
  uint32_t short_write;    // si no es 0, escribe esos bytes de menos (rc = 0)
  int32_t finish_rc;
  int32_t cancel_rc;
  // lo que se llamó
  int starts, writes, finishes, cancels;
  char log[64];
  uint32_t write_off[8];
} FakeAm;

static void fake_init(FakeAm *a) {
  memset(a, 0, sizeof *a);
  a->write_chunk = -1;
}

// Corre la máquina hasta que termine, contestando como el AM de mentira. Devuelve el estado final.
static UfState run(UpdFlow *f, FakeAm *a) {
  UfAction act;
  int guard = 0;
  while (guard++ < 100 && uf_next(f, &act)) {
    int32_t rc = 0;
    uint32_t written = 0;
    size_t n = strlen(a->log);
    switch (act.op) {
      case UF_OP_START:
        a->starts++;
        rc = a->start_rc;
        if (n < sizeof a->log - 2) a->log[n] = 'S';
        break;
      case UF_OP_WRITE: {
        int chunk = (int)(act.offset / UF_CHUNK_BYTES);
        if (a->writes < 8) a->write_off[a->writes] = act.offset;
        a->writes++;
        written = act.len;
        if (a->write_chunk == chunk) {
          rc = a->write_rc;
          if (a->short_write != 0) written = act.len - a->short_write;
          else written = 0;
        }
        if (n < sizeof a->log - 2) a->log[n] = 'W';
        break;
      }
      case UF_OP_FINISH:
        a->finishes++;
        rc = a->finish_rc;
        if (n < sizeof a->log - 2) a->log[n] = 'F';
        break;
      case UF_OP_CANCEL:
        a->cancels++;
        rc = a->cancel_rc;
        if (n < sizeof a->log - 2) a->log[n] = 'C';
        break;
    }
    uf_result(f, rc, written);
  }
  return f->state;
}

// Descarga todo de una vez.
static void download_all(UpdFlow *f) { uf_downloaded(f, f->total); }

static void test_happy_path(void) {
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(f.state, UF_INSTALLING);
  CHECK_EQ_INT(run(&f, &a), UF_DONE);
  CHECK_STR(a.log, "SWWF"); // start, dos trozos, finish: ni cancelar
  CHECK_EQ_INT(a.writes, 2);
  CHECK_EQ_INT((int)a.write_off[0], 0);
  CHECK_EQ_INT((int)a.write_off[1], (int)UF_CHUNK_BYTES);
  CHECK_EQ_INT((int)uf_progress(&f), (int)TOTAL);
  CHECK_EQ_INT(a.cancels, 0);
}

static void test_chunks(void) {
  // un .cia que cabe en un trozo, uno exacto y uno de tres trozos
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  uf_init(&f, 20000);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_DONE);
  CHECK_STR(a.log, "SWF");
  fake_init(&a);
  uf_init(&f, UF_CHUNK_BYTES);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_DONE);
  CHECK_STR(a.log, "SWF");
  fake_init(&a);
  uf_init(&f, 2 * UF_CHUNK_BYTES + 5);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_DONE);
  CHECK_STR(a.log, "SWWWF");
  CHECK_EQ_INT((int)a.write_off[2], (int)(2 * UF_CHUNK_BYTES));
}

static void test_steps_shown(void) {
  UpdFlow f;
  uf_init(&f, TOTAL);
  download_all(&f);
  UfAction act;
  CHECK(uf_next(&f, &act));
  CHECK_EQ_INT(act.op, UF_OP_START);
  CHECK_EQ_INT(act.step, UPD_STEP_INSTALL);
  uf_result(&f, 0, 0);
  CHECK(uf_next(&f, &act));
  CHECK_EQ_INT(act.op, UF_OP_WRITE);
  CHECK_EQ_INT(act.step, UPD_STEP_INSTALL);
  CHECK_EQ_INT(act.len, UF_CHUNK_BYTES);
  uf_result(&f, 0, act.len);
  CHECK_EQ_INT((int)uf_progress(&f), (int)UF_CHUNK_BYTES);
  CHECK(uf_next(&f, &act));
  uf_result(&f, 0, act.len);
  CHECK(uf_next(&f, &act));
  CHECK_EQ_INT(act.op, UF_OP_FINISH);
  CHECK_EQ_INT(act.step, UPD_STEP_FINISH); // se muestra «Terminando…» antes de que AM bloquee
  // sin resultado pendiente resuelto no hay otra acción
  CHECK(!uf_next(&f, &act));
}

static void test_write_fails_cancels_and_stops(void) {
  // falla un trozo: se cancela la instalación abierta y se termina con el error. NO se borra nada y NO se reintenta.
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  a.write_chunk = 0;
  a.write_rc = (int32_t)0xC8A08BF4;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK_STR(a.log, "SWC"); // start, write (falla), cancel: y se acabó
  CHECK_EQ_INT(a.starts, 1);
  CHECK_EQ_INT(a.cancels, 1);
  CHECK_STR(f.error, "FSFILE_Write C8A08BF4 en el byte 0");
  UfAction act;
  CHECK(!uf_next(&f, &act)); // no se vuelve a pedir nada
}

static void test_write_fails_in_second_chunk(void) {
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  a.write_chunk = 1;
  a.write_rc = (int32_t)0xC8A08BF5;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK_STR(a.log, "SWWC");
  char want[64];
  snprintf(want, sizeof want, "FSFILE_Write C8A08BF5 en el byte %u", (unsigned)UF_CHUNK_BYTES);
  CHECK_STR(f.error, want);
  CHECK(strlen(f.error) < UPDATE_ERROR_BYTES);
}

static void test_cancel_result_does_not_change_error(void) {
  // el resultado de AM_CancelCIAInstall (bueno o malo) no cambia el error que se muestra: el del primer fallo
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  a.write_chunk = 0;
  a.write_rc = (int32_t)0xC8A08BF4;
  a.cancel_rc = (int32_t)0xC8804478;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK(strstr(f.error, "C8A08BF4") != NULL);
  CHECK(strstr(f.error, "C8804478") == NULL);
}

static void test_start_fails_no_cancel(void) {
  // si AM_StartCiaInstall falla no hay manejador que cancelar: se termina directo
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  a.start_rc = (int32_t)0xC8A08BF4;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK_STR(a.log, "S");
  CHECK_EQ_INT(a.cancels, 0);
  CHECK_STR(f.error, "AM_StartCiaInstall C8A08BF4");
}

static void test_short_write_and_finish_failure(void) {
  // escribir de menos (rc 0) cuenta como fallo y el texto lo dice
  UpdFlow f;
  FakeAm a;
  fake_init(&a);
  a.write_chunk = 0;
  a.short_write = 100;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK_EQ_INT(f.fault.op, UF_OP_WRITE);
  CHECK(strstr(f.error, "FSFILE_Write 00000000 en el byte 0 (escribió 262044 de 262144)") != NULL);
  CHECK_STR(a.log, "SWC");
  // un fallo de AM_FinishCiaInstall termina sin cancelar (el manejador ya se consumió) y sin reintentar
  fake_init(&a);
  a.finish_rc = (int32_t)0xC8A08BF4;
  uf_init(&f, TOTAL);
  download_all(&f);
  CHECK_EQ_INT(run(&f, &a), UF_FAILED);
  CHECK_STR(a.log, "SWWF");
  CHECK_EQ_INT(a.cancels, 0);
  CHECK(strstr(f.error, "AM_FinishCiaInstall C8A08BF4") != NULL);
}

static void test_network_cut_never_touches_am(void) {
  UpdFlow f;
  uf_init(&f, TOTAL);
  uf_downloaded(&f, 100000);
  CHECK_EQ_INT(f.state, UF_DOWNLOADING);
  CHECK_EQ_INT((int)uf_progress(&f), 100000);
  UfAction act;
  CHECK(!uf_next(&f, &act)); // con la descarga a medias no hay nada que pedirle a AM
  uf_download_failed(&f);    // se cortó la red
  CHECK_EQ_INT(f.state, UF_FAILED);
  CHECK(!f.am_touched);
  CHECK(!uf_next(&f, &act));
  uf_downloaded(&f, TOTAL);  // datos tardíos no la reviven
  CHECK_EQ_INT(f.state, UF_FAILED);
  CHECK(!uf_next(&f, &act));
  CHECK(!f.am_touched);
}

static void test_download_progress_and_clamp(void) {
  UpdFlow f;
  uf_init(&f, 1000);
  uf_downloaded(&f, 400);
  CHECK_EQ_INT((int)uf_progress(&f), 400);
  CHECK_EQ_INT(f.state, UF_DOWNLOADING);
  uf_downloaded(&f, 5000); // de más: no pasa del total
  CHECK_EQ_INT((int)f.received, 1000);
  CHECK_EQ_INT(f.state, UF_INSTALLING);
  CHECK_EQ_INT((int)uf_progress(&f), 0); // ya es el progreso de la instalación
}

static void test_size_limits(void) {
  CHECK(!uf_size_ok(-1));
  CHECK(!uf_size_ok(0));
  CHECK(!uf_size_ok(UF_MIN_CIA_BYTES - 1));
  CHECK(uf_size_ok(UF_MIN_CIA_BYTES));
  CHECK(uf_size_ok(370000));
  CHECK(uf_size_ok(UF_MAX_CIA_BYTES));
  CHECK(!uf_size_ok((int64_t)UF_MAX_CIA_BYTES + 1));
  CHECK(!uf_size_ok(48ll * 1024 * 1024)); // el viejo límite ya no vale
}

// Verificación de lo descargado contra lo que anunció el PC (tamaño y SHA-256), antes de tocar AM.
static void test_verify(void) {
  uint8_t cia[20000];
  for (size_t i = 0; i < sizeof cia; i++) cia[i] = (uint8_t)(i * 31u + 7u);
  uint8_t sha[SHA256_DIGEST_LEN];
  sha256(cia, sizeof cia, sha);
  CHECK(uf_verify(cia, sizeof cia, sizeof cia, sha));
  // un solo bit distinto en cualquier punto del archivo (principio, medio, final) no pasa
  const size_t where[] = {0, 10000, sizeof cia - 1};
  for (size_t i = 0; i < 3; i++) {
    cia[where[i]] ^= 1;
    CHECK_MSG(!uf_verify(cia, sizeof cia, sizeof cia, sha), "un bit cambiado en %u debía rechazarse", (unsigned)where[i]);
    cia[where[i]] ^= 1;
  }
  CHECK(uf_verify(cia, sizeof cia, sizeof cia, sha));
  // un hash distinto, con un solo bit cambiado en cualquier byte
  uint8_t bad[SHA256_DIGEST_LEN];
  for (size_t i = 0; i < sizeof bad; i++) {
    memcpy(bad, sha, sizeof bad);
    bad[i] ^= 0x80;
    CHECK_MSG(!uf_verify(cia, sizeof cia, sizeof cia, bad), "hash alterado en el byte %u debía rechazarse", (unsigned)i);
  }
  // el tamaño distinto al anunciado no pasa aunque el hash de lo recibido coincida con el de lo que se recibió
  CHECK(!uf_verify(cia, sizeof cia - 1, sizeof cia, sha));
  CHECK(!uf_verify(cia, sizeof cia, sizeof cia - 1, sha));
  // el hash de un archivo más corto tampoco sirve para el entero
  uint8_t sha_short[SHA256_DIGEST_LEN];
  sha256(cia, sizeof cia - 1, sha_short);
  CHECK(!uf_verify(cia, sizeof cia, sizeof cia, sha_short));
  // entradas nulas: falla cerrado
  CHECK(!uf_verify(NULL, 0, 0, sha));
  CHECK(!uf_verify(cia, sizeof cia, sizeof cia, NULL));
  // hash de ceros (un campo sin llenar) no vale para un archivo real
  uint8_t zero[SHA256_DIGEST_LEN];
  memset(zero, 0, sizeof zero);
  CHECK(!uf_verify(cia, sizeof cia, sizeof cia, zero));
  CHECK(strstr(UF_ERR_MISMATCH, "no coincide con el que anunció el PC") != NULL);
}

static void test_result_without_action_ignored(void) {
  UpdFlow f;
  uf_init(&f, TOTAL);
  uf_result(&f, 5, 0); // sin acción entregada: no hace nada
  CHECK_EQ_INT(f.state, UF_DOWNLOADING);
  download_all(&f);
  UfAction act;
  CHECK(uf_next(&f, &act));
  CHECK(!uf_next(&f, &act)); // falta el resultado de la anterior
}

static void test_fault_text(void) {
  UfFault x;
  memset(&x, 0, sizeof x);
  char t[128];
  x.op = UF_OP_WRITE;
  x.rc = (int32_t)0xC8A08BF4;
  uf_fault_text(&x, t, sizeof t);
  CHECK_STR(t, "FSFILE_Write C8A08BF4 en el byte 0");
  x.op = UF_OP_START;
  uf_fault_text(&x, t, sizeof t);
  CHECK_STR(t, "AM_StartCiaInstall C8A08BF4");
  x.op = UF_OP_CANCEL;
  uf_fault_text(&x, t, sizeof t);
  CHECK_STR(t, "AM_CancelCIAInstall C8A08BF4");
  char small[8];
  uf_fault_text(&x, small, sizeof small); // sin desbordar
  CHECK(strlen(small) < sizeof small);
}

int main(void) {
  TEST_BEGIN("updflow: descarga a memoria, verificación, instalación en trozos y cancelar si AM falla (logic/updflow.c)");
  RUN(test_happy_path);
  RUN(test_chunks);
  RUN(test_steps_shown);
  RUN(test_write_fails_cancels_and_stops);
  RUN(test_write_fails_in_second_chunk);
  RUN(test_cancel_result_does_not_change_error);
  RUN(test_start_fails_no_cancel);
  RUN(test_short_write_and_finish_failure);
  RUN(test_network_cut_never_touches_am);
  RUN(test_download_progress_and_clamp);
  RUN(test_size_limits);
  RUN(test_verify);
  RUN(test_result_without_action_ignored);
  RUN(test_fault_text);
  TEST_END();
}
