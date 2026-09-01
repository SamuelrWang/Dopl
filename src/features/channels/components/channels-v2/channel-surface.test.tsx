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
// ⚠ NOT `() => null` any more: the Threads tab's "New thread" reaches the
// composer through this surface, and a mock that renders nothing cannot show
// that it arrived. It stays inert — only the signal is exposed.
vi.mock("./composer", () => ({
  ChannelsV2Composer: ({ newThreadSignal }: { newThreadSignal?: number }) => (
    <div data-testid="composer" data-new-thread={String(newThreadSignal ?? 0)} />
  ),
}));
// ⚠ NOT `() => null` any more (2026-08-25): `selfManagement` decides whether
// this block is MOUNTED AT ALL, and a mock that renders nothing cannot tell the
// two answers apart. It stays inert — the real one has its own suite
// (`settings-tab.test.tsx`); what is under test here is the threading.
vi.mock("./settings-agent", () => ({
  ChannelAgentSettings: () => <div data-testid="agent-settings" />,
}));
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

/**
 * 🔒 **A CHANNEL'S HEADER IDENTITY (Samuel, 2026-09-01).**
 *
 * The header normally asks `channel-display.ts › channelDisplayName`, which
 * names a DM after its peer — right on the workspace channels page, wrong on
 * /home, where a container is a CHANNEL whose identity is its own name and does
 * not move with its roster. The /home list row and Info tab were fixed at their
 * OWN derivation (`home-rows.ts › channelTitle`); this header reads a different
 * one, so a container minted before the channel-first inversion — carrying
 * `is_direct = true` from `server/service-writes.ts › createDirectChannel` —
 * showed the peer's name at the
 * top of the pane while the row and the card beside it showed the channel's.
 */
describe("StandaloneChannelSurface — the header's identity", () => {
  const DM = {
    ...CHANNEL,
    name: "Q3 Fundraise",
    isDirect: true,
    directPeer: {
      userId: "user-2",
      displayName: "Priya Shah",
      avatarUrl: null,
    },
  };

  it("names a direct channel after its peer by DEFAULT — the workspace page's behaviour", () => {
    mount({ channel: DM });
    expect(screen.getByText("Priya Shah")).toBeTruthy();
    expect(screen.queryByText("Q3 Fundraise")).toBeNull();
  });

  it("pins the header to the channel's own name under `peerNamedHeader: false`", () => {
    mount({ channel: DM, capabilities: { peerNamedHeader: false } });
    expect(screen.getByText("Q3 Fundraise")).toBeTruthy();
    // ⚠ THE ABSENCE IS THE ASSERTION: the roster is still loaded and the
    // Members list still names her — what must not happen is the CHANNEL being
    // named after her.
    expect(screen.queryByText("Priya Shah")).toBeNull();
  });
});

describe("StandaloneChannelSurface — the host's two knobs", () => {
  it("renders the channels page's own Info tab when no slot is given", () => {
    mount();
    expect(screen.getByText("Main info")).toBeTruthy();
  });

  it("REPLACES the Info tab's body with the slot, keeping the tab row", () => {
    mount({ slots: { infoTab: () => <p>Diana Taylor, since March</p> } });
    expect(screen.getByText("Diana Taylor, since March")).toBeTruthy();
    // The channel's own body is GONE, not merely pushed below the card.
    expect(screen.queryByText("Main info")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Info/ })).toBeTruthy();
  });

  // ⚠ THE SLOT IS HANDED **THIS SURFACE'S** GATE, never left to mint one
  // (2026-08-25). The person card writes — removable Main-info rows — and
  // INVARIANTS §7/§8 allow one `useRefetchGate` per live surface; a second one
  // coordinates with nothing, so the doorbell's refetch lands mid-write and
  // repaints the row the operator just deleted. Asserting the gate ARRIVES is
  // the only thing that can catch that regression: a slot that quietly stopped
  // receiving it renders identically.
  it("hands the Info-tab slot the surface's own refetch gate", () => {
    let seen: unknown = null;
    mount({
      slots: {
        infoTab: (ctx) => {
          seen = ctx.gate;
          return <p>slot</p>;
        },
      },
    });
    // ⚠ IDENTITY, not shape. A shape assertion would pass against a gate the
    // slot minted for itself, which is precisely the bug — so this pins that
    // the object handed over is the one `live.ts` returned to THIS surface.
    const fromLive = live.mock.results.at(-1)?.value.gate;
    expect(fromLive).toBeTruthy();
    expect(seen).toBe(fromLive);
  });

  // ⚠ `await` ON THE TAB BODY throughout this block: the info column's body
  // crossfades (150ms), so a tab's content lands one fade after its click. The
  // NEGATIVE assertions have to come after a positive one from the SAME tab, or
  // they pass merely because the fade has not finished.
  it("offers the invite row and its dialog by default", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(await screen.findByText("Add members")).toBeTruthy();
    expect(screen.getByTestId("invite-dialog")).toBeTruthy();
  });

  it("hides the invite row AND its dialog under memberManagement: false", async () => {
    // A fixed two-person container: "Add members" names an operation that cannot
    // happen, and NO DEAD ROWS is the rule this tab already keeps.
    mount({ capabilities: { memberManagement: false } });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    // The rest of the tab is untouched — and awaiting it is what proves the two
    // absences below are absences, not a body that has not arrived yet.
    expect(await screen.findByText("Archive")).toBeTruthy();
    expect(screen.queryByText("Add members")).toBeNull();
    // ⚠ Not merely hidden — the dialog opens a roster read of its own, and there
    // is no row left to open it.
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
  });

  it("hides DELETE under memberManagement: false — the channel is the relationship", async () => {
    // ⚠ The host pins this surface to the ONE channel inside a two-person
    // container. Deleting it leaves a container whose relationship neither side
    // can render, while the host's list still holds the row: a live control
    // whose only outcome is a broken card.
    mount({ capabilities: { memberManagement: false } });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    await screen.findByText("Archive");
    expect(screen.queryByText(/^Delete /)).toBeNull();
  });

  // ⚠ THE TWO COLUMNS ARE WIRED THROUGH THE SELECTION HOOK, not through each
  // other, which is what makes this the surface's test rather than the tab's:
  // both hosts of this surface get the wiring from one place.
  it("carries the Threads tab's New thread across to the composer", async () => {
    mount();
    const signal = () =>
      screen.getByTestId("composer").getAttribute("data-new-thread");
    expect(signal()).toBe("0");

    fireEvent.click(screen.getByRole("tab", { name: /^Threads/ }));
    fireEvent.click(await screen.findByRole("button", { name: "New thread" }));
    expect(signal()).toBe("1");

    // A COUNTER, not a flag: asking twice asks twice.
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(signal()).toBe("2");
  });

  it("still offers delete by default — the workspace page is unchanged", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(await screen.findByText(/^Delete /)).toBeTruthy();
  });
});

/**
 * `selfManagement` — THE VIEWER'S OWN STAKE, where `memberManagement` above is
 * the CONTAINER's roster (Samuel, rulings R2/R3, 2026-08-25).
 *
 * ⚠ ONE FLAG, TWO CONTROLS, AND THAT IS WHY BOTH ARE ASSERTED IN THE SAME PAIR
 * OF CASES. The guest lane (`app/c/[workspaceId]`) is one story — a person with
 * no Dopl desktop whose whole application is this channel — so "Leave channel"
 * and the agent block go together or the flag was minted twice. The two live
 * two files apart (`settings-tab.tsx` and `channel-manage.tsx`), which is
 * exactly how one of them comes back alone.
 *
 * The channel is a plain MEMBER's, because the owner has no leave row to lose.
 */
describe("StandaloneChannelSurface — the viewer's own stake", () => {
  const asMember = { channel: channel({ role: "member" }) };

  it("offers the leave row AND the agent block by default", async () => {
    mount(asMember);
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    // The anchor: awaiting a row from THIS tab is what makes the absences in
    // the next case absences rather than an unfinished crossfade.
    expect(await screen.findByText("Add members")).toBeTruthy();
    expect(screen.getByText("Leave channel")).toBeTruthy();
    expect(screen.getByTestId("agent-settings")).toBeTruthy();
  });

  it("hides BOTH under selfManagement: false, and touches nothing else", async () => {
    mount({ ...asMember, capabilities: { selfManagement: false } });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    // ⚠ The roster half is a SEPARATE flag and is still on — this is the
    // assertion that catches the two being fused back together.
    expect(await screen.findByText("Add members")).toBeTruthy();
    // Leaving is one-way out of the guest's only surface (the link was revoked
    // at claim), and the tool profile governs a session they never run.
    expect(screen.queryByText("Leave channel")).toBeNull();
    expect(screen.queryByTestId("agent-settings")).toBeNull();
  });

  it("the guest preset's empty Settings tab speaks to a MEMBER, not a joiner", async () => {
    // Both flags off is the guest lane whole. The tab falls to its empty
    // state, and the description must not tell a member to "join" — that
    // sentence belongs to a non-member browsing a public channel.
    mount({
      ...asMember,
      capabilities: { memberManagement: false, selfManagement: false },
    });
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    expect(await screen.findByText("Nothing to manage")).toBeTruthy();
    expect(
      screen.getByText("This channel has no settings for you to change.")
    ).toBeTruthy();
    expect(screen.queryByText(/Join this channel/)).toBeNull();
  });
});

/**
 * `knowledge` — THE THIRD CAPABILITY, and the only one that ADDS (Home
 * Knowledge Panels M4).
 *
 * ⚠ WHAT IS UNDER TEST IS THE PASS-THROUGH, not the tab. The tab has its own
 * suite (`knowledge-tab.test.tsx`) and the row has `info-panel.test.tsx`; what
 * neither can see is this surface dropping the flag on its way to the column —
 * a host would pass `knowledge: true` and get the old four tabs, with nothing
 * failing anywhere.
 *
 * ⚠ THE DEFAULT IS OFF, WHICH INVERTS THE OTHER TWO. That is deliberate and the
 * reason is written where the capability is declared: this one adds a tab over a
 * channel-scoped grant lane, and the workspace page already has the whole
 * knowledge surface.
 */
describe("StandaloneChannelSurface — the knowledge capability", () => {
  it("draws no Knowledge tab by default", () => {
    mount();
    expect(screen.queryByRole("tab", { name: /^Knowledge/ })).toBeNull();
  });

  it("draws it — and mounts NOTHING behind it — when the host opts in", () => {
    mount({ capabilities: { knowledge: true } });
    expect(screen.getByRole("tab", { name: /^Knowledge/ })).toBeTruthy();
    // ⚠ The tab's reads mount with the tab. Until it is opened this is a label
    // and no request, which is the same property `selfManagement: false` buys
    // the consent inbox (`guest-surface-reads.test.tsx`).
    expect(screen.queryByText("Nothing has been shared into this channel yet."))
      .toBeNull();
  });
});
