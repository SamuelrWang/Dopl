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
import { REAL_DESCRIPTORS, realDescriptor } from "../lib/runtime-descriptors-harness";
import {
  agentAuthHeldCopy,
  canSignIn,
  liveModelSwitchRefusal,
  noRuntimeCopy,
  runtimeLabel,
  signInAction,
  signInPointer,
  signedOutLaunchCopy,
} from "../lib/runtime-copy";
import { launchRefusalText } from "./use-agents-panel";
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

// ── U10 (2026-09-21): THE COPY IS THE SELECTED RUNTIME'S, NOT ONE VENDOR'S ──────────────────
//
// ⚠ THE DEFECT THESE CLOSE. `use-agents-panel.ts` answered `no-sdk` with "No Claude runtime on
// this Mac" and `auth-hold` with "Sign in to Claude to start an agent" — on a path EVERY runtime
// reaches. Main's own words were already vendor-neutral (`session-launch.js` says `no-sdk` means
// "this machine has no agent runtime" on every runtime), so the Claude was invented in the COPY.
// A signed-out Codex therefore sent the operator to fix a credential the session does not use.
//
// ⚠ AND THE OTHER HALF IS THAT CLAUDE IS UNTOUCHED — the rule the Stop-control block above
// states. A de-naming that fires on every runtime is a regression, not a feature.
//
// ⚠ DRIVEN OFF THE REAL DESCRIPTORS, never fixtures: what is being asserted is that the SHIPPED
// adapters carry the labels and credential declarations this copy is built from.

describe("the signed-out and no-runtime copy", () => {
  it("a signed-out Codex says `Sign in to Codex`, and the Claude path still says Claude", () => {
    expect(signInAction(realDescriptor("codex"))).toBe(null);
    expect(signedOutLaunchCopy(realDescriptor("codex"))).toBe("Sign in to Codex to start an agent");
    expect(signInPointer(realDescriptor("codex"))).toMatch(/^Sign in to Codex/);
    expect(agentAuthHeldCopy(realDescriptor("codex"))).toBe(
      "Your agent is waiting for you to sign in to Codex."
    );
    // ⚠ THE CLAUDE PATH, UNCHANGED IN SUBSTANCE: it still names Claude, and it names it because
    // the DESCRIPTOR does — `Claude Code` is that adapter's own `label`, never a literal here.
    expect(signInAction(realDescriptor("claude"))).toBe("Sign in to Claude Code");
    expect(signedOutLaunchCopy(realDescriptor("claude"))).toMatch(/Claude/);
    expect(agentAuthHeldCopy(realDescriptor("claude"))).toMatch(/Claude/);
  });

  it("the `auth-hold` / `no-sdk` launch refusals name the runtime the channel would launch on", () => {
    for (const id of ["claude", "codex", "cursor"]) {
      const d = realDescriptor(id);
      expect(launchRefusalText("auth-hold", d)).toBe(signedOutLaunchCopy(d));
      expect(launchRefusalText("no-sdk", d)).toBe(`No ${runtimeLabel(d)} runtime on this Mac`);
    }
    // ⚠ NOT ONE SENTENCE WEARING THREE HATS: a copy function that ignored the descriptor would
    // satisfy every line above if they were read one at a time.
    const said = REAL_DESCRIPTORS.map((d) => launchRefusalText("no-sdk", d));
    expect(new Set(said).size).toBe(REAL_DESCRIPTORS.length);
    // ⚠ AND CODEX MUST NOT BE ABLE TO SAY CLAUDE, which is the whole verification bar.
    for (const line of [
      launchRefusalText("no-sdk", realDescriptor("codex")),
      launchRefusalText("auth-hold", realDescriptor("codex")),
    ]) {
      expect(line).not.toMatch(/Claude|Anthropic/);
    }
  });

  it("with NO descriptor the copy names no vendor at all — the plain-browser lane", () => {
    // ⚠ UNKNOWN IS NOT EMPTY (INVARIANTS §11). A desktop older than the runtime port sends no
    // descriptor, and the old code answered with Claude's name whether or not that was the
    // runtime. Naming nothing is the honest answer; the REFUSAL is still said.
    for (const line of [launchRefusalText("no-sdk"), launchRefusalText("auth-hold")]) {
      expect(line).not.toMatch(/Claude|Codex|Cursor|Anthropic|OpenAI/);
      expect(line.length).toBeGreaterThan(0);
    }
    // ⚠ THE UNNAMED FORM IS ITS OWN SENTENCE, not the named one with a placeholder spliced in —
    // "No the agent runtime runtime on this Mac" is what a `${runtimeLabel(d)}` fallback produces.
    expect(noRuntimeCopy(null)).toBe("No agent runtime on this Mac");
    expect(signedOutLaunchCopy(null)).toBe("Sign in to your agent runtime to start an agent");
    expect(agentAuthHeldCopy(null)).toBe("Your agent is waiting for you to sign in to its runtime.");
  });

  it("an unrecognized reason still falls back rather than rendering a raw enum", () => {
    expect(launchRefusalText("kaboom", realDescriptor("codex"))).toBe("Could not start the agent");
    expect(launchRefusalText(undefined)).toBe("Could not start the agent");
  });

  it("hide, never gray: only a runtime with a real in-app flow offers a button", () => {
    // ⚠ CODEX AND CURSOR DECLARE `credential.interactiveSignIn: null` — their sign-in is a
    // browser/device-code hop Dopl cannot complete inside its own window. The SENTENCE is still
    // said; what is absent is a button that would open nothing (or, worse, the wrong runtime's).
    expect(canSignIn(realDescriptor("claude"))).toBe(true);
    expect(canSignIn(realDescriptor("codex"))).toBe(false);
    expect(canSignIn(realDescriptor("cursor"))).toBe(false);
    expect(signInAction(realDescriptor("cursor"))).toBe(null);
  });

  it("the live-model-switch refusal is per runtime, and Claude keeps the control", () => {
    // ⚠ `canSwitchModelLive` HAD NO CONSUMER IN `main/` UNTIL 2026-09-22 (NOT U10, which is what
    // this said and what F-753 said: U10's refusal re-read the field itself) — it was declared, mirrored
    // here, and read by nothing, so a Codex session recorded a model switch that never happened.
    expect(liveModelSwitchRefusal(realDescriptor("claude"))).toBe(null);
    const codex = liveModelSwitchRefusal(realDescriptor("codex"));
    expect(codex).toMatch(/Codex/);
    expect(codex).toMatch(/has not been measured/);
    expect(codex).not.toMatch(/Claude/);
  });
});
