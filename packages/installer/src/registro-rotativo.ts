// Registro en archivo con rotación por tamaño (el `bridge.log` del puente): al pasar de 5 MB se renombra a `<archivo>.1`, reemplazando el
// anterior, y se sigue en uno nuevo. Así el disco no se llena aunque el puente escriba sin parar. Escritura síncrona y sin lanzar: el
// registro es auxiliar y nunca debe tumbar al programa.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_LOG_BYTES = 5 * 1024 * 1024;

export class RegistroRotativo {
  /** Bytes del archivo actual; `undefined` hasta medirlo (con la primera escritura). */
  private size: number | undefined;
  /** El motivo del último fallo al escribir (el registro no tumba al programa, pero tampoco calla); `undefined` si va bien. */
  ultimoError: string | undefined;

  constructor(
    readonly ruta: string,
    private readonly maxBytes: number = MAX_LOG_BYTES,
  ) {}

  write(datos: string | Uint8Array): void {
    try {
      const bytes = typeof datos === "string" ? Buffer.byteLength(datos) : datos.byteLength;
      if (this.size === undefined) {
        mkdirSync(dirname(this.ruta), { recursive: true });
        try {
          this.size = statSync(this.ruta).size;
        } catch {
          this.size = 0;
        }
      }
      if (this.size >= this.maxBytes) {
        try {
          renameSync(this.ruta, `${this.ruta}.1`);
        } catch {
          // sin poder rotar (otro programa lo tiene abierto) se sigue escribiendo en el mismo
        }
        this.size = 0;
      }
      appendFileSync(this.ruta, datos);
      this.size += bytes;
      this.ultimoError = undefined;
    } catch (err) {
      // el registro es auxiliar: no lanza, pero deja el motivo para que se muestre
      this.ultimoError = `${this.ruta}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
