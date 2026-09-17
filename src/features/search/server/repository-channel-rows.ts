import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageKind } from "@/features/channels/types";
import { SEARCH_GROUP_TOTAL_CAP } from "../contracts";
import { containsPattern } from "./query-text";

/**
 * THE FOUR GROUPS FENCED BY **CHANNEL MEMBERSHIP** — channels, messages,
 * threads, artifacts (2026-09-17).
 *
 * 🔒 **EVERY FUNCTION HERE TAKES A `channelIds` ARRAY AND `repository-reach.ts ›
 * loadSearchReach` IS ITS ONLY LEGITIMATE SOURCE.** That array is literally the
 * `WHERE … IN (…)` of each query, so a channel the caller is not a member of is
 * never NAMED rather than filtered out afterwards. An empty array short-circuits
 * with NO query — `.in("x", [])` is a legal PostgREST filter that returns
 * nothing, but spending a round trip to learn it is a per-keystroke cost.
 *
 * ⚠ Every read is CAPPED at {@link SEARCH_GROUP_TOTAL_CAP} and the count that
 * comes back IS `SearchGroup.total`. At the cap the number means "50 or more"
 * (`contracts.ts`), which is why nothing here reports `truncated` separately: the
 * ceiling is the count's own documented ceiling, not a second clip.
 */

/**
 * One row a group can draw, before it knows which group it is. ⚠ Snake_case
 * stops here (INVARIANTS §2) — nothing above this layer sees a column name.
 */
export interface SearchHit {
  id: string;
  /** The headline. Never empty — a row with no name cannot be a hit. */
  title: string;
  /** Prose to cut a snippet from, when this kind has any. */
  body?: string | null;
  /**
   * ⚠ **SET BY A REPOSITORY ONLY WHEN THE LABEL IS A COLUMN IT ALREADY READ** —
   * a knowledge base's name, a member's email. Every other kind's subtitle is
   * the channel or container it lives in, which the SERVICE fills from the reach
   * it is already holding rather than paying a second join per group.
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
 * 🔒 **WHAT THE "MESSAGES" SECTION MEANS, STATED ONCE.** Only `kind='message'`
 * rows — what a person or an agent SAID.
 *
 * ⚠ **THE `task_*` KINDS ARE EXCLUDED ON PURPOSE AND THE EXCLUSION IS A PRODUCT
 * DECISION, NOT A PERFORMANCE ONE.** They are a thread's lifecycle NARRATION
 * (`task_started` / `task_progress` / `task_finished` / `task_failed`,
 * `@dopl/contracts › ChannelMessageKind`) — an autonomous run emits dozens of
 * them carrying the thread's own title, so including them would make one thread
 * fill the Messages section with rows that all point at the Threads section's
 * single row for the same thing. The THREAD is searchable in its own group.
 * ⚠ `kind='system'` goes for the same reason: nobody typed it.
 */
const SEARCHABLE_MESSAGE_KIND: ChannelMessageKind = "message";

/** Channels the caller is in whose NAME matches. ⚠ Archived rooms are kept —
 *  a search is where somebody goes to find one. */
export async function searchChannels(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("id, name, workspace_id, updated_at")
    .in("id", channelIds)
    // ⚠ A tombstoned channel is NOT-FOUND everywhere else; the reach read
    // already dropped it, and stating it twice costs nothing and survives a
    // future caller that builds the array some other way.
    .is("deleted_at", null)
    .ilike("name", containsPattern(query))
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ChannelNameRow[]).map((row) => ({
    id: row.id,
    title: row.name,
    containerId: row.workspace_id,
    channelId: row.id,
    updatedAt: row.updated_at,
  }));
}

interface ChannelNameRow {
  id: string;
  name: string;
  workspace_id: string;
  updated_at: string;
}

/**
 * Messages whose BODY matches, by Postgres full text.
 *
 * 🔒 ⚠ **`.textSearch(…, {type:"websearch", config:"simple"})` IS THE CONTRACT'S
 * EXPRESSION FORM, VERBATIM.** PostgREST renders it as
 * `to_tsvector('simple', body) @@ websearch_to_tsquery('simple', $1)` — the
 * `simple` dictionary on both sides, so no stemming and no stopword list decides
 * what a person's own words mean.
 *
 * ⚠ **IT READS THE COLUMN `body` AND NOT A `tsvector` COLUMN, AND THAT IS
 * DELIBERATE AS OF 2026-09-17 (F-715).** `supabase/migrations/20261007120000_search_
 * fulltext_indexes.sql` adds `channel_messages.search_tsv` (generated, STORED)
 * plus its GIN index and is **WRITTEN, NOT APPLIED**. Naming a column that does
 * not exist yet would make this route BROKEN rather than SLOW until somebody
 * applies it, which `20260822170000_overview_time_range_indexes.sql` states as
 * the rule for this directory. **TO SWITCH once the migration is live: change
 * the first argument below from `"body"` to `"search_tsv"` and drop `config`
 * (the generated column already fixes the dictionary). Nothing else moves — the
 * predicate is the same one, and a probe to discover which is available would be
 * a per-request round trip to learn something a deploy already knows.**
 *
 * ⚠ **NEWEST-FIRST, NOT `ts_rank`.** `ts_rank` is an expression in a SELECT
 * list and PostgREST cannot ask for one; ranking is applied over the page
 * this returns (`service-groups.ts › rankHits`), with `created_at DESC` as the tie
 * and the order the page is CUT on — so a busy room's burst cannot push an older
 * room's only hit off a 50-row page in a way that changes between keystrokes.
 */
export async function searchMessages(
  channelIds: string[],
  query: string
): Promise<SearchHit[]> {
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("id, seq, body, channel_id, workspace_id, created_at")
    .in("channel_id", channelIds)
    .eq("kind", SEARCHABLE_MESSAGE_KIND)
    .textSearch("body", query, { type: "websearch", config: "simple" })
    .order("created_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map((row) => ({
    id: row.id,
    // ⚠ The TITLE of a message hit is the channel it is in, filled in by the
    // service from the reach it already holds — a message has no name of its
    // own, and inventing one out of its first line would duplicate the snippet.
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
 * Threads whose TITLE matches. ⚠ The table is `channel_tasks` — the thread list's
 * own store (`20260818120000_channel_tasks_activity_view.sql`, *"read model for
 * the thread list"*); there has never been a `channel_threads` table and a
 * future reader looking for one will not find it.
 * ⚠ CLOSED threads are kept: a finished piece of work is the thing people search
 * for most.
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
 * Artifacts whose NAME matches.
 * ⚠ `dissolved_at IS NULL` — a dissolved card is RETIRED, never deleted
 * (`20260926120000_channel_artifacts.sql`): the row survives so an old id still
 * resolves, and a browse surface that listed one would offer a card that folds
 * nothing.
 * ⚠ `created_at`, because `channel_artifacts` has no `updated_at` column. The
 * field is reported as what it is rather than relabelled.
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
