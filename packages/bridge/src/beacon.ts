import { createSocket, type Socket } from "node:dgram";
import { hostname, networkInterfaces } from "node:os";

export interface BeaconOptions {
  /** Puerto TCP de la consola que se anuncia. */
  consolePort: number;
  /** Puerto UDP de destino. Por defecto 33333. */
  udpPort?: number;
  name?: string;
  intervalMs?: number;
}

/** Dirección de difusión de una subred IPv4 a partir de la IP y la máscara. */
export function broadcastAddress(ip: string, mask: string): string {
  const a = ip.split(".").map(Number);
  const m = mask.split(".").map(Number);
  return a.map((x, i) => (x! | (~m[i]! & 255)) & 255).join(".");
}

/**
 * Aviso UDP por cada interfaz IPv4 no interna: un socket enlazado a la dirección de la interfaz
 * (así el paquete sale por la interfaz correcta) que envía a la difusión de su subred.
 */
export function startBeacon(options: BeaconOptions): { stop(): void } {
  const udpPort = options.udpPort ?? 33333;
  const payload = Buffer.from(
    JSON.stringify({ service: "3ds-agent-companion", v: 1, port: options.consolePort, name: options.name ?? hostname() }),
  );
  const sockets = new Map<string, Socket>();
  const ready = new Set<string>();

  const drop = (address: string) => {
    const s = sockets.get(address);
    sockets.delete(address);
    ready.delete(address);
    try {
      s?.close();
    } catch {
      // ya cerrado
    }
  };

  const tick = () => {
    const current = new Map<string, string>();
    for (const list of Object.values(networkInterfaces())) {
      for (const i of list ?? []) {
        if (i.family === "IPv4" && !i.internal) current.set(i.address, broadcastAddress(i.address, i.netmask));
      }
    }
    for (const address of [...sockets.keys()]) if (!current.has(address)) drop(address);
    for (const [address, broadcast] of current) {
      const send = (socket: Socket) => {
        try {
          socket.send(payload, udpPort, broadcast, () => {});
        } catch {
          // interfaz caída: se reintenta en el siguiente ciclo
        }
      };
      const existing = sockets.get(address);
      if (existing) {
        if (ready.has(address)) send(existing);
        continue;
      }
      const created = createSocket("udp4");
      sockets.set(address, created);
      created.on("error", () => drop(address));
      created.bind({ address, port: 0 }, () => {
        try {
          created.setBroadcast(true);
        } catch {
          drop(address);
          return;
        }
        ready.add(address);
        send(created);
      });
    }
  };

  tick();
  const timer = setInterval(tick, options.intervalMs ?? 2000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      for (const address of [...sockets.keys()]) drop(address);
    },
  };
}
