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
 * ⚠ **32,728 → 8,997 ON 2026-09-02 (slice B8), AND IT IS A REWRITE RATHER THAN
 * A TRIM.** The document had become the destination for every paragraph evicted
 * from a PUSHED string — `REFUSALS` alone was 5,765 characters, `CHANNEL_OWN_AGENTS`
 * 4,873, `AWAITING` 3,914 on a hold that is now a knob on `read` — and an
 * unmeasured destination is not a diet, it is a relocation. It is re-sectioned
 * to the five ops and cut to CONTRACTS: what the nouns mean, what each op
 * promises, and the rule behind an argument whose `.describe()` may only carry
 * its contract. Fourteen sections became seven.
 *
 * ⚠ **{@link DOCTRINE_SECTION_MAX_CHARS} IS STILL THE ONE THAT GOVERNS COST**,
 * because a typical pull is ONE section; both are ratchets in both directions —
 * growing past a number fails, and shrinking below one without lowering it
 * fails too. ⚠ The largest section is now the LAW, which is the one section
 * whose size is capped for a second reason in `channel-law.test.ts`.
 */
// ⚠ **8,960 → 9,446 (2026-09-03), A RISE, AND HERE IS THE TRADE THAT LICENSES
// IT.** The `waiting` section (600 chars, its own tighter cap in
// `channel-doctrine.ts › WAITING_MAX_CHARS`) is where the ~1.4k of re-arm
// doctrine that used to ride EVERY hold result now lives — pulled once instead
// of pushed per empty hold, forever, to say nothing new. **A rise of 600 here
// against ~1,400 off every hold result is the design**; the READ section paid
// ~130 of it back by deleting the hold prose the new section states properly.
// A rise with no matching fall is prose laundering, and this is the gate for it.
// ⚠ **9,446 → 9,428 (2026-09-04, −18): THE ADDRESSING LINE SAYS MORE AND COSTS
// LESS.** MODEL's "WHO A MESSAGE IS FOR" now carries the READ line's new arrow
// vocabulary AND the rule that a person who names nobody is still answered
// (RR3's arms 3 and 4) — paid for by deleting its restatement of "anything
// threaded into an exchange you are a party to is yours", which the LAW block
// already says as "ACT ON ... messages in a THREAD you are a party to".
// **A rule that had two homes now has one, and the second was the expensive one.**
const DOCTRINE_MAX_CHARS = 9_502; // ⚠ 9,428 → 9,502 (+74, 2026-09-06): the pulled half of the artifacts-wave trade — the pushed schema fell 762 in the same change.
// ⚠ **2,870 → 2,879 (2026-09-03): +9 ON EVERY SECTION, AND NOT ONE OF THEM
// GREW.** `SECTION_INDEX` names every section and rides every pull, so adding
// `waiting` to the table lengthened what a caller receives for `send`, `law`
// and the rest by the nine characters of the new name. The alternative was to
// cut nine characters out of the largest section to pay for a name that is not
// its own — a trade that would make the budget lie about where the cost is.
const DOCTRINE_SECTION_MAX_CHARS = 2_879;

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
