import { describe, expect, it } from "vitest";
import { shortModel } from "../src/model.ts";

describe("shortModel", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-opus-4-5-20251101", "Opus 4.5"],
    ["claude-sonnet-4-20250514", "Sonnet 4"],
    ["claude-opus-4-1-20250805", "Opus 4.1"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    ["claude-3-5-sonnet-20241022", "Sonnet 3.5"],
    ["claude-3-5-haiku-latest", "Haiku 3.5"],
    ["claude-3-opus-20240229", "Opus 3"],
    ["claude-opus-5-5[1m]", "Opus 5.5"],
    ["Claude-Opus-5-5", "Opus 5.5"],
    ["anthropic.claude-opus-4-5-20251101-v1:0", "Opus 4.5"],
    ["us.anthropic.claude-sonnet-4-20250514-v1:0", "Sonnet 4"],
    ["claude-sonnet-4-5@20250929", "Sonnet 4.5"],
    ["claude-opus", "Opus"],
    ["opus", "Opus"],
    ["opus[1m]", "Opus"],
    ["sonnet", "Sonnet"],
    ["opusplan", "Opus"],
    ["haiku", "Haiku"],
    ["  claude-opus-5-5  ", "Opus 5.5"],
  ])("%s -> %s", (raw, corto) => {
    expect(shortModel(raw)).toBe(corto);
  });

  it("lo que no reconoce lo deja como llegó (recortado a 38) y vacío sigue vacío", () => {
    expect(shortModel("")).toBe("");
    expect(shortModel("   ")).toBe("");
    expect(shortModel("Opus")).toBe("Opus");
    expect(shortModel("gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(shortModel("g-1")).toBe("g-1");
    expect(shortModel("x".repeat(80)).length).toBeLessThanOrEqual(38);
  });
});
