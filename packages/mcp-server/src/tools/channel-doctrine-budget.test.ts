/**
 * **THE PULLED DOCTRINE'S OWN BUDGET** for `dopl_channel` (slice A6b,
 * 2026-09-02).
 *
 * ⚠ **A THIRD BUDGET, AND IT IS BUDGETED DIFFERENTLY FROM THE OTHER TWO ON
 * PURPOSE.** A tool's DESCRIPTION (`tool-budget.test.ts`) and its INPUT SCHEMA
 * (`channel-schema-budget.test.ts`) are PUSHED: every connected client pays for
 * them on every connection, including the sessions that never call the tool, so
 * their ratchets only ever move down. `channel-doctrine.ts` is PULLED — nobody
 * pays for it until an agent asks — which is exactly why it needed a gate of its
 * own: prose evicted from the two pushed surfaces lands HERE, and an unmeasured
 * destination is not a diet, it is a relocation.
 *
 * ⚠ **AND WHY IT IS ITS OWN FILE**, the reason `channel-schema-budget.test.ts`
 * gives: `tool-budget.test.ts` belongs to the budget-gates slice, and a
 * per-slice assertion file is what keeps two waves from colliding on merge.
 */

import { describe, it, expect } from "vitest";
import {
  CHANNEL_DOCTRINE,
  DOCTRINE_SECTIONS,
  DOCTRINE_SECTION_NAMES,
  doctrineSection,
  type DoctrineSection,
} from "./channel-doctrine.js";

/**
 * ⚠ **THE WHOLE-DOCUMENT NUMBER WENT UP ON THE DAY IT WAS FIRST MEASURED HERE,
 * AND THAT IS RECORDED RATHER THAN HIDDEN: 32,085 → 32,728.** The +643 is
 * `op="help", section=` — an index line naming the sections, and the SECURITY
 * sentence repeated at the head of each one, because a caller that pulls a
 * single section skipped the header it used to live in. What it buys is the
 * number below it: a typical pull is now ONE section, and the largest section
 * is under a fifth of the document.
 *
 * ⚠ **SO {@link DOCTRINE_SECTION_MAX_CHARS} IS THE ONE THAT GOVERNS COST**, and
 * both are ratchets in both directions — growing past a number fails, and
 * shrinking below one without lowering it fails too.
 */
const DOCTRINE_MAX_CHARS = 32_728;
const DOCTRINE_SECTION_MAX_CHARS = 6_252;

describe("the pulled doctrine is budgeted too, and by section", () => {
  it(`the whole document is at most ${DOCTRINE_MAX_CHARS} chars`, () => {
    expect(CHANNEL_DOCTRINE.length).toBeLessThanOrEqual(DOCTRINE_MAX_CHARS);
    expect(
      CHANNEL_DOCTRINE.length,
      "it shrank — lower DOCTRINE_MAX_CHARS to the measured size in the same commit",
    ).toBeGreaterThan(DOCTRINE_MAX_CHARS - 500);
  });

  it(`no single section exceeds ${DOCTRINE_SECTION_MAX_CHARS} chars, as served by section=`, () => {
    // ⚠ MEASURED THROUGH `doctrineSection`, not off the raw constants: what a
    // caller receives carries the section's own heading, the SECURITY sentence
    // and the index, and a budget over the parts is not a budget over the answer.
    const over = Object.keys(DOCTRINE_SECTIONS)
      .map((name) => ({ name, len: doctrineSection(name as DoctrineSection).length }))
      .filter(({ len }) => len > DOCTRINE_SECTION_MAX_CHARS)
      .map(({ name, len }) => `${name}: ${len} chars`);
    expect(
      over,
      `a doctrine section grew past the budget — split it, or cut it:\n- ${over.join("\n- ")}`,
    ).toEqual([]);
  });

  it("every published `section=` name resolves to a section, and back", () => {
    // ⚠ THE PAIR. The schema builds its enum from `DOCTRINE_SECTIONS`' keys, so
    // this cannot drift today — and asserting it is what keeps a future
    // hand-written list from being the thing that offers a name `op="help"`
    // cannot answer.
    expect([...DOCTRINE_SECTION_NAMES].sort()).toEqual(
      Object.keys(DOCTRINE_SECTIONS).sort(),
    );
    for (const name of DOCTRINE_SECTION_NAMES) {
      expect(doctrineSection(name), name).toContain(DOCTRINE_SECTIONS[name]);
    }
  });
});
