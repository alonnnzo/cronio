// Genera release/Cronio-Setup-<versión>.exe (y latest.yml, sin publicar nada: --publish never): compila el main, empaqueta el puente y corre electron-builder (sin firma de código).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const paquete = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
delete env.CSC_LINK;
delete env.WIN_CSC_LINK;

function correr(args) {
  const r = spawnSync("npm", args, { cwd: paquete, stdio: "inherit", env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
correr(["run", "build"]);
correr(["run", "bundle:bridge"]);
// Anota la carpeta `release` de esta máquina en `origen-local.json` SOLO si se pide con CRONIO_ORIGEN_LOCAL=1 (`npm run dist:local`,
// para quien desarrolla: el programa la usa como origen de actualizaciones por defecto si esa carpeta existe en el PC donde corre).
// Sin esa variable el archivo va vacío (`{}`) y el programa arranca con origen «ninguno»: la ruta de esta máquina nunca viaja en el
// instalador público. electron-builder exige que el archivo exista, por eso se escribe siempre. Ver docs/10-fase-7-instalador.md.
mkdirSync(resolve(paquete, "build"), { recursive: true });
const origenLocal = process.env.CRONIO_ORIGEN_LOCAL === "1" ? { carpeta: resolve(paquete, "release") } : {};
writeFileSync(resolve(paquete, "build", "origen-local.json"), `${JSON.stringify(origenLocal, null, 2)}\n`);
const b = spawnSync("npx", ["electron-builder", "--win", "nsis", "--publish", "never"], { cwd: paquete, stdio: "inherit", env, shell: true });
process.exit(b.status ?? 1);
