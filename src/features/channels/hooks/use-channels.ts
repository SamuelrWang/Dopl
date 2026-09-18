"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Channel, ChannelListPayload } from "../types";
import { channelsPath, type ChannelScope } from "../client/query-keys";

const selectChannels = (body: ChannelListPayload) => body.channels ?? [];

/**
 * 🔒 **THE ONE CHANNEL LIST — `?scope=container|account`** (Samuel's ruling
 * R-26 (b), 2026-09-17: *one endpoint*).
 *
 * `container` is the workspace page's list; `account` spans every container the
 * caller is a member of and is what /home reads. **One hook, one cache entry per
 * scope, one row type** — `GET /api/home/channels`, `HomeChannel` and the two
 * cache-to-cache bridges are deleted.
 *
 * ⚠ **THE SCOPE IS ALWAYS SENT, INCLUDING `container`**, so the two entries are
 * distinct key tuples rather than one entry two fences write into. It is also the
 * CACHE MIGRATION: `["/api/channels", ws, undefined]` — the 24h IndexedDB-persisted
 * entry the previous bundle wrote — is not a tuple any reader registers any more,
 * so it is orphaned and garbage-collected instead of being served with five fields
 * missing. That is this wave's answer to the version gate (§13); the new fields
 * still spell their `?? EMPTY_X` inline, because a per-key migration is an argument
 * and §8 is a rule.
 *
 * ⚠ **NO `includeArchived` SINCE 2026-09-17 (R-21).** There is no archived state:
 * the read answers every live channel, and a channel carrying an old `archived_at`
 * stamp comes back as an ordinary channel.
 */
export function useChannels(
  target: string | { scope: ChannelScope; workspaceId?: string }
) {
  // ⚠ A bare workspace id is the CONTAINER scope — the form every existing caller
  // uses, kept so a page that wants the ordinary list says nothing extra.
  const opts =
    typeof target === "string"
      ? { scope: "container" as ChannelScope, workspaceId: target }
      : target;
  const query = useApiQuery<ChannelListPayload, Channel[]>(channelsPath(), {
    // ⚠ ABSENT on the account scope, and it has to be: `withUserAuth` resolves no
    // workspace, and sending `X-Workspace-Id` would key the cache per rail
    // selection for a list that does not depend on one.
    workspaceId: opts.scope === "account" ? undefined : opts.workspaceId,
    query: { scope: opts.scope },
    select: selectChannels,
  });
  return {
    channels: query.data ?? [],
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
  };
}

/**
 * The account scope's own payload, for the ONE reader that needs more than the
 * rows: /home also renders the caller's LEGACY unbound links, which have no
 * channel to hang off and so are not rows.
 *
 * ⚠ **THE SAME CACHE ENTRY `useChannels({scope:"account"})` REGISTERS** — same
 * path, same params, so mounting both costs one request and one entry.
 */
export function useAccountChannels() {
  const query = useApiQuery<ChannelListPayload>(channelsPath(), {
    query: { scope: "account" },
  });
  return query;
}
