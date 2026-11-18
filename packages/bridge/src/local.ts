// Protección común de los servidores locales (API y simulador).

/** Acepta solo Host de bucle local (defensa contra DNS rebinding). */
export function isLocalHostHeader(host: string | undefined): boolean {
  return host !== undefined && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
}
