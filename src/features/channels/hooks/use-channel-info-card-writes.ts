"use client";

import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { ChannelApiError, channelRequest } from "../client/api";
import { channelKeys, channelPath } from "../client/query-keys";
import { patchChannel, type ChannelsCache } from "../lib/optimistic-cache";
import type { ChannelInfoCard } from "../info-card";
import type { Channel } from "../types";

/**
 * THE INFO-CARD WRITE — one channel's curated Main-info card, saved whole
 * (Samuel, 2026-08-25).
 *
 * ⚠ ITS OWN MODULE, NOT A SIXTH `use-channel-lifecycle-writes.ts` CONFIG. That
 * file is the channel's LIFECYCLE — archive, visibility, delete, join, leave:
 * five writes about whether a room exists and who is in it, and every one of
 * them is manage-gated. The card is content the room carries, gated on
 * MEMBERSHIP (`service-writes.ts › updateChannel`). Filing it there would put
 * a member-writable field in a module whose docblock says the opposite.
 *
 * ⚠ IT SHARES THE PATCH AND THEREFORE THE CACHE RULES. `PATCH /api/channels/
 * [channelId]` answers with the caller-relative channel, so the reconcile is
 * exact and the invalidate names ORDERING only — the same shape
 * `archiveConfig` / `visibilityConfig` have, and for the same reasons
 * (INVARIANTS §8 rules 1 and 5).
 */

export interface InfoCardDraft {
  /** Captured at the gesture; never re-read from the selection (§8 rule 4). */
  channelId: string;
  /** THE WHOLE CARD. The server replaces rather than merges — see
   *  `service-writes.ts › updateChannel`. */
  card: ChannelInfoCard;
}

export interface InfoCardWriteDeps {
  workspaceId: string;
  /**
   * The host surface's `useRefetchGate` gate. ⚠ REQUIRED, for the reason
   * `LifecycleWriteDeps` gives: without it this write races the realtime
   * doorbell's refetches, and a channels-list refetch landing between the
   * optimistic patch and the response repaints the OLD card.
   */
  gate: MutationGate;
}

export function infoCardConfig(
  deps: InfoCardWriteDeps
): UseApiMutationConfig<InfoCardDraft, { channel: Channel }> {
  return {
    request: (draft) => ({
      path: channelPath(draft.channelId),
      method: "PATCH",
      workspaceId: deps.workspaceId,
      body: { infoCard: draft.card },
    }),
    // ⚠ THE OPTIMISTIC PATCH IS THE WHOLE POINT OF THE GESTURE. Removing a row
    // is a click on that row: it has to leave immediately, or the × reads as
    // broken for a network round trip. The rollback restores it if the server
    // refuses.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, draft.channelId, { infoCard: draft.card })
      ),
    // ⚠ MERGE, NEVER REPLACE (§8 rule 5) — `patchChannel` spreads the server
    // row over the cached one, so caller-relative fields the PATCH does return
    // stay correct and nothing the response omits is dropped.
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    // ORDERING is the one thing this write changes and cannot compute:
    // `repository.ts › updateChannel` stamps `updated_at`, which is the list's
    // sort key. The card itself is already reconciled above.
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    onError: (err) =>
      toast({
        title:
          err instanceof ChannelApiError
            ? err.message
            : "Couldn't save this info card",
      }),
  };
}

/**
 * Save this channel's card.
 *
 * ⚠ THE CALLER HOLDS THE CARD AND SENDS THE NEXT ONE WHOLE. The pure editors
 * live in `../info-card.ts` (`hideBuiltInRow` / `removeInfoCardRow` /
 * `upsertInfoCardRow`), so a surface never assembles a card by hand and two
 * surfaces cannot assemble one differently.
 */
export function useChannelInfoCardWrite({
  channelId,
  workspaceId,
  gate,
}: {
  channelId: string;
  workspaceId: string;
  gate: MutationGate;
}) {
  const write = useApiMutationWith<InfoCardDraft, { channel: Channel }>(
    channelRequest,
    infoCardConfig({ workspaceId, gate })
  );
  return {
    save: (card: ChannelInfoCard) => write.mutate({ channelId, card }),
    pending: write.pending,
  };
}
