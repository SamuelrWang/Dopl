import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import ChannelsPage from "#/pages/channels";
import { SEGMENT } from "#/test-utils/bridge";
import type {
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
} from "@/features/channels/types";

/**
 * Channels page smoke test, AFTER THE CUTOVER (wiring plan Phase 12,
 * 2026-08-18). This file used to mount the two-pane `ChannelsViewCore`; that
 * tree is deleted and `/:workspaceSegment/channels` now mounts the three-column
 * surface (`components/channels-v2/channels-v2-core.tsx`) that lived behind a
 * temporary `channels-v2` route until the rename.
 *
 * What is pinned here is the SEAM, not the surface — every column has its own
 * suite next to the component:
 *
 *  - the page resolves the workspace once and every live surface issues its OWN
 *    initial fetch, which is what keeps first paint correct with the realtime
 *    doorbell silent;
 *  - the `:channelId` route selects that channel (the desktop notification's
 *    landing route — `main/shell-mode.js › CHANNELS_PAGE` builds it);
 *  - the consent decision is IN THE INBOX and not in the transcript. That moved
 *    with the surface: the old page rendered a launch panel at the end of the
 *    scroller, the new one puts it behind the sidebar's Inbox row with a badge
 *    (F-214 is the gap that leaves in the channel view). The WRITE is unchanged
 *    — the same `PATCH /consent/[id]` with the same `"allow"`.
 *  - the channel-management controls the cutover carried over are REACHABLE.
 *    They were the old header's, and orphaning them was the demolition's one
 *    real risk.
 *
 * `fetch` is the mock point — the seam both clients share (SPA's `#/lib/api`
 * and `@/shared/api/api-client`, which the channels feature client calls
 * directly for every mutation).
 *
 * ⚠ Supabase stubbed at the browser-client module: jsdom has no `window.dopl`,
 * so the realtime registry does NOT take its SPA short-circuit and would reach
 * for a Supabase config the renderer has none of. Stub keeps the subscriptions
 * wiring for real without a websocket. Assertions deliberately do NOT depend on
 * a realtime event — every surface loads from its own fetch.
 */

vi.mock("@/shared/supabase/browser", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    getSupabaseBrowser: () => ({
      channel: () => channel,
      removeChannel: () => {},
      // `CreateChannelDialog` mounts `useAuthUserState`, which falls through to
      // the Supabase client without a `window.dopl` bridge (jsdom).
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    }),
  };
});

const CHANNEL_ID = "ch-1";
const OTHER_ID = "ch-2";

/** ⚠ Fresh per test: realtime registry shares one channel per workspace id
 *  across mounts (module singleton + teardown grace window), so a reused id
 *  hands the second test the first test's already-connected entry. */
let workspaceId = "";
let workspaceSeq = 0;

const baseChannel: Channel = {
  id: CHANNEL_ID,
  workspaceId: "",
  slug: "migration",
  name: "migration",
  topic: "Desktop port",
  visibility: "private",
  isDirect: false,
  directPeer: null,
  createdBy: "u-1",
  archivedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  memberCount: 2,
  lastMessageAt: "2026-08-01T12:00:00.000Z",
  role: "owner",
  isMember: true,
  lastReadAt: null,
  unread: false,
  myNotifyScope: "all",
  myAgentToolProfile: "full",
  myFavoritedAt: null,
  onlineMemberCount: 1,
};

const OTHER: Channel = {
  ...baseChannel,
  id: OTHER_ID,
  slug: "brand",
  name: "brand",
  topic: "Brand work",
};

const MESSAGES: ChannelMessage[] = [
  {
    id: "m-1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: "u-2",
    authorKind: "user",
    kind: "message",
    body: "Can your agent take the channels port?",
    metadata: { taskId: "t-1" },
    clientMsgId: null,
    createdAt: "2026-08-01T11:59:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  },
  {
    id: "m-2",
    seq: 2,
    channelId: CHANNEL_ID,
    authorUserId: "u-1",
    authorKind: "agent",
    kind: "message",
    body: "Picked it up, wiring the client queries now.",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
  },
];

const MEMBERS: ChannelMember[] = [
  {
    channelId: CHANNEL_ID,
    userId: "u-1",
    role: "owner",
    lastReadAt: null,
    notifyScope: "all",
    agentToolProfile: "full",
    favoritedAt: null,
    agentOnline: true,
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    addedBy: null,
    joinedAt: "2026-08-01T10:00:00.000Z",
    displayName: "Sam",
    email: "sam@example.com",
    avatarUrl: null,
  },
  {
    channelId: CHANNEL_ID,
    userId: "u-2",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: "u-1",
    joinedAt: "2026-08-01T10:05:00.000Z",
    displayName: "Ada",
    email: "ada@example.com",
    avatarUrl: null,
  },
];

/** ONE thread on the primary channel — the pop-out's landing needs something real
 *  to select, and the `?thread=` case below is the whole reason it is here. */
const THREAD_ID = "t-1";
const THREAD = {
  id: THREAD_ID,
  channelId: CHANNEL_ID,
  workspaceId: "",
  title: "Ship the release",
  status: "open",
  outcome: null,
  mode: "collab",
  createdBy: "u-1",
  targetUserId: null,
  createdAt: "2026-08-01T11:00:00.000Z",
  updatedAt: "2026-08-01T11:00:00.000Z",
  closedAt: null,
  outcomeSummary: null,
  lastActivityAt: "2026-08-01T12:00:00.000Z",
};

const CONSENT: ChannelConsentRequest = {
  id: "cr-1",
  channelId: CHANNEL_ID,
  workspaceId: "",
  operatorUserId: "u-1",
  requesterUserId: "u-2",
  kind: "inbound",
  messageSeq: 1,
  summary: "Run the channels port",
  bodyPreview: "Can your agent take the channels port?",
  proposedReply: null,
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-08-01T12:01:00.000Z",
  expiresAt: null,
  requesterName: "Ada",
  requesterAvatarUrl: null,
};

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[];
/** Flipped by the consent PATCH so the follow-up inbox read comes back empty,
 *  as the real service does (`pending` rows only). */
let consentDecided = false;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  workspaceId = `ws-${++workspaceSeq}`;
  calls = [];
  consentDecided = false;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const path = url.split("?")[0];
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    // ONE read for workspace + role + caller id; `resolve` and `me` seeded
    // from it, so the page never waits on them in series.
    if (path === "/api/boot") {
      return json({
        isOnboarded: true,
        surveyCompleted: true,
        userId: "u-1",
        workspace: { id: workspaceId, name: "Acme", slug: "acme", publicId: "ab12cd" },
        segment: SEGMENT,
        needsRedirect: false,
        role: "admin",
        myAccess: { defaultLevel: "edit", overrides: [] },
      });
    }
    if (path === `/api/workspaces/${SEGMENT}/members`) return json({ members: [] });
    if (path === "/api/channels") {
      return json({
        channels: [
          { ...baseChannel, workspaceId },
          { ...OTHER, workspaceId },
        ],
      });
    }
    const channelId = /^\/api\/channels\/(ch-\d)\//.exec(path)?.[1];
    if (channelId && path.endsWith("/messages")) {
      return json({ messages: channelId === CHANNEL_ID ? MESSAGES : [] });
    }
    if (channelId && path.endsWith("/members")) {
      return json({ members: channelId === CHANNEL_ID ? MEMBERS : [] });
    }
    if (channelId && path.endsWith("/tasks")) {
      return json({ tasks: channelId === CHANNEL_ID ? [THREAD] : [] });
    }
    if (channelId && path.endsWith("/mentions")) return json({ mentions: [] });
    if (path === "/api/channels/consent") {
      return json({
        requests: consentDecided ? [] : [{ ...CONSENT, workspaceId }],
      });
    }
    if (path === "/api/channels/trust") return json({ rules: [] });
    if (path === "/api/channels/consent/cr-1" && method === "PATCH") {
      consentDecided = true;
      return json({
        request: { ...CONSENT, workspaceId, status: "allowed", decidedBy: "web" },
      });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** Both rows are the SAME page component; `channelId` is what differs — and,
 *  since wiring plan Phase 10, an optional `?thread=` SELECTION on the second one. */
function renderPage(channelId?: string, threadId?: string) {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/channels", element: <ChannelsPage /> },
      { path: "/:workspaceSegment/channels/:channelId", element: <ChannelsPage /> },
    ],
    {
      initialEntries: [
        channelId
          ? `/${SEGMENT}/channels/${channelId}${threadId ? `?thread=${threadId}` : ""}`
          : `/${SEGMENT}/channels`,
      ],
    }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const requestsTo = (path: string, method = "GET") =>
  calls.filter((c) => c.url.split("?")[0] === path && c.method === method);

describe("channels page", () => {
  it("resolves the workspace, then loads the tree and the transcript", async () => {
    renderPage();

    expect(
      await screen.findByText("Picked it up, wiring the client queries now.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Can your agent take the channels port?")
    ).toBeInTheDocument();

    expect(requestsTo("/api/boot", "POST")[0].body).toEqual({ segment: SEGMENT });
    expect(requestsTo("/api/workspaces/me")).toHaveLength(0);

    // ⚠ Every live surface needs its OWN initial fetch: that is what keeps the
    // page correct on first paint with the realtime doorbell silent.
    for (const path of [
      "/api/channels",
      `/api/channels/${CHANNEL_ID}/messages`,
      `/api/channels/${CHANNEL_ID}/members`,
      `/api/channels/${CHANNEL_ID}/tasks`,
      `/api/channels/${CHANNEL_ID}/mentions`,
      "/api/channels/consent",
    ]) {
      expect(requestsTo(path).length).toBeGreaterThan(0);
      expect(requestsTo(path)[0].headers["x-workspace-id"]).toBe(workspaceId);
    }

    // ⚠ `/api/channels/trust` is NOT in that list any more (2026-08-19). The
    // manage cluster moved off the pane header into the right panel's SETTINGS
    // tab, so `useTrustRules` mounts with the tab rather than with the page —
    // which is the point: a read behind a closed tab is a read nobody asked for.
    expect(requestsTo("/api/channels/trust")).toHaveLength(0);
  });

  it("opens the channel the ROUTE names, not the first row", async () => {
    // THE DESKTOP NOTIFICATION'S LANDING ROUTE (wiring plan Phase 9, renamed
    // off `channels-v2` at the cutover). The page reads the param and hands it
    // down; the shared tree is router-free and takes it as a plain prop.
    renderPage(OTHER_ID);

    await waitFor(() =>
      expect(requestsTo(`/api/channels/${OTHER_ID}/messages`).length).toBeGreaterThan(0)
    );
    expect(requestsTo(`/api/channels/${CHANNEL_ID}/messages`)).toHaveLength(0);
  });

  it("opens the THREAD the query names — the pop-out window's landing", async () => {
    // ⚠ NOT A ROUTE (wiring plan Phase 10, 2026-08-18). Main opens the pop-out on
    // `/{segment}/channels/{channelId}?thread={threadId}` — the SAME `:channelId` row
    // above, with no new `routes.tsx` entry and no deep-link grammar change, because a
    // thread is not a page: it is which transcript this page has open. The page reads the
    // search param and hands it down as a plain prop, exactly as it does the channel.
    renderPage(CHANNEL_ID, THREAD_ID);

    // The thread view replaces the channel's own rows: the crumb becomes
    // `# channel / title` and the channel crumb is THE WAY BACK (a button).
    const crumb = await screen.findByLabelText("Breadcrumb");
    await waitFor(() =>
      expect(within(crumb).getByRole("button", { name: "migration" })).toBeInTheDocument()
    );
    expect(within(crumb).getByText("Ship the release")).toBeInTheDocument();
  });

  it("lands on the CHANNEL view when the query names no thread", async () => {
    renderPage(CHANNEL_ID);
    await screen.findByText("Picked it up, wiring the client queries now.");
    // No crumb trail: the channel name is plain text, with nothing to go back to.
    const crumb = screen.getByLabelText("Breadcrumb");
    expect(within(crumb).queryByRole("button")).not.toBeInTheDocument();
    expect(within(crumb).getByText("migration")).toBeInTheDocument();
  });

  it("decides a pending ask INLINE; the Inbox is a passive list that navigates", async () => {
    renderPage();

    // The decision lives on the transcript's own surfaces now (Samuel,
    // 2026-08-20): the thread card carries Launch agent / Decline. The Inbox
    // is a PASSIVE list — a row navigates to its channel and renders no verb.
    const inbox = await screen.findByRole("button", { name: /Inbox/ });
    // The card's decision is already on the transcript before any nav.
    await screen.findByRole("button", { name: "Launch agent" });

    fireEvent.click(inbox);
    // The pane lists the waiting ask, but offers no decision.
    const row = await screen.findByText("Ada's agent is asking");
    expect(
      screen.queryByRole("button", { name: "Launch agent" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Decline" })
    ).not.toBeInTheDocument();

    // The row is the navigation: back to the channel, where the card decides.
    fireEvent.click(row.closest("button")!);
    const cardLaunch = await screen.findByRole("button", {
      name: "Launch agent",
    });
    fireEvent.click(cardLaunch);

    await waitFor(() =>
      expect(requestsTo("/api/channels/consent/cr-1", "PATCH")).toHaveLength(1)
    );
    const patch = requestsTo("/api/channels/consent/cr-1", "PATCH")[0];
    expect(patch.body).toEqual({ decision: "allow" });
    expect(patch.headers["x-workspace-id"]).toBe(workspaceId);

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Launch agent" })
      ).not.toBeInTheDocument()
    );
  });

  it("keeps the channel-management surface reachable after the demolition", async () => {
    // The cutover deleted the page that owned these entry points. Every one of
    // them was on the old header or its list pane, and the plan's KEEP list
    // names them — an unreachable dialog is a deleted feature with a file still
    // in the tree, which `npx knip` would not even flag.
    //
    // ⚠ THEY MOVED AGAIN ON 2026-08-19, WHICH IS WHY THIS TEST OPENS A TAB. The
    // pane header now carries the info toggle and nothing else; the cluster is
    // the right panel's SETTINGS tab, where the Links empty state used to be.
    // The sidebar's two `+` entries did NOT move.
    renderPage();

    await screen.findByText("Picked it up, wiring the client queries now.");
    expect(screen.getByRole("button", { name: "Add channel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New direct message" })
    ).toBeInTheDocument();

    // Nothing channel-scoped is on the header any more — not even mounted.
    expect(screen.queryByRole("radiogroup", { name: "Tools" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    // ⚠ THE PER-CHANNEL SETTINGS ARE THE TAB ITSELF NOW (2026-08-19, second
    // ruling the same day): the popover behind "Channel settings" was DELETED
    // and its controls are inline, so the entry point to look for is the
    // control, not a button that opens one. The kebab's four items are rows.
    expect(screen.getByRole("radiogroup", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make public" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete channel" })).toBeInTheDocument();

    // And the tab's own read arrives with it, not before it.
    await waitFor(() =>
      expect(requestsTo("/api/channels/trust").length).toBeGreaterThan(0)
    );
  });

  it("has no Links tab left to render an empty state into", async () => {
    // It was a deliberate empty state ("No links in this channel yet.") holding
    // the slot Settings took. Nothing was rehomed out of it — there was nothing
    // in it — and where a channel's files and links land is still open.
    renderPage();

    await screen.findByText("Picked it up, wiring the client queries now.");
    expect(screen.queryByRole("tab", { name: "Links" })).toBeNull();
    expect(screen.queryByText("No links in this channel yet.")).toBeNull();
  });
});
