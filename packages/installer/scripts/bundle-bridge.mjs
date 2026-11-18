// Empaqueta el puente (packages/bridge/src/cli.ts) en un solo archivo para llevarlo dentro de Cronio.
// Sale ESM (.mjs): el puente usa import.meta.dirname, y zod/ws entran sin dependencias nativas.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "..", "..", "..");
const salida = resolve(aqui, "..", "build", "bridge", "cli.mjs");
mkdirSync(dirname(salida), { recursive: true });
// la versión del puente va dentro del bundle (/health la dice) y en un archivo al lado, que el programa del PC compara con la del puente que encuentre
const version = JSON.parse(readFileSync(resolve(raiz, "packages", "bridge", "package.json"), "utf8")).version;

await build({
  entryPoints: [resolve(raiz, "packages", "bridge", "src", "cli.ts")],
  outfile: salida,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ws trae `require` de módulos nativos opcionales dentro de try/catch; sin ellos usa JS puro
  external: ["bufferutil", "utf-8-validate"],
  // las dependencias CJS (ws) llaman a require() de módulos de Node
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  define: { __BRIDGE_VERSION__: JSON.stringify(version) },
  legalComments: "none",
  logLevel: "info",
});
writeFileSync(resolve(dirname(salida), "cli.version"), `${version}
`);
console.log(`Puente ${version} empaquetado en ${salida}`);
