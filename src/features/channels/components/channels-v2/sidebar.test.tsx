// @vitest-environment jsdom
/**
 * The wired sidebar. Properties pinned here because a redesign loses them
 * quietly:
 *
 *  - channels and DMs come from the REAL channel list, split on `is_direct`;
 *  - threads nest one indent step under the OPEN channel, from the real thread
 *    read, windowed by `SIDEBAR_THREAD_ACTIVE_WINDOW_MS`;
 *  - NO unread COUNT badge — `Channel.unread` is a boolean and a count would be
 *    a number no read established;
 *  - selection MIRRORS the center pane (thread wins over its channel);
 *  - the section chevrons COLLAPSE and the search FILTERS, per Samuel's
 *    interaction-completeness ruling (2026-08-18);
 *  - FAVORITES IS REAL (2026-08-19) — a partition of the same channel list, a
 *    MOVE rather than a shortcut (the favourited channel leaves its home
 *    section), and a section that is ABSENT rather than empty.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChannelsV2Sidebar, SIDEBAR_NO_MATCHES } from "./sidebar";
import { SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import { channel, member, thread, ME, PEER } from "./test-fixtures";
import { sidebarThreads } from "./view-model-requested";

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
const THREADS = [thread({ id: "t-kit", title: "UI-kit design" })];

function renderSidebar(over: Partial<React.ComponentProps<typeof ChannelsV2Sidebar>> = {}) {
  const props: React.ComponentProps<typeof ChannelsV2Sidebar> = {
    rooms: ROOMS,
    direct: DIRECT,
    threads: THREADS,
    members: [member(), member({ userId: PEER, displayName: "Diana Taylor" })],
    currentUserId: ME,
    selectedChannelId: "ch-web",
    openThreadId: null,
    onSelectChannel: vi.fn(),
    onOpenThread: vi.fn(),
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

describe("channels-v2 sidebar", () => {
  it("renders the real channel list, the DM's resolved peer, and nests the open channel's threads", () => {
    renderSidebar();

    expect(row("Website")).not.toBeNull();
    expect(row("Front-end")).not.toBeNull();
    // A DM row is named by its resolved peer, never "Direct message".
    expect(row("Diana Taylor")).not.toBeNull();
    // The thread hangs under the OPEN channel and nowhere else.
    expect(row("UI-kit design")).not.toBeNull();
  });

  it("nests nothing under a channel that is not open — the read is per-channel", () => {
    renderSidebar({ selectedChannelId: "ch-fe" });
    // `threads` still holds the row; the tree may only show it under the
    // channel it was read for, because there is no workspace-wide thread read.
    const list = screen.getByRole("complementary", { name: "Channels" });
    expect(within(list).getByRole("button", { name: "UI-kit design" })).not.toBeNull();
    // …and it hangs under Front-end now, not Website.
    // ⚠ ASSERTED AS "after its own channel, before any other", not as an exact
    // offset (2026-08-20): the thread disclosure put a sibling button between
    // the channel row and its first thread, and an index+1 pin was measuring
    // adjacency in the DOM rather than the nesting it is about.
    // The NEAREST PRECEDING channel row is the one it hangs under — which is
    // what "nests under" means, and what an index+1 pin was standing in for.
    const rows = within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    const thread = rows.indexOf("UI-kit design");
    const parent = rows
      .slice(0, thread)
      .filter((label) => label === "Website" || label === "Front-end")
      .pop();
    expect(parent).toBe("Front-end");
  });

  it("shows an unread DOT, never a count — `Channel.unread` is a boolean", () => {
    renderSidebar();
    expect(screen.getByLabelText("Unread messages")).not.toBeNull();
    // No badge digit anywhere on the channel rows.
    expect(within(row("Front-end")).queryByText(/^\d+$/)).toBeNull();
  });

  // ⚠ THE COUNT IS OUTBOUND-ONLY since 2026-08-22 (Samuel — the inbound consent
  // retirement); the CALLER slices it. This component renders the number it is
  // handed and asserts only that a zero is not a badge.
  it("badges the Inbox row only when a real pending count exists", () => {
    renderSidebar({ consentCount: 0 });
    expect(within(row("Inbox")).queryByText("0")).toBeNull();
    cleanup();
    renderSidebar({ consentCount: 3 });
    expect(within(row("Inbox")).getByText("3")).not.toBeNull();
  });

  it("opens the inbox from the Inbox row, and the row wears the selection", () => {
    // Phase 8: the badge finally has somewhere to go — the row is a nav
    // destination for the center column, so it follows the selection rule.
    const props = renderSidebar({ consentCount: 2 });
    fireEvent.click(row("Inbox"));
    expect(props.onOpenInbox).toHaveBeenCalledTimes(1);
    expect(row("Inbox").hasAttribute("aria-current")).toBe(false);
    cleanup();
    renderSidebar({ inboxOpen: true });
    expect(row("Inbox").getAttribute("aria-current")).toBe("true");
    // …and nothing else is selected, because the pane is showing neither.
    expect(row("Website").hasAttribute("aria-current")).toBe(false);
  });

  it("selection mirrors the center pane: an open thread outranks its channel", () => {
    renderSidebar({ openThreadId: "t-kit" });
    expect(row("UI-kit design").getAttribute("aria-current")).toBe("true");
    expect(row("Website").hasAttribute("aria-current")).toBe(false);
  });

  it("leaves the channel selected when the open thread has no row in the tree", () => {
    // Aged past the sidebar window, so the tree does not show it.
    renderSidebar({ threads: [], openThreadId: "t-old" });
    expect(row("Website").getAttribute("aria-current")).toBe("true");
  });

  it("collapses a section for real", () => {
    renderSidebar();
    const header = screen.getByRole("button", { name: "Channels" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
  });

  it("filters the tree from the header search", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Filter channels"), {
      target: { value: "front" },
    });
    expect(screen.getByRole("button", { name: "Front-end" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
  });

  /**
   * ⚠ A SECTION THAT MATCHES NOTHING MUST SAY SO. The empty-state guards read
   * the UNFILTERED arrays, so a non-matching query rendered NEITHER rows nor an
   * empty line — a blank column that looks broken rather than one that has
   * answered. And "none exist" is not "none match": the two are different
   * facts and are worded differently.
   */
  it("says NO MATCHES when the filter empties a section that has rows", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Filter channels"), {
      target: { value: "zzz-nothing" },
    });
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Diana Taylor" })).toBeNull();
    // Once per emptied section — Channels and Direct messages both.
    expect(screen.getAllByText(SIDEBAR_NO_MATCHES)).toHaveLength(2);
    // ⚠ And NOT the genuinely-empty wording: nothing was established about
    // whether this workspace has channels.
    expect(screen.queryByText("No channels yet.")).toBeNull();
    expect(screen.queryByText("No direct messages yet.")).toBeNull();
  });

  it("keeps the genuinely-empty wording when there is no query at all", () => {
    renderSidebar({ rooms: [], direct: [] });
    expect(screen.getByText("No channels yet.")).not.toBeNull();
    expect(screen.getByText("No direct messages yet.")).not.toBeNull();
    expect(screen.queryByText(SIDEBAR_NO_MATCHES)).toBeNull();
  });

  it("keeps the genuinely-empty wording even under a query", () => {
    // An empty section cannot have been emptied BY the filter.
    renderSidebar({ rooms: [], direct: [] });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Filter channels"), {
      target: { value: "anything" },
    });
    expect(screen.getByText("No channels yet.")).not.toBeNull();
    expect(screen.queryByText(SIDEBAR_NO_MATCHES)).toBeNull();
  });

  it("selects a channel and opens a thread through its callbacks", () => {
    const props = renderSidebar();
    fireEvent.click(row("Front-end"));
    expect(props.onSelectChannel).toHaveBeenCalledWith("ch-fe");
    fireEvent.click(row("UI-kit design"));
    expect(props.onOpenThread).toHaveBeenCalledWith("t-kit");
  });
});

describe("the sidebar's 24h window", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");

  it("keeps a thread inside the window and drops one outside it", () => {
    const fresh = thread({
      id: "fresh",
      lastActivityAt: new Date(now - 1_000).toISOString(),
    });
    const stale = thread({
      id: "stale",
      lastActivityAt: new Date(
        now - SIDEBAR_THREAD_ACTIVE_WINDOW_MS - 1_000
      ).toISOString(),
    });
    expect(sidebarThreads([fresh, stale], now).map((t) => t.id)).toEqual(["fresh"]);
  });

  it("reads an ABSENT lastActivityAt as inactive, never as active", () => {
    // ⚠ Absent means "this read did not derive it" (INVARIANTS §5), and the
    // fail-safe direction is the one presence has: stale reads OFFLINE.
    expect(sidebarThreads([thread({ lastActivityAt: undefined })], now)).toEqual([]);
  });

  /**
   * ⚠ THE RULING'S SECOND ARM IS GONE (Samuel, 2026-08-22). "Active in the last
   * 24 hours OR REQUESTED" (2026-08-18) admitted an aged thread the viewer owed
   * an answer on — the one they most needed a way back to while a `pending`
   * inbound row was live. With no inbound decision, there is nothing to rescue,
   * and the arm's two arguments left the signature. Pinned as an ABSENCE: a
   * re-added optional arm would compile and silently widen the tree again.
   */
  it("admits NOTHING past the window — the requested arm is deleted", () => {
    const stale = thread({
      id: "asked",
      lastActivityAt: new Date(
        now - SIDEBAR_THREAD_ACTIVE_WINDOW_MS - 1_000
      ).toISOString(),
    });
    expect(sidebarThreads([stale], now)).toEqual([]);
    expect(sidebarThreads([thread({ id: "bare", lastActivityAt: undefined })], now)).toEqual(
      []
    );
  });
});

/**
 * THE FAVORITES SECTION (Samuel, 2026-08-19 — the one piece of design furniture
 * that got a column instead of staying hardcoded).
 *
 * Every case here pins a decision that a redesign would silently reverse: that a
 * favourite MOVES the row rather than duplicating it (2026-08-19, superseding
 * the same-day shortcut ruling these cases used to pin), that DMs can be
 * favourited too, that the order is alphabetical rather than the list's own
 * recency, and that an empty section takes its header with it while a
 * FILTERED-empty one does not.
 */
describe("the sidebar's real Favorites section", () => {
  const FAV_ROOMS = [
    channel({ id: "ch-web", name: "Website", myFavoritedAt: "2026-08-19T10:00:00.000Z" }),
    channel({ id: "ch-fe", name: "Front-end" }),
    channel({ id: "ch-api", name: "API", myFavoritedAt: "2026-08-19T09:00:00.000Z" }),
  ];

  it("is ABSENT — header and all — when nothing is favourited", () => {
    renderSidebar();
    // ⚠ Not "renders an empty section". Unlike Channels and Direct messages,
    // which always say "No channels yet.", favouriting is optional
    // organisation and a header for an unused feature is noise.
    expect(screen.queryByRole("button", { name: "Favorites" })).toBeNull();
  });

  // Thread nesting is a real property of this section (its own case below), but
  // it is noise in the ones about SECTION MEMBERSHIP — those render no threads.
  const NO_THREADS = { rooms: FAV_ROOMS, threads: [] };

  /** Row labels of ONE section, so a case can say WHICH section a row is in —
   *  `toHaveLength(1)` alone cannot, and under move semantics the section is
   *  the whole claim. The `+` actions sit inside their header and are dropped. */
  const sectionRows = (title: string, until?: string) => {
    const list = screen.getByRole("complementary", { name: "Channels" });
    const labels = within(list)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "")
      .filter((l) => l !== "Add channel" && l !== "New direct message");
    const to = until ? labels.indexOf(until) : -1;
    return labels.slice(labels.indexOf(title) + 1, to === -1 ? undefined : to);
  };

  it("MOVES a favourited channel — one row, in Favorites, not in the tree", () => {
    renderSidebar(NO_THREADS);
    expect(screen.getByRole("button", { name: "Favorites" })).not.toBeNull();
    // ⚠ A FAVOURITE IS A MOVE, NOT A SHORTCUT (Samuel, 2026-08-19, superseding
    // the same-day Slack-semantics ruling this case used to pin at two rows).
    // ONE channel is ONE row in this column, favourited or not.
    expect(screen.getAllByRole("button", { name: "Website" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "API" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Front-end" })).toHaveLength(1);
    expect(sectionRows("Favorites", "Direct messages")).toEqual(["API", "Website"]);
    // …and the tree below holds exactly what did NOT move.
    expect(sectionRows("Channels")).toEqual(["Front-end"]);
  });

  it("returns a channel to its home section when it is NOT favourited", () => {
    // The other half of the move: clearing the column is what puts the row back,
    // and the section goes with the last favourite.
    renderSidebar({
      rooms: FAV_ROOMS.map((c) => ({ ...c, myFavoritedAt: null })),
      threads: [],
    });
    expect(screen.queryByRole("button", { name: "Favorites" })).toBeNull();
    expect(sectionRows("Channels")).toEqual(["Website", "Front-end", "API"]);
  });

  it("keeps the EMPTIED home section's header and its 'none yet' line", () => {
    // Everything favourited → Channels has nothing to show and nobody typed
    // anything, so it says what it says with no channels at all. ⚠ NOT
    // `SIDEBAR_NO_MATCHES`: "none match" is a claim about a query.
    renderSidebar({
      rooms: [
        channel({ id: "ch-only", name: "Only", myFavoritedAt: "2026-08-19T10:00:00.000Z" }),
      ],
      threads: [],
    });
    expect(screen.getByRole("button", { name: "Channels" })).not.toBeNull();
    expect(screen.getByText("No channels yet.")).not.toBeNull();
    expect(screen.queryByText(SIDEBAR_NO_MATCHES)).toBeNull();
  });

  it("nests the OPEN channel's threads under its favourite row", () => {
    // ⚠ The nesting had to MOVE with the row. This section is the channel's
    // only row now, so a Favorites row that stayed a bare `ChannelRow` would
    // have dropped the open channel's threads out of the column entirely.
    renderSidebar({ rooms: FAV_ROOMS }); // `selectedChannelId` defaults to ch-web
    // ⚠ The disclosure button is a row-level sibling since 2026-08-20, so it
    // appears in this list too — filtered out here rather than folded into the
    // expectation, because what this case is about is which CHANNEL the thread
    // hangs under.
    expect(
      sectionRows("Favorites", "Direct messages").filter(
        (label) => !/threads in /.test(label ?? "")
      )
    ).toEqual(["API", "Website", "UI-kit design"]);
  });

  it("favourites a DM by its resolved peer, with the DM row face", () => {
    renderSidebar({
      direct: [
        channel({
          id: "ch-dm",
          isDirect: true,
          name: "dm",
          myFavoritedAt: "2026-08-19T10:00:00.000Z",
          directPeer: { userId: PEER, displayName: "Diana Taylor", avatarUrl: null },
        }),
      ],
      threads: [],
    });
    // Named by the peer, and the section reuses the same row, so a DM is a face
    // and a channel is a hash tile in Favorites exactly as below.
    expect(screen.getAllByRole("button", { name: "Diana Taylor" })).toHaveLength(1);
    expect(sectionRows("Favorites", "Direct messages")).toEqual(["Diana Taylor"]);
    // The DM section it left keeps its header and its own "none yet" line.
    expect(screen.getByText("No direct messages yet.")).not.toBeNull();
  });

  it("orders favourites BY NAME, not by the list's own order", () => {
    // The list arrives Website-first (recency, as `listChannels` returns it);
    // the section must read API, Website. A favourites list is used by POINTING.
    renderSidebar({
      rooms: [...FAV_ROOMS, channel({ id: "ch-an", name: "Analytics" })],
      threads: [],
    });
    expect(sectionRows("Favorites", "Direct messages")).toEqual(["API", "Website"]);
    // …while the tree below keeps the LIST's own order — the sort belongs to
    // this section and must not have reordered what stayed behind.
    expect(sectionRows("Channels")).toEqual(["Front-end", "Analytics"]);
  });

  it("selects the channel from a favourite row, and wears the selection there too", () => {
    const props = renderSidebar({ ...NO_THREADS, selectedChannelId: "ch-api" });
    const favRow = screen.getByRole("button", { name: "API" });
    expect(favRow.getAttribute("aria-current")).toBe("true");
    fireEvent.click(favRow);
    expect(props.onSelectChannel).toHaveBeenCalledWith("ch-api");
  });

  it("collapses like any other section", () => {
    renderSidebar(NO_THREADS);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    // ⚠ The rows go with it — under move semantics there is no second copy in
    // the tree to survive a collapse. The header stays, so they come back.
    expect(screen.queryByRole("button", { name: "Website" })).toBeNull();
    expect(screen.getByRole("button", { name: "Favorites" })).not.toBeNull();
  });

  it("KEEPS its header and says NO MATCHES when the filter empties it", () => {
    // ⚠ The exception to the absent-section rule, and the same
    // two-different-facts rule the sections below follow: "you have no
    // favourites" and "none of them match what you typed" are opposite claims
    // that look identical as a blank space.
    renderSidebar(NO_THREADS);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Filter channels"), {
      target: { value: "front" },
    });
    expect(screen.getByRole("button", { name: "Favorites" })).not.toBeNull();
    // Two emptied sections: Favorites and Direct messages — and not Channels,
    // which still has the one channel that never moved.
    expect(screen.getAllByText(SIDEBAR_NO_MATCHES)).toHaveLength(2);
  });
});

/**
 * ⚠ THE REQUESTED GLYPH IS DELETED (Samuel, 2026-08-22) — `Clock`,
 * `text-warning` and the accessible name "— awaiting your approval" all went with
 * the inbound consent lane. Every thread row wears `Bot` and its own title.
 */
describe("the sidebar's thread glyph", () => {
  it("names a thread row by its title alone, with no approval state", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "UI-kit design" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /awaiting your approval/ })).toBeNull();
  });
});
