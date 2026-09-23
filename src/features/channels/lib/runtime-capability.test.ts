/**
 * The capability helper, driven over the three real descriptors (`runtime-descriptors-harness.ts`
 * loads the adapters, so a descriptor change fails here).
 */

import { describe, expect, it } from "vitest";
import {
  approvalCategories,
  approvalCategoryMode,
  descriptorFor,
  freeform,
  interruptRefusal,
  normalizeRuntimeId,
  normalizeToolMode,
  secondaryAxis,
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
    // A downgrade must not strand a channel whose stored id belongs to a build
    // that knew an adapter this one does not.
    expect(descriptorFor(REAL_DESCRIPTORS, "gemini", REAL_DEFAULT_RUNTIME)?.id).toBe(
      REAL_DEFAULT_RUNTIME
    );
  });

  it("answers null when the build offered no adapters", () => {
    expect(descriptorFor([], "codex", "claude")).toBeNull();
  });

  it("answers null with no reported default, never registry order (F23)", () => {
    expect(descriptorFor(REAL_DESCRIPTORS, "", "")).toBeNull();
    expect(descriptorFor(REAL_DESCRIPTORS, "gemini", undefined)).toBeNull();
  });
});

describe("toolMode.options is an ORDERING — narrowest first, widest last", () => {
  it("ships the ORDER the 08-31 amendments corrected, not the design table's", () => {
    // ⚠ `granular` is SECOND on Codex and `allowlist` FIRST on Cursor. The design's
    // §1.4 table put `granular` last (declaring it the widest) and Cursor's modes in
    // the order the docs print them; both were refuted by the shipped adapters, and
    // the printed order would have made the windowless floor NARROW a session.
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

describe("secondaryAxis — a row Claude does not have", () => {
  it("is null on Claude and declared on the other two, in their own words", () => {
    expect(secondaryAxis(CLAUDE)).toBeNull();
    expect(secondaryAxis(CODEX)?.key).toBe("sandbox_mode");
    expect(secondaryAxis(CODEX)?.options.map((o) => o.value)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
    expect(secondaryAxis(CURSOR)?.key).toBe("sandbox");
    expect(secondaryAxis(CURSOR)?.options.map((o) => o.value)).toEqual([
      "enabled",
      "disabled",
    ]);
  });
});

describe("approval.categories — Codex's own five, under Codex's own mode", () => {
  it("names the five verbatim and invents none", () => {
    // ⚠ Revision 1 of the design declared ['command','file-change','network','mcp'],
    // none of which appear in the platform's documentation. These are the shipped ones.
    expect(approvalCategories(CODEX)).toEqual([
      "sandbox_approval",
      "rules",
      "mcp_elicitations",
      "request_permissions",
      "skill_approval",
    ]);
  });

  it("hangs them under `granular` and gives the other two no sub-control at all", () => {
    expect(approvalCategoryMode(CODEX)).toBe("granular");
    expect(approvalCategoryMode(CLAUDE)).toBeNull();
    expect(approvalCategoryMode(CURSOR)).toBeNull();
    expect(approvalCategories(CLAUDE)).toEqual([]);
    expect(approvalCategories(CURSOR)).toEqual([]);
  });
});

describe("freeform — a branch that renders nothing today, on purpose", () => {
  it("is null on all three adapters as shipped", () => {
    // §3.1 asks for it and `transport` must be SHOWN if it ever lands; the branch is
    // written as data so the day a descriptor fills this in, the row is already right.
    for (const d of REAL_DESCRIPTORS) expect(freeform(d)).toBeNull();
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
