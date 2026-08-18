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
 *    interaction-completeness ruling (2026-08-18).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChannelsV2Sidebar } from "./sidebar";
import { SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import { channel, member, thread, ME, PEER } from "./test-fixtures";
import { sidebarThreads } from "./view-model";

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
});
