/**
 * THE THREAD'S OWN WRITES — set mode and DELETE (Samuel, 2026-08-21) — driven
 * through TanStack's own `MutationObserver`, the same way `use-thread-writes.
 * test.ts` drives the send family: onMutate → mutationFn → onSuccess/onError →
 * onSettled IS the contract, and a hand-rolled runner would pin a
 * re-implementation of it. `npm test` has no DOM, which is why both configs are
 * exported apart from the hook.
 *
 * What is load-bearing here and pinned nowhere else:
 *   - the DELETE patches BOTH per-channel caches — the thread list AND the
 *     transcript. Dropping only one leaves either orphan messages under a card
 *     that is gone, or an empty thread in the list;
 *   - a FAILED delete restores both verbatim and the selection is NOT cleared:
 *     `onDeleted` fires in `onSuccess`, never in `optimistic`;
 *   - set-mode INVALIDATES NOTHING. `channel_tasks.updated_at` is not an activity
 *     clock (INVARIANTS §5, C-1), so a mode change moves no ordering and naming
 *     the thread list would re-download it on every click;
 *   - ⚠ NOTHING WRITES A THREAD STATUS. Threads have no finished state, and the
 *     delete's body is empty rather than a `{op:…}` — a config that grew one
 *     would be closing by another name.
 */

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import {
  channelMentionsPath,
  channelMessagesParams,
  channelMessagesPath,
  channelThreadsPath,
} from "../client/query-keys";
import type { MessagesCache, ThreadsCache } from "../lib/optimistic-cache";
import type { ChannelMessage, ChannelThread } from "../types";
import {
  deleteThreadConfig,
  setThreadModeConfig,
  type ThreadLifecycleDeps,
} from "./use-thread-lifecycle-writes";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const THREAD = "t-1";
const OTHER_THREAD = "t-2";

/** ⚠ The EXACT entries the reads register under — paths and params from
 *  `client/query-keys.ts`, never a third hand-typed copy. */
const MESSAGES_ENTRY = apiQueryKey(channelMessagesPath(CHANNEL), {
  workspaceId: WORKSPACE,
  query: channelMessagesParams(),
});
const THREADS_ENTRY = apiQueryKey(channelThreadsPath(CHANNEL), {
  workspaceId: WORKSPACE,
});
const LIST_ENTRY = apiQueryKey("/api/channels", { workspaceId: WORKSPACE });
const MENTIONS_ENTRY = apiQueryKey(channelMentionsPath(CHANNEL), {
  workspaceId: WORKSPACE,
});

function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: THREAD,
    channelId: CHANNEL,
    workspaceId: WORKSPACE,
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: "u-me",
    targetUserId: "u-ada",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
    ...over,
  };
}

function message(id: string, taskId: string | null): ChannelMessage {
  return {
    id,
    seq: Number(id.replace(/\D/g, "")) || 1,
    channelId: CHANNEL,
    authorUserId: "u-me",
    authorKind: "user",
    kind: "message",
    body: "hello",
    metadata: taskId ? { taskId } : {},
    clientMsgId: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
  };
}

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
  deps: ThreadLifecycleDeps;
  deleted: string[];
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
  const deleted: string[] = [];
  return {
    client,
    gate,
    deleted,
    deps: {
      client,
      workspaceId: WORKSPACE,
      gate,
      onDeleted: (id) => deleted.push(id),
    },
  };
}

function seed(h: Harness) {
  h.client.setQueryData<ThreadsCache>(THREADS_ENTRY, {
    tasks: [thread(), thread({ id: OTHER_THREAD, title: "Other" })],
  });
  h.client.setQueryData<MessagesCache>(MESSAGES_ENTRY, {
    messages: [
      message("m1", THREAD),
      message("m2", null),
      message("m3", OTHER_THREAD),
    ],
  });
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

const draft = { channelId: CHANNEL, threadId: THREAD };

describe("deleteThreadConfig", () => {
  it("DELETEs the thread's own path with no body", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle, calls } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    expect(calls[0].path).toBe(`/api/channels/${CHANNEL}/tasks/${THREAD}`);
    expect(calls[0].opts).toMatchObject({ method: "DELETE" });
    // ⚠ NOT a `{op:…}` PATCH. A body here would be closing wearing a new verb.
    expect((calls[0].opts as { body?: unknown }).body).toBeUndefined();
    settle(undefined);
    await inFlight;
  });

  it("drops the thread AND its messages in the same frame, leaving the rest", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();

    expect(
      h.client.getQueryData<ThreadsCache>(THREADS_ENTRY)?.tasks.map((t) => t.id)
    ).toEqual([OTHER_THREAD]);
    expect(
      h.client
        .getQueryData<MessagesCache>(MESSAGES_ENTRY)
        ?.messages.map((m) => m.id)
    ).toEqual(["m2", "m3"]);

    settle(undefined);
    await inFlight;
  });

  it("clears the selection only ON SUCCESS", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    expect(h.deleted).toEqual([]);
    settle(undefined);
    await inFlight;
    expect(h.deleted).toEqual([THREAD]);
  });

  it("restores BOTH caches and keeps the selection when the delete fails", async () => {
    const h = harness();
    seed(h);
    const { inFlight, fail } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    fail(new Error("nope"));
    await inFlight;

    expect(
      h.client.getQueryData<ThreadsCache>(THREADS_ENTRY)?.tasks.map((t) => t.id)
    ).toEqual([THREAD, OTHER_THREAD]);
    expect(
      h.client
        .getQueryData<MessagesCache>(MESSAGES_ENTRY)
        ?.messages.map((m) => m.id)
    ).toEqual(["m1", "m2", "m3"]);
    expect(h.deleted).toEqual([]);
  });

  it("holds the refetch gate for the life of the write", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    expect([h.gate.begun, h.gate.ended]).toEqual([1, 0]);
    settle(undefined);
    await inFlight;
    expect([h.gate.begun, h.gate.ended]).toEqual([1, 1]);
  });

  /** The list carries `lastMessageAt` + unread ordering, which this write changes
   *  and cannot compute. */
  it("invalidates the channel list on settle", async () => {
    const h = harness();
    seed(h);
    h.client.setQueryData(LIST_ENTRY, { channels: [] });
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    settle(undefined);
    await inFlight;
    const entry = h.client.getQueryCache().find({ queryKey: LIST_ENTRY });
    expect(entry).toBeDefined();
    expect(entry?.state.isInvalidated).toBe(true);
  });

  /**
   * ⚠ AND THE MENTIONS ENTRY (2026-08-22, F-253). The cascade hard-deletes the
   * thread's messages and a mention row POINTS AT ONE, so the Tags inbox kept
   * listing rows whose messages no longer exist and clicking one scrolled to
   * nothing. It is invalidated rather than patched because this write does not
   * hold the deleted message ids — the transcript patch is what drops them.
   */
  it("invalidates the channel's MENTIONS too — a mention points at a deleted row", async () => {
    const h = harness();
    seed(h);
    h.client.setQueryData(MENTIONS_ENTRY, { mentions: [] });
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    settle(undefined);
    await inFlight;
    const entry = h.client.getQueryCache().find({ queryKey: MENTIONS_ENTRY });
    expect(entry?.state.isInvalidated).toBe(true);
  });

  /** Both patches decline on an entry that holds no data, so a delete fired on a
   *  channel whose reads have not landed writes nothing and still succeeds. */
  it("declines on cold caches instead of inventing them", async () => {
    const h = harness();
    const { inFlight, settle } = run(h, deleteThreadConfig(h.deps), draft);
    await flush();
    expect(h.client.getQueryData(THREADS_ENTRY)).toBeUndefined();
    expect(h.client.getQueryData(MESSAGES_ENTRY)).toBeUndefined();
    settle(undefined);
    await inFlight;
    expect(h.deleted).toEqual([THREAD]);
  });
});

describe("setThreadModeConfig", () => {
  const modeDraft = {
    channelId: CHANNEL,
    threadId: THREAD,
    mode: "autonomous" as const,
  };

  it("PATCHes the set_mode arm and lights the row before the answer", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle, calls } = run(
      h,
      setThreadModeConfig(h.deps),
      modeDraft
    );
    await flush();
    expect(calls[0].path).toBe(`/api/channels/${CHANNEL}/tasks/${THREAD}`);
    expect(calls[0].opts).toMatchObject({
      method: "PATCH",
      body: { op: "set_mode", mode: "autonomous" },
    });
    expect(
      h.client
        .getQueryData<ThreadsCache>(THREADS_ENTRY)
        ?.tasks.find((t) => t.id === THREAD)?.mode
    ).toBe("autonomous");
    settle({ task: thread({ mode: "autonomous" }) });
    await inFlight;
  });

  it("rolls the row back when the write fails", async () => {
    const h = harness();
    seed(h);
    const { inFlight, fail } = run(h, setThreadModeConfig(h.deps), modeDraft);
    await flush();
    fail(new Error("nope"));
    await inFlight;
    expect(
      h.client
        .getQueryData<ThreadsCache>(THREADS_ENTRY)
        ?.tasks.find((t) => t.id === THREAD)?.mode
    ).toBe("interactive");
  });

  /** ⚠ A mode change is not activity. Naming the thread list here would
   *  re-download it on every click for a value the reconcile already holds. */
  it("invalidates nothing", async () => {
    const h = harness();
    seed(h);
    const { inFlight, settle } = run(h, setThreadModeConfig(h.deps), modeDraft);
    await flush();
    settle({ task: thread({ mode: "autonomous" }) });
    await inFlight;
    expect(
      h.client.getQueryCache().find({ queryKey: THREADS_ENTRY })?.state
        .isInvalidated
    ).toBeFalsy();
  });

  /** A thread missing from a cold list is not invented — `upsertThread` maps over
   *  rows that exist, and the patch declines rather than appending a stub. */
  it("does not invent a row the list does not have", async () => {
    const h = harness();
    h.client.setQueryData<ThreadsCache>(THREADS_ENTRY, {
      tasks: [thread({ id: OTHER_THREAD })],
    });
    const { inFlight, settle } = run(h, setThreadModeConfig(h.deps), modeDraft);
    await flush();
    expect(
      h.client.getQueryData<ThreadsCache>(THREADS_ENTRY)?.tasks.map((t) => t.id)
    ).toEqual([OTHER_THREAD]);
    settle({ task: thread({ mode: "autonomous" }) });
    await inFlight;
  });
});
