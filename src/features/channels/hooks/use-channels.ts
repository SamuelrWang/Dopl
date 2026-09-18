"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Channel, ChannelListPayload } from "../types";
import { channelsPath, type ChannelScope } from "../client/query-keys";

const selectChannels = (body: ChannelListPayload) => body.channels ?? [];

/**
 * 🔒 **THE ONE CHANNEL LIST — `?scope=container|account`** (R-26 (b), 2026-09-17).
 * `container` is the workspace page's list; `account` spans every container the
 * caller is a member of and is what /home reads. One hook, one cache entry per
 * scope, one row type.
 *
 * ⚠ **THE SCOPE IS ALWAYS SENT, INCLUDING `container`**, so the two entries are
 * distinct key tuples rather than one entry two fences write into. It is also the
 * CACHE MIGRATION: `["/api/channels", ws, undefined]` — the 24h IndexedDB entry the
 * previous bundle wrote — is no longer a tuple any reader registers, so it is
 * orphaned rather than served with five fields missing. The new fields still spell
 * their `?? EMPTY_X` inline: a per-key migration is an argument and §8 is a rule.
 *
 * ⚠ **NO `includeArchived` SINCE R-21** — there is no archived state; a channel
 * carrying an old `archived_at` stamp comes back as an ordinary channel.
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
 * The account scope's RAW payload, for the readers that need more than the rows:
 * /home also renders the caller's LEGACY unbound links, which have no channel to
 * hang off. ⚠ **THE SAME CACHE ENTRY `useChannels({scope:"account"})` REGISTERS** —
 * same path, same params, so mounting both costs one request and one entry.
 */
export function useAccountChannels() {
  const query = useApiQuery<ChannelListPayload>(channelsPath(), {
    query: { scope: "account" },
  });
  return query;
}
