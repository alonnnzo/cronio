// Genera gfx/cronio_palabra.png (logo completo, 232 px de ancho, fondo transparente) para la intro de la app.
// Uso: node_modules\electron\dist\electron.exe client-3ds\cia\gen-intro-logo.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const v = new BrowserWindow({ width: 300, height: 200, show: false });
  await v.loadFile(join(__dirname, "intro-logo.html"));
  const r = await v.webContents.executeJavaScript("render(232)");
  if (!r.ok) console.error("AVISO: no cargó Dela Gothic One (¿sin internet?)");
  writeFileSync(join(__dirname, "..", "gfx", "cronio_palabra.png"), Buffer.from(r.png.split(",")[1], "base64"));
  console.log(`gfx/cronio_palabra.png ${r.w}x${r.h}`);
  app.quit();
});
