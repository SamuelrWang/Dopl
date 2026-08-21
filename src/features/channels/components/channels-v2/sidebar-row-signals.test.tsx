// @vitest-environment jsdom
/**
 * WHAT A SIDEBAR CHANNEL ROW CARRIES AND DOES — the thread disclosure and the
 * ask signal, both Samuel's, both 2026-08-20.
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
 * to "active in the last 24h OR requested". That window is bounded but not SMALL
 * — a busy DM puts eight rows under one channel and pushes every other channel
 * below the fold, in the one column that has to stay scannable. ⚠ The window is
 * the RIGHT rule and is untouched; the fix is a disclosure, not a narrower
 * window, because narrowing it would hide threads the operator is being ASKED
 * about — which is exactly what the ask signal below is for.
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
    requestedThreads: new Set<string>(),
    consentCount: 0,
    inboxOpen: false,
    onOpenInbox: vi.fn(),
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
 * THE ASK SIGNAL (Samuel's ruling, 2026-08-20: option (a), a per-channel count).
 *
 * ⚠ THE WHOLE POINT IS THE CHANNEL YOU ARE NOT LOOKING AT. Every other
 * consent-derived signal in this column is scoped to the OPEN channel (the Clock
 * glyph needs the loaded transcript to know which thread an ask is about); this
 * one rides a workspace-wide read so a DM three rows down can say somebody is
 * waiting on you.
 */
describe("the sidebar's ask signal", () => {
  const asks = (m: Record<string, number>) =>
    new Map(Object.entries(m)) as ReadonlyMap<string, number>;

  it("badges a channel with pending asks, with the count", () => {
    renderSidebar({ pendingAsks: asks({ "ch-web": 3 }) });
    expect(screen.getByLabelText("3 awaiting your answer in Website")).toBeTruthy();
  });

  // ⚠ THE FEATURE, stated as a test: it must work for a channel that is NOT open.
  it("badges a channel the operator is not looking at", () => {
    renderSidebar({ selectedChannelId: "ch-web", pendingAsks: asks({ "ch-fe": 1 }) });
    expect(screen.getByLabelText("1 awaiting your answer in Front-end")).toBeTruthy();
  });

  it("badges a DM the same way — the signal is per row, not per section", () => {
    renderSidebar({ pendingAsks: asks({ "ch-dm": 2 }) });
    expect(
      screen.getByLabelText("2 awaiting your answer in Diana Taylor")
    ).toBeTruthy();
  });

  it("shows NO badge on a channel with nothing waiting", () => {
    renderSidebar({ pendingAsks: asks({ "ch-web": 1 }) });
    expect(screen.queryByLabelText(/awaiting your answer in Front-end/)).toBeNull();
  });

  it("shows no badge at all when nothing is pending anywhere", () => {
    renderSidebar({ pendingAsks: asks({}) });
    expect(screen.queryByLabelText(/awaiting your answer/)).toBeNull();
  });

  // ⚠ THE INTERACTION WITH THE DISCLOSURE, and the case it matters most in: a
  // retracted branch hides the THREADS, and the ask badge is on the CHANNEL row.
  it("survives collapsing the branch — the badge is not one of the hidden rows", () => {
    renderSidebar({
      threads: [thread({ id: "t-1", title: "UI-kit design" })],
      pendingAsks: asks({ "ch-web": 2 }),
    });
    fireEvent.click(screen.getByRole("button", { name: /^Hide threads in Website$/ }));
    expect(screen.queryByRole("button", { name: "UI-kit design" })).toBeNull();
    expect(screen.getByLabelText("2 awaiting your answer in Website")).toBeTruthy();
  });

  // The two are different facts and a channel can legitimately have both: the
  // dot is "something newer than your lastReadAt", the badge is "answer me".
  it("coexists with the unread dot rather than replacing it", () => {
    renderSidebar({ pendingAsks: asks({ "ch-fe": 1 }) });
    expect(screen.getByLabelText("1 awaiting your answer in Front-end")).toBeTruthy();
    expect(screen.getAllByLabelText("Unread messages").length).toBeGreaterThan(0);
  });

  it("renders nothing when the prop is absent — the sidebar has no second read", () => {
    renderSidebar();
    expect(screen.queryByLabelText(/awaiting your answer/)).toBeNull();
  });
});
