// Servidor HTTP que entrega el .cia a FBI. Solo responde GET /agent-companion.cia.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { CIA_PUERTO, CIA_RUTA } from "./setup/cia.ts";

export interface ServidorCia {
  puerto: number;
  cerrar(): Promise<void>;
}

/** Levanta el servidor. `puerto` 0 elige uno libre (para pruebas). */
export function iniciarServidorCia(rutaCia: string, puerto: number = CIA_PUERTO, host: string = "0.0.0.0"): Promise<ServidorCia> {
  const servidor: Server = createServer((req, res) => {
    const ruta = new URL(req.url ?? "/", "http://localhost").pathname;
    if (ruta !== CIA_RUTA) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "content-type": "text/plain; charset=utf-8" });
      res.end("Método no permitido");
      return;
    }
    let tamano: number;
    try {
      tamano = statSync(rutaCia).size;
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("El archivo .cia no existe");
      return;
    }
    // FBI necesita content-length para saber cuánto descargar
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": tamano });
    const flujo = createReadStream(rutaCia);
    flujo.on("error", () => res.destroy());
    flujo.pipe(res);
  });
  return new Promise((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(puerto, host, () => {
      const dir = servidor.address();
      resolver({
        puerto: typeof dir === "object" && dir ? dir.port : puerto,
        cerrar: () =>
          new Promise<void>((ok) => {
            servidor.close(() => ok());
            servidor.closeAllConnections();
          }),
      });
    });
  });
}
