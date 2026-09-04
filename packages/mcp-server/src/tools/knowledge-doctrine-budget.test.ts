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

/** ⚠ Samuel's ruling 2026-09-03: a ≤500-char block, both halves. */
const KNOWLEDGE_DOCTRINE_MAX = 500;

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
