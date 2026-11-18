import { describe, expect, it } from "vitest";
import { AttemptLimiter } from "../src/pairing.ts";

describe("AttemptLimiter", () => {
  it("1 intento por segundo por IP", () => {
    let now = 0;
    const l = new AttemptLimiter({ now: () => now });
    expect(l.tryAcquire("1.1.1.1")).toBe(true);
    expect(l.tryAcquire("1.1.1.1")).toBe(false);
    expect(l.tryAcquire("2.2.2.2")).toBe(true);
    now = 999;
    expect(l.tryAcquire("1.1.1.1")).toBe(false);
    now = 1000;
    expect(l.tryAcquire("1.1.1.1")).toBe(true);
  });

  it("tope global de 5 por segundo", () => {
    let now = 0;
    const l = new AttemptLimiter({ now: () => now });
    for (let i = 0; i < 5; i++) expect(l.tryAcquire(`10.0.0.${i}`)).toBe(true);
    expect(l.tryAcquire("10.0.0.99")).toBe(false);
    now = 1000;
    expect(l.tryAcquire("10.0.0.99")).toBe(true);
  });

  it("los rechazados no consumen cupo", () => {
    let now = 0;
    const l = new AttemptLimiter({ now: () => now, perIpIntervalMs: 0, globalPerSecond: 2 });
    expect(l.tryAcquire("a")).toBe(true);
    expect(l.tryAcquire("a")).toBe(true);
    for (let i = 0; i < 10; i++) expect(l.tryAcquire("a")).toBe(false);
    now = 1000;
    expect(l.tryAcquire("a")).toBe(true);
  });
});
