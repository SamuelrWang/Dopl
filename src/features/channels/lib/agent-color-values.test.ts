/**
 * 🔒 THE PICKER MEASURES WHAT THE SCREEN PAINTS. `AGENT_COLOR_VALUES` must equal every
 * `--agent-color-NN` token in BOTH CSS trees — same keys, same numbers — or the "most distinct
 * colour" the server picks is computed over a palette nobody sees.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_COLOR_KEYS } from "./agent-colors";
import { AGENT_COLOR_VALUES, parseOklch } from "./agent-color-values";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CSS_FILES = ["src/app/globals.css", "apps/desktop-ui/src/styles/tokens.css"];

function tokensOf(rel: string): Map<string, string> {
  const source = readFileSync(path.join(ROOT, rel), "utf8");
  const out = new Map<string, string>();
  for (const m of source.matchAll(/--agent-color-(\d+)\s*:\s*([^;]+);/g)) {
    out.set(`agent-${m[1]}`, m[2].trim());
  }
  return out;
}

describe("AGENT_COLOR_VALUES mirrors the painted tokens", () => {
  for (const rel of CSS_FILES) {
    it(`matches ${rel} key for key and number for number`, () => {
      const tokens = tokensOf(rel);
      expect([...tokens.keys()].sort()).toEqual([...AGENT_COLOR_KEYS].sort());
      for (const key of AGENT_COLOR_KEYS) {
        const parsed = parseOklch(tokens.get(key) ?? "");
        expect(parsed, `${rel} ${key} is not an oklch() token`).not.toBeNull();
        expect(parsed, `${rel} ${key}`).toEqual(AGENT_COLOR_VALUES[key]);
      }
    });
  }
});

describe("parseOklch", () => {
  it("reads plain, percent-lightness, deg and alpha forms", () => {
    expect(parseOklch("oklch(0.44 0.11 20)")).toEqual({ l: 0.44, c: 0.11, h: 20 });
    expect(parseOklch("oklch(44% 0.11 20deg)")).toEqual({ l: 0.44, c: 0.11, h: 20 });
    expect(parseOklch("oklch(0.44 0.11 20 / 0.5)")).toEqual({ l: 0.44, c: 0.11, h: 20 });
  });

  it("refuses anything that is not a literal oklch()", () => {
    expect(parseOklch("#ff0000")).toBeNull();
    expect(parseOklch("var(--x)")).toBeNull();
  });
});
