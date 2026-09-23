"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { channelRequest } from "../client/api";
import { channelKeys, channelPath } from "../client/query-keys";
import { patchChannel, type ChannelsCache } from "../lib/optimistic-cache";
import type { Channel } from "../types";

/**
 * THE HEADER WRITE — this channel's NAME and its DESCRIPTION (`topic`), saved
 * one field at a time from the Info tab's click-to-edit lines (Samuel,
 * 2026-09-16).
 *
 * ⚠ ITS OWN MODULE, ON `use-channel-info-card-writes.ts`'s TERMS AND FOR ITS
 * REASON. `use-channel-lifecycle-writes.ts` is the channel's LIFECYCLE — archive,
 * visibility, delete, join, leave: five writes about whether a room exists and
 * who is in it. Name and topic are the room's own LABEL, and they move when the
 * header's editing surface moves, which is a different reason to change.
 *
 * ⚠ IT IS MANAGE-GATED ON THE SERVER, unlike the info card beside it
 * (`service-writes-channel.ts › MANAGED_CHANNEL_FIELDS` lists both `name` and
 * `topic`). The Info tab therefore renders the plain text for a non-manager
 * rather than an editable line — an affordance that always ends in a 403 is a
 * dead control (INVARIANTS §5), and hiding it changes no permission either way.
 *
 * ⚠ IT SHARES THE PATCH AND THEREFORE THE CACHE RULES. `PATCH /api/channels/
 * [channelId]` answers with the caller-relative channel, so the reconcile is
 * exact and the invalidate names ORDERING only (INVARIANTS §8 rules 1 and 5).
 *
 * ⚠ **NO NEW ENDPOINT.** This is the same route `useChannelLifecycleWrites` and
 * `useChannelInfoCardWrite` already PATCH; only the body differs.
 */

export interface HeaderDraft {
  /** Captured at the gesture; never re-read from the selection (§8 rule 4). */
  channelId: string;
  /**
   * ONE FIELD PER SAVE, and the blur that commits a line names only the line it
   * committed. Sending both would make an untouched name part of the topic's
   * write — and a stale one, if the row rendered before somebody else renamed
   * the room.
   */
  patch: { name: string } | { topic: string };
}

export interface HeaderWriteDeps {
  workspaceId: string;
  /**
   * The host surface's `useRefetchGate` gate. ⚠ REQUIRED, for the reason
   * `InfoCardWriteDeps` gives: without it this write races the realtime
   * doorbell's refetches, and a channels-list refetch landing between the
   * optimistic patch and the response repaints the OLD name.
   */
  gate: MutationGate;
}

export function headerConfig(
  deps: HeaderWriteDeps
): UseApiMutationConfig<HeaderDraft, { channel: Channel }> {
  return {
    request: (draft) => ({
      path: channelPath(draft.channelId),
      method: "PATCH",
      workspaceId: deps.workspaceId,
      body: draft.patch,
    }),
    // ⚠ THE OPTIMISTIC PATCH IS WHAT MAKES THE GESTURE FEEL LIKE TYPING INTO THE
    // LINE. The field un-focuses into plain text on blur; without this the old
    // value flashes back for a round trip, which reads as "it did not save".
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, draft.channelId, draft.patch)
      ),
    // ⚠ MERGE, NEVER REPLACE (§8 rule 5).
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    // ORDERING is the one thing this write changes and cannot compute:
    // `repository.ts › updateChannel` stamps `updated_at`, the list's sort key.
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    onError: (err) =>
      toast({
        title: userFacingMessage(err, "Couldn't save this change"),
      }),
  };
}

/**
 * Save this channel's name or description.
 *
 * ⚠ TWO NAMED VERBS, NOT ONE `save(patch)`. The caller is a line that knows
 * which field it is, and a single object argument is how a surface comes to send
 * `{ name, topic }` with one of them stale.
 */
export function useChannelHeaderWrite({
  channelId,
  workspaceId,
  gate,
}: {
  channelId: string;
  workspaceId: string;
  gate: MutationGate;
}) {
  const write = useApiMutationWith<HeaderDraft, { channel: Channel }>(
    channelRequest,
    headerConfig({ workspaceId, gate })
  );
  return {
    saveName: (name: string) => write.mutate({ channelId, patch: { name } }),
    saveTopic: (topic: string) => write.mutate({ channelId, patch: { topic } }),
    pending: write.pending,
  };
}
