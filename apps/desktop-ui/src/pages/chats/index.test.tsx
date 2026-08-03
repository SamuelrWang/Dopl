import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import ChatsPage from "#/pages/chats";
import type { Chat, ChatDetail, ChatFolder } from "@/features/chats/types";
import { SEGMENT } from "#/test-utils/bridge";

/**
 * Smoke test for the ported chats page: the REAL `ChatsView` tree (reused from
 * the web app) over a mocked data layer. `fetch` is the mock point because it
 * is the one seam both clients share — the SPA's `#/lib/api` transport and the
 * web feature client's `@/shared/api/api-client`, which `ChatsView` calls
 * directly for its mutations.
 *
 * Supabase is stubbed at the browser-client module so the realtime hook wires
 * for real (registry included) without a websocket; the stub hands back the
 * status callback so the SUBSCRIBED catch-up refetch can be driven explicitly.
 */

const realtime = vi.hoisted(() => ({
  status: null as ((status: string) => void) | null,
}));

vi.mock("@/shared/supabase/browser", () => {
  const channel = {
    on: () => channel,
    subscribe: (cb: (status: string) => void) => {
      realtime.status = cb;
      return channel;
    },
  };
  return {
    getSupabaseBrowser: () => ({
      channel: () => channel,
      removeChannel: () => {},
    }),
  };
});


/** Fresh per test: the realtime registry shares one channel per workspace id
 *  across mounts (module singleton with a teardown grace window), so a reused
 *  id would hand the second test the first test's already-connected entry. */
let workspaceId = "";
let workspaceSeq = 0;

const FOLDER: ChatFolder = {
  id: "f-1",
  name: "Migration",
  visibility: "private",
  accessMode: "workspace",
  grantedTeamIds: [],
};

const CHAT: Chat = {
  id: "c-1",
  folderId: "f-1",
  title: "Port the chats page",
  overview: "Working through the desktop port.",
  pinned: false,
  visibility: "private",
  accessMode: "workspace",
  grantedTeamIds: [],
  owner: { userId: "u-1", name: "Sam", avatarUrl: null },
  source: "claude-code",
  project: "dopl",
  format: "summarized",
  sessionDate: "2026-08-01",
  exportedAt: "2026-08-01T18:00:00.000Z",
  updatedAt: "2026-08-01T18:00:00.000Z",
  messageCount: 2,
  deliverables: [{ label: "Ported page", done: true }],
  learnings: ["Reuse beats forking"],
};

const DETAIL: ChatDetail = {
  ...CHAT,
  messages: [
    { index: 1, role: "user", summary: "Asked for the port", verbatim: null },
    { index: 2, role: "agent", summary: "Wired the client queries", verbatim: null },
  ],
};

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[];
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  workspaceId = `ws-${++workspaceSeq}`;
  realtime.status = null;
  calls = [];
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (url.startsWith("/api/workspaces/resolve")) {
      return json({
        workspace: { id: workspaceId, name: "Acme", slug: "acme", publicId: "ab12cd" },
        canonical: SEGMENT,
        needsRedirect: false,
      });
    }
    if (url === "/api/workspaces/me") return json({ role: "admin", userId: "u-1" });
    if (url === "/api/chats") return json({ chats: [CHAT], hiddenCount: 0 });
    if (url === "/api/chats/folders") return json({ folders: [FOLDER] });
    if (url === "/api/chats/c-1") {
      return method === "PATCH"
        ? json({ chat: { ...CHAT, pinned: true } })
        : json({ chat: DETAIL });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/chats", element: <ChatsPage /> }],
    { initialEntries: [`/${SEGMENT}/chats`] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const requestsTo = (path: string, method = "GET") =>
  calls.filter((c) => c.url.split("?")[0] === path && c.method === method);

describe("chats page", () => {
  it("resolves the workspace, then loads the archive and its transcript", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Port the chats page" })
    ).toBeInTheDocument();

    // The RSC's four server reads, now client queries.
    expect(requestsTo("/api/workspaces/resolve")[0].url).toContain(
      `segment=${SEGMENT}`
    );
    expect(requestsTo("/api/workspaces/me")).toHaveLength(1);
    expect(requestsTo("/api/chats")[0].headers["x-workspace-id"]).toBe(workspaceId);
    expect(requestsTo("/api/chats/folders")).toHaveLength(1);

    // Folder grouping and the per-selection transcript both render.
    expect(
      screen.getByRole("button", { name: "Folder sharing: private" })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Wired the client queries")
    ).toBeInTheDocument();
    expect(requestsTo("/api/chats/c-1")).toHaveLength(1);
  });

  it("pins the open chat through the API", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Pin" }));

    await waitFor(() => expect(requestsTo("/api/chats/c-1", "PATCH")).toHaveLength(1));
    const patch = requestsTo("/api/chats/c-1", "PATCH")[0];
    expect(patch.body).toEqual({ pinned: true });
    expect(patch.headers["x-workspace-id"]).toBe(workspaceId);
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("refetches the list when the realtime channel subscribes", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Port the chats page" });
    const before = requestsTo("/api/chats").length;

    await act(async () => {
      realtime.status?.("SUBSCRIBED");
    });

    await waitFor(() =>
      expect(requestsTo("/api/chats").length).toBeGreaterThan(before)
    );
    expect(requestsTo("/api/chats/folders").length).toBeGreaterThan(1);
  });
});
