import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageKind } from "@/features/channels/types";
import { SEARCH_GROUP_TOTAL_CAP } from "../contracts";
import {
  SEARCH_TSQUERY_CONFIG,
  buildPrefixTsQuery,
  containsPattern,
} from "./query-text";

/**
 * The four groups fenced by channel membership: channels, messages, threads,
 * artifacts.
 *
 * The `channelIds` array is the fence — it becomes the `WHERE … IN (…)` of every
 * query, so a channel the caller cannot reach is never named. Its only
 * legitimate source is `repository-reach.ts › loadSearchReach`. An empty array
 * short-circuits without a round trip.
 *
 * Every read is capped at {@link SEARCH_GROUP_TOTAL_CAP} and that count IS
 * `SearchGroup.total`; at the cap it means "50 or more" (`contracts.ts`), so
 * nothing here reports `truncated` separately.
 */

/**
 * One row a group can draw, before it knows which group it is. Snake_case stops
 * here (INVARIANTS §2) — nothing above this layer sees a column name.
 */
export interface SearchHit {
  id: string;
  /** The headline. Never empty — a row with no name cannot be a hit. */
  title: string;
  /** Prose to cut a snippet from, when this kind has any. */
  body?: string | null;
  /**
   * Set here only when the label is a column this read already has (a base's
   * name, a member's email). Every other kind's subtitle is filled by the
   * service from the reach it already holds, to avoid a join per group.
   */
  subtitle?: string;
  containerId: string;
  channelId?: string;
  seq?: number;
  threadId?: string;
  avatarUrls?: string[];
  updatedAt?: string;
}

/**
 * The Messages section means `kind='message'` only — what a person or agent said.
 * The `task_*` kinds are thread lifecycle narration and `system` is untyped by
 * anyone, so both are excluded: one autonomous run would otherwise flood the
 * section with rows pointing at a single Threads row.
 */
const SEARCHABLE_MESSAGE_KIND: ChannelMessageKind = "message";

/**
 * Channels the caller is in whose name matches. Archived rooms are kept — a
 * search is where somebody goes to find one.
 *
 * (2026-09-17) The subtitle is `topic`: there is no `description` column on
 * `channels`, and `topic` is what the header and info panel already draw. It is
 * NOT NULL DEFAULT `''`, so an empty topic rides out as no subtitle at all — a
 * `""` would leave the gap where a description goes.
 */
export async function searchChannels(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("id, name, topic, workspace_id, updated_at")
    .in("id", channelIds)
    // Redundant with the reach read, which already drops tombstones — restated
    // so a future caller that builds `channelIds` differently stays fenced.
    .is("deleted_at", null)
    .ilike("name", containsPattern(query))
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ChannelNameRow[]).map((row) => {
    const hit: SearchHit = {
      id: row.id,
      title: row.name,
      containerId: row.workspace_id,
      channelId: row.id,
      updatedAt: row.updated_at,
    };
    if (row.topic !== "") hit.subtitle = row.topic;
    return hit;
  });
}

interface ChannelNameRow {
  id: string;
  name: string;
  topic: string;
  workspace_id: string;
  updated_at: string;
}

/**
 * Messages whose body matches, by Postgres full text.
 *
 * F-717 (2026-09-17): `config` must be named on the QUERY side. PostgREST
 * renders `fts(simple)` as `to_tsquery('simple', $1)` — it parameterises the
 * tsquery function, it does not re-wrap the column. The generated column fixing
 * its own dictionary settles only the vector half; without `config` the query
 * half falls back to `default_text_search_config` and matches nothing.
 *
 * Raw `fts`, not `wfts`: `buildPrefixTsQuery` builds the tsquery itself so the
 * last token can be a prefix (`pick:*` finds *picker*), which
 * `websearch_to_tsquery` would normalise away. Its allow-list is what makes the
 * raw form safe — `to_tsquery` is the one spelling that can raise a syntax error
 * on user text.
 *
 * F-715 (closed 2026-09-17): reads `search_tsv`, the generated stored column, so
 * the GIN index serves this instead of a per-row `to_tsvector`. Before pointing a
 * NEW arm at a column whose migration has not landed, note that the expression
 * form (`.textSearch("body", …)`) is slow but never wrong, while naming an absent
 * column is broken.
 *
 * Newest-first, not `ts_rank`: PostgREST cannot ask for a SELECT-list
 * expression. Ranking happens over this page in `service-groups.ts › rankHits`,
 * and `created_at DESC` is also the order the page is cut on, so a busy room's
 * burst cannot shuffle an older room's hit off the page between keystrokes.
 */
export async function searchMessages(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  // No token, no query: an empty tsquery matches nothing, so skip the round trip.
  const tsQuery = buildPrefixTsQuery(query);
  if (tsQuery === null) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("id, seq, body, channel_id, workspace_id, created_at")
    .in("channel_id", channelIds)
    .eq("kind", SEARCHABLE_MESSAGE_KIND)
    .textSearch("search_tsv", tsQuery, { config: SEARCH_TSQUERY_CONFIG })
    .order("created_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map((row) => ({
    id: row.id,
    // A message has no name; the service fills the title with its channel from
    // the reach it already holds. Using the first line would duplicate the snippet.
    title: "",
    body: row.body,
    containerId: row.workspace_id,
    channelId: row.channel_id,
    seq: Number(row.seq),
    updatedAt: row.created_at,
  }));
}

interface MessageRow {
  id: string;
  seq: number | string;
  body: string;
  channel_id: string;
  workspace_id: string;
  created_at: string;
}

/**
 * Threads whose title matches. The table is `channel_tasks` — the thread list's
 * own store; there has never been a `channel_threads` table.
 * Closed threads are kept: finished work is what people search for most.
 */
export async function searchThreads(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_tasks")
    .select("id, title, channel_id, workspace_id, updated_at")
    .in("channel_id", channelIds)
    .ilike("title", containsPattern(query))
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ThreadRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    containerId: row.workspace_id,
    channelId: row.channel_id,
    threadId: row.id,
    updatedAt: row.updated_at,
  }));
}

interface ThreadRow {
  id: string;
  title: string;
  channel_id: string;
  workspace_id: string;
  updated_at: string;
}

/**
 * Artifacts whose name matches.
 * `dissolved_at IS NULL`: a dissolved card is retired, not deleted — the row
 * survives so an old id still resolves, but listing one would offer a card that
 * folds nothing.
 * Orders on `created_at` because `channel_artifacts` has no `updated_at`.
 */
export async function searchArtifacts(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .select("id, name, summary, channel_id, workspace_id, created_at")
    .in("channel_id", channelIds)
    .is("dissolved_at", null)
    .ilike("name", containsPattern(query))
    .order("created_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ArtifactRow[]).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.summary === "" ? null : row.summary,
    containerId: row.workspace_id,
    channelId: row.channel_id,
    updatedAt: row.created_at,
  }));
}

interface ArtifactRow {
  id: string;
  name: string;
  summary: string;
  channel_id: string;
  workspace_id: string;
  created_at: string;
}
