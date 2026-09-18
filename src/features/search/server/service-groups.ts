import "server-only";
import {
  SEARCH_GROUP_ITEM_CAP,
  SEARCH_GROUP_TOTAL_CAP,
  type SearchGroup,
  type SearchGroupKind,
  type SearchItem,
} from "../contracts";
import type { SearchChannelRef } from "./repository-reach";
import type { SearchHit } from "./repository-channel-rows";
import { buildSnippet, highlightPattern, highlightTerms } from "./snippet";

/**
 * Hit to item to group: the projection half of the search service, split from
 * `service.ts` so the fence and the rendering are one reason-to-change each.
 *
 * A group with no items is OMITTED, not emptied — the popup draws a header for
 * every group it is handed. {@link toGroup} returns `null` and
 * {@link assembleGroups} drops it.
 */

/** The labels a hit needs that no single row carries. Built once per request from
 *  the reach that proved access, never re-queried per row. */
export interface SearchLabels {
  channelById: ReadonlyMap<string, SearchChannelRef>;
  containerNameById: ReadonlyMap<string, string>;
}

/**
 * Ranked here rather than by `ts_rank` for transport reasons: PostgREST can only
 * ask for columns, so ranking in Postgres would need a `SECURITY DEFINER` RPC.
 * The page scored is already the database's newest-first 50, so this reorders a
 * bounded page and never decides which rows were fetched.
 *
 * Title hits outweigh body hits. The tiebreak is total — equal scores fall back
 * to `updatedAt` then arrival order, so identical requests return one order.
 */
export function rankHits(hits: SearchHit[], pattern: RegExp | null): SearchHit[] {
  if (pattern === null) return hits;
  const scored = hits.map((hit, index) => ({
    hit,
    index,
    score: countMatches(hit.title, pattern) * 3 + countMatches(hit.body, pattern),
  }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const at = a.hit.updatedAt ?? "";
    const bt = b.hit.updatedAt ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    // Last tiebreak is arrival order, the database's own deterministic page —
    // not sort stability, which guarantees equal ELEMENTS, not equal keys.
    return a.index - b.index;
  });
  return scored.map((s) => s.hit);
}

function countMatches(text: string | null | undefined, pattern: RegExp): number {
  if (!text) return 0;
  pattern.lastIndex = 0;
  let count = 0;
  for (
    let hit = pattern.exec(text);
    hit !== null && count < 32;
    hit = pattern.exec(text)
  ) {
    if (hit[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * One group, or `null` when nothing matched.
 *
 * `total` is the ROW count, capped at `SEARCH_GROUP_TOTAL_CAP`, so a count at the
 * cap means "50 or more" (INVARIANTS §9). Never the item count: `items` is capped
 * at eight, and reporting eight when forty matched would hide what the reader is
 * about to scroll for.
 */
export function toGroup(
  kind: SearchGroupKind,
  hits: SearchHit[],
  labels: SearchLabels,
  pattern: RegExp | null
): SearchGroup | null {
  if (hits.length === 0) return null;
  const ranked = rankHits(hits, pattern);
  return {
    kind,
    total: Math.min(ranked.length, SEARCH_GROUP_TOTAL_CAP),
    items: ranked
      .slice(0, SEARCH_GROUP_ITEM_CAP)
      .map((hit) => toItem(kind, hit, labels, pattern)),
  };
}

/**
 * A DM's stored name is a placeholder, not a label: the column is NOT NULL and DM
 * surfaces render the peer per viewer. A search row has no roster to resolve
 * against, so it says nothing rather than labelling every thread "Direct message".
 */
const DIRECT_CHANNEL_PLACEHOLDER_NAME = "Direct message";

/** The channel's name when it has one a reader would recognise. */
function channelLabel(name: string | undefined): string | undefined {
  if (name === undefined || name === DIRECT_CHANNEL_PLACEHOLDER_NAME) {
    return undefined;
  }
  return name;
}

/**
 * The subtitle is decided here, in one place. A repository sets it only when the
 * label is a column it already read; everything else is the channel the row lives
 * in, or nothing for a container-level row (`containerName` already rides beside
 * it).
 *
 * (2026-09-17) A channel hit takes no fallback: the generic arm would resolve the
 * row itself and draw the channel's name twice. A channel's subtitle is its
 * description or nothing.
 */
function toItem(
  kind: SearchGroupKind,
  hit: SearchHit,
  labels: SearchLabels,
  pattern: RegExp | null
): SearchItem {
  const channel = hit.channelId
    ? labels.channelById.get(hit.channelId)
    : undefined;
  const containerName = labels.containerNameById.get(hit.containerId);
  const item: SearchItem = {
    id: hit.id,
    kind,
    // A message has no name of its own — the repository says so with an empty
    // title, and the room it was said in is the honest headline. The final
    // fallback is the container, never a slice of the body (that would print the
    // snippet twice and mark it once).
    title: hit.title !== "" ? hit.title : (channel?.name ?? containerName ?? ""),
    containerId: hit.containerId,
  };
  const subtitle =
    kind === "channels"
      ? hit.subtitle
      : (hit.subtitle ??
        (hit.title !== "" ? channelLabel(channel?.name) : containerName));
  if (subtitle !== undefined) item.subtitle = subtitle;
  const snippet = buildSnippet(hit.body, pattern);
  if (snippet !== undefined) item.snippet = snippet;
  if (containerName !== undefined) item.containerName = containerName;
  if (hit.channelId !== undefined) item.channelId = hit.channelId;
  if (hit.seq !== undefined) item.seq = hit.seq;
  if (hit.threadId !== undefined) item.threadId = hit.threadId;
  if (hit.avatarUrls !== undefined) item.avatarUrls = hit.avatarUrls;
  if (hit.updatedAt !== undefined) item.updatedAt = hit.updatedAt;
  return item;
}

/**
 * The payload's group list, in `SEARCH_GROUP_ORDER`. It iterates the ORDER, not
 * the map: iterating results would tie section order to which query resolved
 * first, which the popup renders as sections jumping between keystrokes.
 */
export function assembleGroups(
  order: readonly SearchGroupKind[],
  byKind: ReadonlyMap<SearchGroupKind, SearchHit[]>,
  labels: SearchLabels,
  query: string
): SearchGroup[] {
  const pattern = highlightPattern(highlightTerms(query));
  const groups: SearchGroup[] = [];
  for (const kind of order) {
    const hits = byKind.get(kind);
    if (hits === undefined) continue;
    const group = toGroup(kind, hits, labels, pattern);
    if (group !== null) groups.push(group);
  }
  return groups;
}
