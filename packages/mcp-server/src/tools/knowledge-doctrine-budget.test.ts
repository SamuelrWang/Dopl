/**
 * The knowledge doctrine's own ceiling. ⚠ `tool-budget.test.ts › DOCTRINE_CEILING`
 * bounds the SUM of every published resource, which a 500-char document can
 * drift inside unnoticed; this bounds THIS one, so the cheap document cannot
 * quietly become where evicted paragraphs land.
 */

import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE_DOCTRINE,
  KNOWLEDGE_DOCTRINE_URI,
} from "./knowledge-doctrine";

/**
 * ⚠ Samuel's ruling 2026-09-03: a ≤500-char block, both halves.
 *
 * 🔒 **500 → 750 ON 2026-09-18 (+250): THE WRITE RULES BECAME ENFORCEABLE, SO
 * THEY BECAME READABLE** (Samuel's ruling on the fix list's Q1, option A —
 * *"are you saying that saves should be blocked if there's no description? I
 * think I agree with A"*). Two of the four write rules now REFUSE an agent's
 * save, and a blocking rule an agent can only learn from the block is a rule
 * that costs a write to discover.
 *
 * ⚠ **THE RISE IS PULLED AND THE TRIM CAME FIRST**, which is the only shape
 * these ratchets accept. The read half paid ~60 of it back in the same change
 * (`outline` is no longer the rung that teaches heading NAMES — `get_tree` and
 * `read_file` carry them since Wave 4 a1 — so the sentence that sent readers
 * there shrank to what `outline` still uniquely answers: the COST). The four
 * rules' own ARGUMENTS were left out on purpose: Wave 4's measurements belong
 * in the knowledge base that took them, not in text served to every agent.
 *
 * ⚠ **NEVER QUOTE THIS NUMBER — re-derive it**; the assertion below is the
 * measurement.
 */
const KNOWLEDGE_DOCTRINE_MAX = 750;

describe("dopl://doctrine/knowledge", () => {
  it("fits its 500-character budget", () => {
    expect(KNOWLEDGE_DOCTRINE.length).toBeLessThanOrEqual(KNOWLEDGE_DOCTRINE_MAX);
  });

  it("carries BOTH halves — the read order and the write duty", () => {
    // ⚠ A doctrine that teaches only the read half asks agents to section
    // documents nobody writes headings into, which is the failure this whole
    // wave is about.
    expect(KNOWLEDGE_DOCTRINE).toContain("outline");
    expect(KNOWLEDGE_DOCTRINE).toContain("section");
    expect(KNOWLEDGE_DOCTRINE).toContain("## headings");
    expect(KNOWLEDGE_DOCTRINE).toMatch(/READ:/);
    expect(KNOWLEDGE_DOCTRINE).toMatch(/WRITE:/);
  });

  it("is addressed under the doctrine scheme the channels one uses", () => {
    expect(KNOWLEDGE_DOCTRINE_URI).toBe("dopl://doctrine/knowledge");
  });
});
