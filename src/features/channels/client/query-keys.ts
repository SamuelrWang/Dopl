import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";
import { MAX_MESSAGE_LIMIT } from "../constants";

/**
 * The channels feature's URLs and the cache keys built from them, in one
 * place — so a write and the read it patches can never disagree about either.
 *
 * `client/api.ts` builds its request paths from the same builders below, and
 * the read hooks register keys through `useApiQuery`'s `[path, workspaceId,
 * query]` tuple. Optimistic writes therefore patch by the PREFIX key
 * (`.all`), which reaches every variant a reader may have mounted without the
 * writer having to know them: the channel list is cached twice (with and
 * without `?include=archived`), and the transcript's key carries `limit`.
 *
 * SCOPED BY CHANNEL ID BY CONSTRUCTION. Every per-channel key embeds the id in
 * its path, so a write that captured `selected.id` at submit time cannot land
 * in the cache of a channel the user switched to while it was in flight — the
 * open race where all three per-channel reads use `keepPreviousData` and the
 * previous channel's data stays on screen through the switch.
 */

export function channelsPath(): string {
  return "/api/channels";
}

export function channelPath(channelId: string, tail = ""): string {
  return `/api/channels/${encodeURIComponent(channelId)}${tail}`;
}

export function channelMessagesPath(channelId: string): string {
  return channelPath(channelId, "/messages");
}

/** BOUNDARY: wire/storage name `task` == domain name `thread`. */
export function channelThreadsPath(channelId: string): string {
  return channelPath(channelId, "/tasks");
}

/**
 * ONE thread. ⚠ NOT a cache key and there is deliberately no `channelKeys.thread`
 * beside it: nothing READS a single thread through this client (the page derives
 * the open thread from the bounded list), so the only callers are the two writes
 * that address one — set-mode's PATCH and the DELETE. Adding a key for a query
 * that does not exist would invite a second source of thread truth.
 *
 * BOUNDARY: wire/storage name `task` == domain name `thread`.
 */
export function channelThreadPath(
  channelId: string,
  threadId: string
): string {
  return channelPath(
    channelId,
    `/tasks/${encodeURIComponent(threadId)}`
  );
}

export function channelMembersPath(channelId: string): string {
  return channelPath(channelId, "/members");
}

/** The Tags inbox: MY mentions in this channel. Read AND the mark-read write
 *  share this path, so the write patches the entry the read registered. */
export function channelMentionsPath(channelId: string): string {
  return channelPath(channelId, "/mentions");
}

export const CHANNEL_CONSENT_PATH = "/api/channels/consent";
// ⚠ `CHANNEL_TRUST_PATH` STOOD HERE AND IS DELETED (Samuel, 2026-08-22). Its one
// reader (`use-trust-rules.ts`) and its one writer (the `trust` mutation in
// `use-channel-preference-writes.ts`) went with the inbound consent lane the
// "Always allow" roster was standing consent for. The ROUTE is being deleted
// server-side in the same wave; a client path constant left standing is how a
// deleted endpoint gets called again.

export const channelKeys = {
  /** The workspace channel list. `.all` covers both archived variants. */
  list: (): ApiResourceKeys => apiResource(channelsPath()),
  messages: (channelId: string): ApiResourceKeys =>
    apiResource(channelMessagesPath(channelId)),
  threads: (channelId: string): ApiResourceKeys =>
    apiResource(channelThreadsPath(channelId)),
  members: (channelId: string): ApiResourceKeys =>
    apiResource(channelMembersPath(channelId)),
  mentions: (channelId: string): ApiResourceKeys =>
    apiResource(channelMentionsPath(channelId)),
  consent: (): ApiResourceKeys => apiResource(CHANNEL_CONSENT_PATH),
};

/** The exact query params `useChannels` reads with. */
export function channelListParams(includeArchived: boolean) {
  return includeArchived ? { include: "archived" } : undefined;
}

/** The exact query params `useChannelMessages` reads with. */
export function channelMessagesParams() {
  return { limit: MAX_MESSAGE_LIMIT };
}
