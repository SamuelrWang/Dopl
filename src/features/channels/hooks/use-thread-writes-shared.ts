"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { ChannelApiError } from "../client/api";
import { channelKeys } from "../client/query-keys";

/**
 * What every channels write config is built from: the caller's identity, the
 * refetch gate, and the two per-channel cache keys.
 *
 * ⚠ Split out of `use-thread-writes.ts` because a SECOND config file now needs
 * them (`use-thread-writes-fanout.ts`), and the alternative was either a
 * circular import between two configs or a second copy of the key builders.
 * **A key that differs by one element is a silent no-op** (INVARIANTS §8), so a
 * second copy is exactly the shape not to make.
 */

export interface ThreadWritesParams {
  workspaceId: string;
  currentUserId: string;
  /** Author display for the pending row, so it does not flip name on save. */
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** Holds realtime refetches open for the life of each write. */
  gate: MutationGate;
}

/** The cache the configs read to decide whether a key still needs the
 *  cold-start refetch. */
export interface ThreadWriteDeps extends ThreadWritesParams {
  client: QueryClient;
}

export function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChannelApiError ? err.message : fallback });
}

export const messagesKey = (channelId: string) =>
  channelKeys.messages(channelId).all;
export const threadsKey = (channelId: string) =>
  channelKeys.threads(channelId).all;
