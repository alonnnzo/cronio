// Proceso principal de Cronio (instalador y puente): ventana, bandeja, puente hijo y servidor del .cia.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import { Actualizador } from "./actualizador.ts";
import { consultarSalud, detenerPuenteViejo, leerVersionBundle, PUENTE_API, ProcesoPuente } from "./bridge-proc.ts";
import { iniciarServidorCia } from "./cia-server.ts";
import type { ServidorCia } from "./cia-server.ts";
import { crearIconoPng } from "./icon.ts";
import { cabecerasApi, carpetaConfig } from "./token-api.ts";
import { comandoPuente, crearRutas } from "./paths.ts";
import { agregarHooks, quitarHooks, revisarHooks } from "./setup/apply.ts";
import type { RutasHooks } from "./setup/apply.ts";
import { conCarpeta, guardarCarpetas, leerCarpetas, sinCarpeta } from "./setup/carpetas.ts";
import type { ModoCarpetas } from "./setup/carpetas.ts";
import { CIA_PUERTO, decidirOrigenCia, urlCia } from "./setup/cia.ts";
import { argsMostrarRegla, comandoElevadoReemplazar, estadoConAntigua, leerReglaFirewall, REGLA_NOMBRE_ANTERIOR } from "./setup/firewall.ts";
import { avisosRedPublica, elegirDireccionesLan, leerInterfacesConPuerta, leerPerfilesRed } from "./setup/network.ts";
import { comprobarNode } from "./setup/node-version.ts";
import { cuerpoOlvidar, leerConsolas } from "./setup/dispositivos.ts";
import { rutaPrograma } from "./setup/sistema.ts";
import { HOOK_EVENTOS } from "./setup/settings.ts";
import { instalarSkill, quitarSkill, revisarSkill } from "./setup/skills.ts";
import type { DireccionLan, InterfazRed } from "./setup/network.ts";

const OPCIONES_RUTAS = {
  empaquetada: app.isPackaged,
  dirMain: __dirname,
  recursos: process.resourcesPath,
  ejecutable: process.execPath,
};
const RUTAS = crearRutas(OPCIONES_RUTAS);
const CARPETA_DATOS = carpetaConfig();
const RUTA_CIA = RUTAS.cia;
const RUTA_3DSX = RUTAS.tresdsx;

const iniciarOculto = process.argv.includes("--hidden");
const capturas = process.argv.find((a) => a.startsWith("--debug-shots="))?.slice("--debug-shots=".length);

const ENLACES = {
  node: "https://nodejs.org/es",
  guia3ds: "https://3ds.hacks.guide/es_ES/",
} as const;

app.setName("Cronio");

let ventana: BrowserWindow | undefined;
let bandeja: Tray | undefined;
let saliendo = false;
let servidorCia: ServidorCia | undefined;
const puente = new ProcesoPuente(comandoPuente(OPCIONES_RUTAS, CARPETA_DATOS), join(CARPETA_DATOS, "logs"), leerVersionBundle(RUTAS.puenteVersion));
/** El arranque del puente al abrir la app: el paso 4 espera a que termine antes de decidir quién entrega el .cia. */
let arranquePuente: Promise<unknown> = Promise.resolve();
const actualizador = new Actualizador({
  datosDir: CARPETA_DATOS,
  instalada: app.getVersion(),
  empaquetada: app.isPackaged,
  recursos: process.resourcesPath,
  notificar: (version) => {
    // una vez por versión; con la app en la bandeja es lo único que se hace: actualizar siempre lo pide el usuario
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: "Cronio", body: `Hay una versión nueva de Cronio (${version}). Ábrela para actualizar.` });
    n.on("click", mostrarVentana);
    n.show();
  },
  salir: () => app.quit(),
});
let cierreEnCurso = false;
let cierreListo = false;

function rutasHooks(): RutasHooks {
  return {
    settingsPath: join(homedir(), ".claude", "settings.json"),
    hooksDir: join(CARPETA_DATOS, "hooks"),
    hookOrigen: RUTAS.hookOrigen,
    carpetasOrigen: RUTAS.carpetasOrigen,
    datosDir: CARPETA_DATOS,
  };
}

function ejecutar(archivo: string, args: string[], timeout = 15000): Promise<{ salida: string; codigo: number }> {
  return new Promise((ok) => {
    execFile(archivo, args, { windowsHide: true, timeout, encoding: "utf8" }, (err, stdout, stderr) => {
      const codigo = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      ok({ salida: `${stdout}${stderr}`, codigo });
    });
  });
}

function mensajeDeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- ventana y bandeja ----------

function crearVentana(): BrowserWindow {
  // el .ico (assets/cronio.ico, hecho con scripts/gen-ico.ts) trae todos los tamaños; si falta, se dibuja el PNG
  const rutaIco = RUTAS.ico;
  const icono = existsSync(rutaIco) ? nativeImage.createFromPath(rutaIco) : nativeImage.createFromBuffer(crearIconoPng(64));
  const v = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: "Cronio",
    backgroundColor: "#e6e9ee",
    autoHideMenuBar: true,
    icon: icono,
    webPreferences: {
      preload: RUTAS.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  v.removeMenu();
  // la interfaz no navega ni abre ventanas por su cuenta
  v.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  v.webContents.on("will-navigate", (e) => e.preventDefault());
  v.webContents.on("console-message", (e) => {
    if (e.level === "error" || e.level === "warning") console.log(`[interfaz ${e.level}] ${e.message}`);
  });
  v.on("close", (e) => {
    // cerrar la ventana la manda a la bandeja; "Salir" la cierra de verdad
    if (!saliendo && bandeja) {
      e.preventDefault();
      v.hide();
    }
  });
  // con carpeta local, volver a la ventana (foco o desde la bandeja) busca si hace más de 15 s que no se mira
  v.on("focus", () => actualizador.alFoco());
  v.on("show", () => actualizador.alFoco());
  void v.loadFile(RUTAS.renderer);
  return v;
}

function mostrarVentana(): void {
  if (!ventana || ventana.isDestroyed()) ventana = crearVentana();
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}

function crearBandeja(): void {
  bandeja = new Tray(nativeImage.createFromBuffer(crearIconoPng(32)));
  bandeja.setToolTip("Cronio");
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir", click: mostrarVentana },
      { type: "separator" },
      { label: "Salir (detiene el puente que inició la app)", click: () => app.quit() },
    ]),
  );
  bandeja.on("click", mostrarVentana);
}

// ---------- servidor del .cia ----------

async function detenerCia(): Promise<void> {
  const s = servidorCia;
  servidorCia = undefined;
  await s?.cerrar();
}

// ---------- mensajes desde la interfaz (solo funciones con nombre) ----------

function registrarIpc(): void {
  // En modo capturas (--debug-shots) la interfaz solo se mira: nada que cambie algo del PC (puentes, firewall, archivos de Claude Code,
  // inicio con Windows, actualizaciones) se ejecuta, aunque alguien pulse un botón de la ventana de prueba.
  const INERTES = new Set(["puente-iniciar", "puente-detener", "puente-detener-viejo", "fw-agregar", "inicio-cambiar", "hooks-agregar", "hooks-quitar", "carpetas-modo", "carpetas-agregar", "carpetas-quitar", "skill-instalar", "skill-quitar", "act-origen", "act-carpeta", "act-actualizar", "act-reiniciar", "prueba-enviar", "prueba-terminar", "pair", "dispositivos-olvidar"]);
  const on = (canal: string, f: (...args: any[]) => unknown) =>
    ipcMain.handle(`companion:${canal}`, async (_e, ...args) => {
      if (capturas && INERTES.has(canal)) return { ok: false, detenido: false, resultado: "error", error: "Modo capturas: no se hace nada.", motivo: "Modo capturas: no se hace nada.", estado: await puente.estado() };
      return f(...args);
    });

  on("node", async () => {
    const r = await ejecutar("node", ["--version"]);
    return comprobarNode(r.codigo === 0 ? r.salida : undefined);
  });
  on("enlace", async (clave: keyof typeof ENLACES) => {
    const url = ENLACES[clave]; // solo direcciones de la lista
    if (url) await shell.openExternal(url);
  });

  // hooks de Claude Code
  const vistaHooks = () => {
    const rutas = rutasHooks();
    let estado;
    try {
      estado = revisarHooks(rutas);
    } catch (err) {
      return { eventos: HOOK_EVENTOS, settingsPath: rutas.settingsPath, hooksDir: rutas.hooksDir, error: mensajeDeError(err) };
    }
    return { eventos: HOOK_EVENTOS, settingsPath: rutas.settingsPath, hooksDir: rutas.hooksDir, estado };
  };
  on("hooks-vista", vistaHooks);
  on("hooks-agregar", () => {
    try {
      const r = agregarHooks(rutasHooks());
      return { ok: true, respaldo: r.respaldo, script: r.scriptPath, vista: vistaHooks() };
    } catch (err) {
      return { ok: false, error: mensajeDeError(err), vista: vistaHooks() };
    }
  });
  on("hooks-quitar", () => {
    try {
      const r = quitarHooks(rutasHooks());
      return { ok: true, respaldo: r.respaldo, vista: vistaHooks() };
    } catch (err) {
      return { ok: false, error: mensajeDeError(err), vista: vistaHooks() };
    }
  });

  // carpetas donde se activa la integración
  on("carpetas-vista", () => leerCarpetas(CARPETA_DATOS));
  on("carpetas-modo", (modo: ModoCarpetas) => {
    const actual = leerCarpetas(CARPETA_DATOS);
    guardarCarpetas(CARPETA_DATOS, { modo: modo === "todas" ? "todas" : "elegidas", carpetas: actual.carpetas });
    return leerCarpetas(CARPETA_DATOS);
  });
  on("carpetas-agregar", async () => {
    const r = ventana
      ? await dialog.showOpenDialog(ventana, { title: "Elige una carpeta", properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ title: "Elige una carpeta", properties: ["openDirectory"] });
    if (!r.canceled && r.filePaths[0]) {
      const actual = leerCarpetas(CARPETA_DATOS);
      // desde cero si el archivo no existe o está corrupto: al elegir una carpeta se pasa a "solo en las carpetas que elija"
      const base: { modo: ModoCarpetas; carpetas: string[] } = actual.estado === "ok" ? actual : { modo: "elegidas", carpetas: [] };
      guardarCarpetas(CARPETA_DATOS, conCarpeta(base, r.filePaths[0]));
    }
    return leerCarpetas(CARPETA_DATOS);
  });
  on("carpetas-quitar", (ruta: string) => {
    const actual = leerCarpetas(CARPETA_DATOS);
    if (actual.estado === "ok") guardarCarpetas(CARPETA_DATOS, sinCarpeta(actual, ruta));
    return leerCarpetas(CARPETA_DATOS);
  });

  // skill «grill-me»
  const rutasSkill = () => ({ home: homedir(), origen: RUTAS.skillGrillMe });
  on("skill-vista", () => revisarSkill(rutasSkill()));
  on("skill-instalar", () => {
    try {
      const r = instalarSkill(rutasSkill());
      return { ok: true, archivo: r.archivo, vista: revisarSkill(rutasSkill()) };
    } catch (err) {
      return { ok: false, error: mensajeDeError(err), vista: revisarSkill(rutasSkill()) };
    }
  });
  on("skill-quitar", () => {
    try {
      const r = quitarSkill(rutasSkill());
      return { ok: true, quitada: r.quitada, vista: revisarSkill(rutasSkill()) };
    } catch (err) {
      return { ok: false, error: mensajeDeError(err), vista: revisarSkill(rutasSkill()) };
    }
  });

  // actualizaciones del programa
  on("act-estado", () => actualizador.estado());
  on("act-origen", (origen: string) => actualizador.cambiarOrigen(origen === "local" || origen === "github" ? origen : "ninguno"));
  on("act-carpeta", async () => {
    const opciones = { title: "Elige la carpeta con las versiones (la que tiene latest.yml)", properties: ["openDirectory" as const] };
    const r = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones);
    if (!r.canceled && r.filePaths[0]) return actualizador.cambiarOrigen("local", r.filePaths[0]);
    return actualizador.estado();
  });
  on("act-buscar", () => actualizador.buscar());
  on("act-actualizar", () => actualizador.actualizar());
  on("act-reiniciar", () => actualizador.reiniciar());

  // puente
  on("puente-estado", () => puente.estado());
  on("puente-iniciar", async () => ({ resultado: await puente.iniciar(), estado: await puente.estado() }));
  on("puente-detener", async () => {
    const detenido = await puente.detenerOrdenado();
    return { detenido, estado: await puente.estado() };
  });
  // un puente suelto de otra versión que no se dejó cerrar: el usuario pide detenerlo; luego se arranca el propio
  on("puente-detener-viejo", async (pid: number) => {
    if (!Number.isInteger(pid)) return { ok: false, motivo: "PID inválido.", estado: await puente.estado() };
    const r = await detenerPuenteViejo(pid);
    if (r.ok) await puente.iniciar();
    return { ...r, estado: await puente.estado() };
  });
  on("puente-log", async () => {
    const ruta = puente.rutaLog();
    if (existsSync(ruta)) shell.showItemInFolder(ruta);
    else await shell.openPath(join(CARPETA_DATOS, "logs"));
  });

  // firewall
  const estadoFirewall = async () => {
    const nueva = leerReglaFirewall((await ejecutar(rutaPrograma("netsh"), argsMostrarRegla())).salida);
    if (nueva.existe) return nueva;
    // versiones anteriores la llamaban «Agent Companion»: si abre los dos puertos, funciona (el botón la renombra)
    return estadoConAntigua(nueva, leerReglaFirewall((await ejecutar(rutaPrograma("netsh"), argsMostrarRegla(REGLA_NOMBRE_ANTERIOR))).salida));
  };
  on("fw-estado", estadoFirewall);
  on("fw-agregar", async () => {
    // PowerShell lanza netsh elevado: Windows muestra su aviso de administrador
    const r = await ejecutar(rutaPrograma("powershell"), ["-NoProfile", "-NonInteractive", "-Command", comandoElevadoReemplazar()], 120000);
    const regla = await estadoFirewall();
    if (regla.ok) return { ok: true, regla };
    const cancelado = r.codigo !== 0 || /cancel/i.test(r.salida);
    return {
      ok: false,
      regla,
      error: cancelado
        ? "No se pudo crear la regla. Si cerraste o rechazaste el aviso de Windows, vuelve a pulsar el botón y elige «Sí»."
        : "La regla no quedó creada. Vuelve a intentarlo.",
    };
  });

  // iniciar con Windows
  const argsInicio = () => (app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"]);
  on("inicio-estado", () => ({ activo: app.getLoginItemSettings({ args: argsInicio() }).openAtLogin }));
  on("inicio-cambiar", (activo: boolean) => {
    app.setLoginItemSettings({ openAtLogin: activo, path: process.execPath, args: argsInicio() });
    return { activo: app.getLoginItemSettings({ args: argsInicio() }).openAtLogin };
  });

  // instalar en la 3DS
  on("red", async () => {
    const ruta = await ejecutar(rutaPrograma("powershell"), [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric | Select-Object -ExpandProperty InterfaceAlias",
    ]);
    const conPuerta = ruta.codigo === 0 ? leerInterfacesConPuerta(ruta.salida) : [];
    // perfil de red (Privado/Público/Dominio) de cada interfaz: solo se lee, nunca se cambia
    const perfilesPs = await ejecutar(rutaPrograma("powershell"), [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + [char]9 + $_.Name + [char]9 + $_.NetworkCategory }",
    ]);
    const perfiles = perfilesPs.codigo === 0 ? leerPerfilesRed(perfilesPs.salida) : [];
    // la IP local por la que llegó la consola (la última, aunque ya se haya desconectado): se sabe que funciona
    const consoleLocalIp = (await consultarSalud())?.consoleLocalIp;
    const interfaces: InterfazRed[] = [];
    for (const [nombre, lista] of Object.entries(networkInterfaces())) {
      for (const i of lista ?? []) interfaces.push({ nombre, direccion: i.address, familia: i.family, interna: i.internal });
    }
    return elegirDireccionesLan(interfaces, conPuerta, { perfiles, ...(consoleLocalIp ? { consoleLocalIp } : {}) });
  });
  on("red-avisos", (direcciones: unknown, elegida?: string) =>
    Array.isArray(direcciones) ? avisosRedPublica(direcciones as DireccionLan[], typeof elegida === "string" ? elegida : undefined) : [],
  );
  // abre la página de Configuración de Windows donde se cambia el tipo de perfil de red (el programa no lo cambia)
  on("red-ajustes", async (tipo: string) => {
    await shell.openExternal(tipo === "wifi" ? "ms-settings:network-wifi" : "ms-settings:network-ethernet");
  });
  on("cia-iniciar", async (ip: string) => {
    const existe = existsSync(RUTA_CIA);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { existe, error: "La dirección IP no es válida." };
    // el puente sirve el .cia por su cuenta (siempre, no solo en este paso); este paso solo muestra el QR con su dirección
    await arranquePuente; // nunca antes de que el puente hijo haya terminado de arrancar
    const salud = await consultarSalud();
    const origen = decidirOrigenCia(salud, { propio: puente.esHijo(salud), arrancando: puente.arrancando });
    if (origen.tipo === "sin-puente") {
      await detenerCia();
      return { existe, sinPuente: true };
    }
    if (origen.tipo === "esperando") {
      // el puente propio todavía no tiene el 33337 (ocupado): lo reintenta cada 5 s; este paso no se lo quita
      await detenerCia();
      return { existe, esperandoPuente: true };
    }
    const puerto = origen.tipo === "puente" ? origen.puerto : CIA_PUERTO;
    const url = urlCia(ip, puerto);
    const qr = await QRCode.toDataURL(url, { margin: 2, width: 280, color: { dark: "#14131c", light: "#ffffff" } });
    if (!existe) return { existe, url, qr };
    if (origen.tipo === "puente") {
      await detenerCia(); // por si antes se había levantado el respaldo: dos servidores no pueden compartir el puerto
      return { existe, url, qr, sirviendo: true, origen: "puente", version: origen.version };
    }
    // respaldo: el puente que corre no sirve el .cia (es de desarrollo o anterior): este paso lo sirve mientras esté abierto
    if (!servidorCia) {
      try {
        servidorCia = await iniciarServidorCia(RUTA_CIA, CIA_PUERTO);
      } catch (err) {
        return { existe, url, qr, error: `No se pudo abrir el puerto ${CIA_PUERTO}: ${mensajeDeError(err)}. Cierra lo que lo use y vuelve a este paso.` };
      }
    }
    return { existe, url, qr, sirviendo: true, origen: "respaldo" };
  });
  on("cia-detener", async () => {
    await detenerCia();
    return { sirviendo: false };
  });
  on("cia-carpeta", (cual: "cia" | "3dsx") => {
    const ruta = cual === "3dsx" ? RUTA_3DSX : RUTA_CIA;
    if (existsSync(ruta)) shell.showItemInFolder(ruta);
    else void shell.openPath(RUTAS.carpetaCliente);
  });

  // emparejar y probar
  on("pair", async () => {
    try {
      const r = await fetch(`${PUENTE_API}/pair`, { method: "POST", headers: cabecerasApi(), signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { code, expiresInS } = (await r.json()) as { code: string; expiresInS: number };
      return { ok: true, codigo: code, minutos: Math.round(expiresInS / 60) };
    } catch {
      return { ok: false, error: "El puente no respondió. Inícialo en el paso 3." };
    }
  });
  // consolas emparejadas (Ajustes): la lista sale del puente sin claves y «olvidar» borra la clave y corta la conexión (token local)
  const sinPuente = "El puente no responde. Inícialo en el paso 3 para ver y olvidar consolas.";
  const puenteAnterior = "El puente que está corriendo es de una versión anterior y no sabe olvidar consolas. Reinícialo desde el paso 3.";
  on("dispositivos-lista", async () => {
    try {
      const r = await fetch(`${PUENTE_API}/devices`, { headers: cabecerasApi(), signal: AbortSignal.timeout(4000) });
      if (r.status === 404 || r.status === 501) return { ok: false, error: puenteAnterior };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, consolas: leerConsolas(await r.json()) };
    } catch {
      return { ok: false, error: sinPuente };
    }
  });
  on("dispositivos-olvidar", async (deviceId: unknown) => {
    const cuerpo = cuerpoOlvidar(deviceId);
    if (!cuerpo) return { ok: false, error: "Esa consola no tiene un id válido." };
    try {
      const r = await fetch(`${PUENTE_API}/devices/forget`, { method: "POST", headers: cabecerasApi({ "content-type": "application/json" }), body: cuerpo, signal: AbortSignal.timeout(4000) });
      if (r.status === 404) return { ok: false, error: "Esa consola ya no estaba emparejada." };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { disconnected?: unknown };
      return { ok: true, desconectada: j.disconnected === true };
    } catch {
      return { ok: false, error: sinPuente };
    }
  });
  const enviarEvento = async (cuerpo: Record<string, unknown>) => {
    try {
      const r = await fetch(`${PUENTE_API}/event`, {
        method: "POST",
        headers: cabecerasApi({ "content-type": "application/json" }),
        body: JSON.stringify({ session_id: "agent-companion-prueba", kind: "claude", cwd: "Prueba de Cronio", ...cuerpo }),
        signal: AbortSignal.timeout(4000),
      });
      return { ok: r.ok };
    } catch {
      return { ok: false, error: "El puente no respondió. Inícialo en el paso 3." };
    }
  };
  on("prueba-enviar", async () => {
    const a = await enviarEvento({ event: "start", title: "Prueba de Cronio" });
    if (!a.ok) return a;
    return enviarEvento({ event: "idle", activity: "Prueba", last_message: "Si ves este mensaje en la 3DS, todo funciona." });
  });
  on("prueba-terminar", () => enviarEvento({ event: "end" }));
}

// ---------- capturas de depuración (--debug-shots=carpeta) ----------

/**
 * Saca una captura de cada pantalla (Inicio, Ajustes y los cinco pasos), de cada plegable abierto y una tanda con la ventana más angosta.
 * Solo mira: en este modo no se arranca el puente ni se detiene ni se le pide nada a uno que ya esté corriendo.
 */
async function tomarCapturas(carpeta: string): Promise<void> {
  mkdirSync(carpeta, { recursive: true });
  const v = ventana!;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = (codigo: string) => v.webContents.executeJavaScript(codigo);
  const foto = async (nombre: string) => writeFileSync(join(carpeta, `${nombre}.png`), (await v.webContents.capturePage()).toPNG());
  const abrirPlegables = () => js("document.querySelectorAll('main details').forEach((d) => { d.open = true; })");
  const vistas: Array<{ nombre: string; selector: string; espera: number }> = [
    { nombre: "inicio", selector: '[data-vista="inicio"]', espera: 1500 },
    { nombre: "ajustes", selector: '[data-vista="ajustes"]', espera: 1500 },
    { nombre: "paso1", selector: '[data-paso="1"]', espera: 1500 },
    { nombre: "paso2", selector: '[data-paso="2"]', espera: 1500 },
    { nombre: "paso3", selector: '[data-paso="3"]', espera: 2500 },
    { nombre: "paso4", selector: '[data-paso="4"]', espera: 4500 },
    { nombre: "paso5", selector: '[data-paso="5"]', espera: 2500 },
  ];
  const tanda = async (sufijo: string, ancho: number, alto: number) => {
    v.setMinimumSize(400, 400);
    v.setSize(ancho, alto);
    await espera(1200);
    for (const x of vistas) {
      await js(`document.querySelector('${x.selector}').click()`);
      await espera(x.espera);
      await foto(`installer-${x.nombre}${sufijo}`);
      const hayPlegables = (await js("document.querySelectorAll('main details').length")) as number;
      if (hayPlegables > 0) {
        await abrirPlegables();
        await espera(300);
        await foto(`installer-${x.nombre}-abierto${sufijo}`);
      }
    }
  };
  await tanda("", 1000, 1300);
  await tanda("-angosta", 820, 1300);
}

// ---------- arranque ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", mostrarVentana);

  // «Salir» y cualquier cierre normal pasan por aquí: se detiene el puente propio (primero /shutdown, 3 s, luego kill) y se vuelve a salir
  app.on("before-quit", (e) => {
    saliendo = true;
    if (cierreListo) return;
    e.preventDefault();
    if (cierreEnCurso) return;
    cierreEnCurso = true;
    void Promise.allSettled([detenerCia(), puente.detenerOrdenado()]).then(() => {
      cierreListo = true;
      app.quit();
    });
  });
  // último recurso síncrono: si el proceso termina de otra forma, el hijo no queda vivo (y si Electron muere de golpe, el puente lo nota por COMPANION_PARENT_PID)
  app.on("will-quit", () => puente.matarSiQueda());
  process.on("exit", () => puente.matarSiQueda());
  for (const senal of ["SIGINT", "SIGTERM"] as const) process.on(senal, () => app.quit());
  app.on("window-all-closed", () => {
    if (!bandeja) app.quit();
  });

  void app.whenReady().then(async () => {
    registrarIpc();
    if (!capturas) crearBandeja();
    ventana = crearVentana();
    ventana.once("ready-to-show", () => {
      if (!iniciarOculto || capturas) ventana?.show();
    });
    if (capturas) {
      ventana.webContents.once("did-finish-load", () => {
        void tomarCapturas(capturas).then(
          () => app.quit(),
          (err) => {
            console.error("Error al tomar capturas:", err);
            app.exit(1);
          },
        );
      });
      return;
    }
    // revisa 10 s después y luego según el origen: carpeta local cada 60 s y al volver a la ventana; GitHub cada 6 h (solo si lo activó el usuario)
    actualizador.iniciarRevisiones();
    // el puente se levanta solo; si ya había uno corriendo, se usa ese
    const antes = await consultarSalud();
    arranquePuente = puente.iniciar();
    const r = await arranquePuente;
    console.log(`Puente: ${antes && r === "ya-corria" ? "ya estaba corriendo" : r}`);
  });
}
