// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { channel, member, ME, WS } from "./test-fixtures";

/**
 * Channels v2 core — THE ROUTE-DRIVEN SELECTION (wiring plan Phase 9).
 *
 * ⚠ THE ONLY THING UNDER TEST IS "which channel is open, and who decided".
 * A clicked desktop notification focuses the app and pushes
 * `/{segment}/channels/{channelId}`; the SPA page reads the param and hands
 * it down as `initialChannelId`, because this tree is router-free by
 * construction (the web bundle imports it too). What that prop must buy — and
 * must NOT buy — is three things, and none of them is visible from the page:
 *
 *   • it SELECTS, on mount and on change (a second notification arrives with
 *     the page already mounted, so a mount-only read is a dead notification);
 *   • it does not LOCK — the operator's own click still wins afterwards;
 *   • it takes the Inbox takeover down, or the notification lands the operator
 *     on a pane that is not the channel they were sent to.
 *
 * Every data hook and every child pane is mocked: the assertions are about the
 * selection the core computes, and a real transcript/composer tree would couple
 * this file to five surfaces that have their own suites.
 */

const CH_A = "ch-1"; // the fixture's id
const CH_B = "77777777-7777-4777-8777-777777777777";

const rooms = [channel(), channel({ id: CH_B, slug: "brand", name: "Brand" })];

vi.mock("../../hooks/use-channels", () => ({
  useChannels: () => ({ channels: rooms, loading: false, refetch: () => {} }),
}));
vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));
vi.mock("../../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({ members: [member()], refetch: () => {} }),
}));
vi.mock("../../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({
    mentions: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [] }),
}));
vi.mock("../../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} } }),
}));
vi.mock("../../client/realtime", () => ({
  useChannelsRealtime: () => {},
  usePresenceRealtime: () => {},
}));
vi.mock("@/shared/hooks/use-api-mutation", () => ({
  useRefetchGate: () => ({ signal: () => {}, gate: {} }),
}));

// The panes are stand-ins: each one reports the single fact this file asks it
// for, so a failure names the selection rather than a rendering detail.
vi.mock("./sidebar", () => ({
  ChannelsV2Sidebar: ({
    selectedChannelId,
    onSelectChannel,
    onOpenInbox,
  }: {
    selectedChannelId: string | null;
    onSelectChannel: (id: string) => void;
    onOpenInbox: () => void;
  }) => (
    <div>
      <span data-testid="selected">{selectedChannelId ?? "none"}</span>
      <button onClick={() => onSelectChannel(CH_B)}>pick brand</button>
      <button onClick={onOpenInbox}>open inbox</button>
    </div>
  ),
}));
vi.mock("./message-pane", () => ({
  ChannelsV2MessagePane: ({ channelId }: { channelId: string }) => (
    <div data-testid="pane">{channelId}</div>
  ),
}));
vi.mock("./info-panel", () => ({ ChannelsV2InfoPanel: () => null }));
vi.mock("./agent-panel", () => ({ ChannelsV2AgentPanel: () => null }));
vi.mock("./inbox-pane", () => ({
  ChannelsV2InboxPane: () => <div data-testid="pane">inbox</div>,
}));
// The channel-management cluster arrived at the cutover (wiring plan Phase 12)
// and drags three write hooks, two dialogs and a Supabase-backed auth read in
// with it. It has nothing to say about which channel is open, which is the only
// question this file asks.
vi.mock("./channel-manage", () => ({
  ChannelsV2ManageActions: () => null,
  ChannelsV2CreateDialogs: () => null,
}));

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { ChannelsV2Core } from "./channels-v2-core";

const TestLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href}>{children}</a>
);

const core = (initialChannelId?: string | null) => (
  <ChannelsV2Core
    workspaceId={WS}
    workspaceSlug="acme"
    currentUserId={ME}
    role="owner"
    Link={TestLink}
    initialChannelId={initialChannelId}
  />
);

function renderCore(initialChannelId?: string | null) {
  return render(core(initialChannelId));
}

afterEach(cleanup);

const open = () => screen.getByTestId("pane").textContent;

describe("ChannelsV2Core — the channel a caller names", () => {
  it("falls back to the first row when nothing is named", () => {
    // The paramless `channels-v2` row, and the web tree, both land here — the
    // pre-existing rule, restated so the new prop cannot quietly replace it.
    renderCore();
    expect(open()).toBe(CH_A);
  });

  it("opens the named channel on mount", () => {
    renderCore(CH_B);
    expect(open()).toBe(CH_B);
    expect(screen.getByTestId("selected").textContent).toBe(CH_B);
  });

  it("re-selects when a SECOND notification names a different channel", () => {
    // The page is already mounted, so the route changes under a live component.
    // A mount-only read would leave the operator staring at the previous
    // channel with no sign anything happened — a silently dead notification.
    const { rerender } = renderCore(CH_B);
    expect(open()).toBe(CH_B);
    rerender(core(CH_A));
    expect(open()).toBe(CH_A);
  });

  it("is an initial selection, not a lock — the operator's click wins", () => {
    const { rerender } = renderCore(CH_A);
    fireEvent.click(screen.getByText("pick brand"));
    expect(open()).toBe(CH_B);
    // A re-render that hands over the SAME value must not drag them back.
    rerender(core(CH_A));
    expect(open()).toBe(CH_B);
  });

  it("takes the Inbox takeover down, so the channel is what is on screen", () => {
    // The Inbox is a center-column takeover (Phase 8). Landing "on the channel"
    // has to mean the channel is VISIBLE, not merely selected behind the Inbox.
    const { rerender } = renderCore(CH_A);
    fireEvent.click(screen.getByText("open inbox"));
    expect(open()).toBe("inbox");
    rerender(core(CH_B));
    expect(open()).toBe(CH_B);
  });

  it("naming nothing again selects nothing — it does not reset the pick", () => {
    // Going from `channels/{id}` back to the paramless row names no channel;
    // "no channel named" is not "select the first one all over again".
    const { rerender } = renderCore(CH_A);
    fireEvent.click(screen.getByText("pick brand"));
    expect(open()).toBe(CH_B);
    rerender(core(null));
    expect(open()).toBe(CH_B);
  });
});
