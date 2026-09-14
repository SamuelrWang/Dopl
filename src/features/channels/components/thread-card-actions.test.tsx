// @vitest-environment jsdom
/**
 * WHAT THE TRANSCRIPT'S AGENT-THREAD CARD OFFERS — two actions, and neither is a
 * decision (Samuel, 2026-08-22: *"remove all the stuff about declining and
 * approving of threads — you have the thread, you open it, and either you launch
 * agent or you don't."*).
 *
 * Its own file rather than a suite inside `transcript.test.tsx`, which sits at
 * the 500-line cap — the same seam `sidebar-row-signals.test.tsx` was split on,
 * and the same reason: letting a line cap decide what a suite may assert is
 * backwards. That file keeps what a ROW looks like (sides, chips, receipts,
 * fan-out collapsing); this keeps what the card DOES.
 *
 * The properties that fail quietly:
 *
 *  - **THERE IS NO DECLINE, ANYWHERE.** The inline Decline / consent "Launch
 *    agent" pair fired the CAS'd `PATCH /consent/[id]` against a `pending`
 *    inbound row. That lane is retired along with `PendingChip`, the thread's
 *    awaiting strip and the Inbox's inbound rows. Pinned as an ABSENCE because
 *    nothing else fails when it comes back.
 *  - **"Launch agent" IS THE DIRECT LAUNCH.** It raises no consent row, answers
 *    no request and asks nobody — the same bridge op the composer's Bot icon and
 *    the Agents tab's New Agent button fire.
 *  - **IT LAUNCHES ON THE THREAD "Open thread" OPENS.** A fan-out card names N
 *    threads and `view-model-rows.ts › ownThreadOf` already picked the one this
 *    viewer is party to; any other one starts an agent in an exchange the
 *    operator cannot write in.
 *  - **ABSENT, NOT DISABLED, WITHOUT THE BRIDGE.** A plain browser has no agent
 *    to start, and a permanently greyed button is indistinguishable from a broken
 *    one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { ME, PEER, member, message, thread } from "./test-fixtures";

afterEach(cleanup);

const OTHER = "u-ada";
const GROUP = "grp-1";

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    member({ userId: OTHER, displayName: "Ada Lovelace", role: "member" }),
  ],
  ME
);

/** ONE request, TWO addressees — the shape that makes "which thread" a real
 *  question rather than a trivial one. */
const THREADS = [
  thread({ id: "t-a", createdBy: ME, targetUserId: PEER, title: "Ship it" }),
  thread({ id: "t-b", createdBy: ME, targetUserId: OTHER, title: "Ship it" }),
];
const OPENERS = [
  message({
    id: "op-a",
    seq: 1,
    body: "START-HERE",
    metadata: { taskId: "t-a", fanoutGroup: GROUP },
  }),
  message({
    id: "op-b",
    seq: 2,
    body: "START-HERE",
    metadata: { taskId: "t-b", fanoutGroup: GROUP },
  }),
];

function renderCard(
  over: { canLaunchAgent?: boolean; launchBusy?: boolean } = {}
) {
  const onOpenThread = vi.fn();
  const onLaunchAgent = vi.fn();
  render(
    <Transcript
      rows={channelRows(OPENERS, THREADS, INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onLaunchAgent={onLaunchAgent}
      onOpenThread={onOpenThread}
      {...over}
    />
  );
  return { onOpenThread, onLaunchAgent };
}

const launch = () => screen.queryByRole("button", { name: "Launch agent" });

describe("the card offers no decision", () => {
  it("renders no decline and no requested state, ever", () => {
    renderCard({ canLaunchAgent: true });
    expect(screen.queryByText("Requested")).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByText(/awaiting your answer/i)).toBeNull();
    expect(screen.queryByText(/awaiting your approval/i)).toBeNull();
  });

  /** The two that remain, and nothing else. */
  it("carries exactly Open thread and Launch agent", () => {
    renderCard({ canLaunchAgent: true });
    expect(screen.getByRole("button", { name: "Open thread" })).not.toBeNull();
    expect(launch()).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("the direct launch", () => {
  it("is absent without the bridge op and present with it", () => {
    renderCard();
    expect(launch()).toBeNull();
    cleanup();
    renderCard({ canLaunchAgent: true });
    expect(launch()).not.toBeNull();
  });

  it("launches on the viewer's OWN thread of the group", () => {
    const { onLaunchAgent } = renderCard({ canLaunchAgent: true });
    fireEvent.click(launch()!);
    expect(onLaunchAgent).toHaveBeenCalledWith("t-a");
  });

  /** ⚠ THE SAME THREAD BOTH ACTIONS NAME. If these two ever diverge, the card
   *  opens one exchange and starts an agent in another. */
  it("names the same thread Open thread does", () => {
    const { onLaunchAgent, onOpenThread } = renderCard({ canLaunchAgent: true });
    fireEvent.click(launch()!);
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onLaunchAgent.mock.calls[0][0]).toBe(onOpenThread.mock.calls[0][0]);
  });

  /** `launchBusy` is the double-submit guard over a real click — a different
   *  fact from the capability above. */
  it("refuses a second click while one launch is in flight", () => {
    const { onLaunchAgent } = renderCard({ canLaunchAgent: true, launchBusy: true });
    fireEvent.click(launch()!);
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });
});
