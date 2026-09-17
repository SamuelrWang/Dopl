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
 * HIT → ITEM → GROUP. The projection half of the search service, split out of
 * `service.ts` so the FENCE and the RENDERING are one reason-to-change each
 * (INVARIANTS §1).
 *
 * ⚠ **A GROUP WITH NO ITEMS IS OMITTED, NOT EMPTIED** — `{kind, total: 0,
 * items: []}` and "this section did not match" are the same fact told twice, and
 * the popup draws a section header for every group it is handed. {@link
 * toGroup} returns `null` and {@link assembleGroups} drops it.
 */

/** The labels a hit needs that no single row carries. ⚠ Built ONCE per request
 *  from the reach that proved access, never re-queried per row. */
export interface SearchLabels {
  channelById: ReadonlyMap<string, SearchChannelRef>;
  containerNameById: ReadonlyMap<string, string>;
}

/**
 * ⚠ **THE RANK IS COMPUTED HERE AND NOT BY `ts_rank`, AND THE REASON IS
 * TRANSPORT RATHER THAN TASTE (2026-09-17).** `ts_rank` is an expression in a
 * SELECT list; PostgREST can only ask for columns, so ranking in Postgres would
 * need a `SECURITY DEFINER` RPC — a route BROKEN, not merely slow, until its
 * migration is applied (`supabase/migrations/20260822170000_overview_time_range_
 * indexes.sql` states that rule for this directory). The page this scores is
 * already the DATABASE's newest-first 50, so the rank reorders a bounded page
 * and never decides which rows were fetched.
 *
 * TITLE hits outweigh BODY hits: somebody typing a name is looking for the
 * thing with that name, and a body that merely mentions it is context.
 * ⚠ **NEWEST-FIRST IS THE TIEBREAK AND IT IS TOTAL** — equal scores fall back to
 * `updatedAt`, then to `id`, so two identical requests return the same order.
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
    // ⚠ The LAST tiebreak is the arrival order, which is the database's own
    // deterministic page — never `Array.prototype.sort`'s stability, which is
    // a guarantee about equal elements and not about equal KEYS.
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
 * ⚠ **`total` IS THE ROW COUNT, WHICH IS THE CAP'S OWN CEILING.** Every read is
 * `.limit(SEARCH_GROUP_TOTAL_CAP)`, so a count AT the cap means "50 or more" —
 * the same "at is indistinguishable from over" rule §9 states for `truncated`,
 * spelled as a number because the contract asked for a number. It is never the
 * item count: `items` is capped at eight and a group that reported eight when it
 * found forty would hide the thing the reader is about to scroll for.
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
 * ⚠ **THE SUBTITLE IS DECIDED HERE AND IN ONE PLACE.** A repository sets it only
 * when the label is a column it already read (a knowledge base's name, a
 * member's email); everything else is the CHANNEL it lives in, or — for a
 * container-level row with no channel — nothing, because `containerName` already
 * rides beside it and saying the same word twice is not a subtitle.
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
    // ⚠ A MESSAGE HAS NO NAME OF ITS OWN and the repository says so with an
    // empty title; the room it was said in is the honest headline. The final
    // fallback is the container, never a slice of the body — that would print
    // the snippet twice and mark it once.
    title: hit.title !== "" ? hit.title : (channel?.name ?? containerName ?? ""),
    containerId: hit.containerId,
  };
  const subtitle =
    hit.subtitle ?? (hit.title !== "" ? channel?.name : containerName);
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
 * The payload's group list, in `SEARCH_GROUP_ORDER`.
 *
 * ⚠ **IT ITERATES THE ORDER, NOT THE MAP.** Iterating the results would make the
 * section order depend on which query resolved first, which is a race the popup
 * would render as sections jumping between keystrokes.
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
