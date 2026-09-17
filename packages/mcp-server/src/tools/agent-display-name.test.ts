/**
 * **THE SLUG→DISPLAY NORMALIZER** (`agent-display-name.ts`, Samuel 2026-09-17).
 *
 * ⚠ **THE TWO ARMS ARE THE WHOLE CONTRACT**: a slug is repaired, and anything that shows a
 * capitalization CHOICE is left exactly as its author wrote it.
 */

import { describe, it, expect } from "vitest";
import { agentDisplayName } from "./agent-display-name";
import { launchedTag } from "./channel-ops-launch-name";

describe("a slug-like name becomes Title Case words", () => {
  it.each([
    ["picker-fix", "Picker Fix"],
    ["bug-reviewer", "Bug Reviewer"],
    ["coder_for_auth", "Coder For Auth"],
    ["research", "Research"],
    ["coder-1", "Coder 1"],
    ["p0-fix-2", "P0 Fix 2"],
    // ⚠ SEPARATOR RUNS AND EDGES COLLAPSE rather than producing empty words.
    ["picker--fix", "Picker Fix"],
    ["-picker-fix-", "Picker Fix"],
  ])("%s → %s", (raw, expected) => {
    expect(agentDisplayName(raw)).toBe(expected);
  });

  it("keeps digits rather than dropping or splitting them", () => {
    expect(agentDisplayName("agent-007-triage")).toBe("Agent 007 Triage");
  });
});

describe("a name that carries a capitalization choice is untouched", () => {
  it.each([
    // Already spaced — a person wrote this as a name.
    ["Picker Fix", "Picker Fix"],
    ["bug reviewer", "bug reviewer"],
    // Any uppercase at all means the casing was chosen.
    ["Coder-1", "Coder-1"],
    ["iOS Reviewer", "iOS Reviewer"],
    ["QA", "QA"],
    // Punctuation outside the slug grammar is a choice too.
    ["picker.fix", "picker.fix"],
    ["picker+fix", "picker+fix"],
    // ⚠ SEPARATORS ALONE ARE NOT A CLEAR — every word filtered away would answer `""`.
    ["_", "_"],
    ["--", "--"],
  ])("%s stays %s", (raw, expected) => {
    expect(agentDisplayName(raw)).toBe(expected);
  });

  it('leaves "" as "" — the rename lane\'s CLEAR gesture is not a name to repair', () => {
    expect(agentDisplayName("")).toBe("");
    expect(agentDisplayName("   ")).toBe("");
    expect(agentDisplayName(undefined)).toBe("");
  });

  it("trims, so the stored name is the one that was measured", () => {
    expect(agentDisplayName("  picker-fix  ")).toBe("Picker Fix");
  });
});

describe("the bounds the rest of the lane depends on", () => {
  it("never lengthens a name, so the 1-60 cap means the same on both sides", () => {
    const sixty = "a" + "-bb".repeat(19) + "aa"; // 60 characters, all slug grammar
    expect(sixty.length).toBe(60);
    expect(agentDisplayName(sixty).length).toBe(60);
    for (const raw of ["picker-fix", "coder_for_auth", "x".repeat(60)])
      expect(agentDisplayName(raw).length).toBeLessThanOrEqual(raw.length);
  });

  // ⚠ **THE TAG DERIVATION IS NOT TOUCHED BY THIS CHANGE**, and for a hyphen slug — the shape
  // the bug actually produced — the address is byte-for-byte what it was before.
  it("leaves the derived tag alone for the slug shape this fixes", () => {
    expect(launchedTag(agentDisplayName("picker-fix"))).toBe(
      launchedTag("picker-fix"),
    );
    expect(launchedTag(agentDisplayName("picker-fix"))).toBe("@picker-fix");
  });
});
