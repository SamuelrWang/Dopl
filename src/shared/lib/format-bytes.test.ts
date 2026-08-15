import { describe, it, expect } from "vitest";
import { formatBytes } from "./format-bytes";
import { KB_STORAGE_BYTES } from "@/features/billing/kb-storage";

/**
 * The property worth pinning is the JOIN with the cap table: the meter renders
 * `formatBytes(used)` beside `formatBytes(limit)`, so a decimal/binary mismatch
 * between this file and `kb-storage.ts` shows up as a cap that reads 4.8 MB.
 * Both sides of that join are asserted here, per INVARIANTS §14.
 */

describe("formatBytes", () => {
  it("renders bytes whole and larger units to one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_500)).toBe("1.5 KB");
    expect(formatBytes(4_231_000)).toBe("4.2 MB");
    expect(formatBytes(2_400_000_000)).toBe("2.4 GB");
  });

  it("drops a trailing .0 so a round cap reads as a round number", () => {
    expect(formatBytes(5_000_000)).toBe("5 MB");
    expect(formatBytes(100_000_000)).toBe("100 MB");
  });

  it("renders every plan cap exactly as the plan copy states it", () => {
    expect(formatBytes(KB_STORAGE_BYTES.free)).toBe("5 MB");
    expect(formatBytes(KB_STORAGE_BYTES.solo)).toBe("100 MB");
    expect(formatBytes(KB_STORAGE_BYTES.team)).toBe("100 MB");
  });

  it("reads a nonsense number as 0 B rather than inventing a minus sign", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
