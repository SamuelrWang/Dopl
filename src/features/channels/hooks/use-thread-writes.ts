"use client";

import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { ChannelApiError, channelRequest } from "../client/api";
import {
  channelKeys,
  channelMessagesPath,
  channelThreadsPath,
} from "../client/query-keys";
import {
  appendPendingMessage,
  buildPendingMessage,
  buildPendingThread,
  pendingMessageId,
  reconcileMessage,
  retagPendingMessage,
  upsertThread,
  type MessagesCache,
  type ThreadsCache,
} from "../lib/optimistic-cache";
import type {
  ChannelMessage,
  ChannelThread,
  MessageIntent,
  ThreadOutcome,
} from "../types";

/**
 * THE FLAGSHIP WRITE PATH — sending a message and starting a session, made
 * optimistic.
 *
 * What it replaced: `await postMessage()` (whose response CONTAINS the created
 * row and threw it away) → `await refetchMessages()` (re-downloading the whole
 * 200-message page) → `void refetchChannels()`. Between the click and anything
 * appearing on screen, the only pixel that changed was a 30px send button at
 * 50% opacity, across two serial network hops.
 *
 * What happens now, in order, within one frame of the click:
 *   1. a `clientMsgId` is minted — the idempotency key the server has always
 *      honoured and no client ever sent, so the retry of a failed send cannot
 *      double-post;
 *   2. the message is written into the transcript cache as a pending row, and
 *      a request additionally gets a pending OPEN thread row so its session
 *      card reads "active" rather than computing to "complete" from a lone
 *      unanswered human message;
 *   3. the composer clears (its own state, cleared before the await);
 *   4. the POST leaves.
 * When it answers, the answer is USED: a chat send swaps its own pending row
 * for the saved one in place. When it fails, `onError` restores the exact
 * cache snapshot taken in step 2 and the composer puts the draft back.
 *
 * EVERY CACHE WRITE IS KEYED BY THE CHANNEL ID CAPTURED AT SUBMIT TIME (it
 * rides in the draft, and the per-channel keys embed it in their path). That
 * is what stops an in-flight send from landing in the transcript of a channel
 * the user switched to meanwhile — the open race in which all three
 * per-channel reads use `keepPreviousData` and nobody reads
 * `isPlaceholderData`.
 */

export interface SendDraft {
  /** Captured at submit; never re-read from the selection. */
  channelId: string;
  clientMsgId: string;
  body: string;
  intent?: MessageIntent;
}

export interface OpenThreadDraft {
  channelId: string;
  clientMsgId: string;
  title: string;
  body: string;
  toUserId: string;
}

export interface ThreadOpDraft {
  channelId: string;
  threadId: string;
  op: "close" | "reopen";
  outcome?: ThreadOutcome;
  summary?: string;
}

export interface ThreadWritesParams {
  workspaceId: string;
  currentUserId: string;
  /** Author display for the pending row, so it does not flip name on save. */
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** Holds realtime refetches open for the life of each write. */
  gate: MutationGate;
}

/** What the three configs need beyond their params: the cache they read to
 *  decide whether a key still needs the cold-start refetch. */
export interface ThreadWriteDeps extends ThreadWritesParams {
  client: QueryClient;
}

function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChannelApiError ? err.message : fallback });
}

const messagesKey = (channelId: string) => channelKeys.messages(channelId).all;
const threadsKey = (channelId: string) => channelKeys.threads(channelId).all;

/**
 * THE COLD-CACHE FALLBACK (ENGINEERING §7, rule 1's one exception; the same
 * filter `use-chat-writes.ts` calls `ifCold`). Keeps only the keys that STILL
 * hold no data. It runs in `onSettled`, i.e. AFTER `reconcile`, so "still
 * empty" is the decline itself rather than a guess about it: a warm entry
 * re-downloads nothing, a cold one gets exactly the one refetch that makes the
 * write visible. A key with no query at all is kept and is a no-op —
 * `invalidateQueries` only marks queries that exist, and one mounted later
 * fetches fresh anyway.
 */
function coldKeys(client: QueryClient, keys: QueryKey[]): QueryKey[] {
  return keys.filter(
    (key) =>
      !client
        .getQueriesData({ queryKey: key })
        .some(([, data]) => data !== undefined)
  );
}

/**
 * The three configs are exported APART from the hook, exactly as the lifecycle
 * writes are, so `use-thread-writes.test.ts` can drive them through TanStack's
 * own framework-free `MutationObserver` — `npm test` has no DOM, and the order
 * onMutate → mutationFn → onSuccess/onError → onSettled IS the contract.
 */
export function sendConfig(
  deps: ThreadWriteDeps
): UseApiMutationConfig<SendDraft, { message: ChannelMessage }> {
  return {
    request: (draft) => ({
      path: channelMessagesPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: {
        body: draft.body,
        intent: draft.intent,
        clientMsgId: draft.clientMsgId,
      },
    }),
    optimistic: (draft) =>
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        appendPendingMessage(
          cache,
          buildPendingMessage(cache, {
            channelId: draft.channelId,
            clientMsgId: draft.clientMsgId,
            body: draft.body,
            authorUserId: deps.currentUserId,
            authorName: deps.currentUserName,
            authorAvatarUrl: deps.currentUserAvatarUrl,
          })
        )
      ),
    // THE RESPONSE IS THE POINT: the saved row replaces its pending twin in
    // place. No `refetchMessages`, so a send costs exactly one round trip.
    reconcile: (data, draft) =>
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        reconcileMessage(cache, data.message)
      ),
    // The list carries `lastMessageAt` / unread ordering, which this write
    // does change and cannot compute. UNCONDITIONAL.
    //
    // THE TRANSCRIPT IS NAMED TOO, AND IT IS THE COLD-CACHE CASE ONLY.
    // Both the optimistic patch and the reconcile decline on an undefined
    // entry on purpose (seeding a one-message list into a query that never
    // loaded would render a transcript of exactly that message and then flip),
    // so on a channel whose transcript has not loaded NOTHING here puts the
    // sent message on screen — and the bundled SPA has no realtime doorbell to
    // do it later. That state is reachable in one gesture: all three
    // per-channel reads are `keepPreviousData`, so a switch keeps showing the
    // PREVIOUS channel's transcript while the new one is still in flight, and
    // a send into the new channel can beat its first read.
    //
    // `coldKeys` and not a plain listing, because this is THE FLAGSHIP SEND and
    // rule 1 bites hardest here. `invalidateQueries` defaults to
    // `refetchType: "active"`, and the transcript query IS active — so naming
    // it unconditionally would re-download the 200-message page on EVERY
    // message sent, which is the exact cost this write was built to remove
    // ("no `refetchMessages`, so a send costs exactly one round trip", above).
    // `openThread` and `threadOp` DO name it unconditionally and are still
    // right to: their server-written opening message and lifecycle echo cannot
    // be reconciled from the response at all, so for them the refetch is the
    // only path to the screen warm or cold.
    invalidate: (draft) => [
      channelKeys.list().all,
      ...coldKeys(deps.client, [messagesKey(draft.channelId)]),
    ],
    settleWith: deps.gate,
    // A FAILED send re-reads the transcript unconditionally, and this is the
    // other half of keeping the settle-time path cold-only. `onError` has just
    // restored the pre-send snapshot, which is a guess: a POST that timed out
    // after the row was written leaves the message STORED and the local cache
    // saying it never happened. Rule 1's cost argument does not apply here —
    // this runs on the rare path, not on every message.
    onError: (err, draft) => {
      void deps.client.invalidateQueries({
        queryKey: messagesKey(draft.channelId),
      });
      failed(err, "Couldn't send");
    },
  };
}

export function openThreadConfig(
  deps: ThreadWritesParams
): UseApiMutationConfig<OpenThreadDraft, { task: ChannelThread }> {
  return {
    request: (draft) => ({
      path: channelThreadsPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: {
        title: draft.title,
        body: draft.body,
        toUserId: draft.toUserId,
        clientMsgId: draft.clientMsgId,
      },
    }),
    optimistic: (draft) => {
      const threadId = pendingMessageId(draft.clientMsgId);
      return [
        patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
          appendPendingMessage(
            cache,
            buildPendingMessage(cache, {
              channelId: draft.channelId,
              clientMsgId: draft.clientMsgId,
              body: draft.body,
              authorUserId: deps.currentUserId,
              authorName: deps.currentUserName,
              authorAvatarUrl: deps.currentUserAvatarUrl,
              // `taskId` binds the row into a session card; `to_user_id` draws
              // the addressee line. Both are the wire spellings the transcript
              // already reads, so the pending card is the real component.
              metadata: { taskId: threadId, to_user_id: draft.toUserId },
            })
          )
        ),
        patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
          upsertThread(
            cache,
            buildPendingThread({
              id: threadId,
              channelId: draft.channelId,
              workspaceId: deps.workspaceId,
              title: draft.title,
              createdBy: deps.currentUserId,
              targetUserId: draft.toUserId,
            })
          )
        ),
      ];
    },
    // The POST answers with the thread but NOT its opening message (the server
    // writes that under its own derived key), so the reconcile re-points the
    // pending row at the real thread id and swaps the overlay. The stored
    // opening message arrives with the invalidated read and replaces the
    // pending row wholesale — by which time the card is already correct.
    reconcile: (data, draft) => [
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
        upsertThread(cache, data.task, pendingMessageId(draft.clientMsgId))
      ),
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        retagPendingMessage(cache, draft.clientMsgId, { taskId: data.task.id })
      ),
    ],
    invalidate: (draft) => [
      messagesKey(draft.channelId),
      channelKeys.list().all,
    ],
    settleWith: deps.gate,
    // Both patched caches — the transcript AND the pending thread overlay —
    // are snapshotted together in `onMutate`, so the rollback removes the card
    // whole rather than leaving a titled shell with no message in it.
    onError: (err) => failed(err, "Couldn't open the thread"),
  };
}

export function threadOpConfig(
  deps: ThreadWritesParams
): UseApiMutationConfig<ThreadOpDraft, { task: ChannelThread }> {
  return {
    request: (draft) => ({
      path: `${channelThreadsPath(draft.channelId)}/${encodeURIComponent(
        draft.threadId
      )}`,
      method: "PATCH",
      workspaceId: deps.workspaceId,
      body:
        draft.op === "close"
          ? { op: "close", outcome: draft.outcome, summary: draft.summary }
          : { op: "reopen" },
    }),
    // The thread row IS the transcript's status overlay, so patching it
    // flips the card's chip on the click rather than after two round trips.
    optimistic: (draft) =>
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) => {
        const current = cache?.tasks.find((t) => t.id === draft.threadId);
        if (!cache || !current) return cache;
        return upsertThread(cache, {
          ...current,
          status: draft.op === "close" ? "closed" : "open",
          outcome: draft.op === "close" ? draft.outcome ?? null : null,
          outcomeSummary: draft.op === "close" ? draft.summary ?? null : null,
          closedAt: draft.op === "close" ? new Date().toISOString() : null,
        });
      }),
    reconcile: (data, draft) =>
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
        upsertThread(cache, data.task)
      ),
    // A close/reopen posts a lifecycle echo into the transcript, which only
    // the server can render.
    invalidate: (draft) => [
      messagesKey(draft.channelId),
      channelKeys.list().all,
    ],
    settleWith: deps.gate,
    onError: (err, draft) =>
      failed(
        err,
        draft.op === "close"
          ? "Couldn't close the thread"
          : "Couldn't reopen the thread"
      ),
  };
}

export function useThreadWrites(params: ThreadWritesParams) {
  // Rebuilt every render on purpose: `useApiMutationWith` reads its config
  // through a ref, so these closures are always the current render's.
  const deps: ThreadWriteDeps = { ...params, client: useQueryClient() };
  const send = useApiMutationWith<SendDraft, { message: ChannelMessage }>(
    channelRequest,
    sendConfig(deps)
  );
  const openThread = useApiMutationWith<OpenThreadDraft, { task: ChannelThread }>(
    channelRequest,
    openThreadConfig(params)
  );
  const threadOp = useApiMutationWith<ThreadOpDraft, { task: ChannelThread }>(
    channelRequest,
    threadOpConfig(params)
  );

  return {
    send,
    openThread,
    threadOp,
    /** True while any of the three writes is in flight. */
    pending: send.pending || openThread.pending || threadOp.pending,
  };
}
