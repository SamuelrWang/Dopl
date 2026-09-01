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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  realDescriptor,
} from "../../lib/runtime-descriptors-harness";
import { agentView, disabled, postureTools } from "./settings-agent-harness";

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
const stored = (tools: string) =>
  ({ tools, messages: "ask" }) as { tools: "manual"; messages: "ask" };

/** The Settings tab with a desktop that HAS the runtime concept. */
function withRuntime(
  descriptorId: string,
  over: Parameters<typeof agentView>[0] = {}
) {
  return agentView({
    runtimeSupported: true,
    runtimes: REAL_DESCRIPTORS,
    runtime: descriptorId,
    descriptor: realDescriptor(descriptorId || REAL_DEFAULT_RUNTIME),
    ...over,
  });
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

  it("still renders Dopl's own four on the Permissions row", () => {
    // The pre-port behaviour, byte for byte — `permission-preset-row.tsx ›
    // TOOL_OPTIONS`, whose per-option copy a security review bought.
    agentView({ posture: { tools: "auto", messages: "ask" } });
    expect(openMenu(postureTools()).map((t) => t.split(/(?=[A-Z])/)[0])).toHaveLength(4);
    expect(screen.getByRole("menuitem", { name: /^Accept edits/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /granular/ })).toBeNull();
  });

  it("renders no runtime row even when the descriptor list arrives", () => {
    // ⚠ TWO GATES, NOT ONE. `runtimeSupported` is the OWN-KEY probe; a list that
    // showed up without it would be a version skew, and failing toward "no row" is
    // the correct direction while the probe is outstanding.
    agentView({ runtimes: REAL_DESCRIPTORS, descriptor: CLAUDE });
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
    const onChangePosture = vi.fn();
    withRuntime("", { onChangePosture });
    fireEvent.click(screen.getByLabelText(RUNTIME_ROW));
    fireEvent.click(screen.getByRole("menuitem", { name: "Codex" }));
    // ⚠ NO OTHER KEY. Main branches on `hasOwnProperty(preset,'runtime')`, so a
    // posture write that also carried `tools` would restate an axis nobody moved.
    expect(onChangePosture).toHaveBeenCalledWith({ runtime: "codex" });
  });

  it("goes inert while a posture write is in flight", () => {
    withRuntime("codex", { postureBusy: true });
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
    withRuntime("codex", { posture: { tools: "manual", messages: "ask" } });
    expect(postureTools().textContent).toContain("untrusted");
    expect(postureTools().textContent).not.toContain("Ask each time");
  });

  it("treats the mode already shown as NO CHANGE, not as a write", () => {
    // ⚠ THE BEHAVIOURAL HALF OF THE COERCION, and the half a text assertion cannot
    // reach: `SelectMenu` falls back to `options[0]` for DISPLAY whatever `value` is,
    // so an uncoerced `manual` would still READ "untrusted" — and then clicking
    // "untrusted" would fire `onChange` (because `"untrusted" !== "manual"`) and
    // write a posture the operator never picked.
    const onChangePosture = vi.fn();
    withRuntime("codex", {
      posture: { tools: "manual", messages: "ask" },
      onChangePosture,
    });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^untrusted/ }));
    expect(onChangePosture).not.toHaveBeenCalled();
  });

  it("writes the runtime's own word back on the tools axis", () => {
    const onChangePosture = vi.fn();
    withRuntime("cursor", { onChangePosture });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Run Everything/ }));
    expect(onChangePosture).toHaveBeenCalledWith({ tools: "run-everything" });
  });
});

describe("the SECOND axis exists only where the platform declares one", () => {
  it("Claude renders NO sandbox row — no placeholder, no disabled control", () => {
    withRuntime("claude");
    // ⚠ The Permissions row is asserted PRESENT in the same case, so the absence
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
      posture: stored("granular"),
    });
    expect(FIVE).toHaveLength(5);
    for (const c of FIVE) expect(container.textContent).toContain(c);
  });

  it("are absent at every OTHER Codex mode", () => {
    for (const mode of ["untrusted", "on-request", "never"]) {
      const { container, unmount } = withRuntime("codex", {
        posture: stored(mode),
      });
      expect(container.textContent).not.toContain("mcp_elicitations");
      unmount();
    }
  });

  it("are absent on Claude and on Cursor at every mode they offer", () => {
    for (const d of [CLAUDE, CURSOR]) {
      for (const opt of d.toolMode?.options ?? []) {
        const { container, unmount } = withRuntime(d.id, {
          posture: stored(opt.value),
        });
        expect(container.textContent).not.toContain("sandbox_approval");
        expect(container.textContent).not.toContain("skill_approval");
        unmount();
      }
    }
  });
});
