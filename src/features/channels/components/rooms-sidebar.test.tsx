/**
 * The rooms sidebar is ADDITIVE — the header's thread popover keeps working —
 * so these cases pin what the column adds: open rooms first, each room's state,
 * and the empty / loading distinction.
 *
 * TWO GROUPS ARE GONE, both because their surface is: the "N participants"
 * count (breakout rooms) and the seated-agent pills (named agents). See the
 * channels rollback, §1.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomRow, RoomsSidebar, sortRoomThreads } from "./rooms-sidebar";
import type { ChannelThread } from "../types";

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

describe("sortRoomThreads", () => {
  it("partitions open above closed without re-sorting inside either group", () => {
    const a = thread({ id: "a" });
    const b = thread({ id: "b", status: "closed" });
    const c = thread({ id: "c" });
    expect(sortRoomThreads([b, a, c]).map((t) => t.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});

describe("RoomRow, on its own markup", () => {
  it("renders one room's title and state", () => {
    const markup = renderToStaticMarkup(
      <RoomRow room={thread({ title: "ROOM-TITLE" })} onSelect={() => {}} />
    );
    expect(markup).toContain("ROOM-TITLE");
    expect(markup).toContain("Open");
  });

  it("says nothing about participants or agents any more", () => {
    const markup = renderToStaticMarkup(
      <RoomRow room={thread()} onSelect={() => {}} />
    );
    expect(markup).not.toContain("participant");
    expect(markup).not.toContain("working");
    expect(markup).not.toContain("@");
  });
});
