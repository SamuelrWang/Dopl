"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const output_js_1 = require("./output.js");
(0, vitest_1.describe)("truncate", () => {
    (0, vitest_1.it)("returns empty string for null / undefined", () => {
        (0, vitest_1.expect)((0, output_js_1.truncate)(null, 10)).toBe("");
        (0, vitest_1.expect)((0, output_js_1.truncate)(undefined, 10)).toBe("");
    });
    (0, vitest_1.it)("returns text unchanged when under limit", () => {
        (0, vitest_1.expect)((0, output_js_1.truncate)("hello", 10)).toBe("hello");
    });
    (0, vitest_1.it)("returns text unchanged when exactly at limit", () => {
        (0, vitest_1.expect)((0, output_js_1.truncate)("abcde", 5)).toBe("abcde");
    });
    (0, vitest_1.it)("truncates with ellipsis when over limit", () => {
        const out = (0, output_js_1.truncate)("abcdefghij", 5);
        (0, vitest_1.expect)(out).toHaveLength(5);
        (0, vitest_1.expect)(out.endsWith("…")).toBe(true);
    });
    (0, vitest_1.it)("handles max=0 without crashing", () => {
        (0, vitest_1.expect)((0, output_js_1.truncate)("abc", 0)).toBe("…");
    });
});
(0, vitest_1.describe)("formatDateCompact", () => {
    (0, vitest_1.it)("returns em-dash for null / undefined", () => {
        (0, vitest_1.expect)((0, output_js_1.formatDateCompact)(null)).toBe("—");
        (0, vitest_1.expect)((0, output_js_1.formatDateCompact)(undefined)).toBe("—");
    });
    (0, vitest_1.it)("renders ISO date as YYYY-MM-DD", () => {
        (0, vitest_1.expect)((0, output_js_1.formatDateCompact)("2025-11-15T12:00:00Z")).toBe("2025-11-15");
    });
    (0, vitest_1.it)("returns em-dash for invalid date", () => {
        (0, vitest_1.expect)((0, output_js_1.formatDateCompact)("not-a-date")).toBe("—");
    });
});
(0, vitest_1.describe)("formatTable", () => {
    (0, vitest_1.it)("aligns columns to the widest cell", () => {
        const out = (0, output_js_1.formatTable)(["ID", "NAME"], [
            ["a", "First"],
            ["bcdef", "Second"],
        ]);
        const lines = out.split("\n");
        (0, vitest_1.expect)(lines).toHaveLength(4);
        (0, vitest_1.expect)(lines[0].startsWith("ID   ")).toBe(true);
        (0, vitest_1.expect)(lines[0]).toContain("NAME");
        (0, vitest_1.expect)(lines[1]).toMatch(/^─+\s+─+$/);
        (0, vitest_1.expect)(lines[2].startsWith("a    ")).toBe(true);
        (0, vitest_1.expect)(lines[3].startsWith("bcdef")).toBe(true);
    });
    (0, vitest_1.it)("tolerates missing cells in rows", () => {
        const out = (0, output_js_1.formatTable)(["A", "B"], [["only-a"]]);
        (0, vitest_1.expect)(out.split("\n")[2]).toContain("only-a");
    });
    (0, vitest_1.it)("returns headers + separator even with zero rows", () => {
        const out = (0, output_js_1.formatTable)(["A", "B"], []);
        const lines = out.split("\n");
        (0, vitest_1.expect)(lines).toHaveLength(2);
    });
});
