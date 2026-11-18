#include "updflow.h"

#include <stdio.h>
#include <string.h>

#include "../core/sha256.h"

const char *uf_op_name(UfOp op) {
  switch (op) {
    case UF_OP_START: return "AM_StartCiaInstall";
    case UF_OP_WRITE: return "FSFILE_Write";
    case UF_OP_FINISH: return "AM_FinishCiaInstall";
    case UF_OP_CANCEL: return "AM_CancelCIAInstall";
  }
  return "?";
}

void uf_fault_text(const UfFault *x, char *out, size_t cap) {
  if (cap == 0) return;
  unsigned long rc = (unsigned long)(uint32_t)x->rc;
  if (x->op != UF_OP_WRITE) {
    snprintf(out, cap, "%s %08lX", uf_op_name(x->op), rc);
  } else if (x->rc != 0) {
    snprintf(out, cap, "%s %08lX en el byte %u", uf_op_name(x->op), rc, (unsigned)x->offset);
  } else { // la llamada salió bien pero escribió de menos
    snprintf(out, cap, "%s %08lX en el byte %u (escribió %u de %u)", uf_op_name(x->op), rc, (unsigned)x->offset, (unsigned)x->written, (unsigned)x->len);
  }
}

int uf_size_ok(int64_t bytes) { return bytes >= (int64_t)UF_MIN_CIA_BYTES && bytes <= (int64_t)UF_MAX_CIA_BYTES; }

int uf_verify(const uint8_t *buf, uint32_t len, uint32_t want_size, const uint8_t want_sha[32]) {
  if (buf == NULL || want_sha == NULL || len != want_size) return 0;
  uint8_t got[SHA256_DIGEST_LEN];
  sha256(buf, len, got);
  return ct_equal(got, want_sha, SHA256_DIGEST_LEN);
}

static void set_next(UpdFlow *f, UfOp op, uint32_t offset, uint32_t len) {
  f->has_next = 1;
  f->next.op = op;
  f->next.offset = offset;
  f->next.len = len;
  f->next.step = op == UF_OP_FINISH ? UPD_STEP_FINISH : UPD_STEP_INSTALL;
}

static void next_write(UpdFlow *f) {
  if (f->offset >= f->total) {
    set_next(f, UF_OP_FINISH, 0, 0);
    return;
  }
  uint32_t len = f->total - f->offset;
  if (len > UF_CHUNK_BYTES) len = UF_CHUNK_BYTES;
  set_next(f, UF_OP_WRITE, f->offset, len);
}

void uf_init(UpdFlow *f, uint32_t total) {
  memset(f, 0, sizeof *f);
  f->state = UF_DOWNLOADING;
  f->total = total;
}

void uf_downloaded(UpdFlow *f, uint32_t n) {
  if (f->state != UF_DOWNLOADING) return;
  uint64_t r = (uint64_t)f->received + n;
  f->received = r > f->total ? f->total : (uint32_t)r;
  if (f->received >= f->total) {
    f->state = UF_INSTALLING;
    set_next(f, UF_OP_START, 0, 0);
  }
}

void uf_download_failed(UpdFlow *f) {
  if (f->state != UF_DOWNLOADING) return;
  f->state = UF_FAILED; // AM no se tocó
  f->has_next = 0;
}

int uf_next(UpdFlow *f, UfAction *a) {
  if (f->state != UF_INSTALLING || f->have_action || !f->has_next) return 0;
  f->last = f->next;
  f->has_next = 0;
  f->have_action = 1;
  f->am_touched = 1;
  *a = f->last;
  return 1;
}

static void give_up(UpdFlow *f) {
  f->state = UF_FAILED;
  f->has_next = 0;
  uf_fault_text(&f->fault, f->error, sizeof f->error);
}

// Falló una acción. `has_handle`: hay un manejador de instalación abierto que cancelar antes de terminar.
static void action_failed(UpdFlow *f, UfFault x, int has_handle) {
  x.set = 1;
  f->fault = x;
  if (has_handle) set_next(f, UF_OP_CANCEL, 0, 0);
  else give_up(f);
}

void uf_result(UpdFlow *f, int32_t rc, uint32_t written) {
  if (!f->have_action || f->state != UF_INSTALLING) return;
  f->have_action = 0;
  UfFault x;
  memset(&x, 0, sizeof x);
  x.op = f->last.op;
  x.rc = rc;
  switch (f->last.op) {
    case UF_OP_START:
      if (rc != 0) action_failed(f, x, 0); // sin manejador: no hay nada que cancelar
      else next_write(f);
      break;
    case UF_OP_WRITE:
      if (rc != 0 || written != f->last.len) {
        x.offset = f->last.offset;
        x.len = f->last.len;
        x.written = written;
        action_failed(f, x, 1);
      } else {
        f->offset += f->last.len;
        next_write(f);
      }
      break;
    case UF_OP_FINISH:
      if (rc != 0) action_failed(f, x, 0); // el manejador se consumió con la llamada
      else f->state = UF_DONE;
      break;
    case UF_OP_CANCEL: // el resultado de cancelar no cambia nada: se termina con el error de antes
      give_up(f);
      break;
  }
}

uint32_t uf_progress(const UpdFlow *f) { return f->state == UF_DOWNLOADING ? f->received : f->offset; }
