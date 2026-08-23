// @vitest-environment jsdom
/**
 * THE PER-CHANNEL SURFACE, MOUNTED OUTSIDE THE CHANNELS PAGE.
 *
 * ⚠ WHAT THIS FILE IS FOR IS THE THINGS A SCREENSHOT CANNOT SHOW. The surface
 * renders identically on the workspace page and on Home, so "it looks right"
 * proves nothing about the two properties the extraction had to buy:
 *
 *   • **IT IS A LIVE SURFACE WHEREVER IT MOUNTS.** A standalone host that
 *     forgot `useChannelsV2Live` would render a transcript that quietly stops
 *     updating, with no error anywhere — the failure INVARIANTS §7 counts
 *     registered surfaces to prevent, and which has already shipped once
 *     (`agent-window.tsx`, 2026-08-20). So the assertion is the REGISTRATION,
 *     not the rendering — and that there is exactly ONE of them.
 *   • **IT NEEDS NOTHING FROM THE APP SHELL.** No workspace-access context, no
 *     router, no layout provider: everything below is props and mocked reads,
 *     and the only wrapper is the `QueryClientProvider` every read hook in this
 *     tree needs.
 *
 * Plus the two knobs a second host actually turns: the Info tab's SLOT and
 * `memberManagement: false`.
 *
 * `composer.tsx` and `settings-agent.tsx` are mocked — each is a write surface
 * with its own mutation stack and its own suite, and what is under test here is
 * the surface around them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, member, message, thread, ME, PEER, WS } from "./test-fixtures";

interface LiveArgs {
  workspaceId: string;
  refetchAll: () => void;
  refetchMembers: () => void;
}
const { live } = vi.hoisted(() => ({
  live: vi.fn<(opts: LiveArgs) => { gate: object }>(() => ({ gate: {} })),
}));

vi.mock("./live", () => ({ useChannelsV2Live: live }));
vi.mock("./composer", () => ({ ChannelsV2Composer: () => null }));
vi.mock("./settings-agent", () => ({ ChannelAgentSettings: () => null }));
// The invite half's two dialogs. Both open reads of their own on mount, and the
// `memberManagement` case below is about whether they are MOUNTED at all — which
// a stub still answers, because it is the same element either way.
vi.mock("../invite-dialog", () => ({
  InviteDialog: () => <div data-testid="invite-dialog" />,
}));
vi.mock("../go-public-dialog", () => ({
  GoPublicDialog: () => null,
  needsGoPublicConfirm: () => false,
}));

vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [message({ id: "m-1", seq: 1, body: "on the record" })],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [thread()],
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
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} }, pending: false }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    toolProfile: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../../hooks/use-channel-lifecycle-writes", () => ({
  useChannelLifecycleWrites: () => ({
    toggleArchive: () => {},
    toggleVisibility: () => {},
    remove: () => {},
    join: () => {},
    leave: () => {},
  }),
}));
vi.mock("./use-agents-panel", () => ({
  PEER_SESSIONS_POLL_MS: 30_000,
  useAgentsPanel: () => ({
    peerSessions: [],
    canLaunch: false,
    launchBusy: false,
    launchError: null,
    launchAgent: async () => ({ ok: true }),
    approveTemplate: async () => ({ ok: true }),
    refetch: () => {},
  }),
}));

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { StandaloneChannelSurface } from "./channel-surface-standalone";

const CHANNEL = channel();

/** ⚠ NO APP SHELL, deliberately — see the file docblock. The query client is the
 *  one ambient thing this tree needs, and a fresh one keeps the cases isolated. */
function mount(props: Partial<Parameters<typeof StandaloneChannelSurface>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StandaloneChannelSurface
        workspaceId={WS}
        workspaceSlug="acme"
        channel={CHANNEL}
        currentUserId={ME}
        {...props}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  live.mockClear();
});

describe("StandaloneChannelSurface — mounted outside the channels page", () => {
  it("renders the channel's own header, transcript and tab column", () => {
    mount();
    expect(screen.getByText(CHANNEL.name)).toBeTruthy();
    expect(screen.getByText("on the record")).toBeTruthy();
    // The tab ROW is the column's design and is never a slot — all four.
    for (const tab of ["Info", "Threads", "Agents", "Settings"]) {
      expect(screen.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeTruthy();
    }
  });

  it("is a LIVE surface, and registers exactly ONE coordinator", () => {
    mount();
    // One `useRefetchGate` per live surface (INVARIANTS §7/§8): a second one here
    // would let a doorbell arriving mid-send clobber the optimistic patch.
    expect(live).toHaveBeenCalledTimes(1);
    expect(live.mock.calls[0][0]).toMatchObject<Partial<LiveArgs>>({
      workspaceId: WS,
    });
    const arg: LiveArgs = live.mock.calls[0][0];
    expect(typeof arg.refetchAll).toBe("function");
    expect(typeof arg.refetchMembers).toBe("function");
  });
});

describe("StandaloneChannelSurface — the host's two knobs", () => {
  it("renders the channels page's own Info tab when no slot is given", () => {
    mount();
    expect(screen.getByText("Main info")).toBeTruthy();
  });

  it("REPLACES the Info tab's body with the slot, keeping the tab row", () => {
    mount({ slots: { infoTab: <p>Diana Taylor, since March</p> } });
    expect(screen.getByText("Diana Taylor, since March")).toBeTruthy();
    // The channel's own body is GONE, not merely pushed below the card.
    expect(screen.queryByText("Main info")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Info/ })).toBeTruthy();
  });

  it("offers the invite row and its dialog by default", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(screen.getByText("Add members")).toBeTruthy();
    expect(screen.getByTestId("invite-dialog")).toBeTruthy();
  });

  it("hides the invite row AND its dialog under memberManagement: false", () => {
    // A fixed two-person container: "Add members" names an operation that cannot
    // happen, and NO DEAD ROWS is the rule this tab already keeps.
    mount({ capabilities: { memberManagement: false } });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(screen.queryByText("Add members")).toBeNull();
    // ⚠ Not merely hidden — the dialog opens a roster read of its own, and there
    // is no row left to open it.
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
    // The rest of the tab is untouched.
    expect(screen.getByText("Archive")).toBeTruthy();
  });

  it("hides DELETE under memberManagement: false — the channel is the relationship", () => {
    // ⚠ The host pins this surface to the ONE channel inside a two-person
    // container. Deleting it leaves a container whose relationship neither side
    // can render, while the host's list still holds the row: a live control
    // whose only outcome is a broken card.
    mount({ capabilities: { memberManagement: false } });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(screen.queryByText(/^Delete /)).toBeNull();
  });

  it("still offers delete by default — the workspace page is unchanged", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(screen.getByText(/^Delete /)).toBeTruthy();
  });
});
