import type { AgentKind } from "./viewmodel.ts";

export type DotSignature = "sparks" | "twin" | "typing" | "cursor" | "wings";

// Valores tomados de art/dots/index.html (AGENTS y "Cómo se distingue cada uno").
export const AGENT_STYLES: Record<AgentKind, { color: string; color2?: string; signature: DotSignature }> = {
  claude: { color: "#ee7446", signature: "sparks" },
  gemini: { color: "#5b8cff", color2: "#b274ff", signature: "twin" },
  codex: { color: "#2fd08a", signature: "typing" },
  cursor: { color: "#d5d9e2", signature: "cursor" },
  hermes: { color: "#f6c544", signature: "wings" },
};
