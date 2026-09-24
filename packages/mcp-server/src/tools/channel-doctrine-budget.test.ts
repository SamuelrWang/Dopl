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
const DOCTRINE_MAX_CHARS: Record<ToolSet, number> = { legacy: 13_508, granular: 13_687 };
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
