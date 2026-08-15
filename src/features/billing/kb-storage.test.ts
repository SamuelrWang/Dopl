/**
 * INVARIANT SUITE — the per-KB storage constants.
 *
 * `kb-storage.ts` is the ONE retune spot, so what is pinned here is the VALUE
 * of each plan's cap, not merely that the symbol is referenced (INVARIANTS §14:
 * "A PIN ON A SYMBOL IS NOT A PIN"). The unit is the subtle half — these are
 * DECIMAL megabytes, and a well-meant "fix" to 1024-based MiB would silently
 * make the free plan read 4.77 MB in the very bar that renders it.
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
    // The fail direction matters: an unrecognised plan string must land on the
    // tightest cap, not on `undefined` (which would compare as NaN and let
    // every write through).
    expect(kbStorageLimitForPlan("enterprise" as never)).toBe(
      KB_STORAGE_BYTES.free
    );
  });
});
