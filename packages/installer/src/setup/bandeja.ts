// Menú de la bandeja de Windows (lógica pura y probada): el estado del programa → los elementos del menú, el tooltip y la variante del ícono.
// Aquí no se importa Electron: `main.ts` convierte los elementos en un `Menu` y ejecuta cada `id`.
import type { OrigenActualizacion } from "./app-ajustes.ts";

/** Las acciones que el menú puede pedir; el proceso principal las ejecuta con funciones con nombre (nada genérico). */
export type AccionBandeja =
  | "abrir"
  | "puente-iniciar"
  | "puente-detener"
  | "pausa-30"
  | "pausa-60"
  | "pausa-indefinida"
  | "pausa-reactivar"
  | "act-buscar"
  | "act-actualizar"
  | "act-configurar"
  | "qr"
  | "inicio-windows"
  | "registro"
  | "web"
  | "ayuda"
  | "salir";

export interface EstadoBandeja {
  /** Versión del programa (`app.getVersion()`). */
  version: string;
  /** El puente responde en 127.0.0.1. */
  puenteActivo: boolean;
  /** Lo lanzó este programa (solo ese se puede detener desde aquí). */
  puentePropio: boolean;
  /** Hay una consola 3DS conectada (solo tiene sentido con el puente en marcha). */
  consola: boolean;
  /** Versión de la app de la última 3DS conectada. */
  consolaVersion?: string;
  /** Los avisos están en pausa hasta ese momento (ms desde 1970); `0` = hasta que el usuario la reactive; `undefined` = sin pausa. */
  pausaHasta?: number;
  /** Fase del actualizador (`FaseActualizacion`) y datos que el menú necesita. */
  actualizacion: { origen: OrigenActualizacion; fase: string; version?: string };
  /** «Iniciar con Windows» está activo. */
  inicioConWindows: boolean;
}

export interface ElementoMenu {
  id?: AccionBandeja;
  label?: string;
  type?: "normal" | "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  submenu?: ElementoMenu[];
}

export interface VarianteIcono {
  /** El puente está detenido (o en pausa): el ícono sale atenuado y en gris. */
  apagado: boolean;
  /** Hay una versión nueva: un punto pequeño en la esquina. */
  punto: boolean;
}

const FASES_CON_NUEVA = new Set(["nueva", "descargando", "descargada"]);
const FASES_OCUPADAS = new Set(["buscando", "descargando", "instalando"]);

export const hayActualizacionNueva = (a: EstadoBandeja["actualizacion"]): boolean => Boolean(a.version) && FASES_CON_NUEVA.has(a.fase);

export function varianteIcono(e: EstadoBandeja): VarianteIcono {
  return { apagado: !e.puenteActivo, punto: hayActualizacionNueva(e.actualizacion) };
}

/** «15:30» en la hora local. */
function horaLocal(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const enPausa = (e: EstadoBandeja): boolean => e.pausaHasta !== undefined && !e.puenteActivo;

/** «Cronio · puente en marcha · 3DS conectada». Windows corta el tooltip a 127 caracteres: nada de esto se acerca. */
export function tooltipBandeja(e: EstadoBandeja): string {
  const partes = ["Cronio"];
  if (enPausa(e)) partes.push(e.pausaHasta ? `avisos en pausa hasta las ${horaLocal(e.pausaHasta)}` : "avisos en pausa");
  else if (!e.puenteActivo) partes.push("puente detenido");
  else partes.push("puente en marcha", e.consola ? "3DS conectada" : "3DS sin conexión");
  if (hayActualizacionNueva(e.actualizacion)) partes.push(`hay una versión nueva (${e.actualizacion.version})`);
  return partes.join(" · ");
}

const sep: ElementoMenu = { type: "separator" };

/** El menú contextual completo. El orden es el de la pantalla: estado, abrir, puente, actualizaciones, utilidades, salir. */
export function plantillaMenu(e: EstadoBandeja): ElementoMenu[] {
  const m: ElementoMenu[] = [];
  m.push({ label: `Cronio ${e.version}`, enabled: false });

  // estado (solo informa)
  if (enPausa(e)) m.push({ label: e.pausaHasta ? `Puente: en pausa hasta las ${horaLocal(e.pausaHasta)}` : "Puente: en pausa", enabled: false });
  else m.push({ label: e.puenteActivo ? "Puente: en marcha" : "Puente: detenido", enabled: false });
  if (e.puenteActivo && e.consola) m.push({ label: e.consolaVersion ? `3DS: conectada (app ${e.consolaVersion})` : "3DS: conectada", enabled: false });
  else m.push({ label: "3DS: sin conexión", enabled: false });
  m.push(sep);

  m.push({ id: "abrir", label: "Abrir Cronio" });
  m.push(sep);

  // puente y pausa
  if (e.puenteActivo) {
    m.push(
      e.puentePropio
        ? { id: "puente-detener", label: "Detener el puente" }
        : { id: "puente-detener", label: "Detener el puente (no lo inició Cronio)", enabled: false },
    );
    m.push({
      label: "Pausar avisos por…",
      enabled: e.puentePropio,
      submenu: [
        { id: "pausa-30", label: "30 minutos" },
        { id: "pausa-60", label: "1 hora" },
        { id: "pausa-indefinida", label: "Hasta que lo reactive" },
      ],
    });
  } else if (e.pausaHasta !== undefined) {
    m.push({ id: "pausa-reactivar", label: "Reactivar los avisos ahora" });
  } else {
    m.push({ id: "puente-iniciar", label: "Iniciar el puente" });
  }
  m.push(sep);

  // actualizaciones
  const a = e.actualizacion;
  if (a.origen === "ninguno" || a.fase === "sin-origen") {
    m.push({ label: "Actualizaciones: desactivadas", enabled: false }, { id: "act-configurar", label: "Configurar…" });
  } else if (a.fase === "sin-publicar") {
    m.push({ label: "Actualizaciones: aún sin versiones publicadas", enabled: false }, { id: "act-configurar", label: "Configurar…" });
  } else {
    if (hayActualizacionNueva(a)) {
      const bajando = a.fase === "descargando";
      m.push({ id: "act-actualizar", label: bajando ? `Descargando ${a.version}…` : `Actualizar a ${a.version}`, enabled: !bajando });
    }
    m.push({
      id: "act-buscar",
      label: a.fase === "buscando" ? "Buscando actualizaciones…" : "Buscar actualizaciones",
      enabled: !FASES_OCUPADAS.has(a.fase),
    });
  }
  m.push(sep);

  m.push({ id: "qr", label: "Mostrar el QR de instalación" });
  m.push({ id: "inicio-windows", label: "Iniciar con Windows", type: "checkbox", checked: e.inicioConWindows });
  m.push({ id: "registro", label: "Ver el registro del puente" });
  m.push({
    label: "Página web y ayuda",
    submenu: [
      { id: "web", label: "Página web de Cronio" },
      { id: "ayuda", label: "Ayuda y reportes" },
    ],
  });
  m.push(sep);
  m.push({ id: "salir", label: "Salir" });
  return m;
}

/** Las direcciones que abre el menú: fijas, nunca construidas con texto de afuera. */
export const ENLACES_BANDEJA = {
  web: "https://alonnnzo.github.io/cronio/",
  ayuda: "https://github.com/alonnnzo/cronio/issues",
} as const;

/** Minutos de cada pausa; `0` = hasta que el usuario la reactive. */
export const PAUSAS_MIN = { "pausa-30": 30, "pausa-60": 60, "pausa-indefinida": 0 } as const;
