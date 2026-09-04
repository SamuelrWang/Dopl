/**
 * **THE KNOWLEDGE CAPS, AND THE HAND-COPY THEY CANNOT AVOID.**
 *
 * ⚠ Same construction and same argument as `shared/channels/caps.test.ts`:
 * `packages/mcp-server` cannot import `src/` (its tsconfig `rootDir` is its own
 * `src`), so the agent surface holds a HAND-COPY of these three numbers, and a
 * hand-copy nothing joins is drift waiting to happen. The join is a SOURCE
 * READ, not an import, so it fails from EITHER side.
 *
 * ⚠ Drift here is SILENT in production: both halves compile, and the surface
 * simply nudges (or refuses a pin) at a different number than the one the docs,
 * the service and the doctrine all state.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KB_PIN_MAX_CHARS,
  KB_PIN_WARN_CHARS,
  KB_SECTION_NUDGE_CHARS,
} from "./caps";

/** The package-side copy, read as text — see the docblock for why not imported. */
const SURFACE_SOURCE = readFileSync(
  join(process.cwd(), "packages/mcp-server/src/tools/knowledge-sections.ts"),
  "utf8",
);

/** The right-hand side of one `export const <name> = …;`. ⚠ A missing
 *  declaration FAILS rather than passing vacuously — "the constant is gone" is
 *  exactly the drift this exists for. */
function declaredIn(name: string): string {
  const m = SURFACE_SOURCE.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  expect(m, `${name} is not declared in knowledge-sections.ts any more`).not.toBeNull();
  return m![1].trim();
}

describe("the knowledge caps agree across the import boundary", () => {
  // ⚠ THE EXPRESSION, NOT THE VALUE. `1_500` and `1500` are the same number and
  // a value check would accept either; what a reader compares when they open
  // both files is the text.
  it("KB_SECTION_NUDGE_CHARS is the same expression on both sides", () => {
    expect(declaredIn("KB_SECTION_NUDGE_CHARS")).toBe("1_500");
    expect(KB_SECTION_NUDGE_CHARS).toBe(1_500);
  });

  it("KB_PIN_WARN_CHARS is the same expression on both sides", () => {
    expect(declaredIn("KB_PIN_WARN_CHARS")).toBe("4_000");
    expect(KB_PIN_WARN_CHARS).toBe(4_000);
  });

  it("KB_PIN_MAX_CHARS is the same expression on both sides", () => {
    expect(declaredIn("KB_PIN_MAX_CHARS")).toBe("12_000");
    expect(KB_PIN_MAX_CHARS).toBe(12_000);
  });

  it("the warn cap is below the refusal cap, and both are above the nudge", () => {
    expect(KB_SECTION_NUDGE_CHARS).toBeLessThan(KB_PIN_WARN_CHARS);
    expect(KB_PIN_WARN_CHARS).toBeLessThan(KB_PIN_MAX_CHARS);
  });
});
