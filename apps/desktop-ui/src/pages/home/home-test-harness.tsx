import { fireEvent, screen } from "@testing-library/react";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import {
  USER_ID,
  WORKSPACE,
  accountRoutes,
  noContent,
  ok,
  renderWithProviders,
} from "#/test-utils/bridge";
import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import { EMPTY_AGENT_POSTURE } from "@/features/channels/lib/agent-posture";
import type {
  Channel,
  ChannelMember,
  ChannelThread,
} from "@/features/channels/types";
import type { HomeChannelsPayload, HomePeer } from "@/features/home/types";
import {
  CHANNEL_ID,
  LINK_SEGMENT,
  LINK_WORKSPACE_ID,
} from "./home-test-ids";
// ⚠ TWO FACES' FIXTURES LIVE NEXT DOOR (2026-09-01) — this file sat at EXACTLY
// the 500-line cap, so the Overview wave could not add a row to it. Both are
// re-exported below: every suite still imports from THIS harness, one door.
import { overviewRoutes } from "./overview-test-harness";
import {
  EMPTY_TREE_PATH,
  KB_PRIVATE,
  knowledgeBases,
} from "./knowledge-test-harness";
import type {
  WorkspaceOverviewSeries,
  WorkspaceWithRole,
} from "@/features/workspaces/types";
import HomePage from "./index";

export {
  HOME_OVERVIEW,
  HOME_SERIES,
  SECOND_WORKSPACE_ID,
} from "./overview-test-harness";
export * from "./knowledge-test-harness";

/**
 * SHARED HOME-PAGE TEST HARNESS — the account surface's fixtures and its bridge
 * routing table, in one place.
 *
 * ⚠ EXTRACTED 2026-08-25 BECAUSE `index.test.tsx` REACHED THE 500-LINE CAP with
 * the link-out wave still to cover (§1: a file at the cap cannot absorb a new
 * entry). Two suites now read the same fixtures, which is the point — a second
 * copy of `HOME` is how two tests come to disagree about what a home channel
 * looks like.
 *
 * ⚠ THE SURFACE STUB IS *NOT* HERE. `vi.mock` is hoisted per file and its
 * factory may not close over module imports, so each suite declares its own —
 * 15 lines of stub is cheaper than a hoisting trap.
 */

// ⚠ THE IDS MOVED TO A LEAF MODULE (2026-09-01) — `home-test-ids.ts`, which
// carries why. In short: the two sub-harnesses below need them, they were
// declared HERE, and importing them back out of this file made a cycle that
// baked `undefined` into every fixture built at their module scope. Re-exported
// here, so every suite still reads them from this one door.
export {
  CHANNEL_ID,
  LINK_SEGMENT,
  LINK_WORKSPACE_ID,
  SEVEN_DAYS_MS,
} from "./home-test-ids";

/** The default fixture's one peer. Exported so a multi-peer case extends the
 *  roster rather than restating it. */
export const PRIYA: HomePeer = {
  userId: "user-2",
  displayName: "Priya Shah",
  email: "priya@shahco.tax",
  avatarUrl: null,
};
/** Second and third members, for the cap-is-gone cases (2026-08-26). ⚠ Their
 *  ORDER is the server's (`joined_at ASC`) — the client never re-sorts. */
export const DANA: HomePeer = {
  userId: "user-3",
  displayName: "Dana Ruiz",
  email: "dana@ruiz.co",
  avatarUrl: null,
};
export const OMAR: HomePeer = {
  userId: "user-4",
  displayName: "Omar Idris",
  email: "omar@idris.dev",
  avatarUrl: null,
};

export const HOME: HomeChannelsPayload = {
  channels: [
    {
      workspaceId: LINK_WORKSPACE_ID,
      workspaceSegment: LINK_SEGMENT,
      channelId: CHANNEL_ID,
      // ⚠ `peer` IS `peers[0]` — the server derives it, so a fixture where the
      // two disagree is a payload the API cannot emit.
      peers: [PRIYA],
      peer: PRIYA,
      name: "Priya Shah",
      createdAt: "2026-07-12T10:00:00.000Z",
      lastMessageAt: "2026-08-22T14:19:00.000Z",
      lastMessagePreview: "Three renewals over $1k before October",
      linkOut: null,
    },
  ],
  pendingLinks: [
    {
      id: "link-1",
      url: "https://dopl.link/c/x7Kd92mQ",
      label: null,
      createdAt: "2026-08-19T09:00:00.000Z",
      expiresAt: "2026-08-28T09:00:00.000Z",
      grantedRole: "guest",
      maxUses: 1,
      useCount: 0,
      revokedAt: null,
    },
  ],
};

// ⚠ TYPED, so a rename of any `Channel` field the endpoint sends breaks THIS
// fixture at compile time rather than leaving the §8 stale-cache suite green
// against a payload the endpoint stopped sending (F-322 test-quality wave).
export const CHANNEL: Channel = {
  id: CHANNEL_ID,
  workspaceId: LINK_WORKSPACE_ID,
  slug: "priya-shah",
  name: "Priya Shah",
  topic: "",
  visibility: "private",
  isDirect: true,
  directPeer: { userId: "user-2", displayName: "Priya Shah", avatarUrl: null },
  createdBy: USER_ID,
  archivedAt: null,
  createdAt: "2026-07-12T10:00:00.000Z",
  updatedAt: "2026-08-22T14:19:00.000Z",
  memberCount: 2,
  lastMessageAt: "2026-08-22T14:19:00.000Z",
  role: "owner",
  isMember: true,
  lastReadAt: null,
  unread: false,
  myNotifyScope: null,
  myAgentToolProfile: null,
  myFavoritedAt: null,
  onlineMemberCount: 1,
  // The card as shipped — nothing hidden, nothing added. Suites that exercise
  // the × or the add row override it (`person-info-tab.test.tsx`).
  infoCard: EMPTY_INFO_CARD,
  agentPosture: EMPTY_AGENT_POSTURE,
};

/** The container's roster, as `GET /api/channels/{id}/members` answers it — the
 *  caller plus, on a peer channel, the peer. ⚠ The Info tab reads this through
 *  `useChannelMembers`, on the SAME cache entry the surface uses. */
export const MEMBERS: { members: ChannelMember[] } = {
  members: [
    {
      channelId: CHANNEL_ID,
      userId: USER_ID,
      role: "owner",
      workspaceRole: "owner",
      lastReadAt: null,
      notifyScope: null,
      agentToolProfile: null,
      favoritedAt: null,
      agentOnline: false,
      lastSeenAt: null,
      addedBy: null,
      joinedAt: "2026-07-12T10:00:00.000Z",
      displayName: "Sam Wang",
      email: "sam@usedopl.com",
      avatarUrl: null,
    },
    {
      channelId: CHANNEL_ID,
      userId: "user-2",
      role: "member",
      workspaceRole: "member",
      lastReadAt: null,
      notifyScope: null,
      agentToolProfile: null,
      favoritedAt: null,
      agentOnline: false,
      lastSeenAt: null,
      addedBy: USER_ID,
      joinedAt: "2026-07-12T10:05:00.000Z",
      displayName: "Priya Shah",
      email: "priya@shahco.tax",
      avatarUrl: null,
    },
  ],
};

/** BOUNDARY: the route and its envelope keep the STORAGE name `tasks`; the
 *  domain name is `thread`. */
export const THREADS: { tasks: ChannelThread[]; truncated: boolean } = {
  tasks: [
    {
      id: "task-1",
      channelId: CHANNEL_ID,
      title: "Renewals over $1k",
      status: "open",
      outcome: null,
      mode: "interactive",
      workspaceId: LINK_WORKSPACE_ID,
      createdBy: USER_ID,
      targetUserId: null,
      createdAt: "2026-08-20T09:00:00.000Z",
      updatedAt: "2026-08-22T14:19:00.000Z",
      lastActivityAt: "2026-08-22T14:19:00.000Z",
      closedAt: null,
      outcomeSummary: null,
    },
  ],
  truncated: false,
};

/**
 * `GET /api/workspaces/[segment]/overview-series?metric=messages&channelId=` —
 * what the Info tab's activity strip draws. 31 counted daily bins, oldest
 * first, zero-filled server-side.
 *
 * ⚠ NOT ALL ZERO. A flat series quantises to 31 empty wells, which is a real
 * answer and an untestable picture: every assertion about the strip would pass
 * against a broken quantiser. One busy day gives the ramp something to reach.
 */
export const SERIES: WorkspaceOverviewSeries = {
  metric: "messages",
  days: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-07-${String(26 + i).padStart(2, "0")}`,
    count: i === 30 ? 6 : i % 7 === 0 ? 1 : 0,
  })),
};

/** ⚠ Carries a `kind: "link"` CONTAINER beside the real workspace on purpose:
 *  `GET /api/workspaces` is unfiltered, and the rail must drop it. */
export const WORKSPACES: { workspaces: WorkspaceWithRole[] } = {
  workspaces: [
    { ...WORKSPACE, role: "owner" },
    {
      ...WORKSPACE,
      id: LINK_WORKSPACE_ID,
      name: "Priya Shah",
      slug: "link-priya",
      publicId: "aa11bb",
      kind: "link",
      role: "member",
    },
  ],
};

export function routes(
  path: string,
  opts: BridgeRequestOpts
): Promise<BridgeResponse> | null {
  const bare = path.split("?")[0];
  if (bare === "/api/knowledge/bases") return knowledgeBases(opts, path);
  if (EMPTY_TREE_PATH.test(bare)) {
    return Promise.resolve(ok({ base: KB_PRIVATE, folders: [], entries: [] }));
  }
  if (bare === "/api/workspaces") return Promise.resolve(ok(WORKSPACES));
  if (bare === "/api/home/channels") {
    return Promise.resolve(ok(HOME));
  }
  if (bare === "/api/home/links") {
    return Promise.resolve(
      ok({ link: { ...HOME.pendingLinks[0], id: "link-2" } })
    );
  }
  if (bare.startsWith("/api/home/links/") && opts.method === "DELETE") {
    return Promise.resolve(noContent());
  }
  if (bare === "/api/channels") {
    return Promise.resolve(ok({ channels: [CHANNEL] }));
  }
  // ⚠ THE INFO TAB'S TWO REUSED READS. They are the SAME calls the channels
  // surface makes with the same arguments, so in the app they share one cache
  // entry and cost nothing — here they still have to be answered, or the
  // bridge rejects and the tab renders an error instead of a card.
  if (bare === `/api/channels/${CHANNEL_ID}/members`) {
    return Promise.resolve(ok(MEMBERS));
  }
  if (bare === `/api/channels/${CHANNEL_ID}/tasks`) {
    return Promise.resolve(ok(THREADS));
  }
  if (bare === `/api/workspaces/${LINK_SEGMENT}/overview-series`) {
    return Promise.resolve(ok(SERIES));
  }
  // The info-card write rides the channel header's own PATCH.
  if (bare === `/api/channels/${CHANNEL_ID}` && opts.method === "PATCH") {
    const patch = (opts.body ?? {}) as { infoCard?: unknown };
    return Promise.resolve(
      ok({ channel: { ...CHANNEL, infoCard: patch.infoCard ?? EMPTY_INFO_CARD } })
    );
  }
  // The Overview face's reads — see `overviewRoutes` for why the scoped and
  // unscoped overview paths answer different bodies.
  const overview = overviewRoutes(path);
  if (overview) return overview;
  // Identity + the caller's profile row — `#/test-utils/bridge › accountRoutes`.
  return accountRoutes(bare);
}

/** A channel with nobody in it yet — the state "Add person" acts on. */
export const SOLO_CHANNEL: HomeChannelsPayload["channels"][number] = {
  ...HOME.channels[0],
  name: "Q3 Fundraise",
  peers: [],
  peer: null,
  lastMessageAt: null,
  lastMessagePreview: null,
};

/** THREE people in one container — the shape the retired two-member cap made
 *  unrepresentable (Samuel, 2026-08-26). The avatar stack, the counted title and
 *  the dropped Email row all key off this. */
export const CROWDED_CHANNEL: HomeChannelsPayload["channels"][number] = {
  ...HOME.channels[0],
  peers: [PRIYA, DANA, OMAR],
  peer: PRIYA,
};

/**
 * 🔒 THE STALE-CACHE SHAPE (INVARIANTS §8) — a payload written by a bundle that
 * predates `peers`, served from IndexedDB on the FIRST PAINT after the upgrade.
 * It HAS `peer` and LACKS `peers`, which is why the client's fallback is a
 * two-field MERGE and not a plain `?? EMPTY_PEERS`: falling back to "nobody"
 * would paint every one of the operator's channels as solo.
 *
 * ⚠ THE CAST IS THE POINT AND IS NOT LAZINESS. The wire type is non-optional and
 * is RIGHT — the API always sends the key now. `delete` reproduces the only
 * moment where it is absent, and typing the fixture as `HomeChannel` would make
 * that moment unrepresentable in the very test written to cover it.
 */
export function staleCachedChannel(): HomeChannelsPayload["channels"][number] {
  const stale: Record<string, unknown> = { ...HOME.channels[0] };
  delete stale.peers;
  return stale as unknown as HomeChannelsPayload["channels"][number];
}

/** An invitation already out on that channel — what the chip and the Link out
 *  section render from. ⚠ A BOUND link is never also a `pendingLinks` row. */
export const LINK_OUT: NonNullable<
  HomeChannelsPayload["channels"][number]["linkOut"]
> = {
  id: "link-bound-1",
  url: "https://dopl.link/c/bound99",
  label: null,
  createdAt: "2026-08-24T09:00:00.000Z",
  expiresAt: "2026-08-31T09:00:00.000Z",
  // ⚠ `member`, not the default — the fixture that renders "Joins as member" is
  // the one that would go silent if `mapLinkRow` stopped projecting the field.
  grantedRole: "member",
  maxUses: 1,
  useCount: 0,
  revokedAt: null,
};

/** Serve a different channels payload; everything else routes normally. */
export function withHome(payload: HomeChannelsPayload) {
  return (path: string, opts: BridgeRequestOpts = {}) =>
    path.split("?")[0] === "/api/home/channels"
      ? Promise.resolve(ok(payload))
      : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)));
}

export function renderHome() {
  return renderWithProviders(
    [
      { path: "/home", element: <HomePage /> },
      { path: "/:workspaceSegment", element: <p>Workspace page</p> },
    ],
    ["/home"]
  );
}

/**
 * RAISE THE CHANNELS FACE.
 *
 * ⚠ **NEEDED SINCE 2026-09-01, WHEN THE PAGE'S DEFAULT MOVED TO OVERVIEW**
 * (Samuel; `home-tabs.ts › HOME_DEFAULT_TAB`). Every suite on this page that
 * wants the record pane used to get it for free on first paint. Clicking the
 * real header control is deliberate — nothing here bypasses the pane token, so
 * the crossfade runs exactly as it does for an operator.
 *
 * ⚠ IT DOES NOT AWAIT THE SURFACE: a suite with an empty channel list has no
 * surface to wait for, and gating on one here would hang those cases. Callers
 * that need the pane await it themselves, as they already did.
 */
export async function openChannels(): Promise<void> {
  fireEvent.click(await screen.findByRole("tab", { name: "Channels" }));
  await screen.findByRole("tab", { name: "Channels", selected: true });
}

/**
 * Raise the Channels face AND wait for its record pane.
 *
 * ⚠ THE COMMON CASE, kept as one call because it is two statements in nineteen
 * places in `person-info-tab.test.tsx` alone — and that file sits AT the
 * 500-line cap, where nineteen extra lines is the difference between a suite
 * that lints and one that does not.
 */
export async function openChannelRecord(): Promise<HTMLElement> {
  await openChannels();
  return screen.findByTestId("channel-surface");
}

/** Answer everything normally except one path, which fails. */
export function failing(target: string, response: BridgeResponse) {
  return (path: string, opts: BridgeRequestOpts = {}) =>
    path.split("?")[0] === target
      ? Promise.resolve(response)
      : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)));
}

