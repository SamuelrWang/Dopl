/**
 * **THE HERO DEMO'S DEVICE STAMPS, LENGTH AND SINGLE-SOURCE RULE** (v3, 2026-10-12).
 *
 * Split out of `demo-script.test.ts` on the 500-line cap (`eslint.config.mjs › max-lines`,
 * ENGINEERING.md §2), on the same seam the rest of this directory is cut along: that file
 * covers the SCRIPT (cursor, colours, mentions, lanes, chronology, threads), this one
 * covers the three facts about it that are not the script itself.
 *
 * ⚠ Every probe here was checked to fail closed by reverting the thing it asserts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { messageSourceOf } from "@/features/channels/lib/message-device";
import {
  messagesAt,
} from "./demo-transcript";
import { LOOP_MS, STEPS } from "./demo-steps";

const HERE = join(fileURLToPath(new URL(".", import.meta.url)));
const LAST_STEP = STEPS.length - 1;

/** Source of a file in this directory. ⚠ Throws rather than asserting on "". */
function source(relative: string): string {
  const text = readFileSync(join(HERE, relative), "utf8");
  if (text.trim() === "") throw new Error(`empty source: ${relative}`);
  return text;
}

describe("8. human messages carry the device they were sent from", () => {
  const humans = () =>
    messagesAt(LAST_STEP).filter(
      (m) => m.authorKind === "user" && m.authorUserId !== null
    );

  it("stamps every human line", () => {
    const stamped = humans().filter((m) => messageSourceOf(m.metadata) !== null);
    expect(stamped).toHaveLength(humans().length);
    expect(stamped.length).toBeGreaterThan(0);
  });

  it("parses each stamp through the product's own reader", () => {
    for (const m of humans()) {
      const source = messageSourceOf(m.metadata);
      expect(source, `message ${m.id}`).toBeTruthy();
      expect((source!.label ?? "").trim()).not.toBe("");
      expect(["glasses", "computer", "web", "phone"]).toContain(source!.kind);
    }
  });

  it("varies the device across people, which is the point of showing it", () => {
    const kinds = new Set(
      humans().map((m) => messageSourceOf(m.metadata)?.kind)
    );
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it("puts the viewer on glasses for at least one line", () => {
    const glasses = humans().filter(
      (m) => messageSourceOf(m.metadata)?.kind === "glasses"
    );
    expect(glasses.length).toBeGreaterThan(0);
  });

  it("🔒 stamps NO agent post, which is the product's rule not a choice here", () => {
    // `view-model-rows.ts` nulls `source` for an agent author, so a stamp on one would
    // be dead data that reads as intent.
    const agents = messagesAt(LAST_STEP).filter((m) => m.authorKind === "agent");
    expect(agents.length).toBeGreaterThan(0);
    for (const m of agents) {
      expect(messageSourceOf(m.metadata), `agent post ${m.id}`).toBeNull();
    }
  });
});

describe("9. the loop's length", () => {
  it("is about a minute, measured not claimed", () => {
    // Samuel asked for ~60s. Printed in the DONE rather than estimated.
    expect(LOOP_MS).toBeGreaterThan(45_000);
    expect(LOOP_MS).toBeLessThan(70_000);
  });

  it("gives every beat a duration", () => {
    for (const s of STEPS) expect(s.dur).toBeGreaterThan(0);
  });
});

describe("10. the approved wording lives in exactly one place", () => {
  /**
   * **THE ANTI-DRIFT PROBE** (@cleanup-orchestrator: "pin it against one source, so the
   * two copies can't drift").
   *
   * ⚠ **IT CANNOT COMPARE AGAINST THE KB**, which is where the approved copy lives, so it
   * pins the thing it can: that `demo-data.ts` is the ONLY module in this directory
   * containing any scripted line. Every other consumer has to derive — the inbound banner
   * through `citedMessage`, the mentions snippet by cutting the body — and this is what
   * stops the next "just paste it here too".
   */
  const SIBLINGS = [
    // ⚠ `demo-transcript.ts` is absent because it IS the source. `demo-data.ts` is here
    // precisely because the split moved the lines OUT of it, and nothing may put one back.
    "demo-data.ts",
    "demo-narration.ts",
    "demo-info-data.ts",
    "demo-home-rows.ts",
    "demo-scene.tsx",
    "demo-agent-view.tsx",
    "banner-demo.tsx",
    "demo-steps.ts",
    "demo-info-data.ts",
  ];

  /** Bodies long enough that an accidental match is not a coincidence. */
  const lines = () =>
    messagesAt(LAST_STEP)
      .map((m) => m.body)
      .filter((b) => b.length >= 25);

  it("has lines to check", () => {
    expect(lines().length).toBeGreaterThan(10);
  });

  it("🔒 finds no scripted line restated in any sibling module", () => {
    const offenders: string[] = [];
    for (const file of SIBLINGS) {
      const text = source(file);
      for (const line of lines()) {
        if (text.includes(line)) offenders.push(`${file}: ${line.slice(0, 40)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
