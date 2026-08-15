/**
 * INVARIANT SUITE — per-KB storage constants. Pins the VALUE of each plan's cap
 * (INVARIANTS §14: "A PIN ON A SYMBOL IS NOT A PIN"). ⚠ DECIMAL megabytes — a
 * "fix" to 1024-based MiB makes the free plan read 4.77 MB.
 */

import { describe, it, expect } from "vitest";
import { KB_STORAGE_BYTES, kbStorageLimitForPlan } from "./kb-storage";
import { PLANS } from "./plans";

describe("KB_STORAGE_BYTES", () => {
  it("pins the per-plan per-base byte cap", () => {
    expect(KB_STORAGE_BYTES).toEqual({
      free: 5_000_000,
      solo: 100_000_000,
      team: 100_000_000,
    });
  });

  it("is DECIMAL MB, not MiB — the bar renders these divided by 1000s", () => {
    expect(KB_STORAGE_BYTES.free).toBe(5 * 1_000_000);
    expect(KB_STORAGE_BYTES.free).not.toBe(5 * 1024 * 1024);
  });

  it("covers every plan id the product sells — no plan can fall off the map", () => {
    for (const plan of PLANS) {
      expect(KB_STORAGE_BYTES[plan.id]).toBeGreaterThan(0);
    }
  });

  it("gives both paid plans strictly more room than free", () => {
    expect(KB_STORAGE_BYTES.solo).toBeGreaterThan(KB_STORAGE_BYTES.free);
    expect(KB_STORAGE_BYTES.team).toBeGreaterThan(KB_STORAGE_BYTES.free);
  });
});

describe("kbStorageLimitForPlan", () => {
  it("resolves a cap per plan id", () => {
    expect(kbStorageLimitForPlan("free")).toBe(5_000_000);
    expect(kbStorageLimitForPlan("solo")).toBe(100_000_000);
    expect(kbStorageLimitForPlan("team")).toBe(100_000_000);
  });

  it("falls back to the FREE cap for an unknown plan, never to unlimited", () => {
    // ⚠ Unrecognised plan must land on the TIGHTEST cap, not `undefined`
    // (compares as NaN, letting every write through).
    expect(kbStorageLimitForPlan("enterprise" as never)).toBe(
      KB_STORAGE_BYTES.free
    );
  });
});
