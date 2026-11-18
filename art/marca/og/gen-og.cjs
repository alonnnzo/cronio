// Dibuja og.html con Electron y guarda site/og.png (1200x630). Igual que client-3ds/cia/gen-banner.cjs:
//   node_modules\electron\dist\electron.exe art\marca\og\gen-og.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const v = new BrowserWindow({ width: 1200, height: 630, show: false, useContentSize: true });
  await v.loadFile(join(__dirname, "og.html"));
  const ok = await v.webContents.executeJavaScript("document.fonts.load('36px \"Dela Gothic One\"').then(() => document.fonts.ready).then(() => document.fonts.check('36px \"Dela Gothic One\"'))");
  if (!ok) console.error("AVISO: no cargó Dela Gothic One");
  await new Promise((r) => setTimeout(r, 400));
  let img = await v.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== 1200 || height !== 630) img = img.resize({ width: 1200, height: 630, quality: "best" });
  writeFileSync(join(__dirname, "..", "..", "..", "site", "og.png"), img.toPNG());
  console.log("site/og.png generado");
  app.quit();
});
