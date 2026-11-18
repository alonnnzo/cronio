// Dibuja las texturas del logo de arranque (logo.html) y las guarda en cia/logo/arriba.png y abajo.png.
// Lo llama gen-logo.py.
const { app, BrowserWindow } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const v = new BrowserWindow({ width: 200, height: 200, show: false });
  await v.loadFile(join(__dirname, "logo.html"));
  const r = await v.webContents.executeJavaScript("render()");
  if (!r.okFuente) console.error("AVISO: no cargó Dela Gothic One (¿sin internet?); el logo usará otra letra");
  const dir = join(__dirname, "logo");
  mkdirSync(dir, { recursive: true });
  for (const n of ["arriba", "abajo"]) writeFileSync(join(dir, `${n}.png`), Buffer.from(r[n].split(",")[1], "base64"));
  console.log("texturas del logo generadas en", dir);
  app.quit();
});
