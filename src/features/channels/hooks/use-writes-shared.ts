"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import type { QueryClient } from "@tanstack/react-query";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { channelKeys } from "../client/query-keys";

/**
 * What the channels write configs share: the caller's identity, the refetch gate, the failure
 * toast and the two per-channel cache keys. One module, because **a key that differs by one
 * element is a silent no-op** (INVARIANTS §8), so a second copy is exactly the shape not to make.
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
  toast({ title: userFacingMessage(err, fallback) });
}

export const messagesKey = (channelId: string) =>
  channelKeys.messages(channelId).all;
export const threadsKey = (channelId: string) =>
  channelKeys.threads(channelId).all;
