// @vitest-environment jsdom
/**
 * THE REFUSAL SURFACES — the Stop control and the launch panel, over the three real
 * descriptors (2026-08-31, design §3.2).
 *
 * ⚠ THE RULE BEING PINNED IS "A REFUSAL GETS A SENTENCE", NOT "A CONTROL GOES AWAY".
 * `session.interrupt: 'unverified'` disables Pause/End *and* warns, because without an
 * interrupt Dopl cannot stop a session it started — `main/session-engine.js › runEffect`
 * case `interruptQuery` is the tree's only `.interrupt()` — and a button that vanishes
 * with no reason is one the operator works around. A test that asserted only `disabled`
 * would stay green against the version of this that ships silence.
 *
 * ⚠ AND THE OTHER HALF IS THAT CLAUDE IS UNTOUCHED. Every case below has its negative:
 * a hide-on-absent rule that fires on all three runtimes is a regression, not a feature.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { REAL_DESCRIPTORS } from "../../lib/runtime-descriptors-harness";
import { AgentControls } from "./agent-panel-controls";
import { AgentLaunchPanelView } from "./composer-launch-panel";
import type { AgentLaunchPanel } from "./use-agent-launch";

const CH = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/**
 * `window.dopl` answering a posture read that carries the runtime family.
 * ⚠ `runtime` IS ON THE REPLY EVEN WHEN EMPTY — that is the wire, and the own-key
 * probe is the whole reason it is. Pass `omitRuntime` for the older-desktop shape.
 */
function installBridge(runtime: string, omitRuntime = false) {
  const reply = omitRuntime
    ? { tools: "manual", messages: "ask" }
    : {
        tools: "manual",
        messages: "ask",
        runtime,
        runtimes: REAL_DESCRIPTORS,
        defaultRuntime: "claude",
      };
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    channels: {
      getLaunchPosture: vi.fn().mockResolvedValue(reply),
      setLaunchPosture: vi.fn().mockResolvedValue({ ok: true }),
    },
    sessions: {
      pause: vi.fn().mockResolvedValue({ ok: true }),
      end: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

const AGENT: DesktopSessionSummary = {
  channelId: CH,
  taskId: "t1",
  agentId: "abcd1234",
  state: "idle",
} as unknown as DesktopSessionSummary;

async function mountControls(runtime: string, omitRuntime = false) {
  installBridge(runtime, omitRuntime);
  await act(async () => {
    render(
      <AgentControls agent={AGENT} workspaceSlug="ws" onRefreshSessions={() => {}} />
    );
  });
}

const stopButtons = () =>
  ["Pause", "End"].map((n) =>
    screen.getByRole("button", { name: n })
  ) as HTMLButtonElement[];

describe("the Stop control, against the channel's runtime", () => {
  it("Cursor: Pause and End are inert AND the reason is on screen", async () => {
    await mountControls("cursor");
    for (const b of stopButtons()) expect(b.disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(
      /ability to stop a running turn is unverified/
    );
  });

  it("Claude: both verbs live, and NO refusal line", async () => {
    await mountControls("claude");
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("Codex: both verbs live — the refusal is per runtime, not per port", async () => {
    await mountControls("codex");
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("a desktop with no runtime concept keeps both verbs", async () => {
    // ⚠ A descriptor nobody sent cannot refuse anything. Reading its ABSENCE as a
    // refusal would disable Pause and End on every desktop older than the port.
    await mountControls("", true);
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

/** The launch panel's state object, with only what the view reads. */
function panelStub(over: Partial<AgentLaunchPanel> = {}): AgentLaunchPanel {
  return {
    open: true,
    agentId: "abcd1234",
    name: "#abcd1234",
    description: "",
    templateId: null,
    model: "",
    runtime: "",
    ready: true,
    identityError: null,
    setIdentityError: () => {},
    setName: () => {},
    setDescription: () => {},
    setTemplateId: () => {},
    setModel: () => {},
    setRuntime: vi.fn(),
    toggle: () => {},
    close: () => {},
    reset: () => {},
    ...over,
  };
}

function launchView(over: Partial<AgentLaunchPanel> = {}, channelRuntime = "") {
  return render(
    <AgentLaunchPanelView
      panel={panelStub(over)}
      templates={[]}
      runtimes={REAL_DESCRIPTORS}
      channelRuntime={channelRuntime}
      defaultRuntime="claude"
    />
  );
}

describe("the launch surface", () => {
  it("offers Channel default plus every adapter, by the platform's own label", () => {
    launchView();
    const trigger = screen.getByLabelText("Agent runtime");
    act(() => {
      trigger.click();
    });
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Channel default",
      "Claude Code",
      "Codex",
      "Cursor",
    ]);
  });

  it("carries the interrupt refusal when THIS SPAWN would land on Cursor", () => {
    launchView({ runtime: "cursor" });
    expect(screen.getByRole("note").textContent).toMatch(
      /cannot promise to stop a session it started/
    );
  });

  it("carries it when the CHANNEL would land on Cursor and the panel said nothing", () => {
    // ⚠ MAIN'S PRECEDENCE CHAIN, MIRRORED: `payload.runtime > the channel's pick >
    // the default`. A warning computed off any other order names a refusal belonging
    // to a runtime this launch is not about to use.
    launchView({ runtime: "" }, "cursor");
    expect(screen.getByRole("note")).toBeTruthy();
  });

  it("does NOT carry it when the panel overrides Cursor back to Claude", () => {
    launchView({ runtime: "claude" }, "cursor");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says nothing on Claude or Codex", () => {
    for (const id of ["claude", "codex"]) {
      const { unmount } = launchView({ runtime: id });
      expect(screen.queryByRole("note")).toBeNull();
      unmount();
    }
  });

  it("renders neither the row nor a warning with no adapters — the browser lane", () => {
    render(<AgentLaunchPanelView panel={panelStub()} templates={[]} />);
    expect(screen.queryByLabelText("Agent runtime")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
