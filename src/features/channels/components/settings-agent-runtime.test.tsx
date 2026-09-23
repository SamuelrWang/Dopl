// @vitest-environment jsdom
/**
 * THE SETTINGS TAB'S RUNTIME ROW, AND AXIS A RENDERED IN THE RUNTIME'S OWN WORDS
 * (2026-08-31, the runtime-adapter port, design §3.1/§3.2).
 *
 * ⚠ DRIVEN OVER THE THREE REAL DESCRIPTORS, never hand-written ones
 * (`lib/runtime-descriptors-harness.ts` says why). Every case below is a claim about
 * what an ADAPTER declares, so a descriptor change has to fail here — a fixture that
 * mirrors the adapter is a copy that drifts with it.
 *
 * ⚠ THE RENDER HARNESS IS SHARED WITH `settings-tab.test.tsx` AND
 * `settings-agent-posture.test.tsx` — see `settings-agent-harness.tsx` for why it is a
 * file rather than a copy. This file takes the runtime; the posture file keeps the two
 * axes as Dopl states them.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "../lib/runtime-descriptors-harness";
import { agentView, disabled, postureTools } from "./settings-agent-harness";
// ⚠ **THE GROUP READS THE VERSIONED, RUNTIME-KEYED RECORD SINCE 2026-09-21 (U8).** Every case
// below is the same CLAIM it was; what moved is that a runtime's stored tool mode, model and
// native settings now live in `byRuntime[<id>]` rather than in one global pair
// (`hooks/use-launch-selection.ts` carries the argument).
import {
  catalog,
  launchSelectionStub,
} from "../hooks/launch-selection-harness";

afterEach(cleanup);

const CLAUDE = realDescriptor("claude");
const CODEX = realDescriptor("codex");
const CURSOR = realDescriptor("cursor");

const RUNTIME_ROW = "Runtime for agents you launch";

/**
 * A stored Axis-A value in a RUNTIME's vocabulary.
 *
 * ⚠ THE CAST IS THE FINDING, NOT A CONVENIENCE (F-390). `PermissionPreset.tools` is
 * Dopl's own closed enum because `main/channel-prefs.js › normalizePreset` still
 * validates the durable write against exactly those four words — so "the posture holds
 * `granular`" is a state the TYPE says cannot exist and the UI must nonetheless render.
 * When main's step-5 lands, this cast is what goes.
 */
const stored = (tools: string) => ({ tools });

/**
 * The Settings tab with a desktop that HAS the runtime concept.
 *
 * ⚠ **`record` AND `byRuntime` ARE ONE FACT HERE, NOT TWO.** The stub derives `record` from
 * `byRuntime[runtime]` (`launch-selection-harness.ts` states why), so a case cannot accidentally
 * set "what is selected" and "what that runtime remembers" to disagree — which is exactly the
 * state the switch-away-and-back cases are about.
 */
function withRuntime(
  descriptorId: string,
  over: {
    byRuntime?: Record<string, { tools?: string; native?: Record<string, string> }>;
    catalogs?: Record<string, ReturnType<typeof catalog>>;
    busy?: boolean;
    review?: string[];
    rejected?: string[];
  } = {}
) {
  const { byRuntime, catalogs, busy, review, rejected } = over;
  return agentView({
    selection: launchSelectionStub({
      runtimeSupported: true,
      runtimes: REAL_DESCRIPTORS,
      runtime: descriptorId,
      defaultRuntime: REAL_DEFAULT_RUNTIME,
      descriptor: realDescriptor(descriptorId || REAL_DEFAULT_RUNTIME),
      byRuntime: byRuntime ?? {},
      catalogs: catalogs as never,
      busy: busy ?? false,
      review: review ?? [],
      rejected: rejected ?? [],
    }),
  });
}

/** The same, but answering the stub back so a case can assert the payload. */
function withSelection(over: Parameters<typeof launchSelectionStub>[0] = {}) {
  const selection = launchSelectionStub({
    runtimeSupported: true,
    runtimes: REAL_DESCRIPTORS,
    defaultRuntime: REAL_DEFAULT_RUNTIME,
    ...over,
  });
  return { selection, ...agentView({ selection }) };
}

/** The option labels behind a `SelectMenu`, as an operator would read them. */
function openMenu(trigger: HTMLElement): string[] {
  fireEvent.click(trigger);
  return screen
    .getAllByRole("menuitem")
    .map((el) => el.textContent ?? "");
}

describe("a desktop with NO runtime key renders no runtime row at all", () => {
  it("omits the row rather than greying it — the older-desktop lane", () => {
    // ⚠ NOT a cosmetic gate. Such a build DROPS `runtime` on write, so a live row
    // would let the operator pick Codex and launch every agent on Claude with
    // nothing anywhere saying so (`runtime-capability.ts › hasRuntimeKey`).
    agentView();
    expect(screen.queryByLabelText(RUNTIME_ROW)).toBeNull();
  });

  // ⚠ THE ROW IS CALLED "Tool use" SINCE 2026-09-06 (item 5) — a RENAME ONLY. It is
  // still Axis A, still the effective runtime's own vocabulary, still the same write.
  // `postureTools()` is repointed in the harness; nothing about this case moved.
  it("still renders Dopl's own four on the Tool use row", () => {
    // The pre-port behaviour, byte for byte — `permission-preset-row.tsx ›
    // TOOL_OPTIONS`, whose per-option copy a security review bought.
    agentView({ selection: launchSelectionStub({ byRuntime: { "": { tools: "auto" } } }) });
    expect(openMenu(postureTools()).map((t) => t.split(/(?=[A-Z])/)[0])).toHaveLength(4);
    expect(screen.getByRole("menuitem", { name: /^Accept edits/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /granular/ })).toBeNull();
  });

  it("renders no runtime row even when the descriptor list arrives", () => {
    // ⚠ TWO GATES, NOT ONE. `runtimeSupported` is the OWN-KEY probe; a list that
    // showed up without it would be a version skew, and failing toward "no row" is
    // the correct direction while the probe is outstanding.
    agentView({
      selection: launchSelectionStub({ runtimes: REAL_DESCRIPTORS, descriptor: CLAUDE }),
    });
    expect(screen.queryByLabelText(RUNTIME_ROW)).toBeNull();
  });
});

describe("the runtime picker", () => {
  it("offers Default plus every registered adapter, by the PLATFORM's own label", () => {
    withRuntime("");
    expect(openMenu(screen.getByLabelText(RUNTIME_ROW))).toEqual([
      "Default",
      "Claude Code",
      "Codex",
      "Cursor",
    ]);
  });

  it("shows the channel's pick without opening anything", () => {
    withRuntime("cursor");
    expect(screen.getByLabelText(RUNTIME_ROW).textContent).toContain("Cursor");
  });

  it("writes the pick on the `runtime` key alone", () => {
    const { selection } = withSelection({ runtime: "", descriptor: CLAUDE });
    fireEvent.click(screen.getByLabelText(RUNTIME_ROW));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex" }));
    // ⚠ NO OTHER KEY. Main branches on `hasOwnProperty(preset,'runtime')`, so a
    // posture write that also carried `tools` would restate an axis nobody moved.
    // ⚠ **AND THIS IS NOT COSMETIC SINCE U5.** `patchRejections` checks a patch's `tools`
    // against the runtime the PATCH selects, so a switch that restated the old runtime's
    // `accept_edits` would be REFUSED WHOLE — the write silently doing nothing.
    expect(selection.update).toHaveBeenCalledWith({ runtime: "codex" });
  });

  it("goes inert while a posture write is in flight", () => {
    withRuntime("codex", { busy: true });
    expect(disabled(screen.getByLabelText(RUNTIME_ROW))).toBe(true);
  });
});

describe("Axis A renders each runtime's OWN vocabulary and nothing else's", () => {
  it("Claude: its own four, in its own order", () => {
    withRuntime("claude");
    expect(openMenu(postureTools())).toEqual([
      "Ask each timeEvery tool call waits for you.",
      "Accept editsFile writes run; everything else asks.",
      "AutoReads and edits run; shell and network ask.",
      "BypassEvery classified work tool runs. Hard-denied tools never do.",
    ]);
  });

  it("Codex: untrusted / granular / on-request / never — and no Claude word", () => {
    withRuntime("codex");
    const labels = openMenu(postureTools());
    expect(labels.map((t) => t.split(/(?=[A-Z])/)[0].trim())).toEqual([
      "untrusted",
      "granular",
      "on-request",
      "never",
    ]);
    expect(labels.join(" ")).not.toMatch(/Accept edits|Bypass|Ask each time/);
  });

  it("Cursor: Allowlist / Auto-review / Run Everything — and no Codex word", () => {
    withRuntime("cursor");
    const labels = openMenu(postureTools());
    expect(labels[0]).toMatch(/^Allowlist/);
    expect(labels[1]).toMatch(/^Auto-review/);
    expect(labels[2]).toMatch(/^Run Everything/);
    expect(labels).toHaveLength(3);
    expect(labels.join(" ")).not.toMatch(/untrusted|granular|on-request/);
  });

  it("coerces a Claude-shaped stored value onto the runtime's NARROWEST mode", () => {
    // ⚠ Every channel written before a runtime was picked stores `manual`, which
    // Codex does not speak. Showing it would name a mode the runtime is never asked
    // for; `untrusted` is index 0 and is what main's own coercion answers.
    withRuntime("codex", { byRuntime: { codex: { tools: "manual" } } });
    expect(postureTools().textContent).toContain("untrusted");
    expect(postureTools().textContent).not.toContain("Ask each time");
  });

  it("treats the mode already shown as NO CHANGE, not as a write", () => {
    // ⚠ THE BEHAVIOURAL HALF OF THE COERCION, and the half a text assertion cannot
    // reach: `SelectMenu` falls back to `options[0]` for DISPLAY whatever `value` is,
    // so an uncoerced `manual` would still READ "untrusted" — and then clicking
    // "untrusted" would fire `onChange` (because `"untrusted" !== "manual"`) and
    // write a posture the operator never picked.
    const { selection } = withSelection({
      runtime: "codex",
      descriptor: CODEX,
      byRuntime: { codex: { tools: "manual" } },
    });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^untrusted/ }));
    expect(selection.update).not.toHaveBeenCalled();
  });

  it("writes the runtime's own word back on the tools axis", () => {
    const { selection } = withSelection({ runtime: "cursor", descriptor: CURSOR });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Run Everything/ }));
    expect(selection.update).toHaveBeenCalledWith({ tools: "run-everything" });
  });
});

describe("the SECOND axis exists only where the platform declares one", () => {
  it("Claude renders NO sandbox row — no placeholder, no disabled control", () => {
    withRuntime("claude");
    // ⚠ The Tool use row is asserted PRESENT in the same case, so the absence
    // above is Claude declaring no secondary axis and not a render that did nothing.
    expect(postureTools()).toBeTruthy();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("Codex renders its own row, at its own declared default", () => {
    const { container } = withRuntime("codex");
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(container.textContent).toContain("workspace-write");
    // ⚠ Not Cursor's vocabulary, on the row Cursor also calls "Sandbox".
    expect(container.textContent).not.toContain("Enabled");
  });

  it("IS A CONTROL NOW, AND IT WRITES (F-390 closed)", () => {
    // ⚠ **THIS ROW WAS A VALUE PILL FOR A REASON THAT STOPPED BEING TRUE.** The wire had no
    // field for it, so rendering a picker would have been an operator choosing and every agent
    // launching on something else. U5 gave the containment axis a validated, per-runtime write
    // path and `session-engine.js` stamps the bag at spawn, so the pick reaches the launch.
    const { selection } = withSelection({ runtime: "codex", descriptor: CODEX });
    fireEvent.click(screen.getByLabelText("Sandbox for agents you launch"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^danger-full-access/ }));
    // ⚠ THE WHOLE BAG, not one key — main REPLACES `native` wholesale.
    expect(selection.update).toHaveBeenCalledWith({
      native: { sandbox_mode: "danger-full-access" },
    });
  });

  it("keeps each runtime's native settings apart — no translation, either way", () => {
    // Decision #1: `accept_edits` is not a Codex approval mode and `workspace-write` is not a
    // Claude anything. A record holding both must render only the selected runtime's.
    const byRuntime = {
      claude: { tools: "accept_edits" },
      codex: { tools: "on-request", native: { sandbox_mode: "read-only" } },
    };
    const onCodex = withRuntime("codex", { byRuntime });
    expect(onCodex.container.textContent).toContain("read-only");
    expect(onCodex.container.textContent).not.toContain("Accept edits");
    onCodex.unmount();
    const onClaude = withRuntime("claude", { byRuntime });
    expect(onClaude.container.textContent).toContain("Accept edits");
    expect(onClaude.container.textContent).not.toContain("read-only");
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("Cursor renders its own row, at its own declared default", () => {
    const { container } = withRuntime("cursor");
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(container.textContent).toContain("Enabled");
    expect(container.textContent).not.toContain("workspace-write");
  });
});

describe("the five approval categories, under `granular` and nowhere else", () => {
  const FIVE = CODEX.approval?.categories ?? [];

  it("appear when Codex is at `granular`, in Codex's own words", () => {
    const { container } = withRuntime("codex", {
      byRuntime: { codex: stored("granular") },
    });
    expect(FIVE).toHaveLength(5);
    for (const c of FIVE) expect(container.textContent).toContain(c);
  });

  it("are absent at every OTHER Codex mode", () => {
    for (const mode of ["untrusted", "on-request", "never"]) {
      const { container, unmount } = withRuntime("codex", {
        byRuntime: { codex: stored(mode) },
      });
      expect(container.textContent).not.toContain("mcp_elicitations");
      unmount();
    }
  });

  it("are absent on Claude and on Cursor at every mode they offer", () => {
    for (const d of [CLAUDE, CURSOR]) {
      for (const opt of d.toolMode?.options ?? []) {
        const { container, unmount } = withRuntime(d.id, {
          byRuntime: { [d.id]: stored(opt.value) },
        });
        expect(container.textContent).not.toContain("sandbox_approval");
        expect(container.textContent).not.toContain("skill_approval");
        unmount();
      }
    }
  });
});

// 🔓 THE MODEL ROW AND THE REASONING-EFFORT ROW ARE DELETED (2026-09-23, Samuel: "We don't need a
// pin model in the settings … We don't need this model, channel, and profile settings"). A launch's
// model is the launcher's pick, the identity's, or the runtime default — so what is pinned is the
// ABSENCE, on every runtime, with a live catalog that once would have filled both rows.
describe("NO model row and NO reasoning-effort row, on any runtime (2026-09-23)", () => {
  const CLAUDE_MODELS = catalog("claude", [
    { id: "claude-fable-5", label: "Fable 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true },
  ]);
  const CODEX_MODELS = catalog("codex", [
    { id: "gpt-6-astra", label: "GPT-6 Astra", isDefault: true, efforts: ["low", "high"] },
    { id: "gpt-6-mini", label: "GPT-6 Mini", efforts: ["minimal", "low"] },
  ]);
  const both = { claude: CLAUDE_MODELS, codex: CODEX_MODELS };

  for (const runtime of ["claude", "codex", "cursor"]) {
    it(`${runtime}: neither row renders, and the runtime/tool/messaging rows still do`, () => {
      const { container } = withRuntime(runtime, {
        catalogs: both,
        // A record an OLDER desktop wrote still carrying a model and an effort must not bring
        // either row back.
        byRuntime: { [runtime]: { native: { reasoningEffort: "high" } } },
      });
      expect(screen.queryByLabelText("Model for agents you launch")).toBeNull();
      expect(screen.queryByLabelText("Reasoning effort for agents you launch")).toBeNull();
      expect(container.textContent).not.toMatch(/GPT-6 Astra|Fable 5/);
      expect(screen.getByLabelText("Runtime for agents you launch")).toBeTruthy();
      expect(screen.getByLabelText("Messaging for agents you launch")).toBeTruthy();
    });
  }

  it("Codex's CONTAINMENT row (the sandbox) survives the cut", () => {
    withRuntime("codex", { catalogs: both });
    expect(screen.getByText("Sandbox")).toBeTruthy();
  });
});

describe("what main refused, and what it could not fully honour", () => {
  it("says a REFUSED write out loud, in main's own words", () => {
    // ⚠ NOTHING ELSE WOULD. Main fails closed BEFORE the store, so the rows keep showing the
    // stored values — correct, and indistinguishable from a control that did nothing.
    const { container } = withRuntime("codex", {
      byRuntime: { codex: { tools: "on-request" } },
      rejected: ['"accept_edits" is not a tool setting Codex offers'],
    });
    expect(container.textContent).toContain("is not a tool setting Codex offers");
  });

  it("does NOT echo the rejected request back into the row", () => {
    withRuntime("codex", {
      byRuntime: { codex: { tools: "on-request" } },
      rejected: ['"accept_edits" is not a tool setting Codex offers'],
    });
    expect(postureTools().textContent).toContain("on-request");
  });

  it("surfaces `needsReview` as a NOTE, never as a failure", () => {
    const { container } = withRuntime("codex", {
      review: ["Codex does not offer \"wide-open\" for sandbox_mode; it fell back to the narrowest"],
    });
    expect(container.textContent).toContain("fell back to the narrowest");
  });
});
