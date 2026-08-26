// @vitest-environment jsdom
/**
 * WHAT A SIDEBAR CHANNEL ROW CARRIES AND DOES — the thread disclosure (Samuel,
 * 2026-08-20).
 *
 * ⚠ THE ASK SIGNAL SUITE STOOD HERE AND IS DELETED (Samuel, 2026-08-22). The
 * per-channel count badge went with the inbound consent lane it counted, and so
 * did the `Clock` thread glyph beside it: there is no ask to answer, so there is
 * no number that could be true. Do not restore either suite without restoring
 * the lane. What survives is the pinned ABSENCE below — the one assertion that
 * catches a reintroduction.
 *
 * ⚠ ITS OWN FILE because `sidebar.test.tsx` sits within a few lines of the
 * 500-line cap — the same seam `session-summary-shape.test.mjs` was taken on,
 * and the same reason: letting a line cap decide what a suite may assert is
 * backwards. That file keeps the column's STRUCTURE (sections, selection,
 * favourites, filtering); this one keeps what an individual ROW does, which is
 * where both of these live and where they interact.
 *
 * THE DISCLOSURE'S PROBLEM, stated so a future reader does not "simplify" it
 * away: the rows nested under a channel are the OPEN channel's threads, windowed
 * to "active in the last 24h" (the "OR requested" arm left with the ask signal).
 * That window is bounded but not SMALL — a busy DM puts eight rows under one
 * channel and pushes every other channel below the fold, in the one column that
 * has to stay scannable. ⚠ The window is the RIGHT rule and is untouched; the fix
 * is a disclosure, not a narrower window.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsV2Sidebar } from "./sidebar";
import { ME, PEER, channel, member, thread } from "./test-fixtures";

afterEach(cleanup);

const ROOMS = [
  channel({ id: "ch-web", name: "Website" }),
  channel({ id: "ch-fe", name: "Front-end", unread: true }),
];
const DIRECT = [
  channel({
    id: "ch-dm",
    isDirect: true,
    name: "dm",
    directPeer: { userId: PEER, displayName: "Diana Taylor", avatarUrl: null },
  }),
];

function renderSidebar(over: Partial<React.ComponentProps<typeof ChannelsV2Sidebar>> = {}) {
  const props: React.ComponentProps<typeof ChannelsV2Sidebar> = {
    rooms: ROOMS,
    direct: DIRECT,
    threads: [],
    members: [member(), member({ userId: PEER, displayName: "Diana Taylor" })],
    currentUserId: ME,
    selectedChannelId: "ch-web",
    openThreadId: null,
    onSelectChannel: vi.fn(),
    onOpenThread: vi.fn(),
    canCreate: true,
    onCreateChannel: vi.fn(),
    onCreateDirect: vi.fn(),
    ...over,
  };
  render(<ChannelsV2Sidebar {...props} />);
  return props;
}

const row = (name: string) => screen.getByRole("button", { name });

describe("the sidebar's thread disclosure", () => {
  const MANY = [
    thread({ id: "t-1", title: "UI-kit design" }),
    thread({ id: "t-2", title: "Billing copy" }),
    thread({ id: "t-3", title: "Release notes" }),
  ];
  const toggle = (name: RegExp) => screen.getByRole("button", { name });

  it("defaults EXPANDED — the nesting has to be discoverable", () => {
    renderSidebar({ threads: MANY });
    for (const t of MANY) expect(screen.getByRole("button", { name: t.title })).toBeTruthy();
    expect(toggle(/^Hide threads in Website$/).getAttribute("aria-expanded")).toBe("true");
  });

  it("retracts the threads and leaves the channel row standing", () => {
    renderSidebar({ threads: MANY });
    fireEvent.click(toggle(/^Hide threads in Website$/));
    for (const t of MANY) {
      expect(screen.queryByRole("button", { name: t.title })).toBeNull();
    }
    // ⚠ The point of the feature: the channel is still there to click.
    expect(row("Website")).toBeTruthy();
    expect(row("Front-end")).toBeTruthy();
  });

  it("says how many are hidden, so the count is not lost with the rows", () => {
    renderSidebar({ threads: MANY });
    fireEvent.click(toggle(/^Hide threads in Website$/));
    expect(toggle(/^Show 3 threads in Website$/).getAttribute("aria-expanded")).toBe("false");
  });

  it("expands again", () => {
    renderSidebar({ threads: MANY });
    fireEvent.click(toggle(/^Hide threads in Website$/));
    fireEvent.click(toggle(/^Show 3 threads in Website$/));
    expect(screen.getByRole("button", { name: "UI-kit design" })).toBeTruthy();
  });

  // ⚠ THE TOGGLE IS A SIBLING OF THE ROW, NOT A CHILD. Nesting it would be a
  // button inside a button — invalid HTML, and one target for two actions.
  it("does NOT select the channel when the disclosure is clicked", () => {
    const props = renderSidebar({ threads: MANY });
    fireEvent.click(toggle(/^Hide threads in Website$/));
    expect(props.onSelectChannel).not.toHaveBeenCalled();
  });

  it("still selects the channel when the ROW itself is clicked", () => {
    const props = renderSidebar({ threads: MANY });
    fireEvent.click(row("Website"));
    expect(props.onSelectChannel).toHaveBeenCalledWith("ch-web");
  });

  // A control that toggles nothing is furniture, in the one column that has to
  // stay scannable.
  it("offers no disclosure on a channel with no threads under it", () => {
    renderSidebar({ threads: [] });
    expect(screen.queryByRole("button", { name: /threads in Website/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /threads in Front-end/ })).toBeNull();
  });

  it("is per channel — collapsing the open one says nothing about any other", () => {
    // Only the OPEN channel nests threads today, so the state is keyed by id
    // rather than held as one boolean: the day a second branch nests, one flag
    // would retract both.
    renderSidebar({ threads: MANY });
    fireEvent.click(toggle(/^Hide threads in Website$/));
    expect(screen.queryByRole("button", { name: /threads in Front-end/ })).toBeNull();
    expect(row("Front-end")).toBeTruthy();
  });
});

/**
 * THE ASK SIGNAL AND THE CLOCK GLYPH ARE GONE — pinned as an ABSENCE (Samuel,
 * 2026-08-22).
 *
 * ⚠ A DELETED SIGNAL NEEDS A TEST MORE THAN A LIVE ONE DOES, because nothing
 * else fails when it comes back: `askCount` and `requested` were optional props,
 * so re-adding either would compile, render and go unnoticed until an operator
 * saw a channel telling them to approve something no surface can approve.
 */
describe("the sidebar carries no approval signal", () => {
  it("badges no channel with an ask count", () => {
    renderSidebar({ threads: [thread({ id: "t-1", title: "UI-kit design" })] });
    expect(screen.queryByLabelText(/awaiting your answer/)).toBeNull();
  });

  it("puts no Clock and no approval wording on a thread row", () => {
    renderSidebar({ threads: [thread({ id: "t-1", title: "UI-kit design" })] });
    expect(screen.queryByRole("button", { name: /awaiting your approval/ })).toBeNull();
    // The row is named by its title alone — one glyph, no state to switch on.
    expect(screen.getByRole("button", { name: "UI-kit design" })).toBeTruthy();
  });

  /** The unread dot is a DIFFERENT fact and it survives: "something here is
   *  newer than your `lastReadAt`" was never about approving anything. */
  it("keeps the unread dot", () => {
    renderSidebar();
    expect(screen.getAllByLabelText("Unread messages").length).toBeGreaterThan(0);
  });
});
