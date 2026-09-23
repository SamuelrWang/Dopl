// @vitest-environment jsdom
/**
 * THE SIGNED-OUT LAUNCH REFUSAL CARRIES ITS RUNTIME'S SIGN-IN (2026-09-23). A signed-out launch
 * registers nothing, so no held-agent banner ever appears — this refusal is where a newcomer lands.
 * A sign-in that takes re-runs the launch; any other refusal grows no button.
 */

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, resolved: true, refetch: () => {} }),
}));

const posture = vi.hoisted(() => ({ stored: "" }));
vi.mock("../hooks/use-launch-selection", async () => {
  const harness = await import("../hooks/launch-selection-harness");
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import("../lib/runtime-descriptors-harness");
  return {
    useLaunchSelection: () =>
      harness.launchSelectionStub({
        runtimeSupported: true,
        runtimes: REAL_DESCRIPTORS,
        runtime: posture.stored,
        connected: REAL_DESCRIPTORS.map((d) => d.id),
        connectedKnown: true,
        defaultRuntime: REAL_DEFAULT_RUNTIME,
      }),
  };
});

import { realDescriptor } from "../lib/runtime-descriptors-harness";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, ME } from "./test-fixtures";

const signIn = vi.fn();

beforeEach(() => {
  signIn.mockReset().mockResolvedValue({ ok: true, resumed: 0 });
  posture.stored = "";
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId: vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" }) },
    runtimeAuth: { signIn },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function controls(launchError: string): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" }),
    approveIdentity: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function Harness({ newAgent }: { newAgent: AgentLaunchControls }) {
  const panel = useAgentLaunch();
  useEffect(() => {
    panel.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      openThreadId="t-1"
      channelId="ch-1"
      workspaceId="ws-1"
      currentUserId={ME}
      members={[member({ userId: ME, displayName: "Sam Wang" })]}
    />
  );
}

describe.each([
  ["codex", "Sign in to Codex"],
  ["claude", "Sign in to Claude Code"],
])("a signed-out %s launch", (id, label) => {
  it("offers that runtime's sign-in beside the refusal, and a sign-in that takes re-launches", async () => {
    posture.stored = id;
    const newAgent = controls(signedOutLaunchCopy(realDescriptor(id)));
    render(<Harness newAgent={newAgent} />);
    expect((await screen.findByRole("alert")).textContent).toBe(signedOutLaunchCopy(realDescriptor(id)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });
    expect(signIn).toHaveBeenCalledWith(id);
    expect(newAgent.launchAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(newAgent.launchAgent).mock.calls[0][4]).toBe(id);
  });
});

it("a sign-in that does not take launches nothing", async () => {
  posture.stored = "codex";
  signIn.mockResolvedValue({ ok: false });
  const newAgent = controls(signedOutLaunchCopy(realDescriptor("codex")));
  render(<Harness newAgent={newAgent} />);
  const button = await screen.findByRole("button", { name: "Sign in to Codex" });
  await act(async () => {
    fireEvent.click(button);
  });
  expect(newAgent.launchAgent).not.toHaveBeenCalled();
  expect(screen.getByText("Couldn't sign in to Codex")).toBeTruthy();
});

it("any other refusal grows no sign-in", async () => {
  posture.stored = "codex";
  render(<Harness newAgent={controls("Session limit reached")} />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /^Sign in/ })).toBeNull();
});

it("a runtime with no in-app flow says the sentence and offers no button (Cursor)", async () => {
  posture.stored = "cursor";
  render(<Harness newAgent={controls(signedOutLaunchCopy(realDescriptor("cursor")))} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Sign in to Cursor to start an agent");
  expect(screen.queryByRole("button", { name: /^Sign in/ })).toBeNull();
});
