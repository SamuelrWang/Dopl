// @vitest-environment jsdom
/**
 * The Settings tab's runtime row and Axis A in each runtime's own words, over the real adapters'
 * descriptors so a descriptor change fails here.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "../lib/runtime-descriptors-harness";
import { agentView, disabled, postureTools } from "./settings-agent-harness";
import {
  catalog,
  launchSelectionStub,
  type SelectionStubInput,
} from "../hooks/launch-selection-harness";

afterEach(cleanup);

const CLAUDE = realDescriptor("claude");
const CODEX = realDescriptor("codex");
const CURSOR = realDescriptor("cursor");

const RUNTIME_ROW = "Runtime for agents you launch";

/** The Settings tab on a desktop with the runtime concept. The stub derives `record` from `byRuntime`,
 *  so "what is selected" and "what that runtime remembers" cannot disagree. */
function withRuntime(runtime: string, over: SelectionStubInput = {}) {
  const selection = launchSelectionStub({
    runtimeSupported: true,
    runtimes: REAL_DESCRIPTORS,
    runtime,
    defaultRuntime: REAL_DEFAULT_RUNTIME,
    descriptor: realDescriptor(runtime || REAL_DEFAULT_RUNTIME),
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
    // Such a build drops `runtime` on write: a live row would silently launch every agent on Claude.
    agentView();
    expect(screen.queryByLabelText(RUNTIME_ROW)).toBeNull();
  });

  it("still renders Dopl's own four on the Tool use row", () => {
    // `permission-preset-row.tsx › TOOL_OPTIONS`, whose per-option copy a security review bought.
    agentView({ selection: launchSelectionStub({ byRuntime: { "": { tools: "auto" } } }) });
    expect(openMenu(postureTools()).map((t) => t.split(/(?=[A-Z])/)[0])).toHaveLength(4);
    expect(screen.getByRole("menuitem", { name: /^Accept edits/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /granular/ })).toBeNull();
  });

  it("renders no runtime row even when the descriptor list arrives", () => {
    // The view gates on `runtimeSupported`, never on the list alone.
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
    const { selection } = withRuntime("");
    fireEvent.click(screen.getByLabelText(RUNTIME_ROW));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex" }));
    // No other key: `patchRejections` checks a patch's `tools` against the runtime the patch selects,
    // so restating the old runtime's `accept_edits` would refuse the whole write.
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
    // Pre-runtime channels store `manual`, which Codex does not speak; index 0 is main's own coercion.
    withRuntime("codex", { byRuntime: { codex: { tools: "manual" } } });
    expect(postureTools().textContent).toContain("untrusted");
    expect(postureTools().textContent).not.toContain("Ask each time");
  });

  it("treats the mode already shown as NO CHANGE, not as a write", () => {
    // `SelectMenu` displays `options[0]` whatever the value, so an uncoerced `manual` would read
    // "untrusted" and clicking it would write a posture nobody picked.
    const { selection } = withRuntime("codex", { byRuntime: { codex: { tools: "manual" } } });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^untrusted/ }));
    expect(selection.update).not.toHaveBeenCalled();
  });

  it("writes the runtime's own word back on the tools axis", () => {
    const { selection } = withRuntime("cursor");
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Run Everything/ }));
    expect(selection.update).toHaveBeenCalledWith({ tools: "run-everything" });
  });
});

describe("the SECOND axis exists only where the platform declares one", () => {
  it("Claude renders NO sandbox row — no placeholder, no disabled control", () => {
    withRuntime("claude");
    // The Tool use row is present, so the absence is Claude declaring no secondary axis.
    expect(postureTools()).toBeTruthy();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("Codex renders its own row, at its own declared default", () => {
    const { container } = withRuntime("codex");
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(container.textContent).toContain("workspace-write");
    // Not Cursor's vocabulary, on the row Cursor also calls "Sandbox".
    expect(container.textContent).not.toContain("Enabled");
  });

  it("IS A CONTROL NOW, AND IT WRITES", () => {
    // `session-engine.js` stamps the native bag at spawn, so the pick reaches the launch (F-390).
    const { selection } = withRuntime("codex");
    fireEvent.click(screen.getByLabelText("Sandbox for agents you launch"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^danger-full-access/ }));
    // The whole bag: main replaces `native` wholesale.
    expect(selection.update).toHaveBeenCalledWith({
      native: { sandbox_mode: "danger-full-access" },
    });
  });

  it("keeps each runtime's native settings apart — no translation, either way", () => {
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
      byRuntime: { codex: { tools: "granular" } },
    });
    expect(FIVE).toHaveLength(5);
    for (const c of FIVE) expect(container.textContent).toContain(c);
  });

  it("are absent at every OTHER Codex mode", () => {
    for (const mode of ["untrusted", "on-request", "never"]) {
      const { container, unmount } = withRuntime("codex", {
        byRuntime: { codex: { tools: mode } },
      });
      expect(container.textContent).not.toContain("mcp_elicitations");
      unmount();
    }
  });

  it("are absent on Claude and on Cursor at every mode they offer", () => {
    for (const d of [CLAUDE, CURSOR]) {
      for (const opt of d.toolMode?.options ?? []) {
        const { container, unmount } = withRuntime(d.id, {
          byRuntime: { [d.id]: { tools: opt.value } },
        });
        expect(container.textContent).not.toContain("sandbox_approval");
        expect(container.textContent).not.toContain("skill_approval");
        unmount();
      }
    }
  });
});

// A launch's model is the launcher's pick, the identity's or the runtime default: neither row renders on
// any runtime, even with a live catalog that could fill them.
describe("NO model row and NO reasoning-effort row, on any runtime", () => {
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
        // An older desktop's record still carrying an effort must not bring either row back.
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
    // Main fails closed before the store, so the rows alone look like a control that did nothing.
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
