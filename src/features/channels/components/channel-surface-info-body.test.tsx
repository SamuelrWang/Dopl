// @vitest-environment jsdom
/**
 * **THE ONE INFO BODY, AND WHAT A HOST MAY ADD TO IT** — the `infoExtras`
 * contract and the context the surface hands it.
 *
 * ⚠ Split off `channel-surface.test.tsx` at §1's cap (wave 1A, 2026-09-17), on
 * the honest seam: that file moves when a PANE moves, this one when a host gains
 * an ability. The mock block is COPIED, not shared — `vi.mock` is hoisted above
 * every import, so sharing it costs a factory indirection per mock.
 *
 * ⚠ `08-slot-audit.md` walked all 78 declared slots in the tree and found
 * exactly one that replaced a body the surface had already paid for; it dropped
 * something four times in three weeks, the last putting a FALSE answer on screen
 * (F-723). The type is the fix and these cases say so out loud.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, member, message, thread, ME, PEER, WS } from "./test-fixtures";
import type { ChannelInfoTabContext } from "./channel-surface";

interface LiveArgs {
  workspaceId: string;
  refetchAll: () => void;
  refetchMembers: () => void;
}
const { live } = vi.hoisted(() => ({
  live: vi.fn<(opts: LiveArgs) => { gate: object }>(() => ({ gate: {} })),
}));

vi.mock("./live", () => ({ useChannelsLive: live }));
// ⚠ NOT `() => null` any more: the Threads tab's "New thread" reaches the
// composer through this surface, and a mock that renders nothing cannot show
// that it arrived. It stays inert — only the signal is exposed.
vi.mock("./composer", () => ({
  ChannelsComposer: ({ newThreadSignal }: { newThreadSignal?: number }) => (
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
// ⚠ REPORTS ITS `canManage`, because F-721's gate is what the cases below are
// about and a stub that rendered a bare div could not tell the two answers apart.
vi.mock("./invite-dialog", () => ({
  InviteDialog: ({ canManage }: { canManage: boolean }) => (
    <div data-testid="invite-dialog" data-can-manage={String(canManage)} />
  ),
}));
vi.mock("./go-public-dialog", () => ({
  GoPublicDialog: () => null,
  needsGoPublicConfirm: () => false,
}));

vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [message({ id: "m-1", seq: 1, body: "on the record" })],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [thread()],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({
    mentions: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} }, pending: false }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    toolProfile: { mutate: () => {}, pending: false },
    // 2026-09-07 (items 10/11): `channel-manage.tsx` reads `.pending` off this one, so a double
    // without the key throws where the real hook cannot.
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-channel-lifecycle-writes", () => ({
  useChannelLifecycleWrites: () => ({
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
    approveIdentity: async () => ({ ok: true }),
    refetch: () => {},
  }),
}));

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { StandaloneChannelSurface } from "./channel-surface-standalone";

const CHANNEL = channel();

/** ⚠ NO APP SHELL, deliberately — `channel-surface.test.tsx` carries the reason.
 *  The query client is the one ambient thing this tree needs. */
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

describe("StandaloneChannelSurface — the ONE Info body and the host's extras", () => {
  // 🔒 **THESE TWO CASES INVERTED IN WAVE 1A (2026-09-17), AND THEY WERE
  // REWRITTEN RATHER THAN DELETED.** The second used to assert
  // `queryByText("Channel info")` was **null** — that a host's slot had REPLACED
  // the shared body — which is the exact opposite of the rule now
  // (`00-MASTER.md` §4.2 G2: a slot may ADD, never REPLACE). A deleted test would
  // have left the new rule unpinned on the one surface that broke it four times.
  it("renders the ONE Info body when no host extras are given", () => {
    mount();
    expect(screen.getByText("Channel info")).toBeTruthy();
    expect(screen.getByTestId("channel-members")).toBeTruthy();
  });

  it("renders the host's extras BESIDE the shared body, never instead of it", () => {
    mount({
      slots: {
        infoExtras: () => ({
          belowRoster: <p>Diana Taylor, since March</p>,
        }),
      },
    });
    // The host's region is on screen …
    expect(screen.getByText("Diana Taylor, since March")).toBeTruthy();
    // … AND every section the surface paid for is still under it. Each of these
    // has been lost to a body-replacing slot at least once.
    expect(screen.getByText("Channel info")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Channel activity")).toBeTruthy();
    expect(screen.getByText("Members")).toBeTruthy();
    expect(screen.getByTestId("channel-members")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Info/ })).toBeTruthy();
  });

  // ⚠ **THE POSITION IS THE CONTRACT.** `belowRoster` is a NAME, and a name that
  // did not decide where the node lands would be a `ReactNode` with extra steps.
  it("puts `belowRoster` under the roster, not above it", () => {
    mount({
      slots: { infoExtras: () => ({ belowRoster: <p>Add person</p> }) },
    });
    const roster = screen.getByTestId("channel-members");
    const extra = screen.getByText("Add person");
    expect(
      roster.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // 🔒 THE TWO RULED MENTIONS FACES, FROM ONE BODY (Samuel, 2026-09-15).
  it("draws the collapsed mentions row by default and the open category under `mentionsLayout`", async () => {
    mount();
    // The workspace face: a COLLAPSED BUTTON inside the card, carrying the unread
    // count — and no heading of its own, because it is a row, not a section.
    expect(screen.getByRole("button", { name: /Mentions/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Mentions" })).toBeNull();
    cleanup();

    mount({ capabilities: { mentionsLayout: "category" } });
    // The /home face: a top-level HEADING, a peer of the other two, and nothing
    // to press first.
    const mentions = screen.getByRole("heading", { name: "Mentions" });
    expect(screen.queryByRole("button", { name: /Mentions/ })).toBeNull();
    // ⚠ AND BELOW THE STRIP, which is the same ruling — the position travels
    // with the face.
    const strip = screen.getByRole("heading", { name: "Channel activity" });
    expect(
      strip.compareDocumentPosition(mentions) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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
        infoExtras: (ctx) => {
          seen = ctx.gate;
          return { belowRoster: <p>slot</p> };
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

  // ⚠ **THE SAME ASSERTION, FOUR MORE FIELDS (wave 1A, 2026-09-17).** The
  // context is what the surface has ALREADY PAID FOR, and every field on it is
  // there because a host was re-reading it downstream — `members` twice more,
  // `activity` once more, `channelName` re-derived off the other projection, and
  // `index` (which carries the viewer) not resolved at all, which is F-723.
  // 🔒 **IDENTITY WHEREVER IT CAN BE, FOR THE GATE'S REASON:** a SHAPE assertion
  // passes against a value the tab minted for itself, and a tab minting its own
  // is precisely the defect. `members` is the surface's array by reference;
  // `index.currentUserId` is the id this surface was handed, not one re-resolved.
  it("hands the Info-tab slot the surface's own roster, viewer, series and name", () => {
    let seen: ChannelInfoTabContext | null = null;
    mount({
      slots: {
        infoExtras: (ctx) => {
          seen = ctx;
          return { belowRoster: <p>slot</p> };
        },
      },
    });
    const ctx = seen as unknown as ChannelInfoTabContext;
    expect(ctx.members.map((m) => m.userId)).toEqual([ME, PEER]);
    expect(ctx.index.currentUserId).toBe(ME);
    // The roster the tab is handed IS the roster the index was built over — one
    // read, not two that happen to agree in a fixture.
    expect(ctx.index.byId.get(ME)).toBe(ctx.members[0]);
    expect(ctx.channelName).toBe(CHANNEL.name);
    // ⚠ `loading` IS NOT `bins.length === 0`: an empty well is a MEASURED zero,
    // so the strip has to be able to tell "not counted yet" from "counted, quiet".
    expect(ctx.activity).toEqual({ bins: [], loading: expect.any(Boolean) });
  });

  /**
   * 🔒 **ADD MEMBER — F-721, RESOLVED 2026-09-17** (Samuel, answering R-46's
   * option (b) yes after taking (a) that morning).
   *
   * ⚠ **THE CASES ARE THE GATE, NOT THE PIXELS.** What R-46 deleted was an
   * `IconButton` with no `onClick` — a dead control — so the thing that has to be
   * pinned is that this one is NOT that: it is shown to exactly the readers the
   * server would let through, and pressing it reaches the dialog.
   * ⚠ **THE FLOOR IS MIRRORED, NOT INVENTED:** `channel-manage.tsx` hands the SAME
   * dialog `canManage || meetsMinRole(role, "admin")` for the Settings row, so a
   * case that passed here and failed there would mean two openers of one dialog
   * disagreeing about who may open it.
   */
  it("offers Add member to a channel owner, and opens the invite dialog", async () => {
    mount();
    // ⚠ NOT MOUNTED UNTIL IT IS ASKED FOR — the dialog opens two reads of its own.
    expect(screen.queryByTestId("invite-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByTestId("invite-dialog");
    // It opens with the manage answer this surface already resolved, not with a
    // second one the dialog re-derives.
    expect(dialog.getAttribute("data-can-manage")).toBe("true");
  });

  it("offers it to a workspace ADMIN who is only a channel member", () => {
    mount({ channel: { ...CHANNEL, role: "member" }, role: "admin" });
    expect(screen.getByRole("button", { name: "Add member" })).toBeTruthy();
  });

  it("does NOT offer it to a plain member, or to a guest", () => {
    mount({ channel: { ...CHANNEL, role: "member" }, role: "member" });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    cleanup();

    mount({ channel: { ...CHANNEL, role: "member" }, role: "guest" });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });

  it("does NOT offer it where the roster cannot be added to at all", () => {
    // /home and the guest lane: every member arrives by claiming a bound link,
    // so a workspace-level add answers `LINK_CONTAINER_CLOSED` at ANY size (§4A).
    mount({ capabilities: { memberManagement: false } });
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });

  // ⚠ R-46's OTHER HALF STAYS DELETED. (b) named only the add affordance.
  it("brings back no Filter members control", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Filter/i })).toBeNull();
  });
});
