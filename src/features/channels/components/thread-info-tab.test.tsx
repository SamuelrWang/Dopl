// @vitest-environment jsdom
/**
 * THE INFO TAB WHILE A THREAD IS OPEN (Samuel, 2026-08-21).
 *
 * The properties pinned here are the ones that would fail QUIETLY — a panel that
 * renders something plausible instead of nothing:
 *
 *  - **BOTH SIDES OF THE EXCHANGE ARE NAMED, AND AN UNRESOLVED ONE IS SAID.** A
 *    thread has exactly two parties (INVARIANTS §5); a party who left the
 *    workspace has no roster row, and a uuid is not a name.
 *  - **A THREAD WITH NO ADDRESSEE IS A REAL ROW.** `targetUserId` is nullable, and
 *    it must read as an absent addressee rather than as a member who could not be
 *    found — two different facts.
 *  - **"COULD NOT ASK" IS NOT "NOTHING IS RUNNING."** `null` sessions (a plain
 *    browser, or a main without the feed) must not render as "No agents on this
 *    thread", and must carry no count (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *  - **AGENTS RENDER BY ID.** The stone-name pool is being deleted; several of one
 *    operator's agents now sit on one thread, and the id is the only thing that
 *    tells them apart.
 *  - **NO THREAD-CLOSING VOCABULARY.** A thread has no finished state anywhere in
 *    the product, so this panel has no Status row to fill.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatDate } from "@/shared/lib/format-time";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { CREATED_ROW_LABEL } from "../lib/channel-display";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { ThreadInfoTab } from "./thread-info-tab";
import { CHANNEL_ID, ME, PEER, member, thread } from "./test-fixtures";

afterEach(cleanup);

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang", email: "sam@example.com" }),
  member({
    userId: PEER,
    role: "member",
    displayName: "Diana Taylor",
    email: "diana@example.com",
  }),
];

/**
 * ⚠ WIDENED LOCALLY WITH `agentId`. The field is main's, and
 * `spa-bridge.ts › DesktopSessionSummary` is the DESKTOP's declaration to widen —
 * `agents-model.ts › agentDisplayId` reads it optionally for exactly that reason.
 * The fixture models both live shapes: with an id, and without.
 */
type Summary = DesktopSessionSummary & { agentId?: string };

function summary(over: Partial<Summary> = {}): Summary {
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

function peer(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: PEER,
    channelId: CHANNEL_ID,
    threadId: "t-1",
    name: "onyx",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    // ⚠ FRESH BY DEFAULT — a convenience since 2026-08-22, not a requirement:
    // `peerCardsFor` no longer ages a row out (Samuel: the card stays until the
    // session goes away). The stamp only decides the card's INK now.
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function renderTab(
  over: Partial<React.ComponentProps<typeof ThreadInfoTab>> = {}
) {
  render(
    <ThreadInfoTab
      thread={thread()}
      members={MEMBERS}
      currentUserId={ME}
      agentSessions={[]}
      peerSessions={[]}
      {...over}
    />
  );
}

describe("the thread's own facts", () => {
  it("states the title, the mode and the creation date", () => {
    renderTab();
    expect(screen.getByText("UI-kit design")).toBeTruthy();
    expect(screen.getByText("Interactive")).toBeTruthy();
    expect(screen.getByText("Aug 17, 2026")).toBeTruthy();
  });

  /**
   * ⚠ **THE CREATED ROW IS SPELLED AND FORMATTED LIKE THE CHANNEL BODIES'**
   * (Samuel, 2026-09-17, extending R-20 on F-722's ask). It said "Date of
   * creation" + `formatShortDate` here while the two channel bodies said
   * "Created" + `formatDate` — one selection away in the same column. Pinned on
   * BOTH halves because either one drifting back is the same defect: the LABEL
   * comes from `channel-display.ts › CREATED_ROW_LABEL` (a second literal is how
   * the first divergence happened) and the FORMATTER keeps the YEAR, which on a
   * creation date is the component that matters.
   */
  it("🔒 reads CREATED_ROW_LABEL and keeps the year", () => {
    renderTab();
    expect(screen.getByText(CREATED_ROW_LABEL)).toBeTruthy();
    expect(screen.queryByText("Date of creation")).toBeNull();
    // `formatShortDate`'s face — the year dropped — must not be what renders.
    expect(screen.queryByText("Aug 17")).toBeNull();
    expect(screen.getByText(formatDate(thread().createdAt))).toBeTruthy();
  });

  it("says AUTONOMOUS for an autonomous thread", () => {
    renderTab({ thread: thread({ mode: "autonomous" }) });
    expect(screen.getByText("Autonomous")).toBeTruthy();
    expect(screen.queryByText("Interactive")).toBeNull();
  });

  // ⚠ `channel_tasks.status` is legacy and unread (types.ts › ThreadStatus).
  // A Status row here would have to invent a state the product removed.
  it("carries no thread-closing vocabulary at all", () => {
    const { container } = render(
      <ThreadInfoTab
        thread={thread({ status: "closed", outcome: "completed" })}
        members={MEMBERS}
        currentUserId={ME}
        agentSessions={[]}
      />
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["closed", "reopen", "completed", "archived", "outcome"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("the two parties", () => {
  it("names the opener and the addressee, and says which is which", () => {
    renderTab();
    expect(screen.getByText("Sam Wang")).toBeTruthy();
    expect(screen.getByText("Diana Taylor")).toBeTruthy();
    expect(screen.getByText("Opened by")).toBeTruthy();
    expect(screen.getByText("Addressed to")).toBeTruthy();
  });

  it("states an ABSENT addressee rather than a missing member", () => {
    renderTab({ thread: thread({ targetUserId: null }) });
    expect(screen.getByText("No addressee")).toBeTruthy();
    expect(screen.queryByText("Not in this channel")).toBeNull();
  });

  it("renders a party who is not on the roster as unknown, never as a uuid", () => {
    renderTab({ thread: thread({ targetUserId: "u-gone" }) });
    expect(screen.getByText("Not in this channel")).toBeTruthy();
    expect(screen.queryByText(/u-gone/)).toBeNull();
  });
});

describe("the agents on this thread", () => {
  it("lists SEVERAL of my own agents on one thread, each by its own NAME", () => {
    // ⚠ **IT ASSERTED `#<id>` UNTIL 2026-09-15 AND THAT WAS THE LEAK, NOT THE FIX.** The case
    // was written on 2026-08-27 against INVARIANTS §11 ("the raw agent id is never
    // user-visible") and satisfied it with `#a1b2c3d4` — the raw id with a `#` glued on, which
    // that row then defended as "a NAME the operator accepted at launch". Samuel withdrew the
    // carve-out on 2026-09-15: *"I want to make it so that the user really doesnt see it"*.
    // ⚠ **SO THE AGENTS ARE NAMED, WHICH IS WHAT THE PRODUCT NOW DOES AT LAUNCH** — a human
    // launch submitted blank is named `New Agent`, and an agent launching an agent must supply
    // one. The multiplayer property this case exists for is unchanged: two sessions on one
    // thread, two distinct rows. What tells them apart is a name rather than a machine token.
    renderTab({
      agentSessions: [
        summary({ sessionId: "s-1", agentId: "a1b2c3d4", displayName: "Scout" }),
        summary({ sessionId: "s-2", agentId: "e5f6g7h8", displayName: "Rover" }),
      ],
    });
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.getByText("Rover")).toBeTruthy();
    // ⚠ AND THE ID IS NOWHERE, IN EITHER SPELLING — bare, or with the `#` this tab used to wear.
    expect(screen.queryByText("a1b2c3d4")).toBeNull();
    expect(screen.queryByText("#a1b2c3d4")).toBeNull();
    expect(screen.queryByText("e5f6g7h8")).toBeNull();
  });

  it("narrows to THIS thread — an agent on another one is not here", () => {
    renderTab({ agentSessions: [summary({ taskId: "t-other", name: "quartz" })] });
    expect(screen.queryByText("quartz")).toBeNull();
    expect(screen.getByText("No agents on this thread.")).toBeTruthy();
  });

  it("shows a live peer's agent beside mine", () => {
    renderTab({ agentSessions: [summary()], peerSessions: [peer()] });
    expect(screen.getByText("flint")).toBeTruthy();
    expect(screen.getByText("onyx")).toBeTruthy();
    expect(screen.getByText("Diana Taylor's")).toBeTruthy();
  });

  it("says nothing is running when the desktop answered with an empty feed", () => {
    renderTab({ agentSessions: [] });
    expect(screen.getByText("No agents on this thread.")).toBeTruthy();
    expect(screen.queryByText(/desktop app/i)).toBeNull();
  });

  it("says it COULD NOT ASK when there is no feed — never 'no agents'", () => {
    renderTab({ agentSessions: null });
    expect(screen.getByText(/desktop app/i)).toBeTruthy();
    expect(screen.queryByText("No agents on this thread.")).toBeNull();
    // ⚠ And no count beside the heading: a `0` there is a claim about the
    // operator's own machine that this surface cannot make.
    expect(screen.queryByText("0")).toBeNull();
  });
});
