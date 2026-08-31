"use client";

import {
  coldKeys,
  patchCache,
  useApiMutationWith,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../client/api";
import { channelKeys, channelMessagesPath } from "../client/query-keys";
import { appendPendingMessage, buildPendingMessage } from "../lib/optimistic-cache";
import { useQueryClient } from "@tanstack/react-query";
import {
  failed,
  messagesKey,
  type ThreadWriteDeps,
  type ThreadWritesParams,
} from "./use-thread-writes-shared";
import type { ChannelMessage } from "../types";

/**
 * ANSWER AN ESCALATION — the write behind an escalation card's option buttons
 * (Samuel, 2026-08-31).
 *
 * ⚠ **IT IS AN ORDINARY POST, AND THAT IS THE RULING RATHER THAN THE
 * IMPLEMENTATION.** An escalation is a question about shared work asked in a
 * shared room, so its answer is public too: it goes to
 * `POST /api/channels/[id]/messages` like any other message, it appears in the
 * transcript, and the asking agent receives it the way it receives every other
 * human message. Routing it down a private lane instead would leave a visible
 * question with an invisible answer and a card that reads unanswered forever.
 *
 * ⚠ **THE CLIENT NEVER NAMES AN AGENT.** `escalationAnswer` carries the
 * escalation's message id and the option index and NOTHING ELSE; the server
 * derives which agent to wake off that message's own `client_msg_id` stamp
 * (`server/service-writes-metadata-escalation.ts`). A client-supplied agent id
 * would make this key a wake primitive aimed anywhere.
 *
 * ⚠ **NO SECOND-CLICK GUARD LIVES HERE.** One answer per escalation is enforced
 * at rest (`channel_messages_escalation_answer_key`) and surfaces as a 409; the
 * card hides its buttons once an answer is in the page, and `pending` is the
 * in-flight guard. A read-then-write check in this hook would be a race with a
 * friendlier message and no guarantee behind it.
 *
 * ⚠ `settleWith: gate` — the SAME `useRefetchGate` the page's reads register, or
 * this write races the realtime doorbell's refetch (INVARIANTS §7/§8).
 */

export interface AnswerEscalationDraft {
  /** Captured AT THE CLICK, never re-read from the selection (INVARIANTS §8
   *  rule 4) — every cache key below is built from it, so an in-flight answer
   *  cannot land in the transcript of a channel the operator switched to. */
  channelId: string;
  escalationMessageId: string;
  optionIndex: number;
  /** The option's own label — the body of the message that carries the answer,
   *  so the transcript reads as a sentence and not as an index. */
  optionLabel: string;
  clientMsgId: string;
}

/** The RAW response body the read hook caches; `select` applies on read. */
export interface MessagesCache {
  messages: ChannelMessage[];
}

export function answerEscalationConfig(
  deps: ThreadWriteDeps
): UseApiMutationConfig<AnswerEscalationDraft, { message: ChannelMessage }> {
  return {
    request: (draft) => ({
      path: channelMessagesPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: {
        body: draft.optionLabel,
        clientMsgId: draft.clientMsgId,
        escalationAnswer: {
          escalationMessageId: draft.escalationMessageId,
          optionIndex: draft.optionIndex,
        },
      },
    }),
    // ⚠ THE PENDING ROW IS A PLAIN MESSAGE AND CARRIES NO `escalationAnswer`,
    // DELIBERATELY. The key is server-stamped, so inventing one locally would
    // flip the CARD to answered before the server has agreed — and if the post
    // 403s or 409s the operator would have watched their own answer be accepted
    // and then vanish. The optimistic row is the reply appearing in the
    // transcript; the CARD updates on the reconcile, when the stamp is real.
    optimistic: (draft) =>
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        appendPendingMessage(
          cache,
          buildPendingMessage(cache, {
            channelId: draft.channelId,
            clientMsgId: draft.clientMsgId,
            body: draft.optionLabel,
            authorUserId: deps.currentUserId,
            authorName: deps.currentUserName,
            authorAvatarUrl: deps.currentUserAvatarUrl,
          })
        )
      ),
    // ⚠ MERGE, NEVER REPLACE — but here the whole saved row IS the response, so
    // `reconcileMessage`'s in-place swap is what folds the server-stamped
    // `metadata.escalationAnswer` in, which is what flips the card.
    reconcile: (data, draft) =>
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        reconcileAnswer(cache, data.message, draft.clientMsgId)
      ),
    // The channel list carries `lastMessageAt` / unread ordering, which this
    // write changes and cannot compute. The TRANSCRIPT is cold-only, for
    // `sendMessage`'s reason: naming it unconditionally re-downloads the whole
    // page on every answer.
    invalidate: (draft) => [
      channelKeys.list().all,
      ...coldKeys(deps.client, [messagesKey(draft.channelId)]),
    ],
    settleWith: deps.gate,
    // ⚠ A FAILED answer re-reads the transcript UNCONDITIONALLY. `onError` has
    // restored the pre-click snapshot, which is a GUESS — a POST that timed out
    // after the row was written leaves the answer STORED (and the agent woken)
    // while the local cache says it never happened, and this is the one write
    // where that lie is expensive: the operator would press a second option.
    onError: (err, draft) => {
      void deps.client.invalidateQueries({
        queryKey: messagesKey(draft.channelId),
      });
      failed(err, "Couldn't send that answer");
    },
  };
}

/**
 * Replace the pending twin with the saved row, IN PLACE.
 *
 * ⚠ A LOCAL COPY OF `optimistic-cache.ts › reconcileMessage`'S SHAPE RATHER
 * THAN A CALL TO IT, because that function matches on `clientMsgId` off the
 * SAVED row and the saved row here is the one that carries the stamp we need to
 * land. Matching on the DRAFT's key keeps the swap correct even if the server
 * normalised the id.
 */
function reconcileAnswer(
  cache: MessagesCache | undefined,
  saved: ChannelMessage,
  clientMsgId: string
): MessagesCache | undefined {
  if (!cache) return cache;
  const index = cache.messages.findIndex((m) => m.clientMsgId === clientMsgId);
  if (index === -1) return { ...cache, messages: [...cache.messages, saved] };
  const messages = cache.messages.slice();
  messages[index] = saved;
  return { ...cache, messages };
}

export function useEscalationWrites(params: ThreadWritesParams) {
  // ⚠ Rebuilt every render on purpose — `useApiMutationWith` reads its config
  // through a ref, so these closures are always the current render's
  // (`use-thread-writes.ts › useThreadWrites`'s own note).
  const deps: ThreadWriteDeps = { ...params, client: useQueryClient() };
  const answer = useApiMutationWith<
    AnswerEscalationDraft,
    { message: ChannelMessage }
  >(channelRequest, answerEscalationConfig(deps));
  return { answer, pending: answer.pending };
}
