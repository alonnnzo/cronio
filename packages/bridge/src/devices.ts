import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Device {
  deviceId: string;
  name: string;
  keyHex: string;
  pairedAt: string;
}

/** `devices.json`: se lee del disco en cada consulta (el CLI y el puente comparten el archivo). */
export class DeviceStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  list(): Device[] {
    try {
      const data: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(data) ? (data as Device[]) : [];
    } catch {
      return [];
    }
  }

  get(deviceId: string): Device | undefined {
    return this.list().find((d) => d.deviceId === deviceId);
  }

  add(device: Device): void {
    const next = this.list().filter((d) => d.deviceId !== device.deviceId);
    next.push(device);
    this.write(next);
  }

  /** Olvida un dispositivo (borra su clave del archivo). `false` si no estaba emparejado. */
  remove(deviceId: string): boolean {
    const all = this.list();
    const next = all.filter((d) => d.deviceId !== deviceId);
    if (next.length === all.length) return false;
    this.write(next);
    return true;
  }

  /** Escritura atómica: archivo temporal + rename. */
  private write(devices: Device[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(devices, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
