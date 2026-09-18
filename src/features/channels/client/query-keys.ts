import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";
import {
  CHANNEL_TRANSCRIPT_LINE_BUDGET,
  CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
} from "../constants";

/**
 * The channels feature's URLs and the cache keys built from them, in one place —
 * so a write and the read it patches can never disagree about either.
 *
 * Reads register `useApiQuery`'s `[path, workspaceId, query]` tuple, so
 * optimistic writes patch by the PREFIX key (`.all`) and reach every variant a
 * reader may have mounted (the channel list is cached with and without
 * `?include=archived`; the transcript's key carries `limit`).
 *
 * SCOPED BY CHANNEL ID BY CONSTRUCTION: every per-channel key embeds the id, so
 * a write that captured `selected.id` at submit cannot land in the cache of a
 * channel the user switched to mid-flight — the open race, since all three
 * per-channel reads use `keepPreviousData`.
 */

/**
 * 🔒 **THE SCOPE OF A CHANNEL LIST (R-26).** `container` = one container's list;
 * `account` = every container the caller is a member of. ⚠ The fence differs, the
 * ROW does not — that is the whole ruling.
 */
export type ChannelScope = "container" | "account";

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
 * ONE thread. ⚠ NOT a cache key, and deliberately no `channelKeys.thread` beside
 * it: nothing READS a single thread here (the page derives the open thread from
 * the bounded list), so the only callers are set-mode's PATCH and the DELETE. A
 * key for a query that does not exist invites a second source of thread truth.
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

/**
 * The channel's ARTIFACTS — the browse list, and the single card behind
 * `?artifact=<id>`. ONE path, because it is one route: the query param is what
 * picks the arm, so the two reads register as two variants under one prefix key
 * and a future fold write can patch both with `.all`.
 */
export function channelArtifactsPath(channelId: string): string {
  return channelPath(channelId, "/artifacts");
}

export const CHANNEL_CONSENT_PATH = "/api/channels/consent";
// ⚠ `CHANNEL_TRUST_PATH` IS DELETED (Samuel, 2026-08-22) with the inbound consent
// lane, reader (`use-trust-rules.ts`) and writer alike — a client path constant
// left standing is how a deleted endpoint gets called again.

export const channelKeys = {
  /**
   * The channel list. ⚠ **TWO VARIANTS SINCE R-26 (2026-09-17) AND ONE PREFIX** —
   * `?scope=container` and `?scope=account` are two cache entries under one path,
   * so `.all` reaches both and every existing optimistic patch keeps working
   * unchanged. (There was a second variant once before, `?include=archived`, and
   * the archive feature took it.)
   *
   * 🔒 **THE ACCOUNT ENTRY IS WHAT /home READS.** `apiPathKey("/api/home/channels")`
   * is DELETED with the route, the payload and both cache-to-cache bridges.
   */
  list: (): ApiResourceKeys => apiResource(channelsPath()),
  messages: (channelId: string): ApiResourceKeys =>
    apiResource(channelMessagesPath(channelId)),
  threads: (channelId: string): ApiResourceKeys =>
    apiResource(channelThreadsPath(channelId)),
  members: (channelId: string): ApiResourceKeys =>
    apiResource(channelMembersPath(channelId)),
  mentions: (channelId: string): ApiResourceKeys =>
    apiResource(channelMentionsPath(channelId)),
  /** ⚠ `.all` covers BOTH arms — the list and every `?artifact=<id>` card. */
  artifacts: (channelId: string): ApiResourceKeys =>
    apiResource(channelArtifactsPath(channelId)),
  consent: (): ApiResourceKeys => apiResource(CHANNEL_CONSENT_PATH),
};

// ⚠ **`channelListParams` IS DELETED (Samuel's ruling R-21, 2026-09-17).** It
// answered `{ include: "archived" }` or `undefined` — the ONE reason the channel
// list had two cache entries. The archive feature is gone, so `useChannels` reads
// with no params at all and `channelKeys.list()` names a single entry.

/**
 * The exact query params `useChannelMessages` reads its NEWEST page with — and
 * therefore the params every optimistic messages patch must be able to reach.
 *
 * ⚠ THE OLDER PAGES ARE NOT HERE, DELIBERATELY. Scroll-up history is fetched with
 * a `before` cursor and held in the hook (`hooks/use-channel-messages.ts`): a
 * `?before=` entry would sit under the SAME prefix key the writes patch
 * (`channelKeys.messages(id).all`), so every send would append its pending row
 * into every loaded page of history.
 *
 * ⚠ **TWO NUMBERS SINCE 2026-09-08, AND `limit` IS NO LONGER THE PAGE SIZE.**
 * `lineBudget` sizes the page — ESTIMATED RENDERED LINES, Samuel's ruling that a
 * row is not a unit a reader experiences — and `limit` is only the hard row cap
 * (`constants.ts › CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS`). Both belong HERE: a
 * `before` fetch sending a different pair would read a differently-sized page
 * than the one on screen.
 */
export function channelMessagesParams() {
  return {
    limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
    lineBudget: CHANNEL_TRANSCRIPT_LINE_BUDGET,
  };
}
