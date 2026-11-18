// `npm run dist:local`: igual que `dist`, pero anota la carpeta `release` de esta máquina como origen de actualizaciones por defecto
// (solo para quien desarrolla; el instalador que se publica se hace con `npm run dist`). Funciona igual en Windows, sin `cross-env`.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "dist.mjs");
const r = spawnSync(process.execPath, [dist], { stdio: "inherit", env: { ...process.env, CRONIO_ORIGEN_LOCAL: "1" } });
process.exit(r.status ?? 1);
