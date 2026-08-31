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
 * ── THE KNOWLEDGE TAB'S READS (Home Knowledge Panels M4) ────────────────────
 * The tab the guest lane turned on is the FOURTH thing this file guards, and it
 * is guarded differently because it is a different failure. Its reads are not in
 * `useChannelSurfaceData` at all — they mount with the tab — so what has to be
 * pinned is not "is it mounted" but "is the route it addresses one a guest may
 * reach". The last describe resolves each URL the tab builds down to the
 * `route.ts` that serves it and reads the FLOOR out of that file's own source,
 * the same technique `app/api/channels/guest-route-floor.test.ts` uses. A path
 * typo, a moved route, or a lowered floor all fail it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { CONSENT_INBOX_POLL_MS } from "../../constants";

const empty = { refetch: vi.fn() };

vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, ...empty }),
}));
vi.mock("../../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({ members: [], ...empty }),
}));
vi.mock("../../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({ threads: [], truncated: false, loading: false, ...empty }),
}));
vi.mock("../../hooks/use-channel-mentions", () => ({
  useChannelMentions: vi.fn(() => ({
    mentions: [],
    truncated: false,
    loading: false,
    ...empty,
  })),
}));
vi.mock("../../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: vi.fn() }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({ favorite: vi.fn(), consent: vi.fn() }),
}));
// The escalation card's ANSWER write (2026-08-31). ⚠ Mocked for the reason the
// two writes above are, and for one more that matters to THIS file: it is the
// first thing in `useChannelSurfaceData` to call `useQueryClient`, so unmocked
// it demands a `QueryClientProvider` this suite deliberately does not mount —
// every read here is stubbed precisely so the hook can be driven with no client.
// ⚠ It issues NO READ, so it says nothing about the guest question this file
// exists to answer.
vi.mock("../../hooks/use-escalation-writes", () => ({
  useEscalationWrites: () => ({
    answer: { mutate: () => {}, pending: false },
    pending: false,
  }),
}));
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: vi.fn(() => ({ requests: [], outbound: [], refetch: vi.fn() })),
}));
vi.mock("./live", () => ({ useChannelsV2Live: () => ({ gate: {} }) }));
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: null, refresh: vi.fn() }),
}));
vi.mock("./use-agents-panel", () => ({
  useAgentsPanel: () => ({ peerSessions: [], refetch: vi.fn() }),
}));
vi.mock("./derivations", () => ({ useChannelsV2Derivations: () => ({}) }));
vi.mock("./use-inline-consent", () => ({
  useInlineConsent: () => ({
    outboundByThread: new Map(),
    decideOutbound: vi.fn(),
    consentBusy: false,
  }),
}));

import { useChannelSurfaceData } from "./channel-surface-data";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelMentions } from "../../hooks/use-channel-mentions";
import { stripComments, workspaceFloor } from "@/shared/auth/route-floor-parser";
import {
  channelKnowledgeBasesPath,
  channelKnowledgeEntryPath,
  channelKnowledgeTreePath,
} from "./knowledge-lane";
import type { Channel } from "../../types";
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

  it("still mounts it when no capabilities are passed at all — the workspace page", () => {
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
 * 🔒 THE KNOWLEDGE TAB'S THREE URLS, RESOLVED TO THEIR ROUTES AND READ FOR THE
 * FLOOR (M4).
 *
 * ⚠ THE ROUTE FILE IS FOUND, NOT NAMED. Each concrete URL is walked down
 * `src/app/api`, taking an exact directory where one exists and the `[dynamic]`
 * one otherwise — so this pin follows the tab's OWN path builders to whatever
 * file actually answers them. Hard-coding the four file paths would pass against
 * a tab that had quietly started asking somewhere else.
 *
 * ⚠ THE FLOOR IS A TRIPWIRE, NOT THE GATE. What actually admits the caller is
 * the channel-membership fence plus the `(knowledge_base, channel)` grant row
 * (`shared/api/channel-knowledge-lane.ts`, `service-channel-grants.ts`), and
 * those have their own suites. What THIS assertion buys is the thing a fence
 * test cannot see: that the SURFACE is pointed at the lane at all.
 */
describe("the Knowledge tab reads only routes a guest may reach", () => {
  const API_ROOT = join(import.meta.dirname, "../../../../app/api");
  const BASE = "55555555-5555-4555-8555-555555555555";
  const ENTRY = "66666666-6666-4666-8666-666666666666";

  /** The `route.ts` that serves one concrete URL. */
  function routeFileFor(url: string): string {
    let dir = API_ROOT;
    for (const segment of url.replace(/^\/api\//, "").split("/")) {
      const dirs = readdirSync(dir, { withFileTypes: true }).filter((e) =>
        e.isDirectory()
      );
      const next =
        dirs.find((e) => e.name === segment) ??
        dirs.find((e) => e.name.startsWith("["));
      if (!next) throw new Error(`no route serves "${segment}" under ${dir}`);
      dir = join(dir, next.name);
    }
    return join(dir, "route.ts");
  }

  const READS: ReadonlyArray<readonly [string, "GET" | "PUT"]> = [
    [channelKnowledgeBasesPath(CHANNEL.id), "GET"],
    [channelKnowledgeTreePath(CHANNEL.id, BASE), "GET"],
    [channelKnowledgeEntryPath(CHANNEL.id, ENTRY), "GET"],
    // ⚠ The WRITE is on the list too. The tab only offers it where the grant
    // says `guest_write`, but the route it posts to must be one the caller can
    // reach at all — a `member`-floored PUT would refuse the guest before the
    // grant was ever consulted, and the refusal would read as a save that
    // silently failed.
    [channelKnowledgeEntryPath(CHANNEL.id, ENTRY), "PUT"],
  ];

  it.each(READS)("%s %s is at minRole guest", (url, method) => {
    const src = readFileSync(routeFileFor(url), "utf8");
    expect(workspaceFloor(src, method)).toBe("guest");
  });

  it("builds every URL through the lane module — no hand-written /api path", () => {
    // ⚠ The one way this pin can be walked around is a `fetch("/api/knowledge/…")`
    // written straight into a component, which no route scan would ever see.
    for (const file of [
      "knowledge-lane.ts",
      "knowledge-tab.tsx",
      "knowledge-entry.tsx",
      "use-channel-knowledge.ts",
    ]) {
      // ⚠ COMMENTS STRIPPED FIRST — these modules NAME the lane's routes in
      // their docblocks, which is the whole point of the docblocks. The same
      // `stripComments` the route-floor sweep uses, for the same reason.
      const src = stripComments(
        readFileSync(join(import.meta.dirname, file), "utf8")
      );
      expect(src).not.toMatch(/["'`]\/api\//);
    }
  });
});
