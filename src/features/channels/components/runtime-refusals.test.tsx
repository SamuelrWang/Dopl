// @vitest-environment jsdom
/**
 * THE REFUSAL SURFACES — the Stop control and the live model picker over the three real
 * descriptors (2026-08-31, design §3.2), and the runtime-owned launch copy (U10).
 *
 * ⚠ THE RULE BEING PINNED IS "A REFUSAL GETS A SENTENCE", NOT "A CONTROL GOES AWAY".
 * `session.interrupt: 'unverified'` disables Pause/End *and* warns, because without an
 * interrupt Dopl cannot stop a session it started. A test that asserted only `disabled`
 * would stay green against the version of this that ships silence.
 *
 * ⚠ A RUNNING AGENT IS JUDGED BY ITS OWN RUNTIME (P6-04), never the channel's current pick:
 * every case below puts the agent on a runtime the channel is NOT on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { REAL_DESCRIPTORS, realDescriptor } from "../lib/runtime-descriptors-harness";
import {
  agentAuthHeldCopy,
  canSignIn,
  noRuntimeCopy,
  signInAction,
  signedOutLaunchCopy,
} from "../lib/runtime-copy";
import { catalog } from "../hooks/launch-selection-harness";
import { launchRefusalText } from "./use-launch-controls";
import { AgentControls } from "./agent-panel-controls";
import { PostureControls } from "./agent-posture";

const CH = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/** Every runtime's own one-model roster, so a picker's absence is the RUNTIME's doing. */
const CATALOGS = Object.fromEntries(
  REAL_DESCRIPTORS.map((d) => [d.id, catalog(d.id, [{ id: `${d.id}-m`, isDefault: true }])])
);

/**
 * `window.dopl` answering the channel's launch record. `channelRuntime` is the channel's pick;
 * `withRecord: false` leaves the channel ops off (nothing read, no descriptor).
 */
function installBridge(channelRuntime: string, withRecord = true) {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    ...(withRecord
      ? {
          channels: {
            getLaunchPosture: vi.fn().mockResolvedValue({
              runtimes: REAL_DESCRIPTORS,
              defaultRuntime: "claude",
              connected: ["claude"],
              catalogVersion: 1,
              catalogs: CATALOGS,
              selection: { v: 2, runtime: channelRuntime, messages: "ask", byRuntime: {} },
            }),
            setLaunchPosture: vi.fn().mockResolvedValue({ ok: true }),
          },
        }
      : {}),
    sessions: {
      pause: vi.fn().mockResolvedValue({ ok: true }),
      end: vi.fn().mockResolvedValue({ ok: true }),
      // ⚠ BOTH BRIDGE OPS PRESENT ON PURPOSE: the runtime gate has to be the only thing left
      // deciding the model picker.
      setMode: vi.fn().mockResolvedValue({ ok: true }),
      setModel: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

const agentOn = (runtimeId: string): DesktopSessionSummary =>
  ({
    channelId: CH,
    taskId: "t1",
    agentId: "abcd1234",
    state: "idle",
    runtimeId,
  }) as unknown as DesktopSessionSummary;

/** The channel sits on a DIFFERENT runtime than the agent, so the agent's own must decide. */
const otherThan = (id: string) => (id === "claude" ? "cursor" : "claude");

async function mountControls(runtimeId: string, withRecord = true) {
  installBridge(otherThan(runtimeId), withRecord);
  await act(async () => {
    render(
      <AgentControls agent={agentOn(runtimeId)} workspaceSlug="ws" onRefreshSessions={() => {}} />
    );
  });
}

const stopButtons = () =>
  ["Pause", "End"].map((n) =>
    screen.getByRole("button", { name: n })
  ) as HTMLButtonElement[];

describe("the Stop control, against the AGENT's runtime", () => {
  it("Cursor agent: Pause and End are inert AND the reason is on screen", async () => {
    await mountControls("cursor");
    for (const b of stopButtons()) expect(b.disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(
      /ability to stop a running turn is unverified/
    );
  });

  it("Claude agent on a Cursor channel: both verbs live, and NO refusal line", async () => {
    await mountControls("claude");
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("Codex: both verbs live — the refusal is per runtime, not per port", async () => {
    await mountControls("codex");
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("with no launch record read, nothing is refused", async () => {
    // ⚠ A descriptor nobody sent cannot refuse anything.
    await mountControls("cursor", false);
    for (const b of stopButtons()) expect(b.disabled).toBe(false);
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
    expect(agentAuthHeldCopy(realDescriptor("codex"))).toBe(
      "Your agent is waiting for you to sign in to Codex."
    );
    // ⚠ THE CLAUDE PATH, UNCHANGED IN SUBSTANCE: it still names Claude, and it names it because
    // the DESCRIPTOR does — `Claude Code` is that adapter's own `label`, never a literal here.
    expect(signInAction(realDescriptor("claude"))).toBe("Sign in to Claude Code");
    expect(signedOutLaunchCopy(realDescriptor("claude"))).toMatch(/Claude/);
    expect(agentAuthHeldCopy(realDescriptor("claude"))).toMatch(/Claude/);
  });

  it("the `auth-hold` / `no-sdk` launch refusals name the runtime they are given", () => {
    for (const id of ["claude", "codex", "cursor"]) {
      const d = realDescriptor(id);
      expect(launchRefusalText("auth-hold", d)).toBe(signedOutLaunchCopy(d));
      expect(launchRefusalText("no-sdk", d)).toBe(`No ${d.label} runtime on this Mac`);
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
});

/**
 * THE LIVE MODEL PICKER, AGAINST THE AGENT'S RUNTIME (2026-09-22; P6-04).
 *
 * ⚠ `canSwitchModelLive` is the rule — *"absent ⇒ the live model picker is hidden on a RUNNING
 * agent"*. ⚠ AND THE NEGATIVE IS HALF THE CASE: Claude and Cursor both declare
 * `liveModelSwitch: true` and keep the control.
 */
async function mountPosture(runtimeId: string) {
  installBridge(otherThan(runtimeId));
  await act(async () => {
    render(<PostureControls agent={agentOn(runtimeId)} channelId={CH} taskId="t1" />);
  });
}

const modelPicker = () => screen.queryByLabelText("Model for this agent");
const toolPicker = () => screen.queryByLabelText("Tool permissions for this agent");

describe("the live model picker, against the AGENT's runtime", () => {
  it("Codex agent: the picker is ABSENT — main would refuse the switch anyway", async () => {
    await mountPosture("codex");
    expect(modelPicker()).toBeNull();
    // ⚠ IT REFUSES A CONTROL, NOT THE STRIP.
    expect(toolPicker()).not.toBeNull();
    expect(screen.queryByText(/Sonnet 5/)).toBeNull();
  });

  it("Claude and Cursor agents declare a live switch and KEEP the picker", async () => {
    for (const id of ["claude", "cursor"]) {
      await mountPosture(id);
      expect(modelPicker(), id).not.toBeNull();
      cleanup();
    }
  });
});
