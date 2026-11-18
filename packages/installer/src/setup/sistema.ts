// Rutas absolutas de los programas de Windows que Cronio ejecuta (PowerShell, netsh, taskkill, tasklist, netstat).
// Llamarlos por su nombre deja que Windows los busque en el PATH y en la carpeta actual: un archivo con el mismo nombre en otro lugar
// (por ejemplo, en la carpeta de un proyecto) correría en su lugar. Con la ruta completa en `%SystemRoot%\System32` eso no pasa.
import { win32 } from "node:path";

/** Carpeta de Windows (`%SystemRoot%`; `C:\Windows` si la variable no existe). */
export function carpetaWindows(env: NodeJS.ProcessEnv = process.env): string {
  const raiz = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
  return raiz && raiz.trim() !== "" ? raiz : "C:/Windows";
}

/** `%SystemRoot%\System32\<exe>`, con separadores de Windows. */
export function rutaSystem32(exe: string, env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(carpetaWindows(env), "System32", exe);
}

/** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. */
export function rutaPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(carpetaWindows(env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Los programas de sistema que se ejecutan, por nombre corto. */
export type ProgramaSistema = "powershell" | "netsh" | "taskkill" | "tasklist" | "netstat";

export function rutaPrograma(programa: ProgramaSistema, env: NodeJS.ProcessEnv = process.env): string {
  return programa === "powershell" ? rutaPowerShell(env) : rutaSystem32(`${programa}.exe`, env);
}
