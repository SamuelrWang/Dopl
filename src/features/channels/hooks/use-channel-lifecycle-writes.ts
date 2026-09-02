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
 * `useApiMutation`.
 *
 * ⚠ Every config carries `settleWith: gate` (the same `useRefetchGate` gate the
 * send and thread ops hold), or the write races the realtime doorbell's four
 * refetches and survives only because some other surface shadows the server
 * value. `onSettled` releases it on the THROWING path too, so a failed archive
 * cannot strand a deferred refetch.
 *
 * ⚠ Every draft carries its own `channelId`, snapshotted AT THE CLICK, and every
 * cache key downstream is built from `draft.channelId` — the three per-channel
 * reads are `keepPreviousData`, so a channel switch keeps rendering the previous
 * channel under the new header. Nothing here re-reads the selection.
 *
 * ⚠ The two list variants are patched SEPARATELY (archive toggle only).
 * `/api/channels` is cached twice — default holds ACTIVE only,
 * `?include=archived` holds everything — so archiving is a row LEAVING one entry
 * and changing state in the other. The keys are DISJOINT on purpose: `onMutate`
 * snapshots per patch in order, so an overlapping pair (a prefix plus one of its
 * members) snapshots the already-patched entry and rolls back to the optimistic
 * value.
 *
 * ⚠ DELETE IS TWO MECHANICS BEHIND ONE VERB:
 *  - a DM SOFT-closes — either side's next open revives the SAME row with its
 *    history, so transcript, roster and threads MUST stay cached. It only leaves
 *    the list.
 *  - anything else HARD-deletes, cascading, which is a CACHE EVICTION: the query
 *    cache is IndexedDB-persisted with a 24h `gcTime`, so an invalidated entry
 *    for a deleted channel still renders it across relaunches. `evictChannel`
 *    `removeQueries` messages/members/threads — and NEVER for a DM.
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
  /** Private leaves the caller's list entirely; public stays read-only.
   *  Captured at the click, like `channelId`. */
  visibility: ChannelVisibility;
}

/** What the five configs need from their host, transport aside. */
export interface LifecycleWriteDeps {
  workspaceId: string;
  /** Holds realtime refetches open for the life of each write. ⚠ REQUIRED, not
   *  optional — a config buildable without a gate re-opens the race where some
   *  writes are protected and some are not. */
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

/**
 * **THE TWO CHANNEL-AGENT SETTINGS** (2026-09-02, v2 wave B slice B4 — rulings
 * B1/B6 and F-449): the default responder and the posture ceiling.
 *
 * ⚠ **ONE DRAFT AND ONE CONFIG FOR BOTH**, because they are one PATCH to one
 * row behind one manage gate. Two configs would be two writes racing the same
 * cache entry for a panel whose controls sit two rows apart.
 *
 * ⚠ **`null` IS A VALUE ON EVERY FIELD HERE AND `undefined` IS "UNCHANGED"** —
 * the distinction `service-writes.ts › updateChannel` keeps, restated because
 * this is where it would be lost: a draft that collapsed the two could never
 * REMOVE a ceiling or withdraw a nomination.
 *
 * ⚠ **NO OPTIMISTIC PATCH.** The other configs in this file patch the list cache
 * because a header pill reads the value; nothing renders these two outside the
 * panel that just set them, and the PATCH answers with the caller-relative
 * channel, so the reconcile below IS the update. An optimistic stamp here would
 * be a claim about a manage gate this client cannot evaluate.
 */
export interface ChannelAgentSettingsDraft {
  channelId: string;
  defaultResponderAgentName?: string | null;
  agentPosture?: {
    tools?: string | null;
    messages?: string | null;
    chain?: boolean | null;
  };
}

export function channelAgentSettingsConfig(
  deps: LifecycleWriteDeps
): UseApiMutationConfig<ChannelAgentSettingsDraft, { channel: Channel }> {
  return {
    request: (draft) => {
      const { channelId, ...patch } = draft;
      return {
        path: channelPath(channelId),
        method: "PATCH",
        workspaceId: deps.workspaceId,
        body: patch,
      };
    },
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    invalidate: () => [channelKeys.list().all],
    settleWith: deps.gate,
    // ⚠ The server's own sentence, not a generic one: a refusal here is a
    // MANAGE refusal or a handle-grammar 400, and both name what to do.
    onError: (err) => failed(err, "Couldn't update the channel"),
  };
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
    // Archiving REMOVES the row from the active list and STAMPS it in the
    // archived one. Unarchiving mirrors that: clearing the stamp drops it from
    // the archived tab, and the active list gets it back from the settle-time
    // invalidate rather than a row invented in the server's sort order.
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
    // PATCH answers with the caller-relative channel, so true `archivedAt` /
    // `updatedAt` land without a read. ⚠ `patchChannel` maps over rows that
    // EXIST, so this cannot re-add the row the optimistic patch just dropped.
    reconcile: (data) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, data.channel.id, data.channel)
      ),
    // Ordering (`updated_at` desc) and membership of the OTHER variant are the
    // two things this write changes and cannot compute.
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
    // ⚠ Header pill and menu label both read `channel.visibility` off the list
    // row, so this patch is what stops them sitting on the old value for two
    // network hops — the pane holds no lens of its own.
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
    // Both branches leave the list: hard-deleted is gone, soft-closed DM is
    // excluded by `deleted_at IS NULL` until reopened.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        dropChannelRow(cache, draft.channelId)
      ),
    // ⚠ Eviction is deliberately ON SUCCESS, not in `optimistic` — a removed
    // query has no snapshot, so evicting before the server answers makes a
    // failed delete unrecoverable.
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
    // `isMember` swaps the read-only "Join channel" bar for the composer, so the
    // pane converts on the click rather than after the roster round trip.
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        patchChannel(cache, draft.channelId, { isMember: true, role: "member" })
      ),
    // ⚠ NO roster reconcile from the 201's `{ member }` — a non-member's roster
    // read may never have loaded (nothing to append to), and `memberCount` /
    // presence hydration are the server's to compute. Transcript invalidated for
    // the same reason: it is the first read this caller is entitled to.
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
    // A PRIVATE channel leaves the caller's world entirely, so the row goes. A
    // PUBLIC one stays visible and read-only — exactly `isMember:false`, the
    // shape a never-joined public channel already has.
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
  // ⚠ Rebuilt every render on purpose — `useApiMutationWith` reads its config
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
  const agentSettings = useApiMutationWith<
    ChannelAgentSettingsDraft,
    { channel: Channel }
  >(channelRequest, channelAgentSettingsConfig(deps));

  return {
    toggleArchive: () => {
      if (!channel) return;
      archive.mutate({
        channelId: channel.id,
        archived: channel.archivedAt === null,
      });
    },
    // ⚠ A DM is always private (DB CHECK). Guarded here as well as in the menu,
    // so nothing can send a request the server must 400.
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
    // ⚠ Never leave a DM: dropping one of the pair's two membership rows
    // destroys it permanently. The server refuses and the menu offers the
    // reversible "Delete conversation"; guarded here too.
    leave: () => {
      if (!channel || channel.isDirect) return;
      leaveChannel.mutate({
        channelId: channel.id,
        userId: currentUserId,
        visibility: channel.visibility,
      });
    },
    /** RR3's nomination. `null` withdraws it. */
    setDefaultResponder: (handle: string | null) => {
      if (!channel) return;
      agentSettings.mutate({
        channelId: channel.id,
        defaultResponderAgentName: handle,
      });
    },
    /** The channel's posture CEILING, per axis (F-449's missing surface). */
    setAgentCeiling: (patch: NonNullable<ChannelAgentSettingsDraft["agentPosture"]>) => {
      if (!channel) return;
      agentSettings.mutate({ channelId: channel.id, agentPosture: patch });
    },
    /** True while a channel-agent setting is being written. */
    agentSettingsPending: agentSettings.pending,
    /** True while any lifecycle write is in flight. */
    pending:
      archive.pending ||
      visibility.pending ||
      remove.pending ||
      joinChannel.pending ||
      leaveChannel.pending ||
      agentSettings.pending,
  };
}
