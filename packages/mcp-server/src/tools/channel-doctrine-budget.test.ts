// The pulled doctrine's own budget: prose evicted from the pushed description and schema lands
// here, and an unmeasured destination is a relocation, not a diet. Measured per tool set: the
// granular text spells longer tool names, and each set has its own ceiling.

import { describe, it, expect } from "vitest";
import { withToolSet } from "../call-ref.js";
import type { ToolSet } from "../tool-manifest.js";
import {
  channelDoctrine,
  DOCTRINE_SECTIONS,
  DOCTRINE_SECTION_NAMES,
  doctrineSection,
  type DoctrineSection,
} from "./channel-doctrine.js";

// Whole document, a ratchet both ways: a rise must be paid for by a fall on a pushed surface, or
// it is prose laundering. Re-derive, never quote.
// +54 (2026-09-25): `posture.tools` names the permission levels and the runtime words behind them.
// +13/+31 (2026-09-28, unified display): CHOOSING names dopl_show for structure; paid by the pushed
// `dopl_send_message.display` param (-469) leaving the granular schema.
// **CEILING +973, CONTENT +1,068, AND THE 95-CHAR DIFFERENCE IS PRE-EXISTING HEADROOM ABSORBED**
// (2026-10-12, grammar B — approved by @cleanup-orchestrator-2, ASK 9, channel seq #4461).
// FIELDS gained the `cites` rule (+461: a typed `#N` is not a link, cite via the field, `seq` today
// and `no` after the numbering migration, cross-channel and unresolvable both refused) and the
// `posture` EXPLANATORY PROSE (+607) that used to be pushed on every connection. 461 + 607 = 1,068.
// ⚠ **THE RAISE IS THE SMALLER NUMBER, AND READING IT AS THE COST IS THE TRAP.** The ceiling moved
// 973 because 95 chars of headroom already sat between the old ceiling and the old content; that
// slack is now spent. Anyone pricing the NEXT line of doctrine against "+973" would under-count by
// 95 and find the gate red with nothing left to absorb it — this file's own standing instruction is
// to re-derive, and the content figure is the one to re-derive against.
// ⚠ **PAID FOR ON THE PUSHED SURFACE, WHICH IS THE WHOLE RULE ABOVE.** `posture` went 922 → 473 in
// the served schema (-449), so `cites` (444) landed with `SCHEMA_MAX_CHARS` UNTOUCHED: 9,110 → 9,114
// against a 9,155 ceiling. Bytes moved from the surface every agent pays for on every handshake to
// the one they pay for only when they ask.
// ⚠ **AND THIS RAISE LEAVES ZERO HEADROOM, DELIBERATELY** — the ruling was "exactly what's needed,
// nothing extra", so the ceilings below ARE the measured sizes. The next line of doctrine is
// therefore a conversation, not an edit: re-derive, then pay for it.
const DOCTRINE_MAX_CHARS: Record<ToolSet, number> = { legacy: 14_556, granular: 14_753 };
// Per section as served (a typical pull is one section); a ceiling only. `send` is the largest, so
// its next rule should split the section rather than raise this. Re-derive, never quote.
const DOCTRINE_SECTION_MAX_CHARS: Record<ToolSet, number> = { legacy: 3_600, granular: 3_650 };

describe.each(["legacy", "granular"] as const)("the pulled doctrine is budgeted too, and by section (%s)", (set) => {
  const inSet = <T,>(fn: () => T) => withToolSet(set, fn);

  it(`the whole document is at most ${DOCTRINE_MAX_CHARS[set]} chars`, () => {
    const length = inSet(channelDoctrine).length;
    expect(length).toBeLessThanOrEqual(DOCTRINE_MAX_CHARS[set]);
    expect(length, "it shrank — lower DOCTRINE_MAX_CHARS to the measured size in the same commit").toBeGreaterThan(
      DOCTRINE_MAX_CHARS[set] - 500,
    );
  });

  it(`no single section exceeds ${DOCTRINE_SECTION_MAX_CHARS[set]} chars, as served by section=`, () => {
    // Measured through `doctrineSection`: what a caller receives includes the heading, SECURITY and index.
    const over = DOCTRINE_SECTION_NAMES.map((name) => ({ name, len: inSet(() => doctrineSection(name)).length }))
      .filter(({ len }) => len > DOCTRINE_SECTION_MAX_CHARS[set])
      .map(({ name, len }) => `${name}: ${len} chars`);
    expect(over, `a doctrine section grew past the budget — split it, or cut it:\n- ${over.join("\n- ")}`).toEqual([]);
  });

  it("every published `section=` name resolves to a section, and back", () => {
    // The schema builds its enum from these keys; this keeps a future hand-written list honest.
    expect([...DOCTRINE_SECTION_NAMES].sort()).toEqual(Object.keys(DOCTRINE_SECTIONS).sort());
    for (const name of DOCTRINE_SECTION_NAMES) {
      inSet(() => expect(doctrineSection(name as DoctrineSection), name).toContain(DOCTRINE_SECTIONS[name]));
    }
  });
});
