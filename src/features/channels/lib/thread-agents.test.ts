/**
 * The join that lets a thread card say "two agents are working in here". The
 * cases that matter are the degraded ones: a thread with no participant set
 * (every legacy thread) and a participant naming an agent this client never
 * loaded. Neither may throw, and neither may produce a confident zero.
 */

import { describe, expect, it } from "vitest";
import {
  threadAgentEntries,
  threadAgentsLabel,
  THREAD_AGENTS_FRESHNESS_NOTE,
  UNKNOWN_AGENT_HANDLE,
} from "./thread-agents";
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

function withParticipants(participants: ThreadParticipant[]): ChannelThread {
  const detail: ChannelThreadDetail = { ...thread(), participants };
  return detail;
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

function userSeat(userId: string): ThreadParticipant {
  return { ...agentSeat("x", `p-${userId}`), kind: "user", userId, agentId: null };
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

const ROSTER = [
  agent({ id: "a1", name: "quartz", status: "active" }),
  agent({ id: "a2", name: "vega", status: "summoned", ownerUserId: "u-ada" }),
];

describe("threadAgentEntries — the happy join", () => {
  it("resolves each agent participant to its handle and status", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a1"), agentSeat("a2")]),
      ROSTER
    );
    expect(entries.map((e) => e.handle)).toEqual(["quartz", "vega"]);
    expect(entries.map((e) => e.status)).toEqual(["active", "summoned"]);
  });

  it("marks only an ACTIVE agent live (a session is working it)", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a1"), agentSeat("a2")]),
      ROSTER
    );
    expect(entries.map((e) => e.live)).toEqual([true, false]);
  });

  it("keeps participant order", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a2"), agentSeat("a1")]),
      ROSTER
    );
    expect(entries.map((e) => e.agentId)).toEqual(["a2", "a1"]);
  });

  it("drops HUMAN participants (the card already names the people)", () => {
    const entries = threadAgentEntries(
      withParticipants([userSeat("u-me"), agentSeat("a1"), userSeat("u-ada")]),
      ROSTER
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].handle).toBe("quartz");
  });

  it("counts the same agent seated twice as ONE seat", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a1", "p1"), agentSeat("a1", "p2")]),
      ROSTER
    );
    expect(entries).toHaveLength(1);
  });
});

describe("threadAgentEntries — degrades quietly", () => {
  it("returns [] for a thread with NO participant set (today's legacy rows)", () => {
    expect(threadAgentEntries(thread(), ROSTER)).toEqual([]);
  });

  it("returns [] for an explicitly empty set — an empty set is not a zero claim", () => {
    expect(threadAgentEntries(withParticipants([]), ROSTER)).toEqual([]);
  });

  it("TOLERATES an unknown agent id: the seat survives, the handle falls back", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a-ghost"), agentSeat("a1")]),
      ROSTER
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      agentId: "a-ghost",
      agent: null,
      handle: UNKNOWN_AGENT_HANDLE,
      status: null,
      live: false,
    });
    expect(entries[1].handle).toBe("quartz");
  });

  it("survives an EMPTY roster (agents still loading)", () => {
    const entries = threadAgentEntries(withParticipants([agentSeat("a1")]), []);
    expect(entries).toHaveLength(1);
    expect(entries[0].handle).toBe(UNKNOWN_AGENT_HANDLE);
  });

  it("ignores an agent participant with no agent id (shape it did not expect)", () => {
    const broken = { ...agentSeat("a1"), agentId: null };
    expect(threadAgentEntries(withParticipants([broken]), ROSTER)).toEqual([]);
  });

  it("never throws on a garbage participants value", () => {
    const rogue = {
      ...thread(),
      participants: "not an array",
    } as unknown as ChannelThread;
    expect(threadAgentEntries(rogue, ROSTER)).toEqual([]);
  });
});

describe("threadAgentsLabel", () => {
  it("says nothing when there are no agents (never '0 agents')", () => {
    expect(threadAgentsLabel([])).toBeNull();
  });

  it("names the agents, and how many are working right now", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a1"), agentSeat("a2")]),
      ROSTER
    );
    expect(threadAgentsLabel(entries)).toBe(
      "@quartz, @vega in this thread. 1 working now. Updates when the thread has activity."
    );
  });

  it("drops the working clause when nobody is working", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a2")]),
      ROSTER
    );
    expect(threadAgentsLabel(entries)).toBe(
      "@vega in this thread. Updates when the thread has activity."
    );
  });

  /**
   * S5 — the participant set is NOT on a realtime stream (migration
   * 20260731130000 keeps `channel_task_participants` out of the publication on
   * F-072 grounds), so it only refreshes when the thread list refetches. A
   * second agent that joins without posting is missing from this row until
   * then. The label states that instead of presenting a possibly-partial set as
   * the answer.
   */
  it("never presents the set as live", () => {
    const entries = threadAgentEntries(
      withParticipants([agentSeat("a1")]),
      ROSTER
    );
    expect(threadAgentsLabel(entries)).toContain(
      THREAD_AGENTS_FRESHNESS_NOTE
    );
  });

  it("says nothing at all, caveat included, when there are no agents", () => {
    expect(threadAgentsLabel([])).toBeNull();
  });

  it("keeps the caveat free of em dashes (product copy rule)", () => {
    expect(THREAD_AGENTS_FRESHNESS_NOTE).not.toContain("—");
  });
});
