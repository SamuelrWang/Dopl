import { describe, expect, it } from "vitest";
import { Throttle, TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  it("expires entries after the TTL and evicts the oldest when full", () => {
    const c = new TtlCache<string, number>(1000, 2);
    c.set("a", 1, 0);
    c.set("b", 2, 0);
    c.set("c", 3, 0);
    expect(c.get("a", 10)).toBeUndefined();
    expect(c.get("b", 10)).toBe(2);
    expect(c.get("b", 1000)).toBeUndefined();
  });
});

describe("Throttle", () => {
  it("lets one action through per interval per key", () => {
    const t = new Throttle<string>(5000, 10);
    expect(t.tryAcquire("d1", 0)).toBe(true);
    expect(t.tryAcquire("d1", 4999)).toBe(false);
    expect(t.tryAcquire("d2", 4999)).toBe(true);
    expect(t.tryAcquire("d1", 5000)).toBe(true);
  });
});
