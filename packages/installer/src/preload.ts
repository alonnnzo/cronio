// Puente seguro entre la interfaz y el proceso principal: solo funciones con nombre, ningún "ejecutar comando".
import { contextBridge, ipcRenderer } from "electron";

const llamar = (canal: string, ...args: unknown[]) => ipcRenderer.invoke(`companion:${canal}`, ...args);

contextBridge.exposeInMainWorld("companion", {
  // comprobaciones y paso 1
  comprobarNode: () => llamar("node"),
  abrirEnlace: (clave: "node" | "guia3ds") => llamar("enlace", clave),
  // paso 2: hooks de Claude Code
  hooksVista: () => llamar("hooks-vista"),
  hooksAgregar: () => llamar("hooks-agregar"),
  hooksQuitar: () => llamar("hooks-quitar"),
  hooksCarpetasVista: () => llamar("carpetas-vista"),
  hooksCarpetasModo: (modo: "todas" | "elegidas") => llamar("carpetas-modo", modo === "todas" ? "todas" : "elegidas"),
  hooksCarpetaAgregar: () => llamar("carpetas-agregar"),
  hooksCarpetaQuitar: (ruta: string) => llamar("carpetas-quitar", String(ruta)),
  // paso 2: skill «grill-me»
  skillVista: () => llamar("skill-vista"),
  skillInstalar: () => llamar("skill-instalar"),
  skillQuitar: () => llamar("skill-quitar"),
  // paso 3: actualizaciones del programa
  actualizacionEstado: () => llamar("act-estado"),
  actualizacionOrigen: (origen: "ninguno" | "local" | "github") => llamar("act-origen", origen === "local" || origen === "github" ? origen : "ninguno"),
  actualizacionElegirCarpeta: () => llamar("act-carpeta"),
  actualizacionBuscar: () => llamar("act-buscar"),
  actualizacionActualizar: () => llamar("act-actualizar"),
  actualizacionReiniciar: () => llamar("act-reiniciar"),
  // paso 3: puente, firewall e inicio con Windows
  puenteEstado: () => llamar("puente-estado"),
  puenteIniciar: () => llamar("puente-iniciar"),
  puenteDetener: () => llamar("puente-detener"),
  puenteDetenerViejo: (pid: number) => llamar("puente-detener-viejo", pid),
  puenteAbrirLog: () => llamar("puente-log"),
  firewallEstado: () => llamar("fw-estado"),
  firewallAgregar: () => llamar("fw-agregar"),
  inicioEstado: () => llamar("inicio-estado"),
  inicioCambiar: (activo: boolean) => llamar("inicio-cambiar", activo === true),
  // paso 4: instalar en la 3DS
  redDirecciones: () => llamar("red"),
  redAvisos: (direcciones: unknown, elegida?: string) => llamar("red-avisos", direcciones, elegida),
  redAbrirAjustes: (tipo: "wifi" | "ethernet") => llamar("red-ajustes", tipo === "wifi" ? "wifi" : "ethernet"),
  ciaIniciar: (ip: string) => llamar("cia-iniciar", String(ip)),
  ciaDetener: () => llamar("cia-detener"),
  ciaMostrarCarpeta: (cual: "cia" | "3dsx") => llamar("cia-carpeta", cual === "3dsx" ? "3dsx" : "cia"),
  // paso 5: emparejar y probar
  emparejarCodigo: () => llamar("pair"),
  // Ajustes: consolas emparejadas
  dispositivosLista: () => llamar("dispositivos-lista"),
  dispositivosOlvidar: (deviceId: string) => llamar("dispositivos-olvidar", String(deviceId)),
  pruebaEnviar: () => llamar("prueba-enviar"),
  pruebaTerminar: () => llamar("prueba-terminar"),
});
