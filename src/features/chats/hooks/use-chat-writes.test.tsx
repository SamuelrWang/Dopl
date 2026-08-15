// @vitest-environment jsdom
/**
 * Chat writes against a REAL `QueryClient`, seeded at the exact keys
 * `useApiQuery` registers. ⚠ Assertions must read the cache back through
 * `apiQueryKey(...)`, not a hand-typed array: a key off by one element is a
 * silent no-op (write "succeeds", screen never moves, nothing throws) and a
 * hand-typed array would agree with the bug.
 * `fetch` is deferred by hand so the cache can be inspected AT THE MOMENT THE
 * REQUEST LEAVES, not merely before it answers.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { apiQueryKey } from "@/shared/api/query-keys";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { CHAT_FOLDERS_PATH, CHATS_PATH, chatPath } from "../client/query-keys";
import type {
  ChatDetailCache,
  ChatFoldersCache,
  ChatListCache,
} from "../lib/optimistic-cache";
import { isPendingId } from "../lib/optimistic-cache";
import type { Chat, ChatDetail, ChatFolder } from "../types";
import { useChatWrites } from "./use-chat-writes";

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/shared/ui/toast", () => ({
  toast: ({ title }: { title: string }) => toasts.push(title),
}));

const WS = "ws-1";

function chat(over: Partial<Chat> = {}): Chat {
  return {
    id: "c-1",
    folderId: "f-1",
    title: "Migration planning",
    overview: "Planned it.",
    pinned: false,
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    owner: { userId: "u-me", name: "Ada", avatarUrl: null },
    source: "claude-code",
    project: null,
    format: "summarized",
    sessionDate: "2026-08-01",
    exportedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    messageCount: 2,
    deliverables: [],
    learnings: [],
    ...over,
  };
}

const FOLDER: ChatFolder = {
  id: "f-1",
  name: "Migration",
  visibility: "private",
  accessMode: "workspace",
  grantedTeamIds: [],
};

const DETAIL: ChatDetail = {
  ...chat(),
  messages: [
    { index: 1, role: "user", summary: "Asked", verbatim: null },
    { index: 2, role: "agent", summary: "Answered", verbatim: null },
  ],
};

const listKey = apiQueryKey(CHATS_PATH, { workspaceId: WS });
const foldersKey = apiQueryKey(CHAT_FOLDERS_PATH, { workspaceId: WS });
const detailKey = (id: string) => apiQueryKey(chatPath(id), { workspaceId: WS });

/** Fetch whose answer the test releases by hand. */
function deferredFetch() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((res) => {
    release = res;
  });
  const mock = vi.fn((input: string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return pending;
  });
  vi.stubGlobal("fetch", mock);
  const json = (body: unknown) =>
    release(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  return {
    calls,
    json,
    noContent: () => release(new Response(null, { status: 204 })),
    fail: (status: number, code: string, message: string) =>
      release(
        new Response(JSON.stringify({ error: { code, message } }), {
          status,
          headers: { "content-type": "application/json" },
        })
      ),
  };
}

let client: QueryClient;
/** Counters, not spies: the gate contract is "exactly once on both paths". */
let gate: MutationGate;
let gateCalls: { begin: number; end: number };
let deleteFailed: string[];

function seed() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<ChatListCache>(listKey, {
    chats: [chat(), chat({ id: "c-2", folderId: null })],
    hiddenCount: 3,
  });
  client.setQueryData<ChatFoldersCache>(foldersKey, { folders: [FOLDER] });
  client.setQueryData<ChatDetailCache>(detailKey("c-1"), { chat: DETAIL });
}

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useChatWrites({
        workspaceId: WS,
        gate,
        onDeleteFailed: (id) => deleteFailed.push(id),
      }),
    { wrapper }
  );
}

const readList = () => client.getQueryData<ChatListCache>(listKey);
const readFolders = () => client.getQueryData<ChatFoldersCache>(foldersKey);
const readDetail = (id: string) =>
  client.getQueryData<ChatDetailCache>(detailKey(id));

beforeEach(() => {
  toasts.length = 0;
  deleteFailed = [];
  gateCalls = { begin: 0, end: 0 };
  gate = {
    begin: () => {
      gateCalls.begin += 1;
    },
    end: () => {
      gateCalls.end += 1;
    },
  };
  seed();
});

describe("pin", () => {
  it("flips the row and the transcript BEFORE the request leaves", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.pin.mutate({ chatId: "c-1", pinned: true });
    });

    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].body).toEqual({ pinned: true });
    expect(readList()?.chats[0].pinned).toBe(true);
    expect(readDetail("c-1")?.chat.pinned).toBe(true);
    expect(readDetail("c-1")?.chat.messages).toHaveLength(2);
    expect(readList()?.chats[1].pinned).toBe(false);

    await act(async () => {
      net.json({ chat: chat({ pinned: true, updatedAt: "2026-08-09T00:00:00.000Z" }) });
    });
    await waitFor(() => expect(result.current.pin.pending).toBe(false));
    expect(readList()?.chats[0].updatedAt).toBe("2026-08-09T00:00:00.000Z");
    // Reconciled from the answer — no re-download scheduled.
    expect(client.getQueryState(listKey)?.isInvalidated).toBeFalsy();
  });

  it("restores the exact bytes on failure and releases the gate", async () => {
    const before = readList();
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.pin.mutate({ chatId: "c-1", pinned: true });
    });
    expect(readList()?.chats[0].pinned).toBe(true);

    await act(async () => {
      net.fail(403, "forbidden", "Not your chat");
    });
    await waitFor(() => expect(result.current.pin.pending).toBe(false));

    expect(readList()).toEqual(before);
    expect(readDetail("c-1")?.chat.pinned).toBe(false);
    expect(toasts).toEqual(["Not your chat"]);
    expect(gateCalls).toEqual({ begin: 1, end: 1 });
  });
});

describe("share", () => {
  it("patches both caches with the columns the server will write", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.share.mutate({
        chatId: "c-1",
        scope: "team",
        teamIds: ["t-1"],
      });
    });

    expect(net.calls[0].body).toEqual({
      visibility: "public",
      accessMode: "teams",
      teamIds: ["t-1"],
    });
    expect(readList()?.chats[0].accessMode).toBe("teams");
    expect(readList()?.chats[0].grantedTeamIds).toEqual(["t-1"]);
    expect(readDetail("c-1")?.chat.visibility).toBe("public");
    expect(readDetail("c-1")?.chat.messages).toHaveLength(2);

    await act(async () => {
      net.json({
        chat: chat({ visibility: "public", accessMode: "teams", grantedTeamIds: ["t-1"] }),
      });
    });
    await waitFor(() => expect(result.current.share.pending).toBe(false));
    expect(readList()?.chats[0].accessMode).toBe("teams");
    // Reconciled from the answer — neither key re-downloads.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(detailKey("c-1"))?.isInvalidated).toBe(false);
  });
});

describe("delete", () => {
  it("EVICTS the transcript on success and re-reads only the list", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.remove.mutate({ chatId: "c-1" });
    });
    expect(net.calls[0].method).toBe("DELETE");
    expect(readList()?.chats.map((c) => c.id)).toEqual(["c-2"]);
    // Still there while the DELETE is in flight — a refusal has to be able to
    // put the whole chat back, transcript included.
    expect(readDetail("c-1")).toBeDefined();

    await act(async () => {
      net.noContent();
    });
    await waitFor(() => expect(result.current.remove.pending).toBe(false));

    // Evicted, not invalidated: no refetch can ever make that entry valid.
    expect(readDetail("c-1")).toBeUndefined();
    expect(client.getQueryState(detailKey("c-1"))).toBeUndefined();
    // hiddenCount is a server computation over the surviving rows.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("puts the row, the transcript and the selection back on failure", async () => {
    const before = readList();
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.remove.mutate({ chatId: "c-1" });
    });
    await act(async () => {
      net.fail(403, "forbidden", "Only the owner can delete it");
    });
    await waitFor(() => expect(result.current.remove.pending).toBe(false));

    expect(readList()).toEqual(before);
    expect(readDetail("c-1")?.chat.messages).toHaveLength(2);
    expect(deleteFailed).toEqual(["c-1"]);
    expect(toasts).toEqual(["Only the owner can delete it"]);
  });
});

describe("create folder", () => {
  it("shows a pending row at submit and swaps it for the saved one", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.createFolder.mutate({ tempId: "pending:x", name: "Aardvark" });
    });

    expect(net.calls[0].body).toEqual({ name: "Aardvark" });
    const optimistic = readFolders()?.folders ?? [];
    expect(optimistic.map((f) => f.name)).toEqual(["Aardvark", "Migration"]);
    expect(isPendingId(optimistic[0].id)).toBe(true);

    await act(async () => {
      net.json({ folder: { ...FOLDER, id: "f-9", name: "Aardvark" } });
    });
    await waitFor(() => expect(result.current.createFolder.pending).toBe(false));

    const saved = readFolders()?.folders ?? [];
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe("f-9");
    expect(saved.some((f) => isPendingId(f.id))).toBe(false);
    // The POST answered with the folder; re-reading the list would undo that.
    expect(client.getQueryState(foldersKey)?.isInvalidated).toBe(false);
  });

  it("removes the pending row when the name is taken", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.createFolder.mutate({ tempId: "pending:x", name: "Migration" });
    });
    expect(readFolders()?.folders).toHaveLength(2);

    await act(async () => {
      net.fail(409, "conflict", 'A folder named "Migration" already exists');
    });
    await waitFor(() => expect(result.current.createFolder.pending).toBe(false));

    expect(readFolders()?.folders).toHaveLength(1);
    expect(toasts).toEqual(['A folder named "Migration" already exists']);
  });
});

describe("folder scope", () => {
  it("mirrors the propagation onto filed chats and re-reads the list", async () => {
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.folderScope.mutate({
        folderId: "f-1",
        scope: "workspace",
        teamIds: [],
      });
    });

    expect(readFolders()?.folders[0].visibility).toBe("public");
    // c-1 is filed in f-1; c-2 is unfiled and must not move.
    expect(readList()?.chats[0].visibility).toBe("public");
    expect(readList()?.chats[1].visibility).toBe("private");

    await act(async () => {
      net.json({ folder: { ...FOLDER, visibility: "public" } });
    });
    await waitFor(() => expect(result.current.folderScope.pending).toBe(false));

    // The per-chat fan-out is unbounded and can partly apply — only the server
    // knows which chats actually moved.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(foldersKey)?.isInvalidated).toBe(false);
  });
});

/**
 * THE COLD-CACHE WINDOW — the write that succeeds and never appears.
 *
 * `optimistic` and `reconcile` both decline on an entry with no data, which is
 * correct (there is no list to patch a row into) and is exactly why the write
 * used to vanish: on a cold start, or inside the IndexedDB restore window, the
 * PATCH lands server-side and no cache learns about it. Nothing looks wrong
 * while it happens — `chats-view` falls back to `initialChats`, so the surface
 * renders fully, showing the state before the click.
 *
 * The assertion is deliberately two-part: the entry EXISTS and its
 * `isInvalidated` is true. `?.isInvalidated` alone passes on an entry that was
 * never created, which is the same nothing the bug produced.
 */
describe("cold cache — the restore window", () => {
  /**
   * A query that exists and has NO data: mounted and still fetching, or waiting
   * on the persisted cache. Built directly because `setQueryData(key, undefined)`
   * cannot express it — an updater resolving to `undefined` bails out and no
   * entry is created.
   */
  function goCold() {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const cache = client.getQueryCache();
    for (const key of [listKey, foldersKey, detailKey("c-1")]) {
      cache.build(client, { queryKey: key });
    }
  }

  it("pin re-reads the list and the transcript it could not patch", async () => {
    goCold();
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.pin.mutate({ chatId: "c-1", pinned: true });
    });
    await act(async () => {
      net.json({ chat: chat({ pinned: true }) });
    });
    await waitFor(() => expect(result.current.pin.pending).toBe(false));

    // The server has the star; no cache does.
    expect(readList()).toBeUndefined();
    expect(readDetail("c-1")).toBeUndefined();
    expect(client.getQueryState(listKey)).toBeDefined();
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(detailKey("c-1"))).toBeDefined();
    expect(client.getQueryState(detailKey("c-1"))?.isInvalidated).toBe(true);
    // Not this write's business, cold or not.
    expect(client.getQueryState(foldersKey)?.isInvalidated).toBe(false);
  });

  it("share re-reads the list and the transcript it could not patch", async () => {
    goCold();
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.share.mutate({
        chatId: "c-1",
        scope: "team",
        teamIds: ["t-1"],
      });
    });
    await act(async () => {
      net.json({ chat: chat({ visibility: "public", accessMode: "teams" }) });
    });
    await waitFor(() => expect(result.current.share.pending).toBe(false));

    expect(readList()).toBeUndefined();
    expect(client.getQueryState(listKey)).toBeDefined();
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(detailKey("c-1"))).toBeDefined();
    expect(client.getQueryState(detailKey("c-1"))?.isInvalidated).toBe(true);
  });

  it("createFolder re-reads the folders it could not insert into", async () => {
    goCold();
    const net = deferredFetch();
    const { result } = mount();

    await act(async () => {
      result.current.createFolder.mutate({
        tempId: "pending:x",
        name: "Aardvark",
      });
    });
    await act(async () => {
      net.json({ folder: { ...FOLDER, id: "f-9", name: "Aardvark" } });
    });
    await waitFor(() => expect(result.current.createFolder.pending).toBe(false));

    expect(readFolders()).toBeUndefined();
    expect(client.getQueryState(foldersKey)).toBeDefined();
    expect(client.getQueryState(foldersKey)?.isInvalidated).toBe(true);
    // The folder list is the only thing a create can change.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
  });
});
