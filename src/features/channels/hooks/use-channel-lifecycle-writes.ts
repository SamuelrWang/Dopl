"use client";

import { useQueryClient } from "@tanstack/react-query";
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
  channelListParams,
  channelMembersPath,
  channelPath,
} from "../client/query-keys";
import { patchChannel, type ChannelsCache } from "../lib/optimistic-cache";
import type { Channel, ChannelVisibility } from "../types";

/**
 * The channel LIFECYCLE writes — archive, visibility, delete, join, leave — on
 * `useApiMutation` (F-159's remainder; the SEND path and the thread writes went
 * first). There were never six: notify scope left the product with F-170.
 *
 * WHY THIS CONVERSION IS NOT COSMETIC (audit C-27). The refetch coordinator
 * used to cover two of six mutation families: only the send and the thread ops
 * incremented the busy counter, so all five writes below raced the realtime
 * doorbell's four refetches and survived ONLY because some other surface
 * shadowed the server value. Every config here therefore carries
 * `settleWith: gate` — the same `useRefetchGate` gate the send and the thread
 * ops hold — which is what makes the protection structural instead of
 * incidental. `onSettled` releases it on the throwing path too, so a failed
 * archive cannot strand a deferred refetch.
 *
 * WHY EACH DRAFT CARRIES ITS OWN `channelId` (§7 rule 4, audit C-21). The three
 * per-channel reads use `keepPreviousData`, so a channel switch keeps rendering
 * the previous channel under the new header. Every value a write needs is
 * snapshotted into the draft AT THE CLICK and every cache key downstream is
 * built from `draft.channelId` — nothing here re-reads the selection.
 *
 * THE TWO LIST VARIANTS ARE PATCHED SEPARATELY, and only the archive toggle
 * needs it. `/api/channels` is cached twice — the default list holds ACTIVE
 * channels only, `?include=archived` holds everything — so archiving is a row
 * LEAVING one cache entry and changing state in the other. One update function
 * cannot say two things, so the toggle names both entries exactly
 * (`channelListKey`) rather than patching the prefix. **The two keys are
 * disjoint on purpose**: `onMutate` snapshots per patch in order, so an
 * overlapping pair (a prefix plus one of its members) would snapshot the
 * already-patched entry and roll back to the optimistic value.
 *
 * DELETE IS TWO MECHANICS BEHIND ONE VERB (ENGINEERING §7, "channels.deleted_at
 * … IS A DM-ONLY MECHANIC" — C-16 / F-173), and the branch survives the
 * conversion intact:
 *  - a DM SOFT-closes. `channels.deleted_at` is the close half of close/reopen;
 *    either side's next open revives the SAME row with its full history, so the
 *    transcript, roster and threads MUST stay cached. It only leaves the list.
 *  - anything else HARD-deletes, cascading. That is a CACHE EVICTION, not just
 *    a write: the query cache is IndexedDB-persisted with a 24h `gcTime`, so an
 *    invalidated entry for a deleted channel still renders it across relaunches.
 *    `evictChannel` therefore `removeQueries` the messages, members and threads
 *    of the deleted channel — and never for a DM.
 */

export interface ArchiveDraft {
  /** Captured at the click; never re-read from the selection. */
  channelId: string;
  archived: boolean;
}

export interface VisibilityDraft {
  channelId: string;
  visibility: ChannelVisibility;
}

export interface DeleteDraft {
  channelId: string;
  /** Decides soft-close vs. hard delete — and therefore whether to evict. */
  isDirect: boolean;
}

export interface JoinDraft {
  channelId: string;
  userId: string;
}

export interface LeaveDraft {
  channelId: string;
  userId: string;
  /** A private channel leaves the caller's list entirely; a public one stays,
   *  read-only. Captured at the click for the same reason as `channelId`. */
  visibility: ChannelVisibility;
}

/** What the five configs need from their host, transport aside. */
export interface LifecycleWriteDeps {
  workspaceId: string;
  /** Holds realtime refetches open for the life of each write. REQUIRED, not
   *  optional: C-27 is exactly the state where some of these writes had a gate
   *  and some did not, so a config that can be built without one re-opens it. */
  gate: MutationGate;
  /** The selected channel is gone — clear the explicit selection. */
  onDeselect: () => void;
  /** Drop a hard-deleted channel's per-channel caches. Never called for a DM. */
  evictChannel: (channelId: string) => void;
}

/** Drop one channel row from a list cache, whichever variant it is. */
export function dropChannelRow(
  cache: ChannelsCache | undefined,
  channelId: string
): ChannelsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    channels: cache.channels.filter((c) => c.id !== channelId),
  };
}

/** The EXACT key one list variant was read under (`useChannels`'s own params). */
function channelListKey(workspaceId: string, includeArchived: boolean) {
  return channelKeys
    .list()
    .entry({ workspaceId, query: channelListParams(includeArchived) });
}

function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChannelApiError ? err.message : fallback });
}

export function archiveConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<ArchiveDraft, { channel: Channel }> {
  return {
    request: (draft) => ({
      path: channelPath(draft.channelId),
      method: "PATCH",
      workspaceId: deps.workspaceId,
      body: { archived: draft.archived },
    }),
    // Archiving REMOVES the row from the active list (that read excludes
    // archived channels), and STAMPS it in the archived list (that read holds
    // both, and the archived tab filters on `archivedAt !== null`). Unarchiving
    // is the mirror: clearing the stamp drops it out of the archived tab, and
    // the active list gets it back from the settle-time invalidate rather than
    // from a row this client would have to invent in the server's sort order.
    optimistic: (draft) => [
      patchCache<ChannelsCache>(
        channelListKey(deps.workspaceId, false),
        (cache) => (draft.archived ? dropChannelRow(cache, draft.channelId) : cache)
      ),
      patchCache<ChannelsCache>(channelListKey(deps.workspaceId, true), (cache) =>
        patchChannel(cache, draft.channelId, {
          archivedAt: draft.archived ? new Date().toISOString() : null,
        })
      ),
    ],
    // The PATCH answers with the caller-relative channel (`updateChannel` ends
    // in `getChannel`), so the true `archivedAt` / `updatedAt` land without a
    // read. `patchChannel` maps over rows that EXIST, so this cannot re-add the
    // row the optimistic patch just dropped.
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    // Ordering (`updated_at` desc) and the row's membership of the OTHER
    // variant are the two things this write changes and cannot compute.
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't update the channel"),
  };
}

export function visibilityConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<VisibilityDraft, { channel: Channel }> {
  return {
    request: (draft) => ({
      path: channelPath(draft.channelId),
      method: "PATCH",
      workspaceId: deps.workspaceId,
      body: { visibility: draft.visibility },
    }),
    // THE HEADER PILL AND THE MENU LABEL BOTH READ `channel.visibility` off the
    // list row, so this one patch is what stops them sitting on the old value
    // for two network hops — the pane holds no lens of its own.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, draft.channelId, { visibility: draft.visibility })
      ),
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't update the channel"),
  };
}

export function deleteConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<DeleteDraft, void> {
  return {
    request: (draft) => ({
      path: channelPath(draft.channelId),
      method: "DELETE",
      workspaceId: deps.workspaceId,
    }),
    // Both branches leave the list: a hard-deleted channel is gone, and a
    // soft-closed DM is excluded by `deleted_at IS NULL` until it is reopened.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        dropChannelRow(cache, draft.channelId)
      ),
    // EVICTION IS DELIBERATELY ON SUCCESS, not in `optimistic`: a removed query
    // has no snapshot, so evicting before the server answers would make a
    // failed delete unrecoverable. A rolled-back delete puts the row back and
    // the transcript is still cached behind it.
    onSuccess: (_data, draft) => {
      if (!draft.isDirect) deps.evictChannel(draft.channelId);
      deps.onDeselect();
    },
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't delete the channel"),
  };
}

export function joinConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<JoinDraft, unknown> {
  return {
    request: (draft) => ({
      path: channelMembersPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: { userId: draft.userId },
    }),
    // `isMember` is what swaps the read-only "Join channel" bar for the
    // composer, so the pane converts on the click rather than after the roster
    // round trip.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, draft.channelId, { isMember: true, role: "member" })
      ),
    // NO ROSTER RECONCILE from the 201's `{ member }`: a non-member's roster
    // read may never have loaded (there is nothing to append to), and
    // `memberCount` / presence hydration are the server's to compute. The
    // transcript is invalidated for the same reason — it is the first read this
    // caller is entitled to.
    invalidate: (draft) => [
      channelKeys.list().all,
      channelKeys.messages(draft.channelId).all,
      channelKeys.members(draft.channelId).all,
    ],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't join the channel"),
  };
}

export function leaveConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<LeaveDraft, void> {
  return {
    request: (draft) => ({
      path: channelMembersPath(draft.channelId),
      method: "DELETE",
      workspaceId: deps.workspaceId,
      body: { userId: draft.userId },
    }),
    // A PRIVATE channel leaves the caller's world entirely (`listChannels`
    // returns public channels plus the ones you belong to), so the row goes. A
    // PUBLIC one stays visible and read-only, which is exactly `isMember:false`
    // — the same shape a never-joined public channel already has.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        draft.visibility === "private"
          ? dropChannelRow(cache, draft.channelId)
          : patchChannel(cache, draft.channelId, {
              isMember: false,
              role: null,
              myAgentToolProfile: null,
            })
      ),
    onSuccess: () => deps.onDeselect(),
    invalidate: (draft) => [
      channelKeys.list().all,
      channelKeys.members(draft.channelId).all,
    ],
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't leave the channel"),
  };
}

export interface ChannelLifecycleParams {
  channel: Channel | null;
  workspaceId: string;
  currentUserId: string;
  /** Hand `useRefetchGate`'s gate so these writes hold the realtime doorbell. */
  gate: MutationGate;
  /** Clear the explicit selection (the channel is going away). */
  onDeselect: () => void;
}

export function useChannelLifecycleWrites({
  channel,
  workspaceId,
  currentUserId,
  gate,
  onDeselect,
}: ChannelLifecycleParams) {
  const client = useQueryClient();
  // Rebuilt every render on purpose: `useApiMutationWith` reads its config
  // through a ref, so these closures are always the current render's.
  const deps: LifecycleWriteDeps = {
    workspaceId,
    gate,
    onDeselect,
    evictChannel: (channelId) => {
      client.removeQueries({ queryKey: channelKeys.messages(channelId).all });
      client.removeQueries({ queryKey: channelKeys.members(channelId).all });
      client.removeQueries({ queryKey: channelKeys.threads(channelId).all });
    },
  };

  const archive = useApiMutationWith<ArchiveDraft, { channel: Channel }>(
    channelRequest,
    archiveConfig(deps)
  );
  const visibility = useApiMutationWith<VisibilityDraft, { channel: Channel }>(
    channelRequest,
    visibilityConfig(deps)
  );
  const remove = useApiMutationWith<DeleteDraft, void>(
    channelRequest,
    deleteConfig(deps)
  );
  const joinChannel = useApiMutationWith<JoinDraft, unknown>(
    channelRequest,
    joinConfig(deps)
  );
  const leaveChannel = useApiMutationWith<LeaveDraft, void>(
    channelRequest,
    leaveConfig(deps)
  );

  return {
    toggleArchive: () => {
      if (!channel) return;
      archive.mutate({
        channelId: channel.id,
        archived: channel.archivedAt === null,
      });
    },
    // A DM is always private (DB CHECK) and the menu hides the item for one;
    // guarded here too so nothing can send a request the server must 400.
    toggleVisibility: () => {
      if (!channel || channel.isDirect) return;
      visibility.mutate({
        channelId: channel.id,
        visibility: channel.visibility === "public" ? "private" : "public",
      });
    },
    remove: () => {
      if (!channel) return;
      remove.mutate({ channelId: channel.id, isDirect: channel.isDirect });
    },
    join: () => {
      if (!channel) return;
      joinChannel.mutate({ channelId: channel.id, userId: currentUserId });
    },
    // Never leave a DM (Q2): dropping one of the pair's two membership rows
    // destroys it permanently, so the server refuses and the menu offers the
    // reversible "Delete conversation" instead. Guarded here too — nothing may
    // send the destructive request for a direct channel.
    leave: () => {
      if (!channel || channel.isDirect) return;
      leaveChannel.mutate({
        channelId: channel.id,
        userId: currentUserId,
        visibility: channel.visibility,
      });
    },
    /** True while any lifecycle write is in flight. */
    pending:
      archive.pending ||
      visibility.pending ||
      remove.pending ||
      joinChannel.pending ||
      leaveChannel.pending,
  };
}
