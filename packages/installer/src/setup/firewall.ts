// Regla de firewall de Windows para que la 3DS pueda llegar al PC. Solo arma textos y lee resultados: no ejecuta nada.

export const REGLA_NOMBRE = "Cronio";
/** Nombre de la regla en versiones anteriores (se borra al crear la nueva). */
export const REGLA_NOMBRE_ANTERIOR = "Agent Companion";
/** Consola (la 3DS se conecta aquí) y descarga del .cia. */
export const PUERTOS_REGLA = [33334, 33337] as const;

const BASE = ["advfirewall", "firewall"];

/**
 * Argumentos para ejecutar netsh directamente (execFile): sin comillas incrustadas, porque Node ya
 * entrecomilla el argumento completo si lleva espacios; con comillas propias las escapa (\") y netsh no halla la regla.
 */
export function argsMostrarRegla(nombre: string = REGLA_NOMBRE): string[] {
  return [...BASE, "show", "rule", `name=${nombre}`];
}

/** Argumentos de `netsh` para crear la regla (entrada, TCP, solo perfil privado y solo desde la subred local: nada de internet). */
export function argsAgregarRegla(): string[] {
  return [
    ...BASE,
    "add",
    "rule",
    `name=${REGLA_NOMBRE}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${PUERTOS_REGLA.join(",")}`,
    "remoteip=localsubnet",
    "profile=private",
  ];
}

export function argsBorrarRegla(nombre: string = REGLA_NOMBRE): string[] {
  return [...BASE, "delete", "rule", `name=${nombre}`];
}

/**
 * `netsh.exe` con ruta completa. cmd expande `%SystemRoot%` solo, así que la línea no depende del PATH ni de la carpeta actual
 * (sin comillas: la carpeta de Windows no lleva espacios, y comillas dentro de «cmd /c» cambian cómo cmd lee la línea).
 */
export const NETSH_EN_CMD = "%SystemRoot%\\System32\\netsh.exe";

/** Como texto dentro de una línea de comandos de cmd: el nombre va entre comillas solo si lleva espacios. */
function enLinea(args: string[]): string {
  return [NETSH_EN_CMD, ...args.map((a) => a.replace(/^(name=)(.*\s.*)$/, '$1"$2"'))].join(" ");
}

/**
 * Orden de PowerShell que, con UN solo aviso de administrador (UAC), borra las reglas con nuestro nombre
 * (y la antigua «Agent Companion») y crea la nueva: así pulsar dos veces no duplica la regla.
 */
export function comandoElevadoReemplazar(): string {
  const cadena = [
    enLinea(argsBorrarRegla(REGLA_NOMBRE_ANTERIOR)),
    enLinea(argsBorrarRegla(REGLA_NOMBRE)),
    enLinea(argsAgregarRegla()),
  ].join(" & ");
  // Start-Process une los argumentos con espacios: «cmd /c <cadena>» llega tal cual a cmd.
  // Ruta completa ($env:ComSpec): con solo «cmd» Windows puede hallar antes otro archivo con ese nombre en el PATH
  // (por ejemplo c:/devkitPro/msys2/usr/bin/cmd) y falla con «no es una aplicación Win32 válida» sin pedir permiso.
  return `Start-Process -FilePath $env:ComSpec -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c',${comillasPs(cadena)}`;
}

function comillasPs(texto: string): string {
  return `'${texto.replace(/'/g, "''")}'`;
}

export interface ReglaFirewall {
  existe: boolean;
  puertos: number[];
  /** Perfiles tal como los informa Windows (puede estar en español o inglés). */
  perfiles: string;
  /** Tiene los dos puertos que necesitamos. */
  ok: boolean;
}

/** Lee la salida de `netsh advfirewall firewall show rule name=Cronio` (español o inglés). */
export function leerReglaFirewall(salida: string): ReglaFirewall {
  const puertos = new Set<number>();
  let perfiles = "";
  for (const linea of salida.split(/\r?\n/)) {
    const mPuerto = /^\s*(?:LocalPort|Puerto local)\s*:\s*(.+?)\s*$/i.exec(linea);
    if (mPuerto?.[1]) {
      for (const parte of mPuerto[1].split(",")) {
        const n = Number(parte.trim());
        if (Number.isInteger(n)) puertos.add(n);
      }
    }
    const mPerfil = /^\s*(?:Profiles|Perfiles)\s*:\s*(.+?)\s*$/i.exec(linea);
    if (mPerfil?.[1]) perfiles = mPerfil[1];
  }
  const lista = [...puertos].sort((a, b) => a - b);
  return {
    existe: lista.length > 0,
    puertos: lista,
    perfiles,
    ok: PUERTOS_REGLA.every((p) => puertos.has(p)),
  };
}

export interface EstadoFirewall extends ReglaFirewall {
  /** No está la regla «Cronio», pero sí la antigua «Agent Companion» con los dos puertos: funciona y el botón la renombra. */
  antigua?: boolean;
}

/** Junta la lectura de la regla «Cronio» con la de la antigua: si la nueva no sirve y la antigua sí, cuenta como ✓ (con \`antigua\`). */
export function estadoConAntigua(nueva: ReglaFirewall, antigua?: ReglaFirewall): EstadoFirewall {
  if (!nueva.existe && antigua?.ok) return { ...antigua, antigua: true };
  return nueva;
}
