// Elegir la IP del PC en la red local, que es la que la 3DS puede alcanzar.

export interface InterfazRed {
  nombre: string;
  direccion: string;
  familia: string | number;
  interna: boolean;
}

/** Perfil de red de Windows: Privado y Dominio dejan pasar a la regla del firewall; Público la bloquea. */
export type PerfilRed = "privada" | "publica" | "dominio";

/** Una fila de `Get-NetConnectionProfile`: la interfaz, el nombre de la red y su perfil. */
export interface PerfilInterfaz {
  interfaz: string;
  red: string;
  perfil: PerfilRed;
}

export interface DireccionLan {
  nombre: string;
  direccion: string;
  /** La interfaz tiene puerta de enlace (sale a Internet): es la red real, no una virtual. */
  conPuerta: boolean;
  recomendada: boolean;
  /** Perfil de red de Windows de la interfaz; ausente si no se pudo leer. */
  perfil?: PerfilRed;
  /** Nombre de la red según Windows (p. ej. «Red 2» o el SSID). */
  red?: string;
  tipo: "wifi" | "ethernet";
  /** Por esta IP llegó la consola alguna vez: se sabe que funciona. */
  porConsola: boolean;
}

export interface OpcionesLan {
  perfiles?: PerfilInterfaz[];
  /** `consoleLocalIp` de /health del puente: la última IP local por la que llegó una consola. */
  consoleLocalIp?: string;
}

/** ¿Es una IPv4 privada (10.x, 172.16-31.x, 192.168.x)? */
export function esPrivadaIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const n = [1, 2, 3, 4].map((i) => Number(m[i]));
  if (n.some((x) => x > 255)) return false;
  const [a, b] = [n[0]!, n[1]!];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|vpn|tail[s]cale|zerotier|loopback|bluetooth/i;

/** ¿La interfaz es inalámbrica? Se deduce del nombre (en Windows en español suele ser «Wi-Fi»). */
export function tipoInterfaz(nombre: string): "wifi" | "ethernet" {
  return /wi-?fi|wlan|wireless|inal[aá]mbric/i.test(nombre) ? "wifi" : "ethernet";
}

/**
 * Devuelve las IPv4 privadas del PC, la mejor primero. Quedan fuera las que no son privadas (la VPN de malla 100.64.0.0/10, 169.254.x, públicas).
 * Orden:
 *  1. la IP por la que llegó una consola (`consoleLocalIp`): se sabe que funciona;
 *  2. interfaces con puerta de enlace y perfil Privado o Dominio (o sin perfil conocido);
 *  3. interfaces con puerta de enlace y perfil Público (Windows bloquea ahí a la 3DS);
 *  4. las demás (sin puerta de enlace: VirtualBox, Hyper-V, WSL…), las que no parecen virtuales primero.
 * `conPuerta` son los nombres de interfaz con ruta por defecto.
 */
export function elegirDireccionesLan(interfaces: InterfazRed[], conPuerta: string[], opciones: OpcionesLan = {}): DireccionLan[] {
  const puerta = new Set(conPuerta.map((n) => n.toLowerCase()));
  const perfiles = new Map((opciones.perfiles ?? []).map((p) => [p.interfaz.toLowerCase(), p]));
  const lista = interfaces
    .filter((i) => !i.interna && (i.familia === "IPv4" || i.familia === 4) && esPrivadaIPv4(i.direccion))
    .map((i) => {
      const p = perfiles.get(i.nombre.toLowerCase());
      const gw = puerta.has(i.nombre.toLowerCase());
      const porConsola = opciones.consoleLocalIp !== undefined && i.direccion === opciones.consoleLocalIp;
      const rango = porConsola ? 0 : gw && p?.perfil !== "publica" ? 1 : gw ? 2 : 3;
      return {
        nombre: i.nombre,
        direccion: i.direccion,
        conPuerta: gw,
        virtual: VIRTUAL.test(i.nombre),
        porConsola,
        rango,
        ...(p ? { perfil: p.perfil, red: p.red } : {}),
        tipo: tipoInterfaz(i.nombre),
      };
    });
  lista.sort((a, b) => a.rango - b.rango || Number(a.virtual) - Number(b.virtual));
  return lista.map(({ virtual: _v, rango: _r, ...i }, idx) => ({ ...i, recomendada: idx === 0 }));
}

export interface AvisoRedPublica {
  interfaz: string;
  red: string;
  tipo: "wifi" | "ethernet";
  texto: string;
  /** Página de Configuración de Windows que se abre con el botón. */
  ajustes: string;
}

/**
 * Avisos de redes con perfil Público que bloquean a la 3DS: la interfaz elegida y cualquiera de la LAN con puerta de enlace.
 * Una por interfaz. Solo informa: el programa nunca cambia el perfil por su cuenta.
 */
export function avisosRedPublica(direcciones: DireccionLan[], elegida?: string): AvisoRedPublica[] {
  const vistas = new Set<string>();
  const avisos: AvisoRedPublica[] = [];
  for (const d of direcciones) {
    if (d.perfil !== "publica" || !(d.conPuerta || d.direccion === elegida) || vistas.has(d.nombre)) continue;
    vistas.add(d.nombre);
    const red = d.red ?? d.nombre;
    const nombreTipo = d.tipo === "wifi" ? "Wi-Fi" : "Ethernet";
    avisos.push({
      interfaz: d.nombre,
      red,
      tipo: d.tipo,
      texto: `Windows tiene la red "${red}" (${d.nombre}) como pública y bloquea a la 3DS. Márcala como privada: Configuración → Red e Internet → ${nombreTipo} → Tipo de perfil de red → Privado.`,
      ajustes: d.tipo === "wifi" ? "ms-settings:network-wifi" : "ms-settings:network-ethernet",
    });
  }
  return avisos;
}

/**
 * Lee la salida de PowerShell
 * `Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + [char]9 + $_.Name + [char]9 + $_.NetworkCategory }`
 * (interfaz, red y categoría separadas por tabulador; la categoría es Public, Private o DomainAuthenticated, o 0, 1 y 2).
 */
export function leerPerfilesRed(salida: string): PerfilInterfaz[] {
  const filas: PerfilInterfaz[] = [];
  for (const linea of salida.split(/\r?\n/)) {
    const partes = linea.split("\t").map((p) => p.trim());
    if (partes.length < 3 || partes[0] === "") continue;
    const cat = partes[partes.length - 1]!.toLowerCase();
    const perfil: PerfilRed | undefined = cat === "public" || cat === "0" ? "publica" : cat === "private" || cat === "1" ? "privada" : cat.startsWith("domain") || cat === "2" ? "dominio" : undefined;
    if (perfil) filas.push({ interfaz: partes[0]!, red: partes.slice(1, -1).join("\t") || partes[0]!, perfil });
  }
  return filas;
}

/** Lee la salida de PowerShell `(Get-NetRoute -DestinationPrefix 0.0.0.0/0).InterfaceAlias` (un nombre por línea). */
export function leerInterfacesConPuerta(salida: string): string[] {
  return [...new Set(salida.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ""))];
}
