import { describe, expect, it } from "vitest";
import { nextAttemptAt, RETRY_DELAYS_S, WEBHOOK_MAX_ATTEMPTS } from "./retry";

const NOW = new Date("2026-10-28T00:00:00Z");
const mid = () => 0.5; // zero jitter

describe("webhook retry schedule", () => {
  it("is 5s, 5m, 30m, 2h, 5h, 10h, 10h then dead-letter (8 attempts)", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => (nextAttemptAt(n, NOW, mid)!.getTime() - NOW.getTime()) / 1000);
    expect(delays).toEqual([...RETRY_DELAYS_S]);
    expect(nextAttemptAt(8, NOW, mid)).toBeNull();
    expect(nextAttemptAt(9, NOW, mid)).toBeNull();
  });

  it("jitter stays within ±10%", () => {
    const lo = nextAttemptAt(2, NOW, () => 0)!.getTime() - NOW.getTime();
    const hi = nextAttemptAt(2, NOW, () => 0.999999)!.getTime() - NOW.getTime();
    expect(lo).toBe(270_000);
    expect(hi).toBeLessThanOrEqual(330_000);
    expect(hi).toBeGreaterThan(329_000);
  });

  it("rejects attemptsDone < 1", () => {
    expect(() => nextAttemptAt(0, NOW)).toThrow();
  });
});
