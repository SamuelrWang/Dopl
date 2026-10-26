"use client";

import { useState } from "react";
import type { ApiMutation } from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";

/**
 * STUB of `apps/desktop-ui/src/pages/home/home-writes.ts` — the four writes the staged popups call,
 * as in-memory mutations with the real `ApiMutation` face (`mutate` / `mutateAsync` / `pending` /
 * `error`). Nothing is sent. `LINK_EXPIRY_MS` / `expiresAtFrom` are copied verbatim (pure).
 */

function useFakeMutation<TDraft, TData>(answer: (draft: TDraft) => TData, onSuccess?: (data: TData) => void): ApiMutation<TDraft, TData> {
  const [pending, setPending] = useState(false);
  async function mutateAsync(draft: TDraft): Promise<TData> {
    setPending(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setPending(false);
    const data = answer(draft);
    onSuccess?.(data);
    return data;
  }
  return {
    mutate: (draft) => void mutateAsync(draft),
    mutateAsync,
    pending,
    error: null,
  };
}

/* ─── STAGING ONLY: page listeners ───
   The copied popups call these writes exactly as desktop does; a staging page that keeps its own
   in-memory rows (`/channels`) subscribes here to see what was written, so the copies stay 1:1
   (no extra props). Module-level sets: one listener per mounted page. */
type CreatedChannel = { name: string; topic: string; workspaceId: string };
const channelCreatedListeners = new Set<(created: CreatedChannel) => void>();
const linkRevokedListeners = new Set<(linkId: string) => void>();

/** Subscribe to every staged "New channel" create. Returns the unsubscribe. */
export function onStagingChannelCreated(listener: (created: CreatedChannel) => void): () => void {
  channelCreatedListeners.add(listener);
  return () => void channelCreatedListeners.delete(listener);
}

/** Subscribe to every staged link Revoke. Returns the unsubscribe. */
export function onStagingLinkRevoked(listener: (linkId: string) => void): () => void {
  linkRevokedListeners.add(listener);
  return () => void linkRevokedListeners.delete(listener);
}

/** `useCreateHomeChannel` — answers a made-up container id. */
export function useCreateHomeChannel(onCreated: (workspaceId: string) => void) {
  return useFakeMutation<{ name: string; topic?: string }, { workspaceId: string }>(
    (draft) => {
      toast({ title: `Staging: created #${draft.name}` });
      const workspaceId = `staging-ws-${draft.name.toLowerCase().replace(/\W+/g, "-")}`;
      for (const l of channelCreatedListeners) l({ name: draft.name, topic: draft.topic ?? "", workspaceId });
      return { workspaceId };
    },
    (result) => onCreated(result.workspaceId)
  );
}

/** `useMintHomeLink` — answers a made-up invitation URL. */
export function useMintHomeLink(onMinted: (url: string) => void) {
  return useFakeMutation<{ workspaceId: string; grantedRole: string; expiresAt: string | null }, string>(
    () => `https://www.usedopl.com/link/stg${Math.random().toString(36).slice(2, 10)}`,
    onMinted
  );
}

/** `useRevokeHomeLink`. */
export function useRevokeHomeLink() {
  return useFakeMutation<string, void>((linkId) => {
    toast({ title: "Staging: link revoked" });
    for (const l of linkRevokedListeners) l(linkId);
  });
}

/** `useRemoveContainerMember`. */
export function useRemoveContainerMember(_workspaceSegment: string, onDone: () => void) {
  return useFakeMutation<string, void>(() => undefined, onDone);
}

/** Windows the New-link popover offers, as milliseconds from now. */
export const LINK_EXPIRY_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: null,
} as const;

export type LinkExpiryKey = keyof typeof LINK_EXPIRY_MS;

export function expiresAtFrom(key: LinkExpiryKey, now = Date.now()): string | null {
  const ms = LINK_EXPIRY_MS[key];
  return ms === null ? null : new Date(now + ms).toISOString();
}
