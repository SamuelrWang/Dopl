// @vitest-environment jsdom
/**
 * THE OWN-AGENT ACTIVITY LABEL (2026-08-20) — "Thinking…" / "Running a command"
 * on my own cards, over the desktop's `detail` key.
 *
 * Separate from `agents-tab.test.tsx` because that file is at 498 of the
 * 500-line cap, and separate from the desktop's `session-detail.test.mjs`
 * because the two own different halves: the desktop owns WHICH SITUATION this
 * is, this owns WHAT A HUMAN READS. The seam is the point — a copy change must
 * not need a desktop release.
 *
 * The properties that fail quietly:
 *
 *  - **AN UNKNOWN KEY RENDERS NOTHING, NEVER THE RAW KEY.** A newer main can
 *    emit a seventh value, and `awaiting_handoff` appearing verbatim on a card
 *    is worse than the pill's own word, which is always true.
 *  - **A DETAIL NEVER SPEAKS OVER AN IDLE DOT.** `AgentLiveness` enforces it
 *    rather than trusting callers, because a card reading "Idle · Thinking…" is
 *    the two-readers-one-fact defect inside one component.
 *  - **PEER CARDS GET NO DETAIL AT ALL.** The cross-machine wire is deliberately
 *    coarse (INVARIANTS §11), and a peer row has no `detail` to render.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { AgentsTab } from "./agents-tab";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { AgentLiveness } from "./bits";
import { agentDetailLabel, agentKey } from "./agents-model";
import { CHANNEL_ID, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

describe("agentDetailLabel — the key becomes a sentence exactly once", () => {
  const CASES: Array<[DesktopSessionSummary["detail"], string | null]> = [
    ["thinking", "Thinking…"],
    ["posting", "Sending a message"],
    ["permission", "Waiting on you"],
    ["awaiting_peer", "Waiting for a reply"],
    ["awaiting_inbound", "Message waiting"],
  ];
  for (const [detail, label] of CASES) {
    it(`renders ${detail} as "${label}"`, () => {
      expect(agentDetailLabel({ detail })).toBe(label);
    });
  }

  it("names the tool when the desktop could name it", () => {
    expect(agentDetailLabel({ detail: "tool", toolLabel: "Bash" })).toBe("Running Bash");
    expect(agentDetailLabel({ detail: "tool", toolLabel: "dopl_channel" })).toBe(
      "Running dopl_channel"
    );
  });

  // ⚠ A REAL CASE, not a defensive stub: `toolLabel` is null whenever the name
  // could not be shortened to anything. "Running a command" is true either way.
  it("falls back to a true sentence when the tool could not be named", () => {
    expect(agentDetailLabel({ detail: "tool", toolLabel: null })).toBe("Running a command");
    expect(agentDetailLabel({ detail: "tool" })).toBe("Running a command");
  });

  it("renders NOTHING for an absent detail — an older main omits the field", () => {
    expect(agentDetailLabel({})).toBeNull();
    expect(agentDetailLabel({ detail: null })).toBeNull();
  });

  it("renders NOTHING for a key this build does not know", () => {
    // A newer main emitting a seventh value must degrade to the pill's word.
    expect(
      agentDetailLabel({ detail: "awaiting_handoff" as DesktopSessionSummary["detail"] })
    ).toBeNull();
  });
});

describe("AgentLiveness — the detail refines the dot, never contradicts it", () => {
  it("shows the detail in place of Running, not beside it", () => {
    render(<AgentLiveness running detail="Thinking…" />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
    // "Running · Thinking…" would say one thing twice; the dot carries liveness.
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("falls back to Running when this build has no finer sentence", () => {
    render(<AgentLiveness running detail={null} />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  // ⚠ THE CASE THE GUARD INSIDE THE COMPONENT EXISTS FOR.
  it("refuses to speak over an IDLE dot even when handed a detail", () => {
    render(<AgentLiveness running={false} detail="Thinking…" />);
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });
});

describe("the Agents tab wires it through for MY agents and not for peers", () => {
  const noop = () => {};

  it("labels my own card with what the machine says it is doing", () => {
    render(
      <AgentsTab
        sessions={[summary({ detail: "tool", toolLabel: "Bash" })]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("Running Bash")).toBeTruthy();
  });

  it("leaves a card from an older main reading exactly as it did before", () => {
    render(
      <AgentsTab
        sessions={[summary()]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("gives a PEER card the coarse word only — there is no detail on that wire", () => {
    const peer: ChannelPeerSession = {
      userId: PEER,
      channelId: CHANNEL_ID,
      threadId: "t-1",
      name: "onyx",
      state: "working",
      channelName: "Website",
      threadTitle: "UI-kit design",
      // ⚠ Fresh by construction — `peerCardsFor` drops a stale row (2026-08-20).
      updatedAt: new Date().toISOString(),
    };
    render(
      <AgentsTab
        sessions={[]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        peers={[peer]}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("onyx")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });
});

/**
 * "OPEN AGENT" (2026-08-20, F-212's closure) — the button that now always opens
 * the agent window.
 *
 * ⚠ THE HISTORY THIS PINS AGAINST, because both wrong answers were shipped. It
 * began reporting `{ok:true}` having opened nothing (main's recreate fallback),
 * and the renderer discarded the verdict anyway. The fix in between was an
 * honest refusal reading "this agent runs without a window" — which Samuel
 * called meaningless, correctly: a window is a VIEW, not a runtime property.
 * There is no refusal path left to word; there is a window.
 */
describe("Open agent always opens the agent view", () => {
  const AGENT = { channelId: CHANNEL_ID, taskId: "t-1" };
  const SEGMENT = "acme-a1b2";

  afterEach(() => {
    delete (window as { dopl?: unknown }).dopl;
  });

  function bridgeWith(sessions: Record<string, unknown>) {
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions,
    };
  }

  it("prefers the dedicated op and hands it the segment the route needs", async () => {
    const openWin = vi.fn().mockResolvedValue({ ok: true });
    bridgeWith({ reopen: vi.fn(), openAgentWindow: openWin });
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: true, reason: undefined });
    expect(openWin).toHaveBeenCalledWith(SEGMENT, CHANNEL_ID, "t-1");
  });

  // ⚠ NOT COMPATIBILITY THEATRE: on a main with only `reopen`, that op now hands a
  // live windowless session to the SAME window, so the button works there too.
  // Gating on the new op alone would hide a working affordance — the mistake
  // `canOpenAgentWindow`'s docblock already records having made once.
  it("falls back to reopen, WITH the segment, on a main without the new op", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    bridgeWith({ reopen });
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: true, reason: undefined });
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, "t-1", SEGMENT);
  });

  it("offers the button when EITHER op is present, and not when neither is", async () => {
    const { canOpenAgentWindow } = await import("./agents-controls");
    bridgeWith({ openAgentWindow: vi.fn() });
    expect(canOpenAgentWindow()).toBe(true);
    bridgeWith({ reopen: vi.fn() });
    expect(canOpenAgentWindow()).toBe(true);
    bridgeWith({});
    expect(canOpenAgentWindow()).toBe(false);
  });

  it("answers a verdict, not a throw, on a main without either op", async () => {
    bridgeWith({});
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: false, reason: "no-bridge" });
  });
});

describe("the panel's button reaches it", () => {
  afterEach(() => {
    delete (window as { dopl?: unknown }).dopl;
  });

  it("routes the click at the agent window, carrying the workspace segment", () => {
    const openWin = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { reopen: vi.fn(), openAgentWindow: openWin },
    };
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        workspaceSlug="acme-a1b2"
        onClose={() => {}}
      />
    );
    screen.getByRole("button", { name: "Open agent" }).click();
    expect(openWin).toHaveBeenCalledWith("acme-a1b2", CHANNEL_ID, "t-1");
  });

  // ⚠ THE DELETED NOTICE. "This agent runs without a window" described an
  // implementation detail as if it were a fact about the agent. Nothing on this
  // surface may say it again.
  it("never tells the operator their agent has no window", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { openAgentWindow: vi.fn().mockResolvedValue({ ok: true }) },
    };
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        workspaceSlug="acme-a1b2"
        onClose={() => {}}
      />
    );
    expect(screen.queryByText(/without a window/i)).toBeNull();
    expect(screen.queryByText(/not built yet/i)).toBeNull();
  });
});
