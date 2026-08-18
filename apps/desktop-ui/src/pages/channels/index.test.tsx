import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 * Channels page smoke test: REAL `ChannelsViewCore` tree over a mocked data
 * layer. `fetch` is the mock point — the seam both clients share (SPA's
 * `#/lib/api` and `@/shared/api/api-client`, which the channels feature client
 * calls directly for every mutation).
 *
 * ⚠ Supabase stubbed at the browser-client module: jsdom has no `window.dopl`,
 * so the realtime registry does NOT take its SPA short-circuit and would reach
 * for a Supabase config the renderer has none of. Stub keeps the four
 * subscriptions wiring for real without a websocket. Assertions deliberately do
 * NOT depend on a realtime event — every surface loads from its own fetch.
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

/** ⚠ Fresh per test: realtime registry shares one channel per workspace id
 *  across mounts (module singleton + teardown grace window), so a reused id
 *  hands the second test the first test's already-connected entry. */
let workspaceId = "";
let workspaceSeq = 0;

const CHANNEL: Channel = {
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
  onlineMemberCount: 1,
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
    metadata: {},
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
    agentOnline: false,
    lastSeenAt: null,
    addedBy: "u-1",
    joinedAt: "2026-08-01T10:05:00.000Z",
    displayName: "Ada",
    email: "ada@example.com",
    avatarUrl: null,
  },
];

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
      return json({ channels: [{ ...CHANNEL, workspaceId }] });
    }
    if (path === `/api/channels/${CHANNEL_ID}/messages`) {
      return json({ messages: MESSAGES });
    }
    if (path === `/api/channels/${CHANNEL_ID}/members`) {
      return json({ members: MEMBERS });
    }
    if (path === `/api/channels/${CHANNEL_ID}/tasks`) return json({ tasks: [] });
    if (path === `/api/channels/${CHANNEL_ID}/agents`) return json({ agents: [] });
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

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/channels", element: <ChannelsPage /> }],
    { initialEntries: [`/${SEGMENT}/channels`] }
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
  it("resolves the workspace, then loads the list and the transcript", async () => {
    renderPage();

    expect(
      await screen.findByText("Picked it up, wiring the client queries now.")
    ).toBeInTheDocument();
    // Twice on purpose: transcript + consent card body preview.
    expect(
      screen.getAllByText("Can your agent take the channels port?")
    ).toHaveLength(2);

    expect(requestsTo("/api/boot", "POST")[0].body).toEqual({ segment: SEGMENT });
    expect(requestsTo("/api/workspaces/me")).toHaveLength(0);

    // ⚠ Every live surface needs its OWN initial fetch: that is what keeps the
    // page correct on first paint with realtime no-op'd.
    for (const path of [
      "/api/channels",
      `/api/channels/${CHANNEL_ID}/messages`,
      `/api/channels/${CHANNEL_ID}/members`,
      `/api/channels/${CHANNEL_ID}/tasks`,
      `/api/channels/${CHANNEL_ID}/agents`,
      "/api/channels/consent",
      "/api/channels/trust",
    ]) {
      expect(requestsTo(path).length).toBeGreaterThan(0);
      expect(requestsTo(path)[0].headers["x-workspace-id"]).toBe(workspaceId);
    }
  });

  it("renders the roster presence strip from the members read", async () => {
    renderPage();

    // Header derives `agentOnline` from the roster, not `onlineMemberCount`.
    expect(await screen.findByText("1 online")).toBeInTheDocument();
  });

  it("decides a pending consent request through the API", async () => {
    renderPage();

    // ⚠ "Launch agent", not "Allow" — the consent CARD was retired for the
    // launch panel (wiring plan Phase 8). The write below is unchanged: the
    // same `PATCH /consent/[id]` with the same `"allow"` decision. In a plain
    // browser there are no desktop launch settings to expand, so the first
    // click IS the decision.
    const launch = await screen.findByRole("button", { name: "Launch agent" });
    expect(screen.getByText("Run the channels port")).toBeInTheDocument();

    fireEvent.click(launch);

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
});
