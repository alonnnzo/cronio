// Dibuja banner.html con Electron y guarda banner.png (256x128). Lo llama gen-art.py; también sirve a mano:
//   node_modules\electron\dist\electron.exe client-3ds\cia\gen-banner.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const v = new BrowserWindow({ width: 256, height: 128, show: false, useContentSize: true, webPreferences: { offscreen: false } });
  await v.loadFile(join(__dirname, "banner.html"));
  await v.webContents.executeJavaScript("document.fonts.load('36px \"Dela Gothic One\"').then(() => document.fonts.ready).then(() => document.fonts.check('36px \"Dela Gothic One\"'))")
    .then((ok) => { if (!ok) console.error("AVISO: no cargó Dela Gothic One (¿sin internet?); el banner usará otra letra"); });
  await new Promise((r) => setTimeout(r, 400));
  let img = await v.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== 256 || height !== 128) img = img.resize({ width: 256, height: 128, quality: "best" });
  writeFileSync(join(__dirname, "banner.png"), img.toPNG());
  console.log("banner.png generado");
  app.quit();
});
