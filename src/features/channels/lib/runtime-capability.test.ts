/**
 * THE CAPABILITY HELPER, DRIVEN OVER THE THREE REAL DESCRIPTORS.
 *
 * ⚠ EVERY CASE HERE IS A CLAIM ABOUT AN ADAPTER, NOT ABOUT THIS FILE. The helper is
 * the web's mirror of `dopl-desktop-app/main/runtime/capability.js`, so a rule that
 * drifts between the two sides is a Stop button that works on one and not the other —
 * and a hand-written fixture would let both drift together. `runtime-descriptors-
 * harness.ts` loads the adapters themselves; a descriptor change fails here.
 *
 * ⚠ THE THREE REFUSALS ARE THE POINT OF THE MODULE. Absent hides a control almost
 * everywhere and REFUSES in three places — interrupt, resume, and a profile with no
 * deny list — so the cases that matter most are the ones asserting a SENTENCE where a
 * naive `== null` check would have produced an absence.
 */

import { describe, expect, it } from "vitest";
import {
  approvalCategories,
  approvalCategoryMode,
  canFork,
  canInterrupt,
  canLaunchProfile,
  canResume,
  descriptorFor,
  freeform,
  hasDeepLink,
  hasReasoningEffort,
  hasRuntimeKey,
  interruptRefusal,
  narrowestToolMode,
  normalizeRuntimeId,
  normalizeToolMode,
  profileRefusal,
  resumeRefusal,
  secondaryAxis,
  showsLocationPicker,
  toolModes,
  widestToolMode,
} from "./runtime-capability";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "./runtime-descriptors-harness";

const CLAUDE = realDescriptor("claude");
const CODEX = realDescriptor("codex");
const CURSOR = realDescriptor("cursor");

describe("hasRuntimeKey — the own-key capability probe", () => {
  it("reads a MISSING key as 'this desktop has no runtime concept'", () => {
    expect(hasRuntimeKey({ tools: "manual", messages: "ask" })).toBe(false);
  });

  it("reads `runtime: ''` as PRESENT — no pick is not no concept", () => {
    // ⚠ THE WHOLE FEATURE. A `!!raw.runtime` check collapses these two into one
    // answer and hides the row from every operator who has not yet chosen.
    expect(hasRuntimeKey({ tools: "manual", messages: "ask", runtime: "" })).toBe(true);
  });

  it("is not fooled by a null or a non-object", () => {
    expect(hasRuntimeKey(null)).toBe(false);
    expect(hasRuntimeKey("runtime")).toBe(false);
  });
});

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

  it("answers null when the build offered no adapters — the older-desktop lane", () => {
    expect(descriptorFor([], "codex", "claude")).toBeNull();
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
    expect(narrowestToolMode(CODEX)).toBe("untrusted");
    expect(widestToolMode(CURSOR)).toBe("run-everything");
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

describe("the REFUSALS — a sentence, never a control that vanished", () => {
  it("Claude can interrupt; Cursor's is UNVERIFIED and says so in one sentence", () => {
    expect(canInterrupt(CLAUDE)).toBe(true);
    expect(interruptRefusal(CLAUDE)).toBeNull();
    expect(canInterrupt(CODEX)).toBe(true);
    expect(canInterrupt(CURSOR)).toBe(false);
    expect(interruptRefusal(CURSOR)).toMatch(/unverified/);
    expect(interruptRefusal(CURSOR)).toMatch(/cannot promise to stop/);
  });

  it("names no vendor in the refusal — the descriptor's own label does that", () => {
    expect(interruptRefusal(CURSOR)).not.toMatch(/Cursor|Anysphere/);
  });

  it("resume is refused only where the usage-reset is UNMEASURED (CXP-4)", () => {
    // §1.4a: an UNMEASURED reset clamps every usage delta to zero, so the session's
    // spend silently stops climbing — no error and no symptom on a number the agent
    // card shows. (§1.4a said "the cost cap never fires"; that column was deleted on
    // 2026-09-22 and `tokensSpent` is the measurement the argument now rests on.)
    // ⚠ A MEASURED `false` IS NOT THAT CASE SINCE 2026-09-22, and this suite asserted
    // it was. Codex's totals were MEASURED to continue across `thread/resume`
    // (`main/runtime/codex/index.js › session.usageResetsOnResume`), main's baseline
    // became runtime-aware, and this mirror kept refusing — so the web said "Codex
    // cannot resume a conversation" about sessions the desktop resumes fine.
    expect(canResume(CLAUDE)).toBe(true); // measured `true` — resets, zero the baseline
    expect(resumeRefusal(CLAUDE)).toBeNull();
    expect(canResume(CODEX)).toBe(true); // measured `false` — continues, CARRY it
    expect(resumeRefusal(CODEX)).toBeNull();
    // ⚠ CURSOR IS THE ONE STILL UNMEASURED, and it is what keeps this case honest:
    // with every runtime measured the assertion would pass over an empty set.
    expect(canResume(CURSOR)).toBe(false);
    expect(resumeRefusal(CURSOR)).toMatch(/usage accounting on resume is unverified/);
    expect(resumeRefusal(CURSOR)).toMatch(/stops the cost cap firing/);
    // ⚠ AND ABSENT READS LIKE `'unverified'`, never like a measurement.
    expect(canResume({ session: { resume: true } })).toBe(false);
  });

  it("the web mirror and main's `capability.js` answer resume with ONE rule", () => {
    // ⚠ THIS FILE'S HEADER: *"The ONE reason this file changes is that
    // `main/runtime/capability.js` changed."* It changed on 2026-09-22 and this half
    // did not, which is a drift that fails NOWHERE — the two just disagree. Driven
    // off the three synthetic shapes rather than the three registered adapters, so
    // the rule is pinned for an adapter nobody has written yet.
    expect(canResume({ session: { resume: true, usageResetsOnResume: true } })).toBe(true);
    expect(canResume({ session: { resume: true, usageResetsOnResume: false } })).toBe(true);
    expect(canResume({ session: { resume: true, usageResetsOnResume: "unverified" } })).toBe(false);
    expect(canResume({ session: { resume: false, usageResetsOnResume: true } })).toBe(false);
  });

  it("a profile with a deny list launches; one without is refused BY NAME", () => {
    // ⚠ The one place absent does NOT mean hide. All three declare all three today.
    for (const d of REAL_DESCRIPTORS) {
      for (const p of ["read_only", "dopl_only", "full"]) {
        expect(canLaunchProfile(d, p)).toBe(true);
        expect(profileRefusal(d, p)).toBeNull();
      }
    }
    expect(profileRefusal(CLAUDE, "nonexistent")).toMatch(
      /declares no deny list for the "nonexistent" profile/
    );
    expect(profileRefusal(CLAUDE, "nonexistent")).toMatch(/Claude Code/);
  });
});

describe("hide-on-absent — §3.2's table, over the shipped descriptors", () => {
  it("🔒 declares no cost on any runtime — the whole column is deleted", () => {
    // 🔒 ⚠ **TWO CASES STOOD HERE: "hides the cost cap on Codex and shows it on the other two"
    // and "gives only Cursor the BILLED cost line".** Both were real — Claude `{usd,
    // billed:false}`, Codex `null`, Cursor `{usd, billed:true}` — and both predicates were dead
    // code with no production consumer in this tree. Samuel deleted the column on 2026-09-22
    // (*"there shouldnt be cost? Claude theres no cost tracking. we dont need cost tracking"*),
    // in main and on every adapter. ⚠ PINNED AS AN ABSENCE rather than removed: `meter.cost` is
    // the sort of declaration a later adapter copies from an old example, and it would arrive
    // here as a field nothing on this side defines.
    for (const d of [CLAUDE, CODEX, CURSOR]) {
      expect(d.meter?.cost, d.id).toBeUndefined();
    }
  });

  it("offers Fork on Codex and NOWHERE else", () => {
    expect(canFork(CODEX)).toBe(true);
    expect(canFork(CLAUDE)).toBe(false);
    expect(canFork(CURSOR)).toBe(false);
  });

  it("offers a reasoning-effort control on Codex and NOWHERE else", () => {
    expect(hasReasoningEffort(CODEX)).toBe(true);
    expect(hasReasoningEffort(CLAUDE)).toBe(false);
    expect(hasReasoningEffort(CURSOR)).toBe(false);
  });

  it("offers no location picker and no 'Open in …' on any of the three", () => {
    for (const d of REAL_DESCRIPTORS) {
      expect(showsLocationPicker(d)).toBe(false);
      expect(hasDeepLink(d)).toBe(false);
    }
  });
});
