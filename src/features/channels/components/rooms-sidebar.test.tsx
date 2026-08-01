/**
 * The rooms sidebar is ADDITIVE — the header's thread popover keeps working —
 * so these cases pin the two things the column adds: open rooms first, and a
 * participant count when (and only when) the server sends one.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomRow, RoomsSidebar, ThreadAgentsRow } from "./rooms-sidebar";
import { threadAgentEntries } from "../lib/thread-agents";
import type {
  ChannelAgent,
  ChannelThread,
  ChannelThreadDetail,
  ThreadParticipant,
} from "../types";

function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: "t1",
    channelId: "c1",
    workspaceId: "w1",
    title: "Migrate the schema",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: "u-me",
    targetUserId: "u-ada",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
    ...over,
  };
}

function participant(id: string): ThreadParticipant {
  return {
    id,
    threadId: "t1",
    workspaceId: "w1",
    kind: "user",
    userId: "u-me",
    agentId: null,
    addedBy: "u-me",
    createdAt: "2026-07-31T00:00:00.000Z",
  };
}

function agentSeat(agentId: string, id = agentId): ThreadParticipant {
  return {
    id,
    threadId: "t1",
    workspaceId: "w1",
    kind: "agent",
    userId: null,
    agentId,
    addedBy: "u-me",
    createdAt: "2026-07-31T00:00:00.000Z",
  };
}

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: "u-me",
    name: "quartz",
    status: "active",
    engagedAt: null,
    engagedBy: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

function render(
  threads: ChannelThread[],
  threadsLoading = false,
  agents: ChannelAgent[] = []
) {
  return renderToStaticMarkup(
    <RoomsSidebar
      threads={threads}
      threadsLoading={threadsLoading}
      agents={agents}
      onSelectThread={() => {}}
      onCollapse={() => {}}
    />
  );
}

describe("RoomsSidebar ordering", () => {
  it("pins OPEN rooms above closed ones", () => {
    const markup = render([
      thread({ id: "t-closed", title: "CLOSED-ROOM", status: "closed" }),
      thread({ id: "t-open", title: "OPEN-ROOM" }),
    ]);
    expect(markup.indexOf("OPEN-ROOM")).toBeLessThan(
      markup.indexOf("CLOSED-ROOM")
    );
  });

  it("labels each room's state", () => {
    const markup = render([
      thread({ id: "t1", title: "A" }),
      thread({ id: "t2", title: "B", status: "closed" }),
      thread({ id: "t3", title: "C", status: "closed", outcome: "failed" }),
    ]);
    expect(markup).toContain("Open");
    expect(markup).toContain("Closed");
    expect(markup).toContain("Failed");
  });

  it("counts the rooms in the header", () => {
    expect(render([thread({ id: "a" }), thread({ id: "b" })])).toContain(">2<");
  });
});

describe("RoomsSidebar participants", () => {
  it("states the participant count when the server sends one", () => {
    const row: ChannelThreadDetail = {
      ...thread(),
      participants: [participant("p1"), participant("p2"), participant("p3")],
    };
    expect(render([row])).toContain("3 participants");
  });

  it("says nothing about participants on a row without them (today's response)", () => {
    expect(render([thread()])).not.toContain("participant");
  });

  it("singularizes a one-participant room", () => {
    const row: ChannelThreadDetail = {
      ...thread(),
      participants: [participant("p1")],
    };
    expect(render([row])).toContain("1 participant");
  });
});

describe("RoomsSidebar empty + loading", () => {
  it("says the channel has no rooms yet", () => {
    expect(render([])).toContain("No rooms yet.");
  });

  it("says it is loading rather than claiming emptiness", () => {
    const markup = render([], true);
    expect(markup).toContain("Loading rooms…");
    expect(markup).not.toContain("No rooms yet.");
  });

  it("can always be collapsed again", () => {
    expect(render([])).toContain('aria-label="Hide rooms"');
  });
});

/**
 * WHO IS WORKING IN THIS THREAD. The operator wants to see two agents
 * collaborating inside one thread at a glance, which a participant COUNT never
 * said. The degraded cases matter most: a legacy thread carries no set at all
 * and must gain nothing, and an unknown agent id must not blank the row.
 */
describe("RoomsSidebar thread agents", () => {
  const ROSTER = [
    agent({ id: "a1", name: "quartz", status: "active" }),
    agent({ id: "a2", name: "vega", status: "summoned" }),
  ];

  function withAgents(participants: ThreadParticipant[]) {
    const row: ChannelThreadDetail = { ...thread(), participants };
    return render([row], false, ROSTER);
  }

  it("names BOTH agents seated in a thread", () => {
    const markup = withAgents([agentSeat("a1"), agentSeat("a2")]);
    expect(markup).toContain("@quartz");
    expect(markup).toContain("@vega");
  });

  it("marks only the ACTIVE one as working, in words as well as a dot", () => {
    const markup = withAgents([agentSeat("a1"), agentSeat("a2")]);
    // Exactly one pill carries the word (the row title summarises it too, which
    // is why this counts the rendered pill rather than every occurrence).
    expect((markup.match(/>working</g) ?? []).length).toBe(1);
    expect(markup).toContain("1 working now.");
    expect(markup).toContain("bg-success");
  });

  it("says nothing extra on a legacy thread with no participant set", () => {
    const markup = render([thread()], false, ROSTER);
    expect(markup).not.toContain("@quartz");
    expect(markup).not.toContain("working");
    // And still no invented zero.
    expect(markup).not.toContain("0 participant");
  });

  it("says nothing extra when the set holds only humans", () => {
    const markup = withAgents([participant("p1")]);
    expect(markup).not.toContain("@");
    expect(markup).toContain("1 participant");
  });

  it("keeps a seat whose agent this client never loaded, without a blank pill", () => {
    const markup = withAgents([agentSeat("a-ghost")]);
    expect(markup).toContain("@agent");
    expect(markup).not.toContain("@quartz");
  });

  it("degrades to fallback handles while the roster is still loading", () => {
    const row: ChannelThreadDetail = {
      ...thread(),
      participants: [agentSeat("a1")],
    };
    expect(render([row], false, [])).toContain("@agent");
  });

  it("uses design tokens only for the live / idle pills", () => {
    expect(withAgents([agentSeat("a1"), agentSeat("a2")])).not.toMatch(
      /#[0-9a-fA-F]{6}/
    );
  });
});

/**
 * `RoomRow` and `ThreadAgentsRow` are exported so the join can be asserted on
 * REAL markup one row at a time, which is the only way the freshness caveat and
 * the render-nothing case can be pinned without reading them out of a whole
 * sidebar. Rendered directly here so those exports have the consumer their docs
 * claim.
 */
describe("RoomRow / ThreadAgentsRow, on their own markup", () => {
  const ROSTER = [
    agent({ id: "a1", name: "quartz", status: "active" }),
    agent({ id: "a2", name: "vega", status: "summoned" }),
  ];

  const row = (participants: ThreadParticipant[]) => {
    const detail: ChannelThreadDetail = { ...thread(), participants };
    return renderToStaticMarkup(
      <RoomRow room={detail} agents={ROSTER} onSelect={() => {}} />
    );
  };

  const agentsRow = (participants: ThreadParticipant[]) => {
    const detail: ChannelThreadDetail = { ...thread(), participants };
    return renderToStaticMarkup(
      <ThreadAgentsRow entries={threadAgentEntries(detail, ROSTER)} />
    );
  };

  it("renders one room's title, state and seats", () => {
    const markup = row([agentSeat("a1"), participant("p1")]);
    expect(markup).toContain("Migrate the schema");
    expect(markup).toContain("Open");
    expect(markup).toContain("@quartz");
  });

  it("renders NOTHING when a thread seats no agents", () => {
    expect(agentsRow([participant("p1")])).toBe("");
    expect(agentsRow([])).toBe("");
  });

  it("marks the working agent in words, not only a dot", () => {
    const markup = agentsRow([agentSeat("a1"), agentSeat("a2")]);
    expect(markup).toContain(">working<");
    expect((markup.match(/>working</g) ?? []).length).toBe(1);
  });

  /**
   * S5 — `channel_task_participants` is deliberately outside the realtime
   * publication, so an agent that joins a thread without posting is missing
   * here until the thread list refetches. The row is not allowed to hide that.
   */
  it("admits in its own title that the set is not live", () => {
    expect(agentsRow([agentSeat("a1")])).toContain(
      "Updates when the thread has activity."
    );
  });

  it("carries no freshness claim at all when it renders nothing", () => {
    expect(agentsRow([])).not.toContain("Updates when");
  });
});
