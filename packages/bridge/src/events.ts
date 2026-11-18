import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type EventType =
  | "agent_seen"
  | "state"
  | "request"
  | "decision"
  | "timeout"
  | "notice"
  | "ack"
  | "instruction_queued"
  | "console_connected"
  | "console_disconnected";

/** Tamaño a partir del cual el registro se rota: pasa a `<archivo>.1` (reemplaza al anterior) y se empieza uno nuevo. */
export const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Registro JSONL (una línea por evento). La ruta se inyecta; los fallos de disco nunca tumban al puente. Al pasar de 5 MB (`maxBytes`)
 * se renombra a `.1`, reemplazando el anterior: así el disco no se llena y quedan entre 5 y 10 MB de historia.
 */
export class EventLog {
  readonly path: string;
  private readonly maxBytes: number;
  /** Bytes del archivo actual; `undefined` hasta saberlo (se mide con el primer evento). */
  private size: number | undefined;

  constructor(path: string, maxBytes: number = MAX_LOG_BYTES) {
    this.path = path;
    this.maxBytes = maxBytes;
  }

  log(type: EventType, data: Record<string, unknown> = {}): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const line = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n";
      if (this.size === undefined) {
        try {
          this.size = statSync(this.path).size;
        } catch {
          this.size = 0;
        }
      }
      if (this.size >= this.maxBytes) {
        try {
          renameSync(this.path, `${this.path}.1`);
        } catch {
          // sin poder rotar (archivo abierto por otro programa, p. ej.) se sigue escribiendo en el mismo
        }
        this.size = 0;
      }
      appendFileSync(this.path, line);
      this.size += Buffer.byteLength(line);
    } catch {
      // el registro es auxiliar
    }
  }
}
