/**
 * The flagship send, driven through TanStack's own `MutationObserver` — onMutate
 * → mutationFn → onSuccess/onError → onSettled IS the contract, and a
 * hand-rolled runner pins a re-implementation of it. `npm test` has no DOM,
 * which is why the three configs are exported apart from the hook.
 *
 * ⚠ THE COLD-CACHE CASE. The optimistic patch and the reconcile BOTH decline on
 * an undefined cache, deliberately (`optimistic-cache.ts`). So on a channel
 * whose transcript has not loaded, neither path that normally puts a sent
 * message on screen does anything — reachable in one gesture, since all three
 * per-channel reads are `keepPreviousData`. Settle-time invalidation of the
 * messages key is the only recovery, and the bundled SPA has no realtime
 * doorbell to do it later.
 *
 * ⚠ Both halves pinned, because the fix has a wrong version that looks right:
 * `invalidateQueries` defaults to `refetchType: "active"` and the transcript
 * query is active, so naming the messages key UNCONDITIONALLY re-downloads the
 * 200-message page on every send. `coldKeys` is what makes it cold-only.
 *
 * ⚠ Assertions check the entry EXISTS before checking what it says — a bare
 * `entry?.state.isInvalidated).toBeFalsy()` passes when the write invalidated
 * some other key entirely.
 */

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient, type QueryKey } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";
import type { MessagesCache } from "../lib/optimistic-cache";
import type { ChannelMessage, ChannelThread } from "../types";
import {
  openThreadConfig,
  sendConfig,
  type ThreadWriteDeps,
} from "./use-thread-writes";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const ME = "u-me";
const CLIENT_MSG_ID = "cmid-1";

/** ⚠ The EXACT entry `useChannelMessages` reads under — path and params from
 *  `client/query-keys.ts`, so it is the read's key by construction, not a third
 *  hand-typed copy. */
const MESSAGES_ENTRY = apiQueryKey(channelMessagesPath(CHANNEL), {
  workspaceId: WORKSPACE,
  query: channelMessagesParams(),
});
const LIST_ENTRY = apiQueryKey("/api/channels", { workspaceId: WORKSPACE });

function saved(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "srv-1",
    seq: 9,
    channelId: CHANNEL,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: "hello",
    metadata: {},
    clientMsgId: CLIENT_MSG_ID,
    createdAt: "2026-08-08T00:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
    ...over,
  };
}

function thread(): ChannelThread {
  return {
    id: "t-1",
    channelId: CHANNEL,
    workspaceId: WORKSPACE,
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: ME,
    targetUserId: "u-ada",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
  };
}

/** Transport settled by hand, so "before the network answers" is a real
 *  assertion rather than a timing hope. */
function deferredRequest() {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const calls: Array<{ path: string; opts: unknown }> = [];
  const request = ((path: string, opts: unknown) => {
    calls.push({ path, opts });
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, calls };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  client: QueryClient;
  deps: ThreadWriteDeps;
  gate: MutationGate & { begun: number; ended: number };
}

function harness(): Harness {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const gate = {
    begun: 0,
    ended: 0,
    begin() {
      gate.begun += 1;
    },
    end() {
      gate.ended += 1;
    },
  };
  return {
    client,
    gate,
    deps: {
      client,
      workspaceId: WORKSPACE,
      currentUserId: ME,
      currentUserName: "Sam",
      currentUserAvatarUrl: null,
      gate,
    },
  };
}

/**
 * Register a query with NO data — a mounted `useChannelMessages` whose first
 * read has not landed. ⚠ `setQueryData` cannot express it (writing `undefined`
 * creates nothing), and it is exactly the state in which every patch declines.
 */
function mountEmptyQuery(client: QueryClient, queryKey: QueryKey) {
  client
    .getQueryCache()
    .build(client, client.defaultQueryOptions({ queryKey }));
}

function run<TDraft, TData>(
  h: Harness,
  config: UseApiMutationConfig<TDraft, TData>,
  draft: TDraft
) {
  const { request, settle, fail, calls } = deferredRequest();
  const observer = new MutationObserver(
    h.client,
    buildApiMutationOptions<TDraft, TData>(h.client, request, config)
  );
  const inFlight = observer.mutate(draft).catch(() => "rejected");
  return { inFlight, settle, fail, calls };
}

const DRAFT = {
  channelId: CHANNEL,
  clientMsgId: CLIENT_MSG_ID,
  body: "hello",
  intent: "chat" as const,
};

function messagesEntry(h: Harness) {
  return h.client.getQueryCache().find({ queryKey: MESSAGES_ENTRY });
}

describe("send — the transcript key is invalidated on settle (H1)", () => {
  it("recovers a COLD transcript: neither patch can write it, so the settle-time invalidation is the only thing that puts the message on screen", async () => {
    const h = harness();
    // No seeded transcript — mounted, first read not landed.
    mountEmptyQuery(h.client, MESSAGES_ENTRY);
    mountEmptyQuery(h.client, LIST_ENTRY);

    const { inFlight, settle } = run(h, sendConfig(h.deps), DRAFT);
    await flush();

    // ⚠ Both cache paths decline on an undefined entry, on purpose.
    expect(h.client.getQueryData<MessagesCache>(MESSAGES_ENTRY)).toBeUndefined();
    expect(messagesEntry(h)?.state.isInvalidated).toBe(false);

    settle({ message: saved() });
    await inFlight;

    expect(h.client.getQueryData<MessagesCache>(MESSAGES_ENTRY)).toBeUndefined();
    // ⚠ Assert the entry EXISTS first — `find()?.state.isInvalidated` is
    // undefined for a key nobody invalidated, and `toBeFalsy()` reads as a pass.
    const entry = messagesEntry(h);
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(true);
    expect([h.gate.begun, h.gate.ended]).toEqual([1, 1]);
  });

  it("invalidates the transcript of the channel captured in the DRAFT, never the one on screen (§7 rule 4)", async () => {
    const h = harness();
    const otherEntry = apiQueryKey(channelMessagesPath("c-2"), {
      workspaceId: WORKSPACE,
      query: channelMessagesParams(),
    });
    mountEmptyQuery(h.client, MESSAGES_ENTRY);
    mountEmptyQuery(h.client, otherEntry);

    const { inFlight, settle } = run(h, sendConfig(h.deps), DRAFT);
    await flush();
    settle({ message: saved() });
    await inFlight;

    expect(messagesEntry(h)?.state.isInvalidated).toBe(true);
    const other = h.client.getQueryCache().find({ queryKey: otherEntry });
    expect(other).toBeDefined();
    expect(other?.state.isInvalidated).toBe(false);
  });

  it("on a WARM transcript it reconciles in place and re-downloads NOTHING — a send is still one round trip (rule 1)", async () => {
    const h = harness();
    h.client.setQueryData(MESSAGES_ENTRY, {
      messages: [saved({ id: "srv-0", seq: 1, clientMsgId: null, body: "older" })],
    } satisfies MessagesCache);

    const { inFlight, settle, calls } = run(h, sendConfig(h.deps), DRAFT);
    await flush();

    expect(calls[0].path).toBe(channelMessagesPath(CHANNEL));
    expect(calls[0].opts).toMatchObject({
      method: "POST",
      workspaceId: WORKSPACE,
      body: { body: "hello", intent: "chat", clientMsgId: CLIENT_MSG_ID },
    });
    expect(
      h.client.getQueryData<MessagesCache>(MESSAGES_ENTRY)?.messages.map((m) => m.id)
    ).toEqual(["srv-0", `pending:${CLIENT_MSG_ID}`]);

    settle({ message: saved() });
    await inFlight;

    // Saved row replaced its pending twin IN PLACE — one message, not two.
    expect(
      h.client.getQueryData<MessagesCache>(MESSAGES_ENTRY)?.messages.map((m) => m.id)
    ).toEqual(["srv-0", "srv-1"]);
    // ⚠ Transcript NOT marked stale, so the active query does not refetch the
    // 200-message page behind an already-correct screen.
    const entry = messagesEntry(h);
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(false);
  });

  /** ⚠ This must keep naming the transcript key: `openThread`'s opening message
   *  is written server-side under a derived key, so it cannot be reconciled from
   *  the response. `threadOp` was the second such write and had the same test
   *  below — deleted with thread closing (wiring plan Phase 4, 2026-08-18). */
  it("openThread names the same transcript key — the send now matches it, not the other way round", async () => {
    const h = harness();
    mountEmptyQuery(h.client, MESSAGES_ENTRY);
    const { inFlight, settle } = run(h, openThreadConfig(h.deps), {
      channelId: CHANNEL,
      clientMsgId: CLIENT_MSG_ID,
      title: "Ship it",
      body: "please",
      toUserId: "u-ada",
    });
    await flush();
    settle({ task: thread() });
    await inFlight;

    const entry = messagesEntry(h);
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(true);
  });

  it("rolls the pending row back on failure, and invalidates anyway so the truth arrives", async () => {
    const h = harness();
    const before: MessagesCache = { messages: [saved({ id: "srv-0", clientMsgId: null })] };
    h.client.setQueryData(MESSAGES_ENTRY, before);

    const { inFlight, fail } = run(h, sendConfig(h.deps), DRAFT);
    await flush();
    expect(h.client.getQueryData<MessagesCache>(MESSAGES_ENTRY)?.messages).toHaveLength(2);

    fail(new Error("network"));
    await inFlight;

    expect(h.client.getQueryData(MESSAGES_ENTRY)).toEqual(before);
    const entry = messagesEntry(h);
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(true);
    // ⚠ A write that THREW still released the gate.
    expect(h.gate.ended).toBe(1);
  });
});
