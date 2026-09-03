/**
 * **THE CAPS THIS MODULE DECLARES, AND THE ONE HAND-COPY IT CANNOT AVOID.**
 *
 * ⚠ `caps.ts`'s own docblock states the rule: *a number is asserted FROM here,
 * never re-typed in a test.* This file keeps that rule while proving the one
 * place the number legitimately exists twice — `packages/mcp-server` cannot
 * import `src/` (its tsconfig `rootDir` is its own `src`), so the poll
 * detector's constants are a HAND-COPY, and a hand-copy nothing joins is drift
 * waiting to happen.
 *
 * ⚠ **THE JOIN IS A SOURCE READ, NOT AN IMPORT**, exactly as
 * `dopl-desktop-app/test/runtime-stamp-literals.test.mjs` does across the
 * desktop seam: the package's file is parsed as TEXT and the literal it
 * declares is compared to the one this module exports. It therefore fails from
 * EITHER side — edit the app's copy and it fails, edit the package's copy and
 * it fails — which is the property a one-directional check does not have.
 *
 * ⚠ Drift here is SILENT in production: both halves parse, both compile, and
 * the detector simply judges over a different window than the one the docs and
 * the desktop describe. Nothing else would notice.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POLL_STRIKE_LIMIT,
  POLL_STRIKE_WINDOW_MS,
  RESILIENCE_WINDOW_MS,
} from "./caps";

/** The package-side copy, read as text — see the docblock for why not imported. */
const DETECTOR_SOURCE = readFileSync(
  join(process.cwd(), "packages/mcp-server/src/tools/channel-poll-detector.ts"),
  "utf8",
);

/**
 * Pull the right-hand side of one `export const <name> = …;` out of the source.
 * ⚠ Deliberately strict: a match failure is reported as a FAILURE rather than
 * silently passing, because "the constant is gone" is the drift this exists for.
 */
function declaredIn(source: string, name: string): string {
  const m = source.match(
    new RegExp(`export const ${name}\\s*=\\s*([^;]+);`),
  );
  expect(m, `${name} is not declared in channel-poll-detector.ts any more`).not.toBeNull();
  return m![1].trim();
}

describe("the poll-detector caps agree across the import boundary", () => {
  it("POLL_STRIKE_LIMIT is the same number on both sides", () => {
    expect(declaredIn(DETECTOR_SOURCE, "POLL_STRIKE_LIMIT")).toBe(
      String(POLL_STRIKE_LIMIT),
    );
  });

  it("POLL_STRIKE_WINDOW_MS is the same EXPRESSION on both sides", () => {
    // ⚠ THE EXPRESSION, NOT THE VALUE. `10 * 60_000` and `600000` are the same
    // number and a value check would accept either; what a reader compares when
    // they open the two files is the text, and a copy that reads differently is
    // a copy somebody will "reconcile" wrongly.
    const appSource = readFileSync(
      join(process.cwd(), "src/shared/channels/caps.ts"),
      "utf8",
    );
    expect(declaredIn(DETECTOR_SOURCE, "POLL_STRIKE_WINDOW_MS")).toBe(
      declaredIn(appSource, "POLL_STRIKE_WINDOW_MS"),
    );
    // …and the value is what this module exports, asserted from here.
    expect(POLL_STRIKE_WINDOW_MS).toBe(10 * 60_000);
  });

  it("the package copy still says WHY it is a copy", () => {
    // ⚠ A duplicated constant with no explanation is deleted by the next
    // reader as "dead". The pointer back to this file is what keeps it alive.
    expect(DETECTOR_SOURCE).toContain("src/shared/channels/caps.ts");
  });

  it("the poll window is NOT wired to the resilience window", () => {
    // ⚠ Two different questions in the same neighbourhood: RESILIENCE_WINDOW_MS
    // asks how long an ADDRESS stays warm, POLL_STRIKE_WINDOW_MS asks how long
    // ago a read still counts as part of one loop. `caps.ts` refuses to express
    // either as arithmetic over the other, and this is that refusal as a test —
    // tuning one must not move the other.
    expect(POLL_STRIKE_WINDOW_MS).not.toBe(RESILIENCE_WINDOW_MS);
  });
});
