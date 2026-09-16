// @vitest-environment jsdom
/**
 * The MENTIONS inbox (the row read "Tags" until Samuel renamed it 2026-09-15 —
 * `mentions-disclosure.tsx` carries that ruling), NOW WIRED (Phase 6). Its interaction has three
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
import { agentPillLabel } from "./mentions-list";
import { indexMembers } from "./view-model";
import { channel, member, mention, ME, PEER } from "./test-fixtures";
import type { ChannelMention } from "../types";

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
  const tagsRow = screen.getByRole("button", { name: /^Mentions/ });
  fireEvent.click(tagsRow);
  return { tagsRow, onOpen };
}

describe("channels mentions inbox", () => {
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

  it("has NO mark-all button — a row is marked read by opening it", () => {
    // ⚠ DELETED 2026-09-15 (Samuel, item 7). This case pinned the bulk button's
    // whole behaviour: it zeroed the badge, sent only the unread ids, and hid
    // itself. Rewritten to pin the DELETION, because the WRITE path is untouched —
    // `use-mention-writes.ts › markRead` still fires on a row's own click — and a
    // future reader should see that the button went deliberately.
    open({ rows: [mention(), mention({ messageId: "m-2" })] });
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  /**
   * ⚠ **THE CLIP EXPLAINER IS DELETED (Samuel, 2026-09-15) AND THESE TWO CASES ARE
   * REWRITTEN INTO ONE.** They pinned that a clipped page SAYS so, and that the
   * sentence never over-asserts what is below the cut — careful rules about a
   * paragraph the list no longer draws, now that it scrolls.
   * ⚠ WHAT SURVIVES IS THE HALF THAT IS STILL TRUE: the BOUND is real and
   * `truncated` still crosses the wire (INVARIANTS §9). Deleting the copy must not
   * quietly delete the fact, so this asserts the prop is still accepted and that
   * NOTHING is rendered for it — which is what makes the deletion visible to the
   * next reader instead of looking like the feature was never there.
   */
  it("renders no clip explainer, clipped or not — the bound stayed, the paragraph went", () => {
    open({ truncated: true });
    expect(screen.queryByText(/Showing your most recent tags/i)).toBeNull();
    expect(screen.queryByText(/Nothing here was dismissed/i)).toBeNull();
    expect(screen.queryByText(/below the cut/i)).toBeNull();
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

/**
 * THE ROW'S SHAPE (Samuel, 2026-09-15, three rulings in one pass): no avatar,
 * the agent's NAME in the black pill, and the channel name on the last line.
 */
describe("the mention row", () => {
  it("carries NO avatar — every row tagged the same one person", () => {
    // The face was a constant repeated fifty times down a 380px panel. The name
    // still identifies the author and the transcript one click away has the face.
    // ⚠ The row's accessible name comes from `shortName`, which is the ROSTER's
    // label for the author — `mention.authorName` is only the fallback for an
    // author who has left. PEER is in `MEMBERS`, so query on what is rendered.
    open({ rows: [mention()] });
    const row = screen.getByRole("button", { name: /unread mention/ });
    expect(row.querySelector("img")).toBeNull();
    // ⚠ NOT just `<img>`: the kit's Avatar falls back to an initials SPAN when
    // there is no url, so a check for the image alone would pass on a row that
    // still draws a face.
    expect(row.querySelector("[data-avatar]")).toBeNull();
  });

  it("names the AGENT in the pill, not the noun", () => {
    open({
      rows: [
        mention({
          authorKind: "agent",
          authorAgentId: "deynelz3",
          authorAgentName: "Bug reviewer",
        }),
      ],
    });
    expect(screen.getByText("Bug reviewer")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
  });

  it("falls back name -> #id -> the bare noun, and never renders a blank pill", () => {
    // The same ladder the transcript's pill walks. `null` is CANNOT SAY, which is
    // the common case on older rows — it is not "not an agent".
    expect(
      agentPillLabel(mention({ authorAgentName: "Bug reviewer", authorAgentId: "deynelz3" }))
    ).toBe("Bug reviewer");
    expect(agentPillLabel(mention({ authorAgentName: null, authorAgentId: "deynelz3" }))).toBe(
      "#deynelz3"
    );
    expect(agentPillLabel(mention({ authorAgentName: null, authorAgentId: null }))).toBe("Agent");
    // A name that is only whitespace is not a name.
    expect(agentPillLabel(mention({ authorAgentName: "   ", authorAgentId: "deynelz3" }))).toBe(
      "#deynelz3"
    );
  });

  it("wears the SAME black face as the Agents-tab ended pill", () => {
    // One recipe, two meanings (`agent-bits.tsx › AgentPill`). Pinned by the
    // token, not by a hex: a second hand-rolled pill is what this prevents.
    open({
      rows: [
        mention({ authorKind: "agent", authorAgentId: "deynelz3", authorAgentName: "Prober" }),
      ],
    });
    const pill = screen.getByText("Prober");
    expect(pill.className).toContain("bg-surface-cta");
    expect(pill.className).toContain("text-text-on-cta");
  });

  it("puts the channel name RIGHT OF THE PILL on line 1, not on a line of its own", () => {
    // ⚠ SUPERSEDED THE SAME DAY (round 3). This case pinned the channel name on the
    // row's LAST line, under the snippet; Samuel moved both the pill and the channel
    // up into line 1. Rewritten rather than deleted so the earlier shape is on the
    // record — and it still asserts ORDER, which is the part that can regress.
    open({ rows: [mention({ authorKind: "agent", authorAgentName: "Prober" })] });
    const pill = screen.getByText("Prober");
    const channel = screen.getByText(/in # /);
    const snippet = screen.getByText(/can you take a look at this/);
    const follows = (a: HTMLElement, b: HTMLElement) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(pill, channel)).toBeTruthy();
    // ...and BOTH are above the snippet now, which is what "line 1" means here.
    expect(follows(channel, snippet)).toBeTruthy();
    expect(pill.parentElement).toBe(channel.parentElement);
  });

  it("drops \"You\" for an agent row, and keeps a PERSON's name", () => {
    // An agent posts under its operator's user id, so `shortName` answered "You"
    // for every agent row in the viewer's own channels — true about the account and
    // useless about which agent. ⚠ The swap is keyed on `authorKind`: a peer who
    // tags you is still named, because a pill would lose the only thing identifying
    // them.
    open({ rows: [mention({ authorKind: "agent", authorAgentName: "Prober", authorUserId: ME })] });
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.getByText("Prober")).toBeTruthy();
    cleanup();
    open({ rows: [mention({ authorKind: "user" })] });
    expect(screen.getByText("Diana Taylor")).toBeTruthy();
  });

  it("wears the AGENT'S colour ON THE PILL, and no background on the row", () => {
    // ⚠ SUPERSEDED WITHIN THE HOUR by Samuel watching it live: the unread DOT and
    // the agent-tinted row background are both gone — *"no background color around
    // each mention, I actually like this better"*, *"have the black pill be in the
    // color of that agent"*. Rewritten rather than deleted so the tint experiment is
    // on the record.
    open({ rows: [mention({ authorKind: "agent", authorAgentName: "Prober", authorAgentColor: "agent-03" })] });
    const pill = screen.getByText("Prober");
    expect(pill.getAttribute("style")).toContain("--agent-color-03");
    const row = screen.getByRole("button", { name: /unread mention/ });
    expect(row.getAttribute("style")).toBeNull();
    expect(row.className).not.toContain("bg-link");
  });

  it("an UNCOLOURED agent keeps the black pill — that is a real state, not a failure", () => {
    // A room with all sixteen keys out runs the next agent uncoloured, and an ended
    // agent is deliberately uncoloured everywhere. Both get the CTA face.
    open({ rows: [mention({ authorKind: "agent", authorAgentName: "Prober", authorAgentColor: null })] });
    const pill = screen.getByText("Prober");
    expect(pill.getAttribute("style")).toBeNull();
    expect(pill.className).toContain("bg-surface-cta");
  });
});
