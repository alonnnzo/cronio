// Actualizaciones del programa del PC (lado Electron). La lógica pura y probada está en setup/actualizaciones.ts.
//
// Dos orígenes, según el ajuste guardado en app.json:
//  - «local»: carpeta con `latest.yml` y el instalador (la `release` de quien desarrolla). Se hace a mano: copia el .exe a una
//    carpeta temporal, verifica el sha512 y lanza el instalador NSIS de un clic (el de electron-builder) **con su ventana de
//    progreso a la vista**: sin `/S`, con `--updated`, aparte (`detached`) y sin ocultar la ventana. Justo después la app sale
//    (before-quit detiene el puente). El instalador espera a que Cronio termine (o lo cierra), reemplaza los archivos y, como no es
//    silencioso, vuelve a abrir Cronio solo (`runAfterFinish`).
//  - «github»: electron-updater con `provider: github`, sin descarga automática; al instalar lanza de la misma forma el instalador
//    que electron-updater dejó en su caché (`downloadedFile`). Solo se carga (require) si el usuario lo activó
//    y el dueño del repo ya está definido: con la casilla apagada no se importa ni se consulta nada.
// Nada se actualiza sin que el usuario lo pida; con la app en la bandeja solo se notifica.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { guardarActualizaciones, guardarVersionAvisada, leerAjustesApp } from "./setup/app-ajustes.ts";
import type { AjustesActualizaciones, OrigenActualizacion } from "./setup/app-ajustes.ts";
import { argsInstalador, copiarYVerificar, debeNotificar, decidirOferta, leerConfigGithub, leerLatestYml, tocaBuscar } from "./setup/actualizaciones.ts";
import type { MotivoBusqueda } from "./setup/actualizaciones.ts";
import type { ConfigGithub } from "./setup/actualizaciones.ts";

export type FaseActualizacion =
  | "inactivo"
  | "buscando"
  | "al-dia"
  | "nueva"
  | "descargando"
  | "descargada"
  | "instalando"
  | "error"
  | "sin-origen"
  | "sin-publicar";

export interface EstadoActualizacion {
  instalada: string;
  origen: OrigenActualizacion;
  carpeta?: string;
  /** El origen salió del valor por defecto (todavía no lo eligió el usuario). */
  porDefecto: boolean;
  /** Solo la app instalada se puede actualizar; en desarrollo se puede mirar pero no instalar. */
  empaquetada: boolean;
  github: ConfigGithub["estado"];
  fase: FaseActualizacion;
  /** Versión nueva ofrecida (fases `nueva`, `descargando`, `descargada`). */
  version?: string;
  /** 0 a 100 mientras descarga (solo GitHub). */
  progreso?: number;
  /** Pasos reales de la instalación, en orden («Copiando la versión nueva…»); el último es el que está en curso. */
  pasos?: string[];
  error?: string;
  ultimaRevision?: number;
}

export interface OpcionesActualizador {
  datosDir: string;
  /** `app.getVersion()`. */
  instalada: string;
  empaquetada: boolean;
  /** `process.resourcesPath` (para `app-update.yml` y `origen-local.json`); solo empaquetada. */
  recursos?: string;
  /** Hay una versión nueva (solo la primera vez por versión): el programa muestra una notificación del sistema. */
  notificar: (version: string) => void;
  /** Cierra la app (`app.quit()`: before-quit detiene el puente propio). */
  salir: () => void;
}

const PRIMERA_REVISION_MS = 10_000;
/** El reloj late cada 30 s; `tocaBuscar` decide si ya toca según el origen (60 s en carpeta local, 6 h en GitHub). */
const LATIDO_MS = 30_000;
/** Pausa para que se alcance a leer «Cerrando Cronio…» antes de que la app salga y quede la barra del instalador. */
const PAUSA_CIERRE_MS = 900;
const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export class Actualizador {
  private fase: FaseActualizacion = "inactivo";
  private version: string | undefined;
  private progreso: number | undefined;
  private pasos: string[] = [];
  private descargado: string | undefined;
  private error: string | undefined;
  private ultimaRevision: number | undefined;
  private updater: typeof import("electron-updater").autoUpdater | undefined;
  private temporizadores: NodeJS.Timeout[] = [];

  constructor(private readonly o: OpcionesActualizador) {}

  /** Carpeta `release` de quien desarrolla: `bin/origen-local.json` la deja `scripts/dist.mjs` al empaquetar (solo en la app instalada). */
  private carpetaConocida(): string | undefined {
    if (!this.o.empaquetada || !this.o.recursos) return undefined;
    try {
      const d = JSON.parse(readFileSync(join(this.o.recursos, "origen-local.json"), "utf8")) as { carpeta?: unknown };
      return typeof d.carpeta === "string" ? d.carpeta : undefined;
    } catch {
      return undefined;
    }
  }

  private configGithub(): ConfigGithub {
    if (!this.o.empaquetada || !this.o.recursos) return { estado: "ausente" };
    try {
      return leerConfigGithub(readFileSync(join(this.o.recursos, "app-update.yml"), "utf8"));
    } catch {
      return { estado: "ausente" };
    }
  }

  ajustes(): AjustesActualizaciones {
    return leerAjustesApp(this.o.datosDir, this.carpetaConocida()).actualizaciones;
  }

  estado(): EstadoActualizacion {
    const a = leerAjustesApp(this.o.datosDir, this.carpetaConocida());
    const origen = a.actualizaciones.origen;
    // sin origen o sin versiones publicadas no hay nada que mostrar aparte de eso
    let fase = this.fase;
    if (origen === "ninguno") fase = "sin-origen";
    else if (origen === "github" && this.configGithub().estado !== "definido") fase = "sin-publicar";
    return {
      instalada: this.o.instalada,
      origen,
      ...(a.actualizaciones.carpeta ? { carpeta: a.actualizaciones.carpeta } : {}),
      porDefecto: a.porDefecto,
      empaquetada: this.o.empaquetada,
      github: this.configGithub().estado,
      fase,
      ...(this.version ? { version: this.version } : {}),
      ...(this.progreso !== undefined ? { progreso: this.progreso } : {}),
      ...(this.pasos.length ? { pasos: [...this.pasos] } : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(this.ultimaRevision ? { ultimaRevision: this.ultimaRevision } : {}),
    };
  }

  /** Guarda el origen elegido (y la carpeta, si es local) y vuelve a empezar desde cero. */
  cambiarOrigen(origen: OrigenActualizacion, carpeta?: string): EstadoActualizacion {
    const actual = this.ajustes();
    guardarActualizaciones(this.o.datosDir, { origen, ...(origen === "local" ? { carpeta: carpeta ?? actual.carpeta } : {}) });
    this.reiniciarEstado();
    return this.estado();
  }

  /**
   * Revisión automática: 10 s después de iniciar y luego según el origen (carpeta local cada 60 s; GitHub cada 6 h). Con origen
   * «ninguno» o sin versiones publicadas no hace nada.
   */
  iniciarRevisiones(): void {
    this.temporizadores.push(setTimeout(() => this.revisarSiToca("inicio"), PRIMERA_REVISION_MS));
    this.temporizadores.push(setInterval(() => this.revisarSiToca("intervalo"), LATIDO_MS));
    for (const t of this.temporizadores) t.unref();
  }

  /** La ventana ganó el foco o salió de la bandeja: con carpeta local busca si pasaron más de 15 s; con GitHub no hace nada. */
  alFoco(): void {
    this.revisarSiToca("foco");
  }

  private revisarSiToca(motivo: MotivoBusqueda): void {
    if (!tocaBuscar(this.ajustes().origen, Date.now(), this.ultimaRevision, motivo)) return;
    void this.buscar().catch(() => undefined);
  }

  private reiniciarEstado(): void {
    this.fase = "inactivo";
    this.version = undefined;
    this.progreso = undefined;
    this.pasos = [];
    this.descargado = undefined;
    this.error = undefined;
  }

  private ocupada(): boolean {
    return this.fase === "buscando" || this.fase === "descargando" || this.fase === "instalando";
  }

  private fallar(err: unknown): void {
    this.fase = "error";
    this.error = err instanceof Error ? err.message : String(err);
  }

  private ofrecer(version: string): void {
    this.fase = "nueva";
    this.version = version;
    this.error = undefined;
    const a = leerAjustesApp(this.o.datosDir, this.carpetaConocida());
    if (debeNotificar(a.ultimaVersionAvisada, version)) {
      try {
        guardarVersionAvisada(this.o.datosDir, version);
      } catch {
        /* si no se puede guardar, se avisa igual */
      }
      this.o.notificar(version);
    }
  }

  /** «Buscar ahora» y la revisión automática. */
  async buscar(): Promise<EstadoActualizacion> {
    if (this.ocupada() || this.fase === "descargada") return this.estado();
    const { origen, carpeta } = this.ajustes();
    if (origen === "ninguno") {
      this.reiniciarEstado();
      return this.estado();
    }
    if (origen === "github" && this.configGithub().estado !== "definido") {
      this.reiniciarEstado(); // todavía no hay versiones publicadas: no se consulta nada
      return this.estado();
    }
    this.fase = "buscando";
    this.error = undefined;
    this.ultimaRevision = Date.now();
    try {
      if (origen === "local") await this.buscarLocal(carpeta);
      else await this.buscarGithub();
    } catch (err) {
      this.fallar(err);
    }
    return this.estado();
  }

  private async buscarLocal(carpeta: string | undefined): Promise<void> {
    if (!carpeta) throw new Error("Elige la carpeta donde están las versiones (la que tiene latest.yml).");
    let texto: string;
    try {
      texto = await readFile(join(carpeta, "latest.yml"), "utf8");
    } catch {
      throw new Error(`No encuentro latest.yml en ${carpeta}.`);
    }
    const l = leerLatestYml(texto);
    if (!l.ok) throw new Error(l.error);
    const oferta = decidirOferta(this.o.instalada, l.latest.version);
    if (oferta.tipo === "ilegible") throw new Error(oferta.motivo);
    if (oferta.tipo === "al-dia") {
      this.fase = "al-dia";
      this.version = undefined;
      return;
    }
    this.ofrecer(oferta.version);
  }

  private async buscarGithub(): Promise<void> {
    const au = this.cargarUpdater();
    const r = await au.checkForUpdates();
    // los eventos ya movieron la fase; si no hubo ninguno (p. ej. sin resultado), se deja al día
    if (this.fase === "buscando") {
      const v = r?.updateInfo?.version;
      const oferta = v ? decidirOferta(this.o.instalada, v) : ({ tipo: "al-dia" } as const);
      if (oferta.tipo === "nueva") this.ofrecer(oferta.version);
      else this.fase = "al-dia";
    }
  }

  /** Carga electron-updater recién cuando hace falta (con GitHub apagado ni se importa). */
  private cargarUpdater(): typeof import("electron-updater").autoUpdater {
    if (this.updater) return this.updater;
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("update-available", (info) => {
      const oferta = decidirOferta(this.o.instalada, info.version);
      if (oferta.tipo === "nueva") this.ofrecer(oferta.version);
      else this.fase = "al-dia";
    });
    autoUpdater.on("update-not-available", () => {
      this.fase = "al-dia";
      this.version = undefined;
    });
    autoUpdater.on("download-progress", (p) => {
      this.fase = "descargando";
      this.progreso = Math.round(p.percent);
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.descargado = info.downloadedFile;
      this.fase = "descargada";
      this.progreso = 100;
    });
    autoUpdater.on("error", (err) => this.fallar(err));
    this.updater = autoUpdater;
    return autoUpdater;
  }

  /**
   * El botón «Actualizar» / «Descargar». Local: copia, verifica y lanza el instalador aparte, y sale. GitHub: baja la versión
   * (luego «Reiniciar y actualizar» la instala).
   */
  async actualizar(): Promise<EstadoActualizacion> {
    if (this.fase !== "nueva") return this.estado();
    const { origen, carpeta } = this.ajustes();
    try {
      if (origen === "local") await this.instalarLocal(carpeta);
      else if (origen === "github") {
        if (!this.o.empaquetada) throw new Error("Solo funciona en la app instalada.");
        const au = this.cargarUpdater();
        this.fase = "descargando";
        this.progreso = 0;
        void au.downloadUpdate().catch((err: unknown) => this.fallar(err));
      }
    } catch (err) {
      this.fallar(err);
    }
    return this.estado();
  }

  private async instalarLocal(carpeta: string | undefined): Promise<void> {
    if (!this.o.empaquetada) throw new Error("Solo funciona en la app instalada (esta es la de desarrollo).");
    if (!carpeta) throw new Error("Falta la carpeta de versiones.");
    this.fase = "instalando";
    this.pasos = ["Copiando la versión nueva…"];
    const l = leerLatestYml(await readFile(join(carpeta, "latest.yml"), "utf8"));
    if (!l.ok) throw new Error(l.error);
    // vuelve a decidir con el archivo de este momento: no instala algo que ya no es más nuevo
    if (decidirOferta(this.o.instalada, l.latest.version).tipo !== "nueva") throw new Error("La versión de la carpeta ya no es más nueva que la instalada.");
    const listo = await copiarYVerificar({
      carpeta,
      latest: l.latest,
      alVerificar: () => {
        this.pasos.push("Comprobando el archivo…");
      },
    });
    if (!listo.ok) throw new Error(listo.error);
    await this.lanzarInstalador(listo.ruta);
  }

  /**
   * Lanza el instalador de electron-builder (NSIS de un clic) con su ventana de progreso visible y cierra la app. Sin `/S` (si no,
   * no hay ventana y tampoco se reabre Cronio), con `--updated`, `detached` y sin `windowsHide`. Se lanza antes de salir: el
   * instalador espera a que Cronio termine (con `--updated` da un margen y, si sigue vivo, lo cierra) y luego reemplaza los archivos.
   */
  private async lanzarInstalador(instalador: string): Promise<void> {
    this.pasos.push("Cerrando Cronio: verás la barra de instalación y se abrirá solo al terminar.");
    await new Promise<void>((ok, mal) => {
      const hijo = spawn(instalador, argsInstalador(), { detached: true, stdio: "ignore" });
      hijo.once("error", mal);
      hijo.once("spawn", () => {
        hijo.unref();
        ok();
      });
    });
    await esperar(PAUSA_CIERRE_MS);
    this.o.salir();
  }

  /**
   * «Reiniciar y actualizar» (GitHub, ya descargada): lanza con la misma barra de progreso el instalador que dejó electron-updater;
   * si no se sabe dónde quedó, vuelve a `quitAndInstall(false, true)` (no silencioso, con la barra, y reabre la app).
   */
  async reiniciar(): Promise<EstadoActualizacion> {
    if (this.fase !== "descargada" || !this.updater) return this.estado();
    this.fase = "instalando";
    if (this.descargado && this.o.empaquetada && existsSync(this.descargado)) {
      try {
        this.pasos = ["Preparando la instalación…"];
        await this.lanzarInstalador(this.descargado);
      } catch (err) {
        this.fallar(err);
      }
    } else {
      this.updater.quitAndInstall(false, true);
    }
    return this.estado();
  }
}
