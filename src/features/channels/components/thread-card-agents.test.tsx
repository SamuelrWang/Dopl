// @vitest-environment jsdom
/**
 * The thread card's face: the thread's name, the opening ask, the agents working the thread (the
 * viewer's own rows open their view, a peer's are inert), and an "Opened by" that tells a person's
 * request from an agent's.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { Transcript } from "./transcript";
import type { AgentFeeds } from "./agent-face";
import { openedByLabel, threadCardAgents } from "./thread-card-agents";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { CHANNEL_ID, ME, PEER, member, message, thread } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);
const T = thread({ id: "t-1", title: "Flaky test suite" });
const OPENER = message({ id: "op", seq: 1, body: "Grace wants a repro", metadata: { threadId: "t-1" } });

function own(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    threadId: "t-1",
    agentId: "ab12cd34",
    name: "flint",
    displayName: "Teardown Fix",
    state: "working",
    channelName: "Website",
    threadTitle: "Flaky test suite",
    ...over,
  };
}

function peer(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: PEER,
    channelId: CHANNEL_ID,
    threadId: "t-1",
    name: "k9x2",
    displayName: "Notice Scout",
    state: "idle",
    channelName: "Website",
    threadTitle: "Flaky test suite",
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function draw(feeds: AgentFeeds | undefined, messages = [OPENER]) {
  const onOpenAgent = vi.fn();
  const { container } = render(
    <Transcript
      rows={channelRows(messages, [T], INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      agentFeeds={feeds}
      onOpenAgent={onOpenAgent}
      onOpenThread={() => {}}
    />
  );
  return { container, onOpenAgent };
}

describe("the card's head", () => {
  it("is the thread's name over the opening ask, with no kind label and no legacy status", () => {
    const { container } = draw(undefined);
    expect(screen.getByText("Flaky test suite").className).toContain("truncate");
    expect(screen.getByText("Grace wants a repro")).toBeTruthy();
    expect(container.textContent).not.toContain("Agent thread");
    expect(container.textContent).not.toMatch(/\bOpen\b(?! thread)/);
    expect(container.querySelector(".white-card")).toBeTruthy();
    expect(container.querySelector(".bg-surface-cta.ring-surface-cta")).toBeNull();
  });
});

describe("the agents in the thread", () => {
  it("lists own agents first; an own row opens its view by key, a peer's has no press", () => {
    const { onOpenAgent } = draw({ sessions: [own()], peers: [peer()] });
    expect(screen.getByText("2 agents in this thread")).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Teardown Fix" }));
    expect(onOpenAgent).toHaveBeenCalledWith("ab12cd34");
    expect(screen.queryByRole("button", { name: "Open Notice Scout" })).toBeNull();
    expect(screen.getByText("Notice Scout")).toBeTruthy();
    expect(screen.getByText("Diana's agent")).toBeTruthy();
  });

  it("caps the visible list at three rows and scrolls past them", () => {
    const sessions = [1, 2, 3, 4].map((n) =>
      own({ sessionId: `s-${n}`, agentId: `a${n}`, displayName: `Coder ${n}` })
    );
    draw({ sessions, peers: [] });
    const list = screen.getByRole("button", { name: "Open Coder 1" }).parentElement as HTMLElement;
    expect(list.className).toContain("max-h-36.5");
    expect(list.className).toContain("overflow-y-auto");
  });

  it("shows an empty well when the feeds are known and nobody is on the thread", () => {
    draw({ sessions: [], peers: [] });
    expect(screen.getByText("No agents yet").closest(".card-well")).toBeTruthy();
  });

  it("draws no compartment when no own feed can say (a plain browser) and no peer is on it", () => {
    const { container } = draw({ sessions: null, peers: [] });
    expect(container.querySelector(".card-well")).toBeNull();
    expect(threadCardAgents({ sessions: null, peers: [] }, CHANNEL_ID, "t-1", INDEX)).toBeNull();
  });
});

describe("Opened by", () => {
  it("names a person, and an agent as its operator's", () => {
    expect(openedByLabel("You", false)).toBe("Opened by you");
    expect(openedByLabel("Diana Taylor", false)).toBe("Opened by Diana Taylor");
    expect(openedByLabel("You", true)).toBe("Opened by your agent");
    expect(openedByLabel("Diana Taylor", true)).toBe("Opened by Diana's agent");
    // The opening agent's own name wins when it is known; blank or unknown keeps the old words.
    expect(openedByLabel("You", true, "UI Fixer")).toBe("Opened by UI Fixer");
    expect(openedByLabel("Diana Taylor", true, "Scout")).toBe("Opened by Scout");
    expect(openedByLabel("You", true, "  ")).toBe("Opened by your agent");
    expect(openedByLabel("You", false, "UI Fixer")).toBe("Opened by you");
  });

  it("reads the opening message's authorKind", () => {
    draw(undefined, [{ ...OPENER, authorKind: "agent" }]);
    expect(screen.getByText("Opened by your agent")).toBeTruthy();
  });
});
