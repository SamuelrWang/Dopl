"use client";

import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../client/api";
import { channelKeys, channelMentionsPath } from "../client/query-keys";
import { failed } from "./use-thread-writes-shared";
import type { ChannelMention } from "../types";

/**
 * MARK MENTIONS READ — the Tags inbox's one write, driving both the per-row
 * click and "Mark all read".
 *
 * ⚠ ONE MUTATION, NOT TWO. Mark-all sends the ids it is DISPLAYING rather than
 * a flag (`schema-mentions.ts` carries the argument), so there is one request
 * shape, one authorization path, and one cache patch. A second "mark all"
 * endpoint would be a second derivation of the set the badge counts.
 *
 * ⚠ OPTIMISTIC, AND THE PATCH IS THE POINT. The badge is client-side arithmetic
 * over the cached projection, so flipping `read` in the cache is what makes the
 * count drop within the frame of the click — the same gesture also navigates
 * the center pane, and a badge that lagged a round trip behind the scroll would
 * read as a failed click.
 *
 * ⚠ `settleWith: gate` — the SAME `useRefetchGate` gate the page's reads
 * register, or this write races the realtime doorbell's refetch and survives
 * only by luck (INVARIANTS §7/§8).
 *
 * ⚠ IDEMPOTENT ON THE SERVER (`ON CONFLICT DO NOTHING`), so a double click is a
 * 200 no-op. Nothing here needs to guard against re-marking.
 */

export interface MarkMentionsReadDraft {
  /** Captured at the click; never re-read from the selection. Every cache key
   *  below is built from it, so an in-flight mark cannot land in the inbox of a
   *  channel the user switched to (all per-channel reads keep previous data). */
  channelId: string;
  messageIds: string[];
}

/** The RAW response body the read hook caches; `select` applies on read
 *  (INVARIANTS §8 — patches operate on the raw body). */
export interface MentionsCache {
  mentions: ChannelMention[];
  truncated?: boolean;
}

export interface MentionWriteDeps {
  workspaceId: string;
  gate: MutationGate;
}

/** Flip `read` on the named rows, leaving every other field and the ORDER
 *  alone. ⚠ Rows STAY listed — the inbox is a record, not a to-do pile. */
function markMentionsInCache(
  cache: MentionsCache | undefined,
  messageIds: readonly string[]
): MentionsCache | undefined {
  if (!cache) return cache;
  const ids = new Set(messageIds);
  return {
    ...cache,
    mentions: cache.mentions.map((mention) =>
      ids.has(mention.messageId) ? { ...mention, read: true } : mention
    ),
  };
}

/**
 * ⚠ Exported APART from the hook so the config can be driven through TanStack's
 * own `MutationObserver` in a DOM-free test — the order onMutate → mutationFn →
 * onSuccess/onError → onSettled IS the contract (INVARIANTS §14).
 */
function markMentionsReadConfig(
  deps: MentionWriteDeps
): UseApiMutationConfig<MarkMentionsReadDraft, { marked: number }> {
  return {
    request: (draft) => ({
      path: channelMentionsPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: { messageIds: draft.messageIds },
    }),
    optimistic: (draft) =>
      patchCache<MentionsCache>(
        channelKeys.mentions(draft.channelId).all,
        (cache) => markMentionsInCache(cache, draft.messageIds)
      ),
    // ⚠ NO `reconcile`. The response is a COUNT, not rows — there is nothing in
    // it to fold back, and the optimistic patch already says everything the
    // server just agreed to. `invalidate` is what corrects a partial accept
    // (an id the server declined stays unread after the refetch).
    invalidate: (draft) => [channelKeys.mentions(draft.channelId).all],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't mark the mention read"),
  };
}

export function useMentionWrites(deps: MentionWriteDeps) {
  const markRead = useApiMutationWith<MarkMentionsReadDraft, { marked: number }>(
    channelRequest,
    markMentionsReadConfig(deps)
  );
  return { markRead, pending: markRead.pending };
}
