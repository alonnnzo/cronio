import { describe, expect, it } from "vitest";
import { urlCia } from "../src/setup/cia.ts";
import { argsAgregarRegla, argsBorrarRegla, argsMostrarRegla, comandoElevadoReemplazar, estadoConAntigua, leerReglaFirewall } from "../src/setup/firewall.ts";
import { avisosRedPublica, elegirDireccionesLan, esPrivadaIPv4, leerInterfacesConPuerta, leerPerfilesRed, tipoInterfaz } from "../src/setup/network.ts";
import { comprobarNode } from "../src/setup/node-version.ts";

describe("firewall", () => {
  it("arma la regla: entrada, TCP 33334 y 33337, perfil privado, sin comillas incrustadas", () => {
    expect(argsAgregarRegla().join(" ")).toBe(
      "advfirewall firewall add rule name=Cronio dir=in action=allow protocol=TCP localport=33334,33337 remoteip=localsubnet profile=private",
    );
    expect(argsMostrarRegla()).toEqual(["advfirewall", "firewall", "show", "rule", "name=Cronio"]);
    // nombre con espacio: un solo argumento, sin comillas propias (Node lo entrecomilla entero)
    expect(argsMostrarRegla("Agent Companion")[4]).toBe("name=Agent Companion");
    expect(argsBorrarRegla().join(" ")).toContain("delete rule");
  });

  it("el comando elevado: un solo RunAs, borra la antigua y la actual y luego agrega", () => {
    const c = comandoElevadoReemplazar();
    expect(c.match(/-Verb RunAs/g)).toHaveLength(1);
    expect(c).toMatch(/^Start-Process -FilePath \$env:ComSpec -Verb RunAs -Wait/);
    expect(c).toContain('delete rule name="Agent Companion"');
    expect(c).toContain("delete rule name=Cronio");
    expect(c.indexOf("delete rule name=Cronio")).toBeLessThan(c.indexOf("add rule"));
    expect(c).toContain("add rule name=Cronio dir=in");
  });

  it("lee la salida en inglés", () => {
    const salida = [
      "Rule Name:                            Agent Companion",
      "----------------------------------------------------------------------",
      "Enabled:                              Yes",
      "Direction:                            In",
      "Profiles:                             Private",
      "Protocol:                             TCP",
      "LocalPort:                            33334,33337",
      "Action:                               Allow",
    ].join("\r\n");
    expect(leerReglaFirewall(salida)).toEqual({ existe: true, puertos: [33334, 33337], perfiles: "Private", ok: true });
  });

  it("lee la salida en español", () => {
    const salida = "Nombre de regla:   Agent Companion\nPerfiles:   Privado\nPuerto local:   33334,33337\n";
    expect(leerReglaFirewall(salida)).toMatchObject({ existe: true, ok: true, perfiles: "Privado" });
  });

  it("lee la salida real de netsh en español (acentos)", () => {
    const salida = [
      "Nombre de regla:                      Agent Companion",
      "----------------------------------------------------------------------",
      "Habilitada:                           Sí",
      "Dirección:                            Dentro",
      "Perfiles:                             Privada",
      "LocalIP:                              Cualquiera",
      "Protocolo:                            TCP",
      "LocalPort:                            33334,33337",
      "Acción:                               Permitir",
    ].join("\r\n");
    expect(leerReglaFirewall(salida)).toEqual({ existe: true, puertos: [33334, 33337], perfiles: "Privada", ok: true });
  });

  it("sin regla o con un solo puerto no está ok", () => {
    expect(leerReglaFirewall("No rules match the specified criteria.")).toEqual({ existe: false, puertos: [], perfiles: "", ok: false });
    expect(leerReglaFirewall("LocalPort: 33334")).toMatchObject({ existe: true, ok: false });
  });
});

describe("IP de la red local", () => {
  const ifaces = [
    { nombre: "Loopback", direccion: "127.0.0.1", familia: "IPv4", interna: true },
    { nombre: "vEthernet (WSL)", direccion: "172.20.1.1", familia: "IPv4", interna: false },
    { nombre: "Wi-Fi", direccion: "192.168.0.20", familia: "IPv4", interna: false },
    { nombre: "Wi-Fi", direccion: "fe80::1", familia: "IPv6", interna: false },
    { nombre: "Ethernet", direccion: "169.254.3.4", familia: "IPv4", interna: false },
    { nombre: "Pública", direccion: "8.8.8.8", familia: "IPv4", interna: false },
  ];

  it("solo IPv4 privadas, la de la interfaz con puerta de enlace primero", () => {
    const r = elegirDireccionesLan(ifaces, ["Wi-Fi"]);
    expect(r.map((x) => x.direccion)).toEqual(["192.168.0.20", "172.20.1.1"]);
    expect(r[0]).toMatchObject({ conPuerta: true, recomendada: true });
    expect(r[1]).toMatchObject({ conPuerta: false, recomendada: false });
  });

  it("sin datos de puerta de enlace, prefiere las no virtuales", () => {
    expect(elegirDireccionesLan(ifaces, [])[0]?.direccion).toBe("192.168.0.20");
  });

  it("acepta la familia numérica 4 y devuelve lista vacía si no hay", () => {
    expect(elegirDireccionesLan([{ nombre: "e", direccion: "10.0.0.5", familia: 4, interna: false }], [])).toHaveLength(1);
    expect(elegirDireccionesLan([], [])).toEqual([]);
  });

  it("rangos privados", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.0.9"]) expect(esPrivadaIPv4(ip)).toBe(true);
    for (const ip of ["172.32.0.1", "172.15.0.1", "192.169.0.1", "169.254.1.1", "999.1.1.1", "abc"]) expect(esPrivadaIPv4(ip)).toBe(false);
  });

  it("lee las interfaces con ruta por defecto", () => {
    expect(leerInterfacesConPuerta("Wi-Fi\r\n\r\nWi-Fi\nEthernet \n")).toEqual(["Wi-Fi", "Ethernet"]);
  });
});

describe("cia y node", () => {
  it("URL del .cia", () => {
    expect(urlCia("192.168.0.20")).toBe("http://192.168.0.20:33337/agent-companion.cia");
  });

  it("versión de Node", () => {
    expect(comprobarNode("v24.11.1\n")).toMatchObject({ ok: true, version: "24.11.1" });
    expect(comprobarNode("v22.0.0")).toMatchObject({ ok: true });
    expect(comprobarNode("v20.18.0")).toMatchObject({ ok: false, version: "20.18.0" });
    expect(comprobarNode("")).toMatchObject({ ok: false });
    expect(comprobarNode(undefined).mensaje).toMatch(/nodejs\.org/);
  });
});

describe("IP del QR según el perfil de red", () => {
  // interfaces de ejemplo: Ethernet 192.168.0.11 (Público), Wi-Fi 192.168.0.10 (Privado), una VPN de malla y VirtualBox
  const real = [
    { nombre: "Ethernet", direccion: "192.168.0.11", familia: "IPv4", interna: false },
    { nombre: "Wi-Fi", direccion: "192.168.0.10", familia: "IPv4", interna: false },
    { nombre: "Malla VPN", direccion: "100.101.102.103", familia: "IPv4", interna: false },
    { nombre: "VirtualBox Host-Only Network", direccion: "192.168.56.1", familia: "IPv4", interna: false },
    { nombre: "Loopback Pseudo-Interface 1", direccion: "127.0.0.1", familia: "IPv4", interna: true },
    { nombre: "Ethernet 2", direccion: "169.254.7.7", familia: "IPv4", interna: false },
  ];
  const perfiles = leerPerfilesRed(
    ["Ethernet\tRed 2\tPublic", "Wi-Fi\tMiCasa\tPrivate", "Malla VPN\tmalla\tPrivate", "VirtualBox Host-Only Network\tRed no identificada\tPrivate"].join("\r\n"),
  );

  it("con las interfaces de ejemplo queda la .10 (Wi-Fi privado) y no la .11 (Ethernet público)", () => {
    const r = elegirDireccionesLan(real, ["Ethernet", "Wi-Fi"], { perfiles });
    expect(r.map((x) => x.direccion)).toEqual(["192.168.0.10", "192.168.0.11", "192.168.56.1"]);
    expect(r[0]).toMatchObject({ recomendada: true, perfil: "privada", red: "MiCasa", tipo: "wifi", porConsola: false });
    expect(r[1]).toMatchObject({ recomendada: false, perfil: "publica", tipo: "ethernet" });
    expect(r.some((x) => x.direccion.startsWith("100.") || x.direccion.startsWith("169.254."))).toBe(false);
  });

  it("la IP por la que llegó la consola va primero, aunque su perfil sea público", () => {
    const r = elegirDireccionesLan(real, ["Ethernet", "Wi-Fi"], { perfiles, consoleLocalIp: "192.168.0.11" });
    expect(r[0]).toMatchObject({ direccion: "192.168.0.11", porConsola: true, recomendada: true });
    expect(r[1]?.direccion).toBe("192.168.0.10");
  });

  it("una consoleLocalIp que ya no es de ninguna interfaz se ignora", () => {
    expect(elegirDireccionesLan(real, ["Ethernet", "Wi-Fi"], { perfiles, consoleLocalIp: "192.168.0.200" })[0]?.direccion).toBe("192.168.0.10");
  });

  it("si solo hay interfaces públicas, usa una igual (con aviso)", () => {
    const soloPublica = real.filter((i) => i.nombre === "Ethernet");
    const r = elegirDireccionesLan(soloPublica, ["Ethernet"], { perfiles });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ direccion: "192.168.0.11", recomendada: true, perfil: "publica" });
    expect(avisosRedPublica(r)).toHaveLength(1);
  });

  it("el perfil Dominio cuenta como bueno", () => {
    const r = elegirDireccionesLan(real, ["Ethernet", "Wi-Fi"], { perfiles: [{ interfaz: "Ethernet", red: "corp", perfil: "dominio" }, { interfaz: "Wi-Fi", red: "x", perfil: "publica" }] });
    expect(r[0]?.direccion).toBe("192.168.0.11");
  });

  it("lee los perfiles de PowerShell (nombres de categoría o números) e ignora líneas raras", () => {
    expect(leerPerfilesRed("Wi-Fi\tMi red\tPrivate\r\nEthernet\tRed 2\t0\r\nVPN\tx\tDomainAuthenticated\r\nbasura\r\n\r\nX\ty\tOtra")).toEqual([
      { interfaz: "Wi-Fi", red: "Mi red", perfil: "privada" },
      { interfaz: "Ethernet", red: "Red 2", perfil: "publica" },
      { interfaz: "VPN", red: "x", perfil: "dominio" },
    ]);
  });

  it("avisa de las redes públicas con puerta de enlace y de la elegida, con la página de Configuración", () => {
    const r = elegirDireccionesLan(real, ["Ethernet", "Wi-Fi"], { perfiles });
    const avisos = avisosRedPublica(r);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ interfaz: "Ethernet", tipo: "ethernet", ajustes: "ms-settings:network-ethernet" });
    expect(avisos[0]?.texto).toBe(
      'Windows tiene la red "Red 2" (Ethernet) como pública y bloquea a la 3DS. Márcala como privada: Configuración → Red e Internet → Ethernet → Tipo de perfil de red → Privado.',
    );
    const wifiPublica = elegirDireccionesLan(real, ["Wi-Fi"], { perfiles: [{ interfaz: "Wi-Fi", red: "Cafe", perfil: "publica" }] });
    expect(avisosRedPublica(wifiPublica)[0]).toMatchObject({ tipo: "wifi", ajustes: "ms-settings:network-wifi" });
    // una interfaz pública sin puerta de enlace solo avisa si es la elegida
    const virtualPublica = elegirDireccionesLan(real, ["Wi-Fi"], { perfiles: [{ interfaz: "VirtualBox Host-Only Network", red: "vb", perfil: "publica" }] });
    expect(avisosRedPublica(virtualPublica)).toHaveLength(0);
    expect(avisosRedPublica(virtualPublica, "192.168.56.1")).toHaveLength(1);
  });

  it("tipo de interfaz por el nombre", () => {
    expect(tipoInterfaz("Wi-Fi")).toBe("wifi");
    expect(tipoInterfaz("Wi-Fi 2")).toBe("wifi");
    expect(tipoInterfaz("Conexión de red inalámbrica")).toBe("wifi");
    expect(tipoInterfaz("Ethernet")).toBe("ethernet");
  });
});

describe("regla antigua del firewall", () => {
  const antigua = leerReglaFirewall("Nombre de regla: Agent Companion\nPerfiles: Privada\nLocalPort: 33334,33337\n");
  const ninguna = leerReglaFirewall("No rules match the specified criteria.");

  it("sin «Cronio» pero con «Agent Companion» con los dos puertos cuenta como ok y marca antigua", () => {
    expect(estadoConAntigua(ninguna, antigua)).toMatchObject({ ok: true, existe: true, antigua: true });
  });

  it("la nueva manda: si existe no se mira la antigua; la antigua incompleta no cuenta", () => {
    const nueva = leerReglaFirewall("LocalPort: 33334,33337");
    expect(estadoConAntigua(nueva, antigua).antigua).toBeUndefined();
    expect(estadoConAntigua(ninguna, leerReglaFirewall("LocalPort: 33334"))).toMatchObject({ ok: false, existe: false });
    expect(estadoConAntigua(ninguna)).toMatchObject({ ok: false });
  });
});
