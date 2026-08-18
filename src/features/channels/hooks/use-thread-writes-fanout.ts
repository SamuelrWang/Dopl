"use client";

import {
  coldKeys,
  patchCache,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelKeys, channelThreadsPath } from "../client/query-keys";
import {
  appendPendingMessage,
  buildPendingMessage,
  buildPendingThread,
  pendingMessageId,
  retagPendingMessage,
  upsertThread,
  type MessagesCache,
  type ThreadsCache,
} from "../lib/optimistic-cache";
import {
  failed,
  messagesKey,
  threadsKey,
  type ThreadWriteDeps,
} from "./use-thread-writes-shared";
import type { ChannelThread } from "../types";

/**
 * THE REQUEST FAN-OUT's client half — its own file because it has its own
 * reason to change: the SHAPE of a request (N addressees, one card), where
 * `use-thread-writes.ts` owns the shape of a message.
 *
 * ⚠ It is still the same idempotency discipline, and this is still the tree
 * that mints keys (INVARIANTS §8) — the base is minted at submit and every
 * derived key hangs off it.
 */

/**
 * ONE request against N addressees — the "New agent thread" panel's send.
 *
 * ⚠ `clientMsgId` is the BASE, not a per-row key. The server derives
 * `${base}:${toUserId}` per addressee (`server/service-tasks-fanout.ts ›
 * addresseeClientMsgId`) and the group id from the base plus the caller, so a
 * retry of the whole send converges thread-by-thread onto the same card. Minting
 * it HERE is what makes that possible: a server-minted key could not survive the
 * client's own retry.
 */
export interface FanOutThreadsDraft {
  channelId: string;
  /** The BASE idempotency key. One per Send, captured at submit. */
  clientMsgId: string;
  title: string;
  body: string;
  /** One entry per pill. ⚠ Empty is not sendable — and is a 400 besides. */
  toUserIds: string[];
}

/** The fan-out's response. `tasks` and `openingSeqs` are ALIGNED by index, in
 *  addressee order — the order the optimistic rows were written in. */
export interface FanOutThreadsResponse {
  tasks: ChannelThread[];
  openingSeqs: (number | null)[];
  fanoutGroup: string;
}


/**
 * The per-addressee key SHAPE, restated on the client for the OPTIMISTIC rows
 * only.
 *
 * ⚠ NOT the wire key. The server derives its own from the base it was sent
 * (`service-tasks-fanout.ts › addresseeClientMsgId`) and the two are never
 * compared — this one exists so the N pending rows of one send have N distinct
 * cache identities instead of overwriting each other, which is the same bug the
 * server-side key prevents one layer down. A drift between them costs nothing.
 */
function pendingAddresseeKey(base: string, toUserId: string): string {
  return `${base}:${toUserId}`;
}

/**
 * THE REQUEST FAN-OUT's write: N threads, rendered as ONE card.
 *
 * ⚠ N PENDING OPENING MESSAGES, not one. The server writes one opening message
 * per thread and the transcript collapses every opener sharing a `fanoutGroup`
 * into a single card (`components/channels-v2/view-model.ts › channelRows`), so
 * a single optimistic row would draw a card with ONE pill and then grow to N
 * when the read lands. Writing the real shape optimistically means the frame
 * after the click already says who was addressed.
 */
export function fanOutThreadsConfig(
  deps: ThreadWriteDeps
): UseApiMutationConfig<FanOutThreadsDraft, FanOutThreadsResponse> {
  return {
    request: (draft) => ({
      path: channelThreadsPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: {
        title: draft.title,
        body: draft.body,
        toUserIds: draft.toUserIds,
        clientMsgId: draft.clientMsgId,
      },
    }),
    optimistic: (draft) => {
      // Provisional group id: never sent, never compared with the server's.
      // The reconcile swaps it for the derived one.
      const group = pendingMessageId(draft.clientMsgId);
      return [
        patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
          draft.toUserIds.reduce<MessagesCache | undefined>(
            (acc, toUserId) =>
              appendPendingMessage(
                acc,
                buildPendingMessage(acc, {
                  channelId: draft.channelId,
                  clientMsgId: pendingAddresseeKey(draft.clientMsgId, toUserId),
                  body: draft.body,
                  authorUserId: deps.currentUserId,
                  authorName: deps.currentUserName,
                  authorAvatarUrl: deps.currentUserAvatarUrl,
                  // ⚠ Wire spellings — the pending rows are read by the real
                  // renderer, so they carry the real keys.
                  metadata: {
                    taskId: pendingMessageId(
                      pendingAddresseeKey(draft.clientMsgId, toUserId)
                    ),
                    to_user_id: toUserId,
                    fanoutGroup: group,
                  },
                })
              ),
            cache
          )
        ),
        patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
          draft.toUserIds.reduce<ThreadsCache | undefined>(
            (acc, toUserId) =>
              upsertThread(
                acc,
                buildPendingThread({
                  id: pendingMessageId(
                    pendingAddresseeKey(draft.clientMsgId, toUserId)
                  ),
                  channelId: draft.channelId,
                  workspaceId: deps.workspaceId,
                  title: draft.title,
                  createdBy: deps.currentUserId,
                  targetUserId: toUserId,
                })
              ),
            cache
          )
        ),
      ];
    },
    // ⚠ ALIGNED BY INDEX. The response lists threads in addressee order, which
    // is the order the pending rows were written in, so each real thread
    // replaces its own twin. A server that reordered would rebuild the card
    // wrong for exactly one frame — and then the invalidated read would fix it.
    reconcile: (data, draft) => [
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
        data.tasks.reduce<ThreadsCache | undefined>(
          (acc, thread, i) =>
            upsertThread(
              acc,
              thread,
              pendingMessageId(
                pendingAddresseeKey(draft.clientMsgId, draft.toUserIds[i])
              )
            ),
          cache
        )
      ),
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        data.tasks.reduce<MessagesCache | undefined>(
          (acc, thread, i) =>
            retagPendingMessage(
              acc,
              pendingAddresseeKey(draft.clientMsgId, draft.toUserIds[i]),
              { taskId: thread.id, fanoutGroup: data.fanoutGroup }
            ),
          cache
        )
      ),
    ],
    // The N server-written opening messages cannot be reconciled from this
    // response at all (they carry seqs and ids only the server knows), so the
    // transcript is named UNCONDITIONALLY — `openThread`'s reasoning, N times.
    //
    // ⚠ The THREAD list is named on the COLD-CACHE condition instead (§8): the
    // optimistic patch and the reconcile both decline on an entry with no data,
    // so on a channel whose thread list has not loaded the card would have no
    // thread to render and nothing scheduled to fetch one.
    invalidate: (draft) => [
      messagesKey(draft.channelId),
      channelKeys.list().all,
      ...coldKeys(deps.client, [threadsKey(draft.channelId)]),
    ],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't send the request"),
  };
}
