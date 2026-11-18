// Dibuja las texturas del banner 3D (banner3d.html) con Electron y las guarda en cia/banner3d/ junto con medidas.json.
// Lo llama gen-banner3d.py; a mano: node_modules\electron\dist\electron.exe client-3ds\cia\gen-banner3d.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const v = new BrowserWindow({ width: 300, height: 200, show: false });
  await v.loadFile(join(__dirname, "banner3d.html"));
  const r = await v.webContents.executeJavaScript("render()");
  if (!r.okFuente) console.error("AVISO: no cargó Dela Gothic One (¿sin internet?); el banner usará otra letra");
  const dir = join(__dirname, "banner3d");
  mkdirSync(dir, { recursive: true });
  for (const n of ["fondo", "placa", "sombra", "ojo"]) {
    writeFileSync(join(dir, `${n}.png`), Buffer.from(r[n].split(",")[1], "base64"));
  }
  writeFileSync(join(dir, "medidas.json"), JSON.stringify(r.medidas, null, 2));
  console.log("texturas del banner 3D generadas en", dir);
  app.quit();
});
