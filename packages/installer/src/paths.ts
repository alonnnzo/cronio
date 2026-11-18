// Rutas de recursos de Cronio en sus dos modos: empaquetado (carpeta `resources` junto al .exe) y desarrollo (dentro del repo).
import { join, resolve } from "node:path";

export interface OpcionesRutas {
  /** `app.isPackaged`. */
  empaquetada: boolean;
  /** Carpeta de `dist/main.js` (el `__dirname` del proceso principal). */
  dirMain: string;
  /** `process.resourcesPath`; solo se usa empaquetada. */
  recursos?: string;
  /** Ejecutable actual (`process.execPath`); empaquetada es Cronio.exe. */
  ejecutable?: string;
}

export interface RutasApp {
  empaquetada: boolean;
  /** Raíz del repo; solo existe en desarrollo. */
  raizRepo?: string;
  /** Carpeta del paquete (en desarrollo) o `app.asar` (empaquetada): contiene `renderer/` y `dist/`. */
  raizApp: string;
  preload: string;
  renderer: string;
  ico: string;
  hookOrigen: string;
  carpetasOrigen: string;
  /** SKILL.md de «grill-me» que se copia a ~/.claude/skills. */
  skillGrillMe: string;
  cia: string;
  /** `agent-companion.version`: la versión del .cia, junto a él (lo deja `make cia`); el puente la lee de ahí. */
  ciaVersion: string;
  tresdsx: string;
  /** Carpeta con el cliente 3DS (para abrirla si falta el .cia). */
  carpetaCliente: string;
  /** Carpeta estática del simulador que sirve el puente. */
  simulador: string;
  /**
   * Dónde está la versión del puente que trae esta app: empaquetada, `bridge/cli.version` (lo escribe `bundle:bridge`);
   * en desarrollo, el `package.json` del puente.
   */
  puenteVersion: string;
}

export interface ComandoPuente {
  archivo: string;
  args: string[];
  cwd: string;
  /** Variables a sumar al entorno del proceso. */
  env: Record<string, string>;
}

export function crearRutas(o: OpcionesRutas): RutasApp {
  const raizApp = resolve(o.dirMain, "..");
  if (o.empaquetada) {
    const r = o.recursos;
    if (!r) throw new Error("Falta la carpeta de recursos de la app empaquetada");
    return {
      empaquetada: true,
      raizApp,
      preload: join(o.dirMain, "preload.js"),
      renderer: join(raizApp, "renderer", "index.html"),
      ico: join(r, "assets", "cronio.ico"),
      hookOrigen: join(r, "hooks", "permission-hook.mjs"),
      carpetasOrigen: join(r, "hooks", "carpetas.mjs"),
      skillGrillMe: join(r, "skills", "grill-me", "SKILL.md"),
      cia: join(r, "client-3ds", "agent-companion.cia"),
      ciaVersion: join(r, "client-3ds", "agent-companion.version"),
      tresdsx: join(r, "client-3ds", "agent-companion.3dsx"),
      carpetaCliente: join(r, "client-3ds"),
      simulador: join(r, "simulator"),
      puenteVersion: join(r, "bridge", "cli.version"),
    };
  }
  // dist/main.js está en packages/installer/dist: la raíz del repo queda tres carpetas arriba
  const raizRepo = resolve(o.dirMain, "..", "..", "..");
  return {
    empaquetada: false,
    raizRepo,
    raizApp,
    preload: join(o.dirMain, "preload.js"),
    renderer: join(raizApp, "renderer", "index.html"),
    ico: join(raizApp, "assets", "cronio.ico"),
    hookOrigen: join(raizRepo, "packages", "hooks", "permission-hook.mjs"),
    carpetasOrigen: join(raizRepo, "packages", "hooks", "carpetas.mjs"),
    skillGrillMe: join(raizRepo, "packages", "hooks", "skills", "grill-me", "SKILL.md"),
    cia: join(raizRepo, "client-3ds", "agent-companion.cia"),
    ciaVersion: join(raizRepo, "client-3ds", "agent-companion.version"),
    tresdsx: join(raizRepo, "client-3ds", "agent-companion.3dsx"),
    carpetaCliente: join(raizRepo, "client-3ds"),
    simulador: join(raizRepo, "packages", "simulator", "public"),
    puenteVersion: join(raizRepo, "packages", "bridge", "package.json"),
  };
}

/**
 * Cómo se lanza el puente.
 * Empaquetada: el propio Cronio.exe como Node (`ELECTRON_RUN_AS_NODE`) con el bundle de `resources/bridge`.
 * Desarrollo: `node --import tsx` sobre el código fuente, como `npm run companion -- start`.
 * Empaquetado le pasa además COMPANION_SIMULATOR=0: el programa instalado no levanta el simulador (su WebSocket local no es para el usuario final).
 * En los dos modos le pasa COMPANION_CIA_PATH: el puente sirve ese .cia en el puerto 33337 y lee su versión del `.version` que
 * está al lado (en el modo empaquetado, ambos vienen de `resources/client-3ds`).
 */
/** Solo pruebas (ver `PUENTE_PUERTO` en bridge-proc.ts): los puertos propios del puente de prueba. */
function puertosPrueba(env: Record<string, string | undefined> = process.env): string[] {
  const v = env.CRONIO_PUERTOS_PRUEBA;
  if (!v || !/^\d{2,5},\d{2,5},\d{2,5},\d{2,5}$/.test(v)) return [];
  const [api, consola, udp, ws] = v.split(",");
  return ["--api-port", api!, "--console-port", consola!, "--udp-port", udp!, "--ws-port", ws!];
}

export function comandoPuente(o: OpcionesRutas, carpetaDatos: string): ComandoPuente {
  if (o.empaquetada) {
    const r = o.recursos;
    if (!r || !o.ejecutable) throw new Error("Faltan recursos o ejecutable de la app empaquetada");
    return {
      archivo: o.ejecutable,
      args: [join(r, "bridge", "cli.mjs"), "start", "--data-dir", join(carpetaDatos, "bridge"), ...puertosPrueba()],
      cwd: r,
      env: { ELECTRON_RUN_AS_NODE: "1", COMPANION_STATIC_DIR: join(r, "simulator"), COMPANION_CIA_PATH: crearRutas(o).cia, COMPANION_SIMULATOR: "0" },
    };
  }
  const raiz = resolve(o.dirMain, "..", "..", "..");
  return { archivo: "node", args: ["--import", "tsx", "packages/bridge/src/cli.ts", "start"], cwd: raiz, env: { COMPANION_CIA_PATH: crearRutas(o).cia } };
}
