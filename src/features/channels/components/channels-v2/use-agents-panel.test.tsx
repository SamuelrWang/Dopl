// @vitest-environment jsdom
/**
 * The Agents tab's LAUNCH wiring (`use-agents-panel.ts`), and the two silences it
 * exists to end.
 *
 *  - **A REFUSED LAUNCH USED TO LOOK EXACTLY LIKE A PENDING ONE.** `sessions:launch`
 *    answers `{ ok: false, reason }` for six real conditions and the result was
 *    DISCARDED, so `no-counterparty` / `busy` / `cap` / `no-sdk` / `auth-hold` all
 *    rendered as a button that stopped saying "Launching…" and a tab that stayed
 *    empty. Nothing else on this surface can report it: a refusal is not a push
 *    (`agents-model.ts › DesktopSessionsFeed`).
 *  - **THE POST-LAUNCH RE-READ WAS AIMED AT THE WRONG FEED.** `refetch` re-reads the
 *    PEER projection, which excludes this operator's own sessions by construction
 *    (`agents-model.ts › peerCardsFor`), so it could never show the agent the
 *    button just launched. The OWN feed's `refresh` is the one that can.
 *
 * ⚠ The primary fix for both is in MAIN — `session-engine.js › startSession` now
 * touches the projection at REGISTRATION, so the push arrives without waiting for
 * the SDK's `system/init` (`test/session-summary.test.mjs`). This file pins the
 * BELT, which is what covers a child that boots and never emits one at all.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  launchRefusalText,
  useAgentsPanel,
  PEER_SESSIONS_POLL_MS,
} from "./use-agents-panel";
import { AgentsTab } from "./agents-tab";
import type { Channel, ChannelThread } from "../../types";

vi.mock("../../hooks/use-channel-agent-sessions", () => ({
  useChannelAgentSessions: () => ({ sessions: [], refetch: peerRefetch }),
}));

const peerRefetch = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { dopl?: unknown }).dopl;
});

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";

const channel = { id: "c-1", name: "Website", isDirect: false } as unknown as Channel;
const thread = {
  id: "t-1",
  title: "UI-kit design",
  createdBy: ME,
  targetUserId: PEER,
} as unknown as ChannelThread;

/**
 * Drives the hook and exposes its live return value to the assertions.
 *
 * ⚠ PUBLISHED FROM AN EFFECT, NOT DURING RENDER. Assigning the hook's result to
 * a captured variable in the component body is a render-phase mutation and
 * `react-hooks/immutability` refuses it (root lint runs `--max-warnings 0`). An
 * effect with no dep array runs after EVERY render, so the holder tracks the
 * latest value — which is the whole point, since `launchError` changes.
 */
function mount(threads: ChannelThread[], refreshDesktopSessions?: () => void) {
  const holder: { value: ReturnType<typeof useAgentsPanel> | null } = { value: null };
  function Probe() {
    const panel = useAgentsPanel({
      channel,
      workspaceId: "ws-1",
      currentUserId: ME,
      threads,
      refreshDesktopSessions,
    });
    useEffect(() => {
      holder.value = panel;
    });
    return null;
  }
  render(<Probe />);
  return holder;
}

/** The desktop bridge, answering `sessions.launch` however the case needs.
 *  ⚠ `apiRequest` is the SPA marker `getSpaBridge` keys on — a fake without it
 *  is not a bridge at all, and every case would collapse to `no-bridge`. */
function bridge(answer: { ok: boolean; reason?: string }) {
  const launch = vi.fn().mockResolvedValue(answer);
  (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), sessions: { launch } };
  return launch;
}

describe("launchRefusalText", () => {
  it("words every reason main can actually answer with", () => {
    // ⚠ THE VALUE, NOT THE SYMBOL (INVARIANTS §14). These six strings are the
    // reasons `channel-dir-ipc.js › sessions:launch` and `session-engine.js ›
    // launch` really produce; a reason that loses its copy must fail here, not
    // render a raw enum at the operator.
    for (const reason of [
      "no-bridge",
      "no-counterparty",
      "busy",
      "cap",
      "no-sdk",
      "auth-hold",
      "disabled",
    ]) {
      const text = launchRefusalText(reason);
      expect(text).not.toContain(reason);
      expect(text.length).toBeGreaterThan(4);
    }
  });

  it("falls back rather than showing an unknown reason verbatim", () => {
    expect(launchRefusalText("kaboom")).toBe("Could not start the agent");
    expect(launchRefusalText(undefined)).toBe("Could not start the agent");
  });
});

describe("useAgentsPanel › launch", () => {
  it("surfaces a refusal instead of discarding it", async () => {
    const launch = bridge({ ok: false, reason: "busy" });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(holder.value!.launchError).toBe("An agent is already on this thread");
    expect(holder.value!.launchBusy).toBe(false);
  });

  it("refuses a thread with no other party, and SAYS so", async () => {
    const launch = bridge({ ok: true });
    // MY OWN thread, addressed to nobody: `createdBy === currentUserId` so the
    // counterparty is `targetUserId`, which is null. The hook used to `return`
    // silently here, which is the same blank screen a discarded refusal gave.
    const orphan = { ...thread, createdBy: ME, targetUserId: null };
    const holder = mount([orphan as unknown as ChannelThread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(launch).not.toHaveBeenCalled();
    expect(holder.value!.launchError).toBe("This thread has no other party");
  });

  it("re-reads the OWN feed on success — not only the peer projection", async () => {
    bridge({ ok: true });
    const refreshDesktopSessions = vi.fn();
    const holder = mount([thread], refreshDesktopSessions);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(refreshDesktopSessions).toHaveBeenCalledTimes(1);
    expect(peerRefetch).toHaveBeenCalledTimes(1);
    expect(holder.value!.launchError).toBeNull();
  });

  it("does NOT re-read the own feed when main refused", async () => {
    bridge({ ok: false, reason: "cap" });
    const refreshDesktopSessions = vi.fn();
    const holder = mount([thread], refreshDesktopSessions);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    // Nothing was registered, so there is nothing to re-read; asking would only
    // repaint the same list and hide the refusal behind a spinner.
    expect(refreshDesktopSessions).not.toHaveBeenCalled();
    expect(holder.value!.launchError).toBe("Session limit reached");
  });

  it("clears a stale refusal when a later launch is attempted", async () => {
    bridge({ ok: false, reason: "busy" });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(holder.value!.launchError).not.toBeNull();
    bridge({ ok: true });
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(holder.value!.launchError).toBeNull();
  });

  // ⚠ THE RENDER HALF LIVES HERE, NOT IN `agents-tab.test.tsx`, WHICH STOOD AT
  // 498 OF THE 500-LINE CAP. Same seam as `_session-summary-harness.mjs`: the
  // cases go where the behaviour is, and this one is the launch row's.
  it("renders the refusal beside the button, as an alert", () => {
    render(
      <AgentsTab
        sessions={[]}
        channelId="c-1"
        openThreadId="t-1"
        currentUserId={ME}
        canLaunch
        launchError="Session limit reached"
        onLaunchAgent={() => {}}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    // `role="alert"` because it appears AFTER the operator acted and nothing
    // else on the surface reports it.
    expect(screen.getByRole("alert").textContent).toBe("Session limit reached");
    expect(screen.getByRole("button", { name: /Launch agent/ })).toBeTruthy();
  });

  it("renders no alert when there is nothing to report", () => {
    render(
      <AgentsTab
        sessions={[]}
        channelId="c-1"
        openThreadId="t-1"
        currentUserId={ME}
        canLaunch
        onLaunchAgent={() => {}}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("exposes the peer re-read so the doorbell can drive it (Wave 3)", () => {
    const holder = mount([thread]);
    expect(typeof holder.value!.refetch).toBe("function");
    // One exported interval, both readers (`thread-window.tsx` is the second).
    expect(PEER_SESSIONS_POLL_MS).toBe(30_000);
  });
});
