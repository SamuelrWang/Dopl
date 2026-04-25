import { describe, expect, it } from "vitest";

import {
  formatDateCompact,
  formatTable,
  truncate,
} from "./output.js";

describe("truncate", () => {
  it("returns empty string for null / undefined", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
  });

  it("returns text unchanged when under limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns text unchanged when exactly at limit", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
  });

  it("truncates with ellipsis when over limit", () => {
    const out = truncate("abcdefghij", 5);
    expect(out).toHaveLength(5);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles max=0 without crashing", () => {
    expect(truncate("abc", 0)).toBe("…");
  });
});

describe("formatDateCompact", () => {
  it("returns em-dash for null / undefined", () => {
    expect(formatDateCompact(null)).toBe("—");
    expect(formatDateCompact(undefined)).toBe("—");
  });

  it("renders ISO date as YYYY-MM-DD", () => {
    expect(formatDateCompact("2025-11-15T12:00:00Z")).toBe("2025-11-15");
  });

  it("returns em-dash for invalid date", () => {
    expect(formatDateCompact("not-a-date")).toBe("—");
  });
});

describe("formatTable", () => {
  it("aligns columns to the widest cell", () => {
    const out = formatTable(
      ["ID", "NAME"],
      [
        ["a", "First"],
        ["bcdef", "Second"],
      ]
    );
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith("ID   ")).toBe(true);
    expect(lines[0]).toContain("NAME");
    expect(lines[1]).toMatch(/^─+\s+─+$/);
    expect(lines[2].startsWith("a    ")).toBe(true);
    expect(lines[3].startsWith("bcdef")).toBe(true);
  });

  it("tolerates missing cells in rows", () => {
    const out = formatTable(["A", "B"], [["only-a"]]);
    expect(out.split("\n")[2]).toContain("only-a");
  });

  it("returns headers + separator even with zero rows", () => {
    const out = formatTable(["A", "B"], []);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
  });
});
