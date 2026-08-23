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
 *    (`use-desktop-sessions.ts › DesktopSessionsFeed`).
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
  type AgentLaunchOutcome,
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
    // reasons `session-ipc-ops.js › sessions:launch` and `session-engine.js ›
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
    expect(holder.value!.launchError).toBe("Busy right now — try again");
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

  /**
   * A CHANNEL-LEVEL AGENT (2026-08-21, the composer's Bot icon in channel view).
   *
   * ⚠ NO COUNTERPARTY IS NOT A REFUSAL HERE, and the two cases must not merge.
   * An agent on the ROOM has nobody on the other side because there is no
   * exchange yet; a THREAD whose other party cannot be resolved is a real
   * refusal and still has to be said. Collapsing them makes the Bot icon in
   * channel view a button that always fails with a sentence about threads.
   */
  it("starts a CHANNEL-LEVEL agent for a null thread, with no counterparty", async () => {
    const launch = bridge({ ok: true });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent(null);
    });
    expect(holder.value!.launchError).toBeNull();
    expect(launch).toHaveBeenCalledTimes(1);
    const payload = launch.mock.calls[0][0];
    // ⚠ `null`, never `""` — the empty string is already a real wire value
    // meaning "a responder whose thread never became first-class".
    expect(payload.taskId).toBeNull();
    expect(payload.counterpartyId).toBeNull();
    expect(payload.threadTitle).toBeNull();
    expect(payload.channelId).toBe("c-1");
  });

  it("still refuses a THREAD whose other party cannot be resolved", async () => {
    const launch = bridge({ ok: true });
    const orphan = { ...thread, createdBy: ME, targetUserId: null };
    const holder = mount([orphan as unknown as ChannelThread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(launch).not.toHaveBeenCalled();
    expect(holder.value!.launchError).toBe("This thread has no other party");
  });

  it("reads main's NEW answer shape — an agentId is a success", async () => {
    // ⚠ Main and this tree ship separately, so `{ok, reason}` and `{agentId}`
    // are both live. A reader that knows only one turns a real launch into a
    // false refusal.
    const launch = vi.fn().mockResolvedValue({ agentId: "a1b2c3d4" });
    (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), sessions: { launch } };
    const refreshDesktopSessions = vi.fn();
    const holder = mount([thread], refreshDesktopSessions);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    expect(holder.value!.launchError).toBeNull();
    expect(refreshDesktopSessions).toHaveBeenCalledTimes(1);
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
    // ⚠ AND THE BUTTON IS STILL LIVE. A refusal is not a cap: the operator's next
    // click is a legitimate retry, and every click mints a NEW agent (2026-08-21).
    const button = screen.getByRole("button", { name: /New Agent/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  /**
   * ⚠ NO ONE-AGENT-PER-THREAD GATE ANYWHERE IN THE UI (Samuel, 2026-08-21).
   * `sessions.launch` spawns a NEW instance per call, so the button may not
   * disarm because agents already stand on the thread — only `launchBusy` (a
   * double-submit guard over one click) and an absent capability take it away.
   */
  it("stays enabled with agents ALREADY on this thread", () => {
    render(
      <AgentsTab
        sessions={[
          {
            sessionId: "s-1",
            channelId: "c-1",
            taskId: "t-1",
            name: "flint",
            state: "working",
            channelName: "Website",
            threadTitle: "UI-kit design",
          },
        ]}
        channelId="c-1"
        openThreadId="t-1"
        currentUserId={ME}
        canLaunch
        onLaunchAgent={() => {}}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: /New Agent/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the button ONLY while a launch is in flight", () => {
    render(
      <AgentsTab
        sessions={[]}
        channelId="c-1"
        openThreadId="t-1"
        currentUserId={ME}
        canLaunch
        launchBusy
        onLaunchAgent={() => {}}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(
      (screen.getByRole("button", { name: /Starting/ }) as HTMLButtonElement).disabled
    ).toBe(true);
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

/**
 * THE TEMPLATE HALF OF THE LAUNCH (2026-08-22).
 *
 * ⚠ THE PINNED PROPERTY IS THAT A BLANK LAUNCH DID NOT MOVE. The one-click
 * button and the composer's Bot icon call `launchAgent(threadId)` and the
 * payload must reach main byte-identical to what it always was — a `templateId:
 * null` key spelled out would be a NEW object on a wire that main and this tree
 * ship separately on.
 *
 * ⚠ AND `template-approval` IS NOT AN ERROR LINE. It is main asking a question
 * about another member's prose; the picker owns the modal
 * (`agent-templates/components/template-approval.tsx`), and a red line under the
 * button saying "could not start the agent" while that modal is open would
 * report the question as a failure.
 */
describe("useAgentsPanel › templates", () => {
  it("puts NEITHER key on the wire for a blank launch", async () => {
    const launch = bridge({ ok: true });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1");
    });
    const payload = launch.mock.calls[0][0];
    expect("templateId" in payload).toBe(false);
    expect("overrides" in payload).toBe(false);
  });

  it("carries the template id and the ephemeral overrides when given", async () => {
    const launch = bridge({ ok: true });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1", "tpl-9", { model: "claude-sonnet-5" });
    });
    const payload = launch.mock.calls[0][0];
    expect(payload.templateId).toBe("tpl-9");
    expect(payload.overrides).toEqual({ model: "claude-sonnet-5" });
  });

  it("words a template that vanished between the picker and the click", () => {
    // ⚠ The endpoint deliberately cannot tell DELETED from INVISIBLE
    // (404-never-403), so neither does the copy.
    const text = launchRefusalText("no-template");
    expect(text).toBe("That template is gone — reload the list");
  });

  it("returns the approval question WITHOUT writing an error line", async () => {
    bridge({
      ok: false,
      reason: "template-approval",
      template: { name: "Code auditor", instructions: "Be terse." },
    } as { ok: boolean; reason?: string });
    const holder = mount([thread]);
    let outcome: AgentLaunchOutcome | null = null;
    await act(async () => {
      outcome = await holder.value!.launchAgent("t-1", "tpl-9");
    });
    expect(outcome!.reason).toBe("template-approval");
    expect(outcome!.template).toEqual({
      name: "Code auditor",
      instructions: "Be terse.",
    });
    // The whole point: no red line under a modal that is asking permission.
    expect(holder.value!.launchError).toBeNull();
  });

  it("still writes an error line for every OTHER refusal", async () => {
    bridge({ ok: false, reason: "no-template" });
    const holder = mount([thread]);
    await act(async () => {
      await holder.value!.launchAgent("t-1", "tpl-9");
    });
    expect(holder.value!.launchError).toBe("That template is gone — reload the list");
  });

  it("answers `busy` rather than silence when a launch is already in flight", async () => {
    // ⚠ The picker AWAITS this. An early `return` would leave a row click
    // looking exactly like a launch that succeeded and had not pushed yet.
    let release: (() => void) | null = null;
    const launch = vi.fn().mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true }); })
    );
    (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), sessions: { launch } };
    const holder = mount([thread]);
    let first: Promise<unknown> | null = null;
    await act(async () => {
      first = holder.value!.launchAgent("t-1");
      await Promise.resolve();
    });
    const second = await holder.value!.launchAgent("t-1");
    expect(second).toEqual({ ok: false, reason: "busy" });
    await act(async () => {
      release!();
      await first;
    });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("feature-detects `approveTemplate` on the op it is about to use", async () => {
    // An older main has the launch op and not this one — the modal must be able
    // to say so rather than looping on a refusal it can never clear.
    bridge({ ok: true });
    const holder = mount([thread]);
    expect(await holder.value!.approveTemplate("tpl-9")).toEqual({
      ok: false,
      reason: "no-bridge",
    });

    const approveTemplate = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { launch: vi.fn(), approveTemplate },
    };
    expect(await holder.value!.approveTemplate("tpl-9")).toEqual({
      ok: true,
      reason: undefined,
    });
    expect(approveTemplate).toHaveBeenCalledWith("tpl-9");
  });
});
