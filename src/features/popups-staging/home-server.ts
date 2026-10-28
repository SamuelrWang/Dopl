/**
 * The /home writes the PRODUCT dialogs make (`features/home/components/channels/home-writes.ts`):
 * create a channel, mint and revoke an invitation link, remove a member. Answered in memory
 * through the playground bridge (`ui-staging/staging-app-bridge.ts`); a page that keeps its own
 * rows (`/channels`) subscribes to see what was written.
 */

import type { Channel } from "@/features/channels/types";
import type { ChannelPendingLink } from "@/features/channels/types-list";
import { toast } from "@/shared/ui/toast";
import { bridgeOk, type BridgeOpts, type BridgeResponse } from "@/features/ui-staging/staging-bridge";
import { minsAgoIso } from "@/features/ui-staging/staging-stubs";

const LATENCY_MS = 500;

type CreatedChannel = { name: string; topic: string; workspaceId: string };
const channelCreatedListeners = new Set<(created: CreatedChannel) => void>();
const linkRevokedListeners = new Set<(linkId: string) => void>();

/** Every staged "New channel" create. Returns the unsubscribe. */
export function onStagingChannelCreated(listener: (created: CreatedChannel) => void): () => void {
  channelCreatedListeners.add(listener);
  return () => void channelCreatedListeners.delete(listener);
}

/** Every staged link Revoke. Returns the unsubscribe. */
export function onStagingLinkRevoked(listener: (linkId: string) => void): () => void {
  linkRevokedListeners.add(listener);
  return () => void linkRevokedListeners.delete(listener);
}

function createChannel(body: Record<string, unknown>): { channel: Channel } {
  const name = String(body.name ?? "channel");
  const topic = String(body.topic ?? "");
  const workspaceId = `staging-ws-${name.toLowerCase().replace(/\W+/g, "-")}`;
  toast({ title: `Staging: created #${name}` });
  for (const listener of channelCreatedListeners) listener({ name, topic, workspaceId });
  return { channel: { id: `staging-ch-${workspaceId}`, workspaceId, name, topic } as unknown as Channel };
}

function mintLink(body: Record<string, unknown>): { link: ChannelPendingLink } {
  const token = Math.random().toString(36).slice(2, 10);
  return {
    link: {
      id: `staging-link-${token}`,
      url: `https://www.usedopl.com/link/stg${token}`,
      label: null,
      createdAt: minsAgoIso(0),
      expiresAt: (body.expiresAt as string | null) ?? null,
      maxUses: 1,
      useCount: 0,
      revokedAt: null,
      grantedRole: String(body.grantedRole ?? "guest"),
    } as ChannelPendingLink,
  };
}

function revokeLink(linkId: string): void {
  toast({ title: "Staging: link revoked" });
  for (const listener of linkRevokedListeners) listener(linkId);
}

export async function homeApiRequest(path: string, opts: BridgeOpts): Promise<BridgeResponse | null> {
  const method = (opts.method ?? "GET").toUpperCase();
  const { pathname } = new URL(path, "http://staging.invalid");
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const wait = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (method === "POST" && pathname === "/api/channels") {
    await wait();
    return bridgeOk(createChannel(body));
  }
  if (method === "POST" && pathname === "/api/home/links") {
    await wait();
    return bridgeOk(mintLink(body));
  }
  const revoke = method === "DELETE" && pathname.match(/^\/api\/home\/links\/([^/]+)$/);
  if (revoke) {
    await wait();
    revokeLink(decodeURIComponent(revoke[1]));
    return bridgeOk(undefined);
  }
  if (method === "DELETE" && /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/.test(pathname)) {
    await wait();
    return bridgeOk(undefined);
  }
  return null;
}
