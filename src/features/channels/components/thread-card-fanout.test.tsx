// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, thread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/**
 * THE REQUEST FAN-OUT, as the transcript sees it: N opening messages sharing one
 * server-stamped `fanoutGroup` are ONE card with N addressee pills.
 *
 * ⚠ Mutation-verify by keying the dedupe on `thread.id` instead of the group —
 * "one card" goes red and three identical posts appear.
 */
describe("the request fan-out", () => {
  const GROUP = "grp-1";
  const THIRD = "33333333-e29b-41d4-a716-446655440000";
  const ROSTER = [
    ...MEMBERS,
    member({ userId: THIRD, displayName: "Ada Lovelace", role: "member" }),
  ];
  const FANOUT_INDEX = indexMembers(ROSTER, ME);
  const THREADS = [
    thread({ id: "t-a", title: "Sweep the docs", createdBy: ME, targetUserId: PEER }),
    thread({ id: "t-b", title: "Sweep the docs", createdBy: ME, targetUserId: THIRD }),
  ];
  const OPENERS = [
    message({
      id: "op-a",
      seq: 1,
      body: "START-HERE",
      metadata: { threadId: "t-a", fanoutGroup: GROUP },
    }),
    message({
      id: "op-b",
      seq: 2,
      body: "START-HERE",
      metadata: { threadId: "t-b", fanoutGroup: GROUP },
    }),
  ];

  function renderFanOut(
    over: { canLaunchAgent?: boolean; launchBusy?: boolean } = {}
  ) {
    const onOpenThread = vi.fn();
    const onLaunchAgent = vi.fn();
    render(
      <Transcript
        rows={channelRows(OPENERS, THREADS, FANOUT_INDEX, formatChannelTimestamp)}
        index={FANOUT_INDEX}
        flashId={null}
        onLaunchAgent={onLaunchAgent}
        onOpenThread={onOpenThread}
        {...over}
      />
    );
    return { onOpenThread, onLaunchAgent };
  }

  it("draws ONE card for two threads, with a pill per ADDRESSEE", () => {
    renderFanOut();
    expect(screen.getAllByRole("button", { name: "Open thread" })).toHaveLength(1);
    expect(screen.getAllByText("START-HERE")).toHaveLength(1);
    // Each pill is that thread's own `targetUserId` — never the requester.
    expect(screen.getByText("Diana T.")).not.toBeNull();
    expect(screen.getByText("Ada L.")).not.toBeNull();
    expect(screen.queryByText("you")).toBeNull();
  });

  it("keeps a fan-out thread's REPLY out of the channel — one card, not two", () => {
    // ⚠ Only OPENERS carry `fanoutGroup` (the server strips it from every
    // other post), so a reply arrives under the thread's OTHER identity, its
    // `threadId`. A group-only seen-key let it re-emit the card as its own
    // (observed live 2026-08-20: the addressee's first agent reply rendered as
    // a second thread card in the main transcript).
    const reply = message({
      id: "re-a",
      seq: 3,
      body: "AGENT-REPLY",
      authorUserId: PEER,
      authorKind: "agent",
      metadata: { threadId: "t-a" },
    });
    render(
      <Transcript
        rows={channelRows([...OPENERS, reply], THREADS, FANOUT_INDEX, formatChannelTimestamp)}
        index={FANOUT_INDEX}
        flashId={null}
        onOpenThread={vi.fn()}
      />
    );
    expect(screen.getAllByRole("button", { name: "Open thread" })).toHaveLength(1);
    expect(screen.queryByText("AGENT-REPLY")).toBeNull();
  });

  it("states NO approval on the pills — no projection says who allowed", () => {
    renderFanOut();
    // F-206: "no pending row" would report never-asked as approved, so the pill states no verdict.
    expect(screen.queryByText(/approved/)).toBeNull();
    expect(screen.queryByText(/awaiting approval/)).toBeNull();
  });

  it("opens the viewer's OWN thread of the group", () => {
    const { onOpenThread } = renderFanOut();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    // ME created both, so the first is theirs — the point is that it names a
    // THREAD id from the group, not the card's message id.
    expect(onOpenThread).toHaveBeenCalledWith("t-a");
  });
});
