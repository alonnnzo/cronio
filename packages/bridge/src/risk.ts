import { fitsInLines, sanitizeText } from "./text.ts";

export type Risk = "normal" | "high";

const HIGH_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rR]/, // rm -r, rm -rf, rm -fr, rm -f -r
  /\brm\s+--recursive\b/,
  /\bdel\b[^\n]*\s\/s\b/i,
  /\brmdir\b[^\n]*\s\/s\b/i,
  /\bgit\s+push\b[^\n]*(--force(?![\w-])|\s-f(?![\w-]))/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b[^\n]*\s-[a-z]*f/,
  /(^|[;&|]\s*)format(\.com)?\s+[a-z]:/i,
  /(^|[;&|]\s*)format\s*$/i,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^\n]*\bof=/,
  /\bshutdown\b/,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
  /\bchmod\s+(-[a-zA-Z]+\s+)*-R\s+777\b/,
  /\bchmod\s+777\s+-R\b/,
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
];

export function classifyRisk(toolName: string, toolInput: unknown): Risk {
  if (toolName !== "Bash" && toolName !== "PowerShell") return "normal";
  const command =
    typeof toolInput === "object" && toolInput !== null && typeof (toolInput as { command?: unknown }).command === "string"
      ? (toolInput as { command: string }).command
      : "";
  // lo que no se puede leer entero en la tarjeta (varias líneas o más de 6 al ajustar) exige mantener A
  const clean = sanitizeText(command);
  if (clean.includes("\n") || !fitsInLines(command)) return "high";
  return HIGH_PATTERNS.some((re) => re.test(command)) ? "high" : "normal";
}
