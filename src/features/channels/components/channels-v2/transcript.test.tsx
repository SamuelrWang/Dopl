// @vitest-environment jsdom
/**
 * The wired transcript. The property this file exists for:
 *
 * **SIDE COMES FROM `author_user_id`, THE AGENT CHIP COMES FROM `authorKind`,
 * AND THE TWO NEVER SWAP JOBS.** `authorKind` is caller-assertable
 * (INVARIANTS §5) — an explicit body value beats `ctx.source`, which is
 * load-bearing because the desktop posts agent results over the operator's own
 * cookie session. Letting it pick a side would let a caller choose which half
 * of somebody else's screen their words land on. `author_user_id` is always
 * `ctx.userId` and is the signal the layout hangs off.
 *
 * Also pinned: `task_started` renders as NOTHING while a TERMINAL lifecycle row
 * renders as a slim receipt line (the shipping desktop's trigger lanes still
 * post both — INVARIANTS §5), a thread's opening message becomes a CARD in the
 * channel view while the rest of its messages stay in the thread view, and the
 * scroll-target row carries `data-message-id`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { channelRows, indexMembers, threadRows } from "./view-model";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, thread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];
const INDEX = indexMembers(MEMBERS, ME);

function renderRows(
  rows: ReturnType<typeof channelRows>,
  requested: ReadonlySet<string> = new Set(),
  // ⚠ The SAME index the rows were derived from, or the body's mention lookup
  // runs against a different roster than `channelRows` did.
  index: typeof INDEX = INDEX
) {
  const onOpenThread = vi.fn();
  render(
    <Transcript
      rows={rows}
      index={index}
      flashId={null}
      requested={requested}
      onOpenThread={onOpenThread}
    />
  );
  return { onOpenThread };
}

/** The row element for a body string — `<article data-message-id>`. */
function rowFor(body: string): HTMLElement {
  return screen.getByText(body, { exact: false }).closest("article") as HTMLElement;
}

describe("channels-v2 transcript — sides", () => {
  it("hangs MY message right and a PEER's left", () => {
    renderRows(
      channelRows(
        [
          message({ id: "mine", body: "MY-TEXT", authorUserId: ME }),
          message({ id: "theirs", seq: 2, body: "THEIR-TEXT", authorUserId: PEER }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(rowFor("MY-TEXT").className).toContain("flex-row-reverse");
    expect(rowFor("THEIR-TEXT").className).not.toContain("flex-row-reverse");
  });

  it("hangs MY AGENT right and a PEER's agent left — never a third column", () => {
    renderRows(
      channelRows(
        [
          message({
            id: "mine",
            body: "MY-AGENT",
            authorUserId: ME,
            authorKind: "agent",
          }),
          message({
            id: "theirs",
            seq: 2,
            body: "PEER-AGENT",
            authorUserId: PEER,
            authorKind: "agent",
          }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(rowFor("MY-AGENT").className).toContain("flex-row-reverse");
    expect(rowFor("PEER-AGENT").className).not.toContain("flex-row-reverse");
    expect(screen.getAllByText("Agent")).toHaveLength(2);
  });

  it("does NOT let `authorKind` move a row: a peer's row claiming `agent` stays left", () => {
    // ⚠ THE MUTATION THIS FILE GUARDS. `authorKind` is a display claim scoped
    // to one user; if the side ever keys off it, this assertion goes red.
    renderRows(
      channelRows(
        [
          message({
            id: "claim",
            body: "CLAIMED",
            authorUserId: PEER,
            authorKind: "agent",
          }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(rowFor("CLAIMED").className).not.toContain("flex-row-reverse");
  });

  it("labels the viewer 'You' and a peer by their roster name", () => {
    renderRows(
      channelRows(
        [
          message({ id: "mine", body: "MY-TEXT" }),
          message({ id: "theirs", seq: 2, body: "THEIR-TEXT", authorUserId: PEER }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(screen.getByText("You")).not.toBeNull();
    expect(screen.getByText("Diana Taylor")).not.toBeNull();
  });

  it("carries `data-message-id` so the Tags inbox's scroll can find a row", () => {
    renderRows(
      channelRows([message({ id: "m-7", body: "FINDME" })], [], INDEX, formatChannelTimestamp)
    );
    expect(rowFor("FINDME").getAttribute("data-message-id")).toBe("m-7");
  });
});

describe("channels-v2 transcript — channel view vs thread view", () => {
  const T = thread({ id: "t-1", title: "UI-kit design" });
  const MESSAGES = [
    message({ id: "chan", seq: 1, body: "CHANNEL-TEXT" }),
    message({ id: "open", seq: 2, body: "OPENING-TEXT", metadata: { taskId: "t-1" } }),
    message({
      id: "reply",
      seq: 3,
      body: "THREAD-REPLY",
      authorUserId: PEER,
      metadata: { taskId: "t-1" },
    }),
  ];

  it("renders the thread's OPENING message as a card and keeps its replies out of the channel", () => {
    renderRows(channelRows(MESSAGES, [T], INDEX, formatChannelTimestamp));
    expect(screen.getByText("CHANNEL-TEXT")).not.toBeNull();
    expect(screen.getByText("Agent thread")).not.toBeNull();
    expect(screen.getByText("UI-kit design")).not.toBeNull();
    expect(screen.getByText("OPENING-TEXT")).not.toBeNull();
    expect(screen.queryByText("THREAD-REPLY")).toBeNull();
  });

  it("falls back to a plain message when the thread row is not in this read", () => {
    // A clipped thread list must not make its messages vanish.
    renderRows(channelRows(MESSAGES, [], INDEX, formatChannelTimestamp));
    expect(screen.getByText("OPENING-TEXT")).not.toBeNull();
    expect(screen.getByText("THREAD-REPLY")).not.toBeNull();
    expect(screen.queryByText("Agent thread")).toBeNull();
  });

  it("opens the thread the card names, not the row's message id", () => {
    const { onOpenThread } = renderRows(
      channelRows(MESSAGES, [T], INDEX, formatChannelTimestamp)
    );
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("t-1");
  });

  it("the thread view shows only that thread's messages", () => {
    renderRows(threadRows(MESSAGES, "t-1", INDEX, formatChannelTimestamp));
    expect(screen.getByText("OPENING-TEXT")).not.toBeNull();
    expect(screen.getByText("THREAD-REPLY")).not.toBeNull();
    expect(screen.queryByText("CHANNEL-TEXT")).toBeNull();
  });
});

/**
 * THE LIFECYCLE RECEIPT. The property: **an ENDING is not run state.**
 *
 * `task_started` is a fact about a runtime and belongs to the Agents tab, so it
 * renders as nothing on every build, forever. A TERMINAL row does not: the
 * shipping desktop's `main/trigger-outcomes.js` posts `task_failed` +
 * `{declined:true}` on a consent deny, and dropping that left the requester
 * staring at an ask nobody appeared to have answered.
 */
describe("channels-v2 transcript — lifecycle receipts", () => {
  it("renders a DECLINED consent outcome as a receipt line, not as its body", () => {
    // Byte-shaped like `main/trigger-outcomes.js › inboundDenied`.
    renderRows(
      channelRows(
        [
          message({
            id: "x",
            seq: 1,
            kind: "task_failed",
            authorKind: "agent",
            body: "Request declined",
            metadata: { declined: true },
          }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    const line = screen.getByText("Declined").closest("p") as HTMLElement;
    expect(line.dataset.receiptStatus).toBe("declined");
    // Flag-derived label only: the row's own (caller-influenceable) copy is
    // never what states the outcome.
    expect(screen.queryByText("Request declined")).toBeNull();
    // A calm ending must not wear alarm ink.
    expect(line.innerHTML).not.toContain("text-danger");
  });

  it("renders the headless lane's flagless task_finished as a receipt", () => {
    // `main/trigger-headless.js › openOutboundReview` posts this with no calm
    // flag and `channel-post.js`'s default body.
    renderRows(
      channelRows(
        [
          message({
            id: "f",
            seq: 1,
            kind: "task_finished",
            authorKind: "agent",
            body: "Finished this request.",
          }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    const line = screen.getByText("Finished").closest("p") as HTMLElement;
    expect(line.dataset.receiptStatus).toBe("finished");
  });

  it("drops a bare task_started, and drops an old build's task_started too", () => {
    renderRows(
      channelRows(
        [
          // Today's headless lane: `postTaskEvent` fills the default body.
          message({
            id: "s1",
            seq: 1,
            kind: "task_started",
            body: "Started working on this request.",
          }),
          // A pre-Phase-5 session-window echo, body and all.
          message({ id: "s2", seq: 2, kind: "task_started", body: "STARTED" }),
          // A flagless terminal row with nothing human in it is machine noise.
          message({ id: "n", seq: 3, kind: "task_failed", body: "   " }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(screen.queryByText("Started working on this request.")).toBeNull();
    expect(screen.queryByText("STARTED")).toBeNull();
    expect(screen.queryByText("Accepted, agent working")).toBeNull();
    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.getByText("Nothing posted here yet.")).not.toBeNull();
  });

  it("paints a FLAGLESS task_failed — a real fault — in alarm ink", () => {
    renderRows(
      channelRows(
        [
          message({
            id: "x",
            seq: 1,
            kind: "task_failed",
            body: "Could not complete this request.",
          }),
        ],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    const line = screen.getByText("Failed").closest("p") as HTMLElement;
    expect(line.dataset.receiptStatus).toBe("failed");
    expect(line.innerHTML).toContain("text-danger");
  });
});

describe("channels-v2 transcript — what it refuses to render", () => {
  it("keeps task_progress prose, which is not a lifecycle kind", () => {
    renderRows(
      channelRows(
        [message({ id: "p", seq: 1, kind: "task_progress", body: "PROGRESS" })],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    // `task_progress` is prose an agent wrote — it stays.
    expect(screen.getByText("PROGRESS")).not.toBeNull();
  });

  it("tints a roster-resolved @mention and leaves unresolvable ones as prose", () => {
    renderRows(
      channelRows(
        [message({ id: "m", body: "@Diana ping, and @nobody too" })],
        [],
        INDEX,
        formatChannelTimestamp
      )
    );
    expect(screen.getByText("@Diana").className).toContain("text-link");
    expect(screen.getByText("@nobody").className).not.toContain("text-link");
  });

  /**
   * THE SELF-TINT IS DRIVEN BY THE SERVER STAMP, NOT BY A RE-PARSE (Phase 6).
   * `metadata.mentionedUserIds` is the same fact the Tags inbox lists, so the
   * two surfaces cannot disagree about whether a message tagged you. A body
   * that names you WITHOUT the stamp — a row written before the stamp existed,
   * or a name that resolved to somebody else on the day it was posted — tints
   * as an ordinary mention and stays out of the inbox, consistently.
   */
  it("tints a mention OF ME only when the server stamp names me", () => {
    // A roster where "@Sam" is unambiguous, so the TOKEN resolves in both rows
    // and the only difference left is the stamp. (The shared `MEMBERS` above
    // give both people the fixture's default email, whose local part `sam`
    // collides — and an ambiguous handle resolves to nobody, by design.)
    const index = indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang", email: "sam@example.com" }),
        member({
          userId: PEER,
          displayName: "Diana Taylor",
          email: "diana@example.com",
        }),
      ],
      ME
    );
    renderRows(
      channelRows(
        [
          message({
            id: "stamped",
            body: "@Sam STAMPED",
            authorUserId: PEER,
            metadata: { mentionedUserIds: [ME] },
          }),
          message({
            id: "bare",
            seq: 2,
            body: "@Sam BARE",
            authorUserId: PEER,
            metadata: {},
          }),
        ],
        [],
        index,
        formatChannelTimestamp
      ),
      new Set(),
      index
    );
    const [stamped, bare] = screen.getAllByText("@Sam");
    expect(stamped.className).toContain("text-link");
    expect(stamped.className).toContain("bg-link/10");
    // Resolved, so tinted as a mention — but NOT as a mention of me.
    expect(bare.className).toContain("text-link");
    expect(bare.className).not.toContain("bg-link/10");
  });
});

/**
 * THE REQUEST FAN-OUT, as the transcript sees it: N opening messages sharing one
 * server-stamped `fanoutGroup` are ONE card with N addressee pills.
 *
 * ⚠ Mutation-verify by keying the dedupe on `thread.id` instead of the group —
 * "one card" goes red and three identical posts appear.
 */
describe("channels-v2 transcript — the request fan-out", () => {
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
      metadata: { taskId: "t-a", fanoutGroup: GROUP },
    }),
    message({
      id: "op-b",
      seq: 2,
      body: "START-HERE",
      metadata: { taskId: "t-b", fanoutGroup: GROUP },
    }),
  ];

  function renderFanOut(requested: ReadonlySet<string> = new Set()) {
    const onOpenThread = vi.fn();
    render(
      <Transcript
        rows={channelRows(OPENERS, THREADS, FANOUT_INDEX, formatChannelTimestamp)}
        index={FANOUT_INDEX}
        flashId={null}
        requested={requested}
        onOpenThread={onOpenThread}
      />
    );
    return { onOpenThread };
  }

  it("draws ONE card for two threads, with a pill per ADDRESSEE", () => {
    renderFanOut();
    expect(screen.getAllByText("Agent thread")).toHaveLength(1);
    expect(screen.getAllByText("START-HERE")).toHaveLength(1);
    // Each pill is that thread's own `targetUserId` — never the requester.
    expect(screen.getByText("Diana T.")).not.toBeNull();
    expect(screen.getByText("Ada L.")).not.toBeNull();
    expect(screen.queryByText("you")).toBeNull();
  });

  it("states NO approval on the pills — no projection says who allowed", () => {
    renderFanOut();
    // ⚠ `AddresseePill` renders an SR-only verdict when `approved` is passed at
    // all. Nothing may pass it here (F-206): "no pending row" would report
    // never-asked as approved.
    expect(screen.queryByText(/approved/)).toBeNull();
    expect(screen.queryByText(/awaiting approval/)).toBeNull();
  });

  it("shows REQUESTED only when the VIEWER's own consent is pending", () => {
    renderFanOut();
    expect(screen.queryByText("Requested")).toBeNull();
    cleanup();
    renderFanOut(new Set(["t-b"]));
    expect(screen.getByText("Requested")).not.toBeNull();
  });

  it("opens the viewer's OWN thread of the group", () => {
    const { onOpenThread } = renderFanOut();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    // ME created both, so the first is theirs — the point is that it names a
    // THREAD id from the group, not the card's message id.
    expect(onOpenThread).toHaveBeenCalledWith("t-a");
  });
});
