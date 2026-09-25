/** Driven over the real adapters' descriptors (`runtime-descriptors-harness.ts`), so a descriptor change fails here. */

import { describe, expect, it } from "vitest";
import {
  descriptorFor,
  interruptRefusal,
  normalizeRuntimeId,
  normalizeToolMode,
  toolModeOptions,
  type RuntimeDescriptor,
} from "./runtime-capability";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "./runtime-descriptors-harness";

const CLAUDE = realDescriptor("claude");
const CODEX = realDescriptor("codex");
const CURSOR = realDescriptor("cursor");

const toolModes = (d: RuntimeDescriptor | null) => toolModeOptions(d).map((o) => o.value);

describe("normalizeRuntimeId / descriptorFor — fail toward the DEFAULT, never a refusal", () => {
  it("keeps a registered id and drops an unregistered one", () => {
    expect(normalizeRuntimeId(REAL_DESCRIPTORS, "codex")).toBe("codex");
    expect(normalizeRuntimeId(REAL_DESCRIPTORS, "gemini")).toBe("");
    expect(normalizeRuntimeId(REAL_DESCRIPTORS, "  ")).toBe("");
  });

  it("resolves an unknown pick to the default adapter rather than to nothing", () => {
    // A downgrade must not strand a channel whose stored id names an adapter this build lacks.
    expect(descriptorFor(REAL_DESCRIPTORS, "gemini", REAL_DEFAULT_RUNTIME)?.id).toBe(
      REAL_DEFAULT_RUNTIME
    );
  });

  it("answers null when the build offered no adapters", () => {
    expect(descriptorFor([], "codex", "claude")).toBeNull();
  });

  it("answers null with no reported default, never registry order", () => {
    expect(descriptorFor(REAL_DESCRIPTORS, "", "")).toBeNull();
    expect(descriptorFor(REAL_DESCRIPTORS, "gemini", undefined)).toBeNull();
  });
});

describe("toolMode.options is an ORDERING — narrowest first, widest last", () => {
  it("ships the ORDER the 08-31 amendments corrected, not the design table's", () => {
    // `[0]` is the fail-closed mode and the last the widest; a wrong order makes the windowless
    // floor narrow a session.
    expect(toolModes(CLAUDE)).toEqual(["manual", "accept_edits", "auto", "bypass"]);
    expect(toolModes(CODEX)).toEqual(["untrusted", "granular", "on-request", "never"]);
    expect(toolModes(CURSOR)).toEqual(["allowlist", "auto-review", "run-everything"]);
  });

  it("fail-closes an unrecognised mode onto index 0, per runtime", () => {
    // A Claude-shaped stored value on a Codex channel is the ordinary case.
    expect(normalizeToolMode(CODEX, "manual")).toBe("untrusted");
    expect(normalizeToolMode(CURSOR, "bypass")).toBe("allowlist");
  });

  it("answers null with no descriptor — the caller falls back to Dopl's own four", () => {
    expect(normalizeToolMode(null, "manual")).toBeNull();
    expect(toolModes(null)).toEqual([]);
  });
});

describe("interruptRefusal — a sentence, never a control that vanished", () => {
  it("Claude and Codex can interrupt; Cursor's is UNVERIFIED and says so in one sentence", () => {
    expect(interruptRefusal(CLAUDE)).toBeNull();
    expect(interruptRefusal(CODEX)).toBeNull();
    expect(interruptRefusal(CURSOR)).toMatch(/unverified/);
    expect(interruptRefusal(CURSOR)).toMatch(/cannot promise to stop/);
  });

  it("names no vendor in the refusal — the descriptor's own label does that", () => {
    expect(interruptRefusal(CURSOR)).not.toMatch(/Cursor|Anysphere/);
  });
});
