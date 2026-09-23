// @vitest-environment jsdom
/**
 * THE NEW-AGENT POPUP'S TWO REFUSAL LINES THAT ARE NOT LAUNCH REFUSALS.
 *
 *  - THE STOP WARNING: a launch landing on a runtime that cannot promise an interrupt carries
 *    `interruptRefusal`'s sentence BEFORE the click, off the runtime the launch would use. These
 *    cases moved here from the retired slide-out's suite (`composer-launch-panel.tsx`, deleted —
 *    P6-09 / T2-08) and now drive the live dialog.
 *  - 🔒 A REFUSED IDENTITY APPROVAL IS SAID (P6-14): the modal used to close on a refused
 *    `approveIdentity` and say nothing, so the next Launch asked again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const selection = vi.hoisted(() => ({ stored: "" }));

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, resolved: true, refetch: () => {} }),
}));
vi.mock("../hooks/use-launch-selection", async () => {
  const harness = await import("../hooks/launch-selection-harness");
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "../lib/runtime-descriptors-harness"
  );
  return {
    useLaunchSelection: () =>
      harness.launchSelectionStub({
        runtimeSupported: true,
        runtimes: REAL_DESCRIPTORS,
        runtime: selection.stored,
        connected: REAL_DESCRIPTORS.map((d) => d.id),
        connectedKnown: true,
        defaultRuntime: REAL_DEFAULT_RUNTIME,
      }),
  };
});

import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch, type AgentIdentityPrefill } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-launch-controls";
import { launchRefusalText } from "./use-launch-controls";
import { realDescriptor } from "../lib/runtime-descriptors-harness";
import { ME } from "./test-fixtures";

beforeEach(() => {
  selection.stored = "";
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId: vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function controls(over: Partial<AgentLaunchControls> = {}): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" }),
    approveIdentity: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

function Harness({
  newAgent,
  identity = null,
}: {
  newAgent: AgentLaunchControls;
  identity?: AgentIdentityPrefill | null;
}) {
  const panel = useAgentLaunch();
  useEffect(() => {
    if (identity) panel.openWithIdentity?.(identity);
    else panel.toggle();
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
      members={[]}
    />
  );
}

async function open(newAgent = controls(), identity: AgentIdentityPrefill | null = null) {
  render(<Harness newAgent={newAgent} identity={identity} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
}

function pick(label: string) {
  const row = screen.getByRole("tablist", { name: "Agent runtime" });
  const pill = Array.from(row.querySelectorAll('[role="tab"]')).find((el) =>
    (el.textContent || "").startsWith(label)
  )!;
  fireEvent.click(pill);
}

const stopNote = () =>
  screen.queryAllByRole("note").find((el) => /stop a session it started/.test(el.textContent || ""));

describe("the stop warning, off the runtime the launch would use", () => {
  it("carries the interrupt refusal when THIS SPAWN is picked onto Cursor", async () => {
    await open();
    pick(realDescriptor("cursor").label);
    expect(stopNote()).toBeTruthy();
  });

  it("carries it when the CHANNEL would land on Cursor and the operator said nothing", async () => {
    selection.stored = "cursor";
    await open();
    expect(stopNote()).toBeTruthy();
  });

  it("does NOT carry it when the operator picks Cursor's channel back to Claude", async () => {
    selection.stored = "cursor";
    await open();
    pick(realDescriptor("claude").label);
    expect(stopNote()).toBeUndefined();
  });

  it("says nothing on Claude or Codex", async () => {
    for (const id of ["claude", "codex"]) {
      await open();
      pick(realDescriptor(id).label);
      expect(stopNote(), id).toBeUndefined();
      cleanup();
    }
  });
});

describe("🔒 a refused identity approval (P6-14)", () => {
  it("keeps the modal open and says why, launching nothing", async () => {
    const newAgent = controls({
      launchAgent: vi.fn().mockResolvedValue({
        ok: false,
        reason: "identity-approval",
        identity: { name: "Code auditor", instructions: "Be terse." },
      }),
      approveIdentity: vi.fn().mockResolvedValue({ ok: false, reason: "no-bridge" }),
    });
    await open(newAgent, { id: "tpl-9", name: "Code auditor" });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    const confirm = await screen.findByRole("button", { name: "Run as this" });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(launchRefusalText("no-bridge"))
    );
    expect(screen.getByRole("button", { name: "Run as this" })).toBeTruthy();
    expect(newAgent.launchAgent).toHaveBeenCalledTimes(1);
  });
});
