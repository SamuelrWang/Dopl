// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    // ONE thread, so the pop-out landing below has something real to select.
    // `openThread` is DERIVED from this list — a thread id that is not in it is a
    // stale pick and falls back to the channel view, which is asserted too.
    threads: [
      {
        id: "t-1",
        channelId: "ch-1",
        title: "Ship the release",
        status: "open",
        createdAt: "2026-08-18T10:00:00.000Z",
        updatedAt: "2026-08-18T10:00:00.000Z",
      },
    ],
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
// ⚠ THE PAGE READS `outbound`, NOT `requests` (2026-08-22 — the inbound consent
// retirement), so the stub has to carry that slice or every render throws on an
// undefined array.
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [] }),
}));
vi.mock("../../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} } }),
}));
// The header bookmark's favourite write (2026-08-19). Mocked for the same
// reason the mention write is: it says nothing about which channel is open, and
// unmocked it pulls the real `useApiMutationWith` out of the stub below.
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("./use-agents-panel", () => ({
  useAgentsPanel: () => ({
    peerSessions: [],
    canLaunch: false,
    launchBusy: false,
    launchAgent: async () => {},
  }),
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
  ChannelsV2MessagePane: ({
    channelId,
    thread,
  }: {
    channelId: string;
    thread: { id: string } | null;
  }) => (
    <>
      <div data-testid="pane">{channelId}</div>
      <span data-testid="thread">{thread?.id ?? "none"}</span>
    </>
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

/**
 * ⚠ A REAL `QueryClientProvider` SINCE 2026-08-20. Every read this file needs is
 * mocked, but the core itself now calls `useQueryClient()` — its realtime
 * `refetchAll` invalidates the channels-list PREFIX rather than refetching one
 * mounted observer, so a non-mounted key variant stops going stale behind a
 * doorbell that fired for it. `useQueryClient` THROWS with no provider, so this
 * wrapper is load-bearing rather than decorative. A fresh client per render keeps
 * the cases isolated.
 */
const core = (initialChannelId?: string | null, initialThreadId?: string | null) => (
  <QueryClientProvider client={new QueryClient()}>
  <ChannelsV2Core
    workspaceId={WS}
    workspaceSlug="acme"
    currentUserId={ME}
    role="owner"
    Link={TestLink}
    initialChannelId={initialChannelId}
    initialThreadId={initialThreadId}
  />
  </QueryClientProvider>
);

function renderCore(initialChannelId?: string | null, initialThreadId?: string | null) {
  return render(core(initialChannelId, initialThreadId));
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

// ── The POP-OUT's landing (wiring plan Phase 10, 2026-08-18) ─────────────────
//
// ⚠ A THREAD IS A SELECTION, NOT A ROUTE. Main opens the pop-out on
// `/{segment}/channels/{channelId}?thread={threadId}` — the SAME row the cutover built,
// with no new `routes.tsx` entry and no deep-link grammar change — and the SPA page hands
// the search param down here as a plain prop, exactly as it does the channel.

const openThread = () => screen.getByTestId("thread").textContent;

describe("ChannelsV2Core — the thread a pop-out names", () => {
  it("opens the named thread on mount, inside the named channel", () => {
    renderCore(CH_A, "t-1");
    expect(open()).toBe(CH_A);
    expect(openThread()).toBe("t-1");
  });

  it("names no thread by default — every other caller lands on the channel view", () => {
    renderCore(CH_A);
    expect(openThread()).toBe("none");
  });

  it("falls back to the CHANNEL view for a thread this channel does not have", () => {
    // Derived, never stored: a stale link (thread aged past the read's ceiling, or moved)
    // must not render an empty thread transcript.
    renderCore(CH_A, "t-does-not-exist");
    expect(open()).toBe(CH_A);
    expect(openThread()).toBe("none");
  });

  it("is an initial selection, not a lock", () => {
    const { rerender } = renderCore(CH_A, "t-1");
    expect(openThread()).toBe("t-1");
    // The same values handed over again must not fight the operator's own navigation.
    rerender(core(CH_A, "t-1"));
    expect(openThread()).toBe("t-1");
  });
});
