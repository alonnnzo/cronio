import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lo reemplaza esbuild (`define`) al empaquetar el puente dentro de Cronio; en desarrollo no existe. */
declare const __BRIDGE_VERSION__: string | undefined;

/** Versión del paquete del puente: inyectada en el bundle, o leída de `packages/bridge/package.json` en desarrollo. */
export function bridgeVersion(): string {
  if (typeof __BRIDGE_VERSION__ === "string") return __BRIDGE_VERSION__;
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // sin package.json (bundle sin versión inyectada): queda desconocida
  }
  return "desconocida";
}
