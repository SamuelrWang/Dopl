import { describe, expect, it } from "vitest";
import {
  participantCountLabel,
  readThreadParticipants,
  sortRoomThreads,
} from "./rooms";
import type {
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

function participant(over: Partial<ThreadParticipant> = {}): ThreadParticipant {
  return {
    id: "p1",
    threadId: "t1",
    workspaceId: "w1",
    kind: "user",
    userId: "u-me",
    agentId: null,
    addedBy: "u-me",
    createdAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

/** A row as the READ paths serve it: the thread plus its participant set. */
function withParticipants(
  count: number,
  over: Partial<ChannelThread> = {}
): ChannelThread {
  const row: ChannelThreadDetail = {
    ...thread(over),
    participants: Array.from({ length: count }, (_, i) =>
      participant({ id: `p${i}` })
    ),
  };
  return row;
}

describe("sortRoomThreads — open rooms are where work is", () => {
  it("pins open rooms above closed ones", () => {
    const rows = [
      thread({ id: "closed-1", status: "closed" }),
      thread({ id: "open-1" }),
      thread({ id: "closed-2", status: "closed", outcome: "failed" }),
      thread({ id: "open-2" }),
    ];
    expect(sortRoomThreads(rows).map((t) => t.id)).toEqual([
      "open-1",
      "open-2",
      "closed-1",
      "closed-2",
    ]);
  });

  it("keeps the server's order inside each group (newest-first survives)", () => {
    const rows = [thread({ id: "a" }), thread({ id: "b" }), thread({ id: "c" })];
    expect(sortRoomThreads(rows).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const rows = [thread({ id: "closed", status: "closed" }), thread({ id: "open" })];
    sortRoomThreads(rows);
    expect(rows.map((t) => t.id)).toEqual(["closed", "open"]);
  });

  it("handles an empty channel", () => {
    expect(sortRoomThreads([])).toEqual([]);
  });
});

describe("participants — read defensively, stated only when present", () => {
  it("reads the contract field when the server sends it", () => {
    expect(readThreadParticipants(withParticipants(3))).toHaveLength(3);
  });

  it("reads [] from a row without participants (today's response)", () => {
    expect(readThreadParticipants(thread())).toEqual([]);
  });

  it("survives a garbage shape rather than throwing in the sidebar", () => {
    const bad = { ...thread(), participants: "three" } as unknown as ChannelThread;
    expect(readThreadParticipants(bad)).toEqual([]);
    const partlyBad = {
      ...thread(),
      participants: [participant(), { nope: true }, null],
    } as unknown as ChannelThread;
    expect(readThreadParticipants(partlyBad)).toHaveLength(1);
  });

  it("pluralizes the count, and says nothing at all when there is none", () => {
    expect(participantCountLabel(0)).toBeNull();
    expect(participantCountLabel(1)).toBe("1 participant");
    expect(participantCountLabel(3)).toBe("3 participants");
  });
});
