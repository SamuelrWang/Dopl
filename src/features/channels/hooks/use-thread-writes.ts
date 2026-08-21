"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  coldKeys,
  patchCache,
  useApiMutationWith,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../client/api";
import {
  channelKeys,
  channelMessagesPath,
  channelThreadsPath,
} from "../client/query-keys";
import {
  failed,
  messagesKey,
  threadsKey,
  type ThreadWriteDeps,
  type ThreadWritesParams,
} from "./use-thread-writes-shared";
import {
  fanOutThreadsConfig,
  type FanOutThreadsDraft,
  type FanOutThreadsResponse,
} from "./use-thread-writes-fanout";
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
import type { ChannelMessage, ChannelThread, MessageIntent } from "../types";

/**
 * THE FLAGSHIP WRITE PATH — sending a message and starting a session, made
 * optimistic. Within one frame of the click:
 *   1. mint a `clientMsgId` — the server's idempotency key, so a retry of a
 *      failed send cannot double-post;
 *   2. write the message into the transcript cache as a pending row; a REQUEST
 *      also gets a pending thread row, so the transcript has a thread to render
 *      the card against (⚠ history: it was added because the DELETED session
 *      card computed to "complete" from a lone unanswered human message);
 *   3. clear the composer (its own state, before the await);
 *   4. send the POST.
 * The response is USED — a chat send swaps its pending row for the saved one in
 * place. On failure `onError` restores the step-2 snapshot and the composer puts
 * the draft back.
 *
 * ⚠ EVERY CACHE WRITE IS KEYED BY THE CHANNEL ID CAPTURED AT SUBMIT TIME (it
 * rides in the draft and the per-channel keys embed it). That is what stops an
 * in-flight send landing in the transcript of a channel the user switched to —
 * all three per-channel reads use `keepPreviousData`.
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

// ⚠ `ThreadOpDraft` and {@link threadOpConfig} USED TO LIVE HERE — the PATCH that
// drove `{op:"close"}` / `{op:"reopen"}` from the thread card and the thread
// panel. Both are DELETED with thread closing (wiring plan Phase 4, 2026-08-18);
// the route arms behind them are gone too, so a resurrected caller would 400 on
// the discriminator rather than fail quietly.

// ⚠ Re-exported, not re-declared: `use-thread-writes-shared.ts` is where these
// live now, and every existing importer keeps its import path.
export type { ThreadWritesParams, ThreadWriteDeps };
// ⚠ `fanOutThreadsConfig` was re-exported here and is NOT (2026-08-20) — it had no
// importer; this file's own use takes it from `./use-thread-writes-fanout` above.
export type { FanOutThreadsDraft, FanOutThreadsResponse };

/**
 * ⚠ Exported APART from the hook so `use-thread-writes.test.ts` can drive them
 * through TanStack's own `MutationObserver` — `npm test` has no DOM, and the
 * order onMutate → mutationFn → onSuccess/onError → onSettled IS the contract.
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
    // ⚠ The RESPONSE is the point: the saved row replaces its pending twin in
    // place. No `refetchMessages`, so a send costs exactly one round trip.
    reconcile: (data, draft) =>
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        reconcileMessage(cache, data.message)
      ),
    // The list carries `lastMessageAt` / unread ordering, which this write
    // changes and cannot compute. UNCONDITIONAL.
    //
    // ⚠ The transcript is named too, but COLD-CACHE ONLY. Both the optimistic
    // patch and the reconcile decline on an undefined entry on purpose, so on a
    // channel whose transcript has not loaded NOTHING here puts the sent message
    // on screen — and the bundled SPA has no realtime doorbell to do it later.
    // Reachable in one gesture: all three per-channel reads are
    // `keepPreviousData`, so a send can beat the new channel's first read.
    //
    // ⚠ `coldKeys`, never a plain listing: `invalidateQueries` defaults to
    // `refetchType: "active"` and the transcript query IS active, so naming it
    // unconditionally re-downloads the 200-message page on EVERY send — the
    // exact cost this write exists to remove. `openThread` and `threadOp` DO
    // name it unconditionally and are right to: their server-written opening
    // message and lifecycle echo cannot be reconciled from the response at all.
    invalidate: (draft) => [
      channelKeys.list().all,
      ...coldKeys(deps.client, [messagesKey(draft.channelId)]),
    ],
    settleWith: deps.gate,
    // ⚠ A FAILED send re-reads the transcript UNCONDITIONALLY: `onError` has
    // just restored the pre-send snapshot, which is a guess — a POST that timed
    // out after the row was written leaves the message STORED while the local
    // cache says it never happened. Rare path, so the cost argument does not
    // apply.
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
              // `taskId` binds the row into its THREAD — the transcript's thread
              // card; `to_user_id` draws the addressee line. ⚠ Wire spellings,
              // so the pending card is the real component.
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
    // ⚠ The POST answers with the thread but NOT its opening message (server
    // writes that under its own derived key), so the reconcile re-points the
    // pending row at the real thread id and swaps the overlay. The stored
    // opening message arrives with the invalidated read.
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
    // ⚠ Both patched caches — transcript AND pending thread overlay — are
    // snapshotted together in `onMutate`, so the rollback removes the card whole
    // rather than leaving a titled shell with no message in it.
    onError: (err) => failed(err, "Couldn't open the thread"),
  };
}

export function useThreadWrites(params: ThreadWritesParams) {
  // ⚠ Rebuilt every render on purpose — `useApiMutationWith` reads its config
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
  const fanOutThreads = useApiMutationWith<
    FanOutThreadsDraft,
    FanOutThreadsResponse
  >(channelRequest, fanOutThreadsConfig(deps));

  return {
    send,
    openThread,
    fanOutThreads,
    /** True while any of the three writes is in flight. */
    pending: send.pending || openThread.pending || fanOutThreads.pending,
  };
}
