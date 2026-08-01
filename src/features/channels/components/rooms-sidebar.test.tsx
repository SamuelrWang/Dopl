/**
 * The rooms sidebar is ADDITIVE — the header's thread popover keeps working —
 * so these cases pin the two things the column adds: open rooms first, and a
 * participant count when (and only when) the server sends one.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomsSidebar } from "./rooms-sidebar";
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

function render(threads: ChannelThread[], threadsLoading = false) {
  return renderToStaticMarkup(
    <RoomsSidebar
      threads={threads}
      threadsLoading={threadsLoading}
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
