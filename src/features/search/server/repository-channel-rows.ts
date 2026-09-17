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

/**
 * Channels the caller is in whose NAME matches. ⚠ Archived rooms are kept —
 * a search is where somebody goes to find one.
 *
 * 🔒 **`topic` IS THE CHANNEL'S DESCRIPTION AND IT IS THIS ROW'S SUBTITLE
 * (Samuel, 2026-09-17:** *"For channels … it should be the name of the channel
 * in black, and then to the right the description of the channel in gray
 * italics."*). It is the column the channel header and the info panel already
 * draw as the description — there is no `description` column on `channels`
 * (`supabase/migrations/20260725120000_channels.sql`), and inventing a client
 * join for one would be a second answer to the same question.
 * ⚠ **NOT NULL DEFAULT `''`** (that migration; bounded by
 * `20260731100000_channels_name_topic_bounds.sql`), so an EMPTY topic is the
 * ordinary case and rides out as NO subtitle at all rather than as an empty
 * one: the popup omits the span, and a `""` would leave the gap where a
 * description goes.
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
    // ⚠ A tombstoned channel is NOT-FOUND everywhere else; the reach read
    // already dropped it, and stating it twice costs nothing and survives a
    // future caller that builds the array some other way.
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
 * Messages whose BODY matches, by Postgres full text.
 *
 * 🔒 ⚠ **`.textSearch(…, {type:"websearch", config:"simple"})` IS THE CONTRACT'S
 * EXPRESSION FORM, VERBATIM.** PostgREST renders it as
 * `to_tsvector('simple', body) @@ websearch_to_tsquery('simple', $1)` — the
 * `simple` dictionary on both sides, so no stemming and no stopword list decides
 * what a person's own words mean.
 *
 * ⚠ **IT READS `search_tsv`, THE GENERATED STORED COLUMN, SINCE 2026-09-17
 * (F-715, CLOSED).** `supabase/migrations/20261007120000_search_fulltext_indexes.sql`
 * — which adds that column and `channel_messages_search_tsv_idx` over it — was
 * APPLIED that day, by name and byte-exact, so the GIN index now serves this
 * predicate instead of a per-row `to_tsvector`.
 * ⚠ **NO `config` ON THIS ARM, AND ITS ABSENCE IS LOAD-BEARING.** The dictionary
 * is fixed INSIDE the generated column (`to_tsvector('simple', coalesce(body,
 * ''))`); passing one here would ask PostgREST to build a `to_tsvector` over a
 * value that already is one. `knowledge_entries.search_tsv` is read the same way,
 * one module over — the two arms are now spelled identically, which is the point.
 * ⚠ **THE EXPRESSION FORM IS WHAT THIS READ AND IT IS WHY THE MIGRATION COULD BE
 * "WRITTEN, NOT APPLIED" FOR A RELEASE.** `.textSearch("body", q, {config:
 * "simple"})` renders the same predicate computed per row — SLOW, NEVER WRONG.
 * Keep that property in mind before pointing a NEW search arm at a column a
 * migration has not landed yet: naming one makes the route BROKEN rather than
 * SLOW, which is the rule `20260822170000_overview_time_range_indexes.sql` states
 * for this directory. **Deploy state is a MEASUREMENT (CLAUDE.md doc rule 4) —
 * re-derive rather than trusting this paragraph:**
 * `SELECT attname FROM pg_attribute WHERE attrelid = 'public.channel_messages'::regclass
 * AND attname = 'search_tsv';`
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
    .textSearch("search_tsv", query, { type: "websearch" })
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
