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

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { AgentsTab } from "./agents-tab";
import { AgentLiveness } from "./bits";
import { agentDetailLabel } from "./agents-model";
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
      updatedAt: "2026-08-20T12:00:00.000Z",
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
