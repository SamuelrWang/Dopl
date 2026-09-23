// The pulled doctrine's own budget: prose evicted from the pushed description and schema lands
// here, and an unmeasured destination is a relocation, not a diet.

import { describe, it, expect } from "vitest";
import {
  CHANNEL_DOCTRINE,
  DOCTRINE_SECTIONS,
  DOCTRINE_SECTION_NAMES,
  doctrineSection,
  type DoctrineSection,
} from "./channel-doctrine.js";

// Whole document, a ratchet both ways: a rise must be paid for by a fall on a pushed surface, or
// it is prose laundering. Re-derive, never quote.
const DOCTRINE_MAX_CHARS = 13_508;
// Per section as served (a typical pull is one section); a ceiling only. `send` is the largest, so
// its next rule should split the section rather than raise this. Re-derive, never quote.
const DOCTRINE_SECTION_MAX_CHARS = 3_600;

describe("the pulled doctrine is budgeted too, and by section", () => {
  it(`the whole document is at most ${DOCTRINE_MAX_CHARS} chars`, () => {
    expect(CHANNEL_DOCTRINE.length).toBeLessThanOrEqual(DOCTRINE_MAX_CHARS);
    expect(
      CHANNEL_DOCTRINE.length,
      "it shrank — lower DOCTRINE_MAX_CHARS to the measured size in the same commit",
    ).toBeGreaterThan(DOCTRINE_MAX_CHARS - 500);
  });

  it(`no single section exceeds ${DOCTRINE_SECTION_MAX_CHARS} chars, as served by section=`, () => {
    // Measured through `doctrineSection`: what a caller receives includes the heading, SECURITY and index.
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
    // The schema builds its enum from these keys; this keeps a future hand-written list honest.
    expect([...DOCTRINE_SECTION_NAMES].sort()).toEqual(
      Object.keys(DOCTRINE_SECTIONS).sort(),
    );
    for (const name of DOCTRINE_SECTION_NAMES) {
      expect(doctrineSection(name), name).toContain(DOCTRINE_SECTIONS[name]);
    }
  });
});
