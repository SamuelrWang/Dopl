// @vitest-environment jsdom
/**
 * 🔒 THE GUEST SURFACE MUST NOT ISSUE A REQUEST IT WILL GET 403 ON (2026-08-26).
 *
 * `useChannelSurfaceData` mounts for EVERY host of the per-channel surface, the
 * guest web lane (`src/app/c/[workspaceId]`) included, and three of its reads
 * were outside the guest-allowed route set — TWO of them on a poll loop:
 *
 *   | read                                  | route                                   | fix        |
 *   |---------------------------------------|-----------------------------------------|------------|
 *   | `useChannelMentions`                  | `GET …/[channelId]/mentions`            | LOWER      |
 *   | `useConsentInbox` (CONSENT_INBOX_POLL_MS) | `GET /api/channels/consent`         | DON'T MOUNT|
 *   | `useAgentsPanel → useChannelAgentSessions` (poll + doorbell) | `GET …/sessions` | LOWER  |
 *
 * The two LOWERED routes are pinned by `app/api/channels/guest-route-floor.test.ts`.
 * THIS file pins the one that is NOT mounted, which no route test can see: a
 * capability that hides a control while its read keeps firing is half a
 * capability, and the failure is silent — a 403 every 30 s, forever, plus a
 * `channel_consent_requests` subscription that correctly delivers a guest
 * nothing, which §7 calls worse than no subscription because it looks like
 * coverage.
 *
 * WHY `selfManagement` AND NOT A NEW FLAG: an OUTBOUND consent row is a draft
 * the VIEWER'S OWN agent wrote and is waiting on them to release. `selfManagement:
 * false` is exactly the statement "this viewer runs no agent here"
 * (`channel-surface.tsx › ChannelSurfaceCapabilities`), so the read can only
 * ever answer `[]`. One flag, one story — Samuel's R2/R3 ruling applied to the
 * data layer instead of only to the rendering.
 *
 * ⚠ MUTATION-VERIFY: reverting the consent read to `useConsentInbox(workspaceId, …)`
 * turns the guest case red and leaves the operator case green.
 *
 * ── THE KNOWLEDGE TAB'S READS ARE GONE (Samuel's ruling R-18, 2026-09-17) ───
 * A FOURTH thing this file guarded was the Knowledge tab's three URLs, resolved
 * down `src/app/api` to the `route.ts` that served each and read for its floor.
 * The capability had no host after 2026-09-04, so the tab, its hook, its client
 * lane and all four routes are deleted and there is nothing left to resolve. The
 * property is not lost: `app/api/channels/guest-route-floor.test.ts` still sweeps
 * every surviving route under `/api/channels` for its declared floor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { CONSENT_INBOX_POLL_MS } from "../constants";

const empty = { refetch: vi.fn() };

vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, ...empty }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({ members: [], ...empty }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({ threads: [], truncated: false, loading: false, ...empty }),
}));
vi.mock("../hooks/use-channel-mentions", () => ({
  useChannelMentions: vi.fn(() => ({
    mentions: [],
    truncated: false,
    loading: false,
    ...empty,
  })),
}));
vi.mock("../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: vi.fn() }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: vi.fn(),
    consent: vi.fn(),
    unaddressedResponder: { mutate: vi.fn(), pending: false },
  }),
}));
// The escalation card's ANSWER write (2026-08-31). ⚠ Mocked for the reason the
// two writes above are, and for one more that matters to THIS file: it is the
// first thing in `useChannelSurfaceData` to call `useQueryClient`, so unmocked
// it demands a `QueryClientProvider` this suite deliberately does not mount —
// every read here is stubbed precisely so the hook can be driven with no client.
// ⚠ It issues NO READ, so it says nothing about the guest question this file
// exists to answer.
vi.mock("../hooks/use-escalation-writes", () => ({
  useEscalationWrites: () => ({
    answer: { mutate: () => {}, pending: false },
    pending: false,
  }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: vi.fn(() => ({ requests: [], outbound: [], refetch: vi.fn() })),
}));
// The channel ACTIVITY strip's series (2026-09-05, the heatmap wiring). ⚠ Stubbed for the same
// reason as the writes above — it is a `useQuery` and this suite deliberately mounts no
// `QueryClientProvider` — and NOT because a guest must not have it: Samuel ruled 2026-09-05 that
// the strip is CHANNEL data and anyone in the channel may read it, guest included. That makes it
// silent on the question this file exists to answer, which is whose CONSENT INBOX mounts.
vi.mock("@/features/workspaces/hooks/use-overview-series", () => ({
  useOverviewSeries: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: null, refresh: vi.fn() }),
}));
vi.mock("./use-agents-panel", () => ({
  useAgentsPanel: () => ({ peerSessions: [], refetch: vi.fn() }),
}));
vi.mock("./derivations", () => ({ useChannelsDerivations: () => ({}) }));
vi.mock("./use-inline-consent", () => ({
  useInlineConsent: () => ({
    outboundByThread: new Map(),
    decideOutbound: vi.fn(),
    consentBusy: false,
  }),
}));

import { useChannelSurfaceData } from "./channel-surface-data";
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useChannelMentions } from "../hooks/use-channel-mentions";
import type { Channel } from "../types";
import type { ChannelSurfaceCapabilities } from "./channel-surface";

const WS = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = { id: "44444444-4444-4444-8444-444444444444" } as Channel;

function mount(capabilities?: ChannelSurfaceCapabilities) {
  return renderHook(() =>
    useChannelSurfaceData({
      workspaceId: WS,
      channel: CHANNEL,
      currentUserId: USER,
      openThreadId: null,
      capabilities,
    })
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the consent inbox is NOT mounted for a viewer with no agent of their own", () => {
  it("passes NULL workspaceId when selfManagement is false — no query, no subscription", () => {
    mount({ memberManagement: false, selfManagement: false });
    // `use-consent-inbox.ts` gates BOTH the `useApiQuery` url and the
    // `useConsentRealtime` binding on this argument, so one null disables the
    // poll and the socket together.
    expect(vi.mocked(useConsentInbox)).toHaveBeenCalledWith(
      null,
      undefined,
      CONSENT_INBOX_POLL_MS
    );
  });

  it("still mounts it for the DESKTOP home surface, which passes memberManagement only", () => {
    // ⚠ THE ASYMMETRY IS THE POINT (`ChannelSurfaceCapabilities`):
    // `memberManagement` is about the CONTAINER (a fixed two-person roster),
    // `selfManagement` is about the VIEWER. The operator absolutely does manage
    // their own agent in their own home channel.
    mount({ memberManagement: false });
    expect(vi.mocked(useConsentInbox)).toHaveBeenCalledWith(
      WS,
      undefined,
      CONSENT_INBOX_POLL_MS
    );
  });

  it("still mounts it when no capabilities are passed at all", () => {
    mount();
    expect(vi.mocked(useConsentInbox)).toHaveBeenCalledWith(
      WS,
      undefined,
      CONSENT_INBOX_POLL_MS
    );
  });
});

describe("the reads a guest DOES keep", () => {
  it("still mounts the mention inbox — it is the guest's OWN, and the route was lowered", () => {
    // The alternative fix (don't mount) was rejected: a guest can be @-mentioned
    // by the operator's agent, and the Tags inbox is where they see it. The read
    // is own-scoped by `ctx.userId` inside the service, so lowering the floor
    // widens nothing.
    mount({ memberManagement: false, selfManagement: false });
    expect(vi.mocked(useChannelMentions)).toHaveBeenCalledWith(CHANNEL.id, WS);
  });
});

/**
 * 🔒 **THE KNOWLEDGE TAB'S THREE URLS ARE GONE (Samuel's ruling R-18, 2026-09-17).**
 * A `describe` block stood here that resolved each of the lane's URLs down
 * `src/app/api` and asserted its floor was `guest`. The tab, its hook, its client
 * lane and all four routes are deleted, so there is nothing left to point at a
 * floor. ⚠ **THE PROPERTY IT BOUGHT IS NOT LOST** — `src/app/api/channels ›
 * guest-route-floor.test.ts` still sweeps EVERY route under `/api/channels` for its
 * declared floor, and this file's remaining cases still pin what the surface
 * requests per capability.
 */
