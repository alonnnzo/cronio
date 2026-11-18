// Sirve los .cia de prueba de banners (cronio-banner-test-a/b/c/d.cia, de `make cia-banner-test`) por HTTP para
// FBI → Remote Install → Enter URL. Sin dependencias: solo Node.
//
//   node client-3ds/cia/servir-pruebas.mjs [puerto]        (por defecto 33338, en 0.0.0.0)
//
// Muestra en la terminal la URL de cada variante con la IP de la red local. Solo sirve esos cuatro archivos (no la app
// real); la 3DS y el PC deben estar en la misma red. Ctrl+C para parar.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const carpeta = join(dirname(fileURLToPath(import.meta.url)), "..");
const puerto = Number(process.argv[2] ?? 33338);
const variantes = { a: "control: banner plano", b: "un plano 3D, sin animación", c: "capas, sin animación", d: "capas con animación de escala" };
const archivo = (v) => join(carpeta, `cronio-banner-test-${v}.cia`);
const permitido = /^\/cronio-banner-test-([a-d])\.cia$/;

const servidor = createServer((req, res) => {
  const m = permitido.exec((req.url ?? "").split("?")[0]);
  const ruta = m && archivo(m[1]);
  const quien = req.socket.remoteAddress;
  if (!ruta || !existsSync(ruta) || (req.method !== "GET" && req.method !== "HEAD")) {
    console.log(`${new Date().toLocaleTimeString()}  ${quien}  ${req.method} ${req.url}  -> 404`);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("no está\n");
    return;
  }
  const tam = statSync(ruta).size;
  console.log(`${new Date().toLocaleTimeString()}  ${quien}  ${req.method} ${req.url}  -> ${tam} bytes`);
  res.writeHead(200, { "content-type": "application/octet-stream", "content-length": tam });
  if (req.method === "HEAD") return void res.end();
  createReadStream(ruta).pipe(res);
});

servidor.listen(puerto, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log(`Sirviendo ${carpeta} en 0.0.0.0:${puerto}\n`);
  console.log("En la 3DS: FBI → Remote Install → Enter URL, y escribe la dirección de una variante (instálalas de a una, en orden A, B, C, D):\n");
  for (const [v, texto] of Object.entries(variantes)) {
    const falta = existsSync(archivo(v)) ? "" : "   [no existe: corre `make cia-banner-test` en client-3ds]";
    for (const ip of ips.length ? ips : ["<IP-del-PC>"]) {
      console.log(`  Banner ${v.toUpperCase()} (${texto}):  http://${ip}:${puerto}/cronio-banner-test-${v}.cia${falta}`);
    }
  }
  console.log("\nCtrl+C para parar.");
});
