/**
 * THE CHANNEL KNOWLEDGE LANE, CLIENT SIDE — the three URLs the Knowledge tab
 * reads, the cache keys built from them, and the payload shapes they answer
 * with (Home Knowledge Panels M4, plan §5.5).
 *
 * ⚠ IT IS THE `/api/channels/{id}/knowledge/**` LANE AND NOTHING ELSE. Every
 * route under it is at `minRole: "guest"` and is gated by a `(knowledge_base,
 * channel)` grant row rather than by a workspace role — which is the ONLY
 * reason one component can serve the operator on /home and a link-claimed guest
 * on /c. The workspace routes (`/api/knowledge/**`) answer a guest with a 403,
 * so **no path in this file may ever be pointed at one**: "the surface must not
 * issue a request it will get 403 on" (`guest-surface-reads.test.tsx`, which
 * pins these three paths against the route floors themselves).
 *
 * ⚠ PATHS AND KEYS TOGETHER, the same rule `client/query-keys.ts` states for
 * the rest of the feature: the entry PUT patches the cache the entry GET
 * registered, and a key that drifts by one element is a silent no-op
 * (INVARIANTS §8).
 */

import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";
import { channelPath } from "../../client/query-keys";
import type {
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";

/** Every knowledge base granted onto this channel at `visible`. */
export function channelKnowledgeBasesPath(channelId: string): string {
  return channelPath(channelId, "/knowledge/bases");
}

/** One granted base's folders + entry METADATA (no bodies). */
export function channelKnowledgeTreePath(
  channelId: string,
  baseId: string
): string {
  return channelPath(
    channelId,
    `/knowledge/bases/${encodeURIComponent(baseId)}/tree`
  );
}

/** ONE entry, body included — and the target of the guest edit (PUT). */
export function channelKnowledgeEntryPath(
  channelId: string,
  entryId: string
): string {
  return channelPath(
    channelId,
    `/knowledge/entries/${encodeURIComponent(entryId)}`
  );
}

export const channelKnowledgeKeys = {
  bases: (channelId: string): ApiResourceKeys =>
    apiResource(channelKnowledgeBasesPath(channelId)),
  tree: (channelId: string, baseId: string): ApiResourceKeys =>
    apiResource(channelKnowledgeTreePath(channelId, baseId)),
  entry: (channelId: string, entryId: string): ApiResourceKeys =>
    apiResource(channelKnowledgeEntryPath(channelId, entryId)),
};

/** `GET …/knowledge/bases` — `{bases, grants}`, two sibling keys, `grants`
 *  keyed by base id (INVARIANTS §9). Every grant here is `level: "visible"`;
 *  it rides along for `guestWrite`. */
export interface ChannelKnowledgeBasesBody {
  bases: KnowledgeBase[];
  grants: Record<string, ChannelResourceGrant>;
}

/** `GET …/knowledge/bases/{id}/tree` — flat folder + entry arrays, bodies
 *  stripped (the lane's tree is `includeBody: false`, like the workspace's). */
export interface ChannelKnowledgeTreeBody {
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

/** `GET|PUT …/knowledge/entries/{id}` — the one entry, body included. */
export interface ChannelKnowledgeEntryBody {
  entry: KnowledgeEntry;
}

/**
 * 🔒 §8 STALE-CACHE FALLBACKS. These payloads are cached in the SAME
 * IndexedDB-persisted client every other read uses (24h `gcTime`), so the first
 * paint after any upgrade can render an entry minted by a bundle that knew a
 * different shape — and every sibling key below is one this lane grew in a
 * single wave, which is exactly the class of field the standing rule is about.
 * Each is read `?? EMPTY_X` INLINE at the selector, never behind an accessor,
 * and `knowledge-lane.test.ts` mounts a key-DELETED fixture for each.
 *
 * Shared frozen singletons rather than a fresh `[]`/`{}` per read: a new
 * identity every render churns the memos downstream of them.
 */
export const EMPTY_BASES: readonly KnowledgeBase[] = Object.freeze([]);
export const EMPTY_GRANTS: Readonly<Record<string, ChannelResourceGrant>> =
  Object.freeze({});
export const EMPTY_FOLDERS: readonly KnowledgeFolder[] = Object.freeze([]);
export const EMPTY_ENTRIES: readonly KnowledgeEntry[] = Object.freeze([]);

/** What the tab renders the granted list from. */
export interface ChannelKnowledgeBases {
  bases: readonly KnowledgeBase[];
  grants: Readonly<Record<string, ChannelResourceGrant>>;
}

export function selectGrantedBases(
  body: Partial<ChannelKnowledgeBasesBody>
): ChannelKnowledgeBases {
  return {
    // ⚠ §8 stale-cache: a payload cached before this lane existed — or one
    // clipped by a degraded route — carries no key. Absent reads as "nothing
    // is shared here", which is the fail-safe direction for an AUDIENCE list.
    bases: body.bases ?? EMPTY_BASES,
    grants: body.grants ?? EMPTY_GRANTS,
  };
}

/** What the tab renders one base's contents from. ⚠ `base` is NOT defaulted:
 *  it is the payload's subject, and a tree without it is a failed read, not an
 *  empty one — the caller branches on `null` rather than drawing a nameless
 *  base. */
export interface ChannelKnowledgeTree {
  base: KnowledgeBase | null;
  folders: readonly KnowledgeFolder[];
  entries: readonly KnowledgeEntry[];
}

export function selectTree(
  body: Partial<ChannelKnowledgeTreeBody>
): ChannelKnowledgeTree {
  return {
    base: body.base ?? null,
    // ⚠ §8 stale-cache, as above.
    folders: body.folders ?? EMPTY_FOLDERS,
    entries: body.entries ?? EMPTY_ENTRIES,
  };
}

/**
 * Whether the viewer may EDIT entries in this base through the lane.
 *
 * 🔒 ONE RULE, BOTH SIDES, AND IT IS THE SERVER'S OWN. `assertGrantWritable`
 * admits a PUT on `visible` + `guest_write` and refuses everything else with a
 * 403 `CHANNEL_GRANT_READ_ONLY` — it never consults a workspace role, so the
 * OPERATOR on /home is as read-only here as the guest is when the toggle is
 * off. Reading the same flag the server reads is what keeps the pen off a
 * surface whose save would be refused.
 *
 * ⚠ An ABSENT grant is read-only, not writable: a base the list somehow
 * carries without its grant row is the degraded case, and the fail-safe
 * direction is no pen.
 */
export function canEditGranted(
  grants: Readonly<Record<string, ChannelResourceGrant>>,
  baseId: string
): boolean {
  return grants[baseId]?.guestWrite === true;
}
