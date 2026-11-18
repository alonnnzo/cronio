import { join } from "node:path";
import { DeviceStore } from "./devices.ts";
import { parentPidFromEnv, watchParent } from "./lifecycle.ts";
import { DEFAULT_PORTS, defaultDataDir, startBridge } from "./main.ts";
import { readTokenFile, TOKEN_HEADER } from "./api-token.ts";
import { carpetaDatos } from "../../hooks/carpetas.mjs";

const USAGE = `Uso: companion <comando> [opciones]

  start     arranca el puente (API 33335, consola 33334, simulador 33340, aviso UDP 33333)
            con COMPANION_SIMULATOR=0 no abre el simulador
  pair      pide al puente en marcha un código de emparejamiento (válido 5 minutos)
  devices   lista los dispositivos emparejados
  devices forget <id>
            olvida un dispositivo: borra su clave y corta su conexión (tendrá que emparejarse de nuevo)

Opciones: --data-dir <carpeta>  --api-port <puerto>
          --console-port <puerto>  --ws-port <puerto>  --udp-port <puerto>   (solo para pruebas en paralelo)`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * `devices forget <id>`. Con el puente en marcha se le pide por la API (borra la clave y corta la conexión de esa consola); si no responde,
 * se borra del archivo directamente (cuando arranque, esa consola ya no podrá autenticarse).
 */
async function olvidarDispositivo(id: string | undefined, dataDir: string, apiPort: number): Promise<number> {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    console.error("Uso: companion devices forget <id>   (el id sale de «companion devices»)");
    return 1;
  }
  try {
    const token = readTokenFile(dataDir, carpetaDatos());
    const res = await fetch(`http://127.0.0.1:${apiPort}/devices/forget`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { [TOKEN_HEADER]: token } : {}) },
      body: JSON.stringify({ deviceId: id }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) {
      // 404 del puente nuevo = no está emparejado; 404 de uno anterior (sin esta ruta) = se borra del archivo, más abajo
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (cuerpo.error?.includes("no está emparejada")) {
        console.error(`${id} no está emparejado.`);
        return 1;
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json()) as { disconnected?: boolean };
    console.log(`Olvidé ${id}${r.disconnected ? " y corté su conexión" : ""}. Para volver a usarla hay que emparejarla de nuevo.`);
    return 0;
  } catch {
    // sin puente (o uno anterior que no sabe olvidar): se borra del archivo
    if (!new DeviceStore(join(dataDir, "devices.json")).remove(id)) {
      console.error(`${id} no está emparejado.`);
      return 1;
    }
    console.log(`Olvidé ${id} (el puente no está en marcha: no había conexión que cortar). Para volver a usarla hay que emparejarla de nuevo.`);
    return 0;
  }
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const dataDir = flag(args, "--data-dir") ?? defaultDataDir();
  const apiPort = Number(flag(args, "--api-port") ?? process.env.COMPANION_API_PORT ?? DEFAULT_PORTS.api);

  switch (command) {
    case "start": {
      const puerto = (nombre: string): number | undefined => {
        const v = flag(args, nombre);
        return v === undefined ? undefined : Number(v);
      };
      let apagar: () => void = () => {};
      const bridge = await startBridge({ dataDir, apiPort, onShutdown: () => apagar(), consolePort: puerto("--console-port"), wsPort: puerto("--ws-port"), udpPort: puerto("--udp-port"), log: (m) => console.log(`[puente ${new Date().toLocaleTimeString("es-CL", { hour12: false })}] ${m}`) });
      console.log(`Puente en marcha.
${bridge.ports.ws === undefined ? "" : `  Simulador:  http://127.0.0.1:${bridge.ports.ws}/\n`}  API local:  http://127.0.0.1:${bridge.ports.api}
  Consola:    TCP ${bridge.ports.console}
  Datos:      ${bridge.dataDir}
Ctrl+C para detener.`);
      let cerrando = false;
      const shutdown = () => {
        if (cerrando) return;
        cerrando = true;
        bridge.stop().finally(() => process.exit(0));
      };
      apagar = shutdown;
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      // lanzado por el programa del PC (COMPANION_PARENT_PID): si ese proceso muere de golpe, el puente se cierra solo
      const padre = parentPidFromEnv();
      if (padre !== undefined) {
        watchParent(padre, () => {
          console.log(`El programa que lanzó el puente (PID ${padre}) ya no existe: cerrando.`);
          shutdown();
        });
      }
      return -1; // sigue vivo
    }
    case "pair": {
      try {
        // el token lo escribe el puente al arrancar, en su carpeta de datos (y una copia en la de configuración de la app)
        const token = readTokenFile(dataDir, carpetaDatos());
        const res = await fetch(`http://127.0.0.1:${apiPort}/pair`, { method: "POST", headers: token ? { [TOKEN_HEADER]: token } : {}, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { code, expiresInS } = (await res.json()) as { code: string; expiresInS: number };
        console.log(`Código de emparejamiento: ${code}\nVálido ${Math.round(expiresInS / 60)} minutos y de un solo uso. Escríbelo en la consola 3DS.`);
        return 0;
      } catch (err) {
        console.error(`No se pudo contactar al puente en 127.0.0.1:${apiPort} (${String(err)}). ¿Está corriendo "companion start"?`);
        return 1;
      }
    }
    case "devices": {
      if (args[0] === "forget") return olvidarDispositivo(args[1], dataDir, apiPort);
      const devices = new DeviceStore(join(dataDir, "devices.json")).list();
      if (devices.length === 0) console.log("Sin dispositivos emparejados.");
      for (const d of devices) console.log(`${d.deviceId}\t${d.name}\temparejado ${d.pairedAt}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return command === undefined || command === "help" || command === "--help" ? 0 : 1;
  }
}

main().then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
