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
 *  - FAVORITES IS REAL (2026-08-19) — a partition of the same channel list, with
 *    Slack semantics (a favourite is a shortcut, not a move) and a section that
 *    is ABSENT rather than empty.
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
    const rows = within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(rows.indexOf("UI-kit design")).toBe(rows.indexOf("Front-end") + 1);
  });

  it("shows an unread DOT, never a count — `Channel.unread` is a boolean", () => {
    renderSidebar();
    expect(screen.getByLabelText("Unread messages")).not.toBeNull();
    // No badge digit anywhere on the channel rows.
    expect(within(row("Front-end")).queryByText(/^\d+$/)).toBeNull();
  });

  it("badges the Inbox row only when a real pending-consent count exists", () => {
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
    expect(
      sidebarThreads([fresh, stale], new Set(), now).map((t) => t.id)
    ).toEqual(["fresh"]);
  });

  it("reads an ABSENT lastActivityAt as inactive, never as active", () => {
    // ⚠ Absent means "this read did not derive it" (INVARIANTS §5), and the
    // fail-safe direction is the one presence has: stale reads OFFLINE.
    expect(
      sidebarThreads([thread({ lastActivityAt: undefined })], new Set(), now)
    ).toEqual([]);
  });

  /** ⚠ THE RULING'S SECOND ARM (Samuel 2026-08-18: "active in the last 24 hours
   *  OR REQUESTED"). Unbuilt until Phase 3 because nothing derived `requested`;
   *  it now comes from the viewer's own consent inbox. */
  it("admits a REQUESTED thread however old it is", () => {
    const stale = thread({
      id: "asked",
      lastActivityAt: new Date(
        now - SIDEBAR_THREAD_ACTIVE_WINDOW_MS - 1_000
      ).toISOString(),
    });
    expect(
      sidebarThreads([stale], new Set(["asked"]), now).map((t) => t.id)
    ).toEqual(["asked"]);
  });

  it("admits a requested thread with NO activity clock at all", () => {
    const bare = thread({ id: "asked", lastActivityAt: undefined });
    expect(
      sidebarThreads([bare], new Set(["asked"]), now).map((t) => t.id)
    ).toEqual(["asked"]);
  });
});

/**
 * THE FAVORITES SECTION (Samuel, 2026-08-19 — the one piece of design furniture
 * that got a column instead of staying hardcoded).
 *
 * Every case here pins a decision that a redesign would silently reverse: that a
 * favourite does not MOVE the row, that DMs can be favourited too, that the
 * order is alphabetical rather than the list's own recency, and that an empty
 * section takes its header with it while a FILTERED-empty one does not.
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

  it("renders the favourited channels and NOTHING else", () => {
    renderSidebar({ rooms: FAV_ROOMS });
    expect(screen.getByRole("button", { name: "Favorites" })).not.toBeNull();
    // Two favourites → two rows in the section, plus every channel's own row in
    // the tree below.
    expect(screen.getAllByRole("button", { name: "Website" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "API" })).toHaveLength(2);
    // ⚠ SLACK SEMANTICS: a favourite is a SHORTCUT, not a move. An
    // un-favourited channel still has exactly one row, and a favourited one
    // still has its row in the tree.
    expect(screen.getAllByRole("button", { name: "Front-end" })).toHaveLength(1);
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
    });
    // Named by the peer in BOTH places — the section reuses `ChannelRow`, so a
    // DM is a face and a channel is a hash tile in Favorites exactly as below.
    expect(screen.getAllByRole("button", { name: "Diana Taylor" })).toHaveLength(2);
  });

  it("orders favourites BY NAME, not by the list's own order", () => {
    // The list arrives Website-first (recency, as `listChannels` returns it);
    // the section must read API, Website. A shortcut list is used by pointing.
    renderSidebar({ rooms: FAV_ROOMS });
    const list = screen.getByRole("complementary", { name: "Channels" });
    const labels = within(list)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    const header = labels.indexOf("Favorites");
    expect(labels.slice(header + 1, header + 3)).toEqual(["API", "Website"]);
    // …while the tree below keeps the LIST's own order — the sort belongs to
    // the shortcut section and must not have reordered the tree with it.
    // (Nested thread rows dropped: the tree interleaves them, Favorites does
    // not, and this case is about channel order.)
    const treeRows = labels
      .slice(labels.indexOf("Channels") + 1)
      .filter((l) => l !== "UI-kit design" && l !== "Add channel");
    expect(treeRows).toEqual(["Website", "Front-end", "API"]);
  });

  it("selects the channel from a favourite row, and wears the selection there too", () => {
    const props = renderSidebar({ rooms: FAV_ROOMS, selectedChannelId: "ch-api" });
    const [favRow] = screen.getAllByRole("button", { name: "API" });
    expect(favRow.getAttribute("aria-current")).toBe("true");
    fireEvent.click(favRow);
    expect(props.onSelectChannel).toHaveBeenCalledWith("ch-api");
  });

  it("collapses like any other section", () => {
    renderSidebar({ rooms: FAV_ROOMS });
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    // The tree row survives the collapse; only the shortcut goes.
    expect(screen.getAllByRole("button", { name: "Website" })).toHaveLength(1);
  });

  it("KEEPS its header and says NO MATCHES when the filter empties it", () => {
    // ⚠ The exception to the absent-section rule, and the same
    // two-different-facts rule the sections below follow: "you have no
    // favourites" and "none of them match what you typed" are opposite claims
    // that look identical as a blank space.
    renderSidebar({ rooms: FAV_ROOMS });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Filter channels"), {
      target: { value: "front" },
    });
    expect(screen.getByRole("button", { name: "Favorites" })).not.toBeNull();
    // Three emptied sections now: Favorites, Direct messages... and not
    // Channels, which still has Front-end.
    expect(screen.getAllByText(SIDEBAR_NO_MATCHES)).toHaveLength(2);
  });
});

describe("the sidebar's REQUESTED glyph", () => {
  it("wears the clock and says why, for a thread awaiting the viewer", () => {
    renderSidebar({ requestedThreads: new Set(["t-kit"]) });
    expect(
      screen.getByRole("button", { name: "UI-kit design — awaiting your approval" })
    ).not.toBeNull();
  });

  it("wears the plain title when nothing is pending", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "UI-kit design" })).not.toBeNull();
  });
});
