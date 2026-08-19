// @vitest-environment jsdom
/**
 * The Tags mentions inbox, NOW WIRED (Phase 6). Its interaction has three
 * moving parts — mark-read, navigate, scroll — and this is where they are
 * pinned.
 *
 * ⚠ WHAT CHANGED FROM THE FIXTURE ERA: the rows are the real
 * `ChannelMention` projection and the read-state comes from each row's own
 * `read` flag rather than from a page-level `Set`, so the badge is now
 * arithmetic over the SAME list the panel renders. That is the assertion the
 * first two cases exist for — a badge derived a second way is free to disagree
 * with the list above it.
 *
 * ⚠ The mark-read WRITE is not driven here. It is a mutation with an optimistic
 * cache patch (`hooks/use-mention-writes.ts`), and what this file owns is the
 * SIGNAL the inbox emits: the mention that was clicked, carrying the message id
 * and the thread id the page turns into a navigate + a nonced scroll.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { InfoTab } from "./info-tab";
import { MENTIONS_CLIPPED_NOTE } from "./mentions-list";
import { indexMembers } from "./view-model";
import { channel, member, mention, ME, PEER } from "./test-fixtures";
import type { ChannelMention } from "../../types";

afterEach(cleanup);

const ROWS: ChannelMention[] = [
  mention({ messageId: "m-9", seq: 9, snippet: "first unread" }),
  mention({ messageId: "m-8", seq: 8, snippet: "second unread", threadId: "t-1" }),
  // Already read — stays in the list, unmarked, so the inbox is a record and
  // not just a to-do pile.
  mention({ messageId: "m-3", seq: 3, snippet: "already read", read: true }),
];

const UNREAD_AT_MOUNT = ROWS.filter((m) => !m.read).length;

const MEMBERS = [
  member({ userId: ME }),
  member({ userId: PEER, displayName: "Diana Taylor", email: "diana@example.com" }),
];

/**
 * The read-state lives in the PROJECTION in the product, and the mark-read
 * write patches it in the query cache. The harness stands in for that patch
 * with the same shape — flip `read` on the clicked row — so what is asserted is
 * the tab's behaviour over a projection and not a stub's.
 */
function Harness({
  onOpen,
  truncated = false,
  rows = ROWS,
}: {
  onOpen: (m: ChannelMention) => void;
  truncated?: boolean;
  rows?: ChannelMention[];
}) {
  const [mentions, setMentions] = useState(rows);
  const markRead = (ids: string[]) =>
    setMentions((prev) =>
      prev.map((m) => (ids.includes(m.messageId) ? { ...m, read: true } : m))
    );
  return (
    <InfoTab
      channel={channel()}
      channelName="Website"
      members={MEMBERS}
      threadCount={2}
      mentions={mentions}
      mentionsTruncated={truncated}
      mentionsLoading={false}
      index={indexMembers(MEMBERS, ME)}
      onOpenMention={(m) => {
        markRead([m.messageId]);
        onOpen(m);
      }}
      onMarkAllMentionsRead={() =>
        markRead(mentions.filter((m) => !m.read).map((m) => m.messageId))
      }
    />
  );
}

function open(props: { truncated?: boolean; rows?: ChannelMention[] } = {}) {
  const onOpen = vi.fn();
  render(<Harness {...props} onOpen={onOpen} />);
  const tagsRow = screen.getByRole("button", { name: /^Tags/ });
  fireEvent.click(tagsRow);
  return { tagsRow, onOpen };
}

describe("channels-v2 mentions inbox", () => {
  it("shows the live unread count and every mention behind the disclosure", () => {
    const { tagsRow } = open();
    expect(tagsRow.getAttribute("aria-expanded")).toBe("true");
    expect(tagsRow.textContent).toContain(String(UNREAD_AT_MOUNT));
    for (const row of ROWS) {
      expect(screen.getByText(row.snippet)).not.toBeNull();
    }
  });

  it("the disclosure closes again", () => {
    const { tagsRow } = open();
    fireEvent.click(tagsRow);
    expect(tagsRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(ROWS[0].snippet)).toBeNull();
  });

  it("a click marks the item read, decrements the badge and emits the navigate + scroll signal", () => {
    const { tagsRow, onOpen } = open();
    const item = screen
      .getByText(ROWS[1].snippet)
      .closest("button") as HTMLElement;
    expect(item.hasAttribute("data-unread")).toBe(true);

    fireEvent.click(item);

    expect(onOpen).toHaveBeenCalledTimes(1);
    // The two fields the page turns into a navigate and a nonced scroll.
    expect(onOpen.mock.calls[0][0]).toMatchObject({
      messageId: ROWS[1].messageId,
      threadId: ROWS[1].threadId,
    });
    // Read: item unmarked, badge decremented. The row STAYS listed — the inbox
    // is a record, not a to-do pile.
    expect(item.hasAttribute("data-unread")).toBe(false);
    expect(screen.getByText(ROWS[1].snippet)).not.toBeNull();
    expect(tagsRow.textContent).toContain(String(UNREAD_AT_MOUNT - 1));
  });

  it("mark-all zeroes the badge and then hides itself", () => {
    const { tagsRow } = open();
    const panel = within(screen.getByRole("button", { name: /^Tags/ }).parentElement!);
    fireEvent.click(panel.getByRole("button", { name: "Mark all read" }));
    expect(tagsRow.textContent).toMatch(/^Tags0$/);
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  /**
   * INVARIANTS §9: the read is bounded and a page AT the ceiling counts as
   * clipped, so the surface that LISTS it must say so. The note may not let a
   * clip pass as an absence.
   */
  it("says so when the page clipped, and stays silent when it did not", () => {
    open({ truncated: true });
    expect(screen.getByText(MENTIONS_CLIPPED_NOTE)).not.toBeNull();
    cleanup();
    open();
    expect(screen.queryByText(MENTIONS_CLIPPED_NOTE)).toBeNull();
  });

  /**
   * ⚠ THE CLIP NOTE MAY NOT OVER-ASSERT EITHER. It used to say "there are more
   * than one page", which this read never established: a page AT the ceiling
   * counts as clipped precisely because a full page and an exhausted one are
   * indistinguishable from here (INVARIANTS §9).
   */
  it("the clipped note claims nothing about what is NOT shown", () => {
    open({ truncated: true });
    const note = screen.getByText(MENTIONS_CLIPPED_NOTE);
    expect(note.textContent).not.toMatch(/more than one page/i);
    expect(note.textContent).not.toMatch(/there are more/i);
  });

  /**
   * ⚠ A ROW ALWAYS NAMES ITS AUTHOR. `view-model.ts › shortName` used to answer
   * "" for an author the roster and the projection can both only describe as
   * blank — and `""` is not nullish, so its own "Member" fallback never fired.
   * The row then rendered a dot, an avatar and no name at all.
   */
  it("names an author with nothing to name them by rather than rendering a gap", () => {
    const anonymous = mention({
      messageId: "m-anon",
      authorUserId: "u-ghost",
      authorName: null,
      snippet: "no name anywhere",
    });
    open({ rows: [anonymous] });
    const item = screen.getByText("no name anywhere").closest("button")!;
    expect(within(item).getByText("Member")).not.toBeNull();
  });

  it("an empty inbox says nothing tags you rather than rendering a clipped note", () => {
    open({ rows: [] });
    expect(
      screen.getByText("No messages tag you in this channel yet.")
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });
});
