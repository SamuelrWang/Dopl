import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { SEARCH_GROUP_TOTAL_CAP } from "../contracts";
import type { SearchHit } from "./repository-channel-rows";
import {
  SEARCH_TSQUERY_CONFIG,
  buildPrefixTsQuery,
  containsPattern,
  orLiteral,
  prefixPattern,
} from "./query-text";
import {
  SEARCH_CANDIDATE_ROW_LIMIT,
  visibleBases,
  visibleChats,
  visibleSkills,
  visibleTemplates,
  type CandidateRow,
  type SearchCaller,
} from "./repository-visibility";

/**
 * The five groups fenced by container membership: knowledge, agent templates,
 * members, skills, chats.
 *
 * F-716 (2026-09-17): container membership admits the caller to the container,
 * not to every row in it. The second fence is the owning feature's own predicate
 * (`canSeeBase` / `canSeeSkill` / `canSeeChat` / `canSeeTemplate`), called from
 * `repository-visibility.ts`. The SQL clause it replaced both missed lent rows
 * and leaked `access_mode='teams'` ones.
 *
 * So the visibility clause is no longer SQL and the CONTAINER fence still is:
 * each read fetches a candidate page (`WHERE workspace_id IN (<the reach>)` plus
 * the name match, capped at `SEARCH_CANDIDATE_ROW_LIMIT`) and the predicate cuts
 * it. A shared credential takes the same path — see {@link CANDIDATE_LIMIT}.
 *
 * (2026-09-17) `members`, `skills` and `chats` are never called in account scope
 * (`contracts.ts › CONTAINER_ONLY_SEARCH_GROUPS`) — those modules do not exist on
 * home. The enforcement is an absence, so `service.test.ts` asserts the tables
 * are never queried rather than that the groups came back empty.
 */

/**
 * The caller's own-row axis. `null` is a credential with no person behind it,
 * never "unknown": every arm below the widest visibility is skipped for it.
 */
export type OwnerRef = string | null;

/**
 * Every caller takes the same path: fetch the candidate page, ask the predicate.
 * A cheap `visibility = <widest>` SQL arm for credentials standing for nobody is
 * NOT equal to the predicate — `canSeeSkill` and `canSeeChat` admit `public` only
 * when `access_mode !== 'teams'` (the sweep in `shared-rows.test.ts` catches the
 * four combinations). The saving is kept where it is free instead: `grantSets`
 * reads no grant table for such a caller.
 */
const CANDIDATE_LIMIT = SEARCH_CANDIDATE_ROW_LIMIT;

/**
 * Bounds the FENCE, not the page. A container with more bases than this searches
 * a bounded subset, which under-counts rather than leaking.
 */
export const SEARCH_REACH_ROW_LIMIT = 500;

/**
 * The knowledge bases a search may name — the fence every entry read is bounded
 * by. Two queries rather than a join: the base set also labels each hit, and
 * PostgREST's embedded select would filter the child rather than the parent.
 */
export async function listReadableBases(
  containerIds: string[],
  caller: SearchCaller
): Promise<Map<string, { name: string; containerId: string }>> {
  const out = new Map<string, { name: string; containerId: string }>();
  if (containerIds.length === 0) return out;
  const db = supabaseAdmin();
  const query = db
    .from("knowledge_bases")
    .select("id, name, workspace_id, visibility, created_by")
    .in("workspace_id", containerIds)
    .is("deleted_at", null);
  const { data, error } = await query.limit(SEARCH_REACH_ROW_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as Array<CandidateRow & { name: string }>;
  const visible = await visibleBases(caller, rows);
  for (const row of visible) {
    out.set(row.id, { name: row.name, containerId: row.workspace_id });
  }
  return out;
}

/**
 * Knowledge entries whose title matches, or whose text does.
 *
 * F-717: `{config: "simple"}` must be named. PostgREST's `config` parameterises
 * the tsquery function, not the column; omitted, the query side falls to
 * `default_text_search_config` (english here) and silently matches nothing
 * against the `simple` vector. The generated `search_tsv` column fixes only the
 * vector half.
 *
 * Two queries, merged, and the title arm is not redundant: the FTS arm is a
 * PREFIX tsquery, and no tsquery matches the middle of a lexeme, so `handbook`
 * would not reach *Knowledge handbook*. Title hits come first in the merge.
 */
export async function searchKnowledgeEntries(
  bases: Map<string, { name: string; containerId: string }>,
  query: string
): Promise<SearchHit[]> {
  const baseIds = [...bases.keys()];
  if (baseIds.length === 0) return [];
  const db = supabaseAdmin();
  const cols = "id, title, body, knowledge_base_id, workspace_id, updated_at";
  const tsQuery = buildPrefixTsQuery(query);
  const [byTitle, byText] = await Promise.all([
    db
      .from("knowledge_entries")
      .select(cols)
      .in("knowledge_base_id", baseIds)
      .is("deleted_at", null)
      .ilike("title", containsPattern(query))
      .order("updated_at", { ascending: false })
      .limit(SEARCH_GROUP_TOTAL_CAP),
    // No token, no query: `null` is a skipped round trip, never an unfiltered
    // read. The title arm above still answers a query with no lexeme.
    tsQuery === null
      ? null
      : db
          .from("knowledge_entries")
          .select(cols)
          .in("knowledge_base_id", baseIds)
          .is("deleted_at", null)
          .textSearch("search_tsv", tsQuery, { config: SEARCH_TSQUERY_CONFIG })
          .order("updated_at", { ascending: false })
          .limit(SEARCH_GROUP_TOTAL_CAP),
  ]);
  if (byTitle.error) throw byTitle.error;
  if (byText?.error) throw byText.error;

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const row of [
    ...((byTitle.data ?? []) as KnowledgeRow[]),
    ...((byText?.data ?? []) as KnowledgeRow[]),
  ]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    hits.push({
      id: row.id,
      title: row.title,
      body: row.body,
      subtitle: bases.get(row.knowledge_base_id)?.name,
      containerId: row.workspace_id,
      updatedAt: row.updated_at,
    });
    if (hits.length >= SEARCH_GROUP_TOTAL_CAP) break;
  }
  return hits;
}

interface KnowledgeRow {
  id: string;
  title: string;
  body: string;
  knowledge_base_id: string;
  workspace_id: string;
  updated_at: string;
}

/** Agent templates whose name matches. `agent_templates` has no soft-delete
 *  column; `visibility` is the only gate the row carries. */
export async function searchAgentTemplates(
  containerIds: string[],
  query: string,
  caller: SearchCaller
): Promise<SearchHit[]> {
  if (containerIds.length === 0) return [];
  const db = supabaseAdmin();
  const builder = db
    .from("agent_templates")
    .select(
      "id, name, description, workspace_id, updated_at, visibility, created_by"
    )
    .in("workspace_id", containerIds)
    .ilike("name", containsPattern(query));
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as TemplateRow[];
  const visible = await visibleTemplates(caller, rows);
  return visible.slice(0, SEARCH_GROUP_TOTAL_CAP).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.description,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface TemplateRow extends CandidateRow {
  name: string;
  description: string | null;
  updated_at: string;
}

/**
 * Members of one container whose display name contains the query, or whose email
 * starts with it.
 *
 * Email is a PREFIX match: a contains-match on `com` would return every member,
 * a roster dump wearing a search result. `email` rides out as the subtitle —
 * container-scoped and membership-fenced, so it exposes nothing the Members page
 * does not already show.
 */
export async function searchMembers(
  containerId: string,
  containerName: string,
  query: string
): Promise<SearchHit[]> {
  const db = supabaseAdmin();
  const { data: memberRows, error: memberError } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", containerId)
    .eq("status", "active")
    .order("user_id", { ascending: true })
    .limit(SEARCH_REACH_ROW_LIMIT);
  if (memberError) throw memberError;
  const userIds = ((memberRows ?? []) as Array<{ user_id: string }>).map(
    (r) => r.user_id
  );
  if (userIds.length === 0) return [];

  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .in("id", userIds)
    // Raw filter string: every value goes through `orLiteral`, or a query
    // containing `,` or `.` rewrites the filter's shape.
    .or(
      `display_name.ilike.${orLiteral(containsPattern(query))},` +
        `email.ilike.${orLiteral(prefixPattern(query))}`
    )
    .order("display_name", { ascending: true })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.id,
    // Email is the fallback title, as `dto.ts › mapMessageRow` resolves an author
    // name — a profile with no display name is a real state.
    title: row.display_name ?? row.email ?? containerName,
    subtitle: row.email ?? undefined,
    containerId,
    avatarUrls: row.avatar_url ? [row.avatar_url] : undefined,
  }));
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** Skills of one container whose name matches. `status='draft'` rows are kept —
 *  the visibility arm already decides who may see the author's draft. */
export async function searchSkills(
  containerId: string,
  query: string,
  caller: SearchCaller
): Promise<SearchHit[]> {
  const db = supabaseAdmin();
  const builder = db
    .from("skills")
    .select(
      "id, name, description, workspace_id, updated_at, visibility, access_mode, created_by"
    )
    .eq("workspace_id", containerId)
    .is("deleted_at", null)
    .ilike("name", containsPattern(query));
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as SkillRow[];
  const visible = await visibleSkills(caller, rows);
  return visible.slice(0, SEARCH_GROUP_TOTAL_CAP).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.description,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface SkillRow extends CandidateRow {
  name: string;
  description: string | null;
  updated_at: string;
}

/** Archived chats of one container whose title matches. The owner column is
 *  `owner_id`, not `created_by` — the one table here that spells it differently. */
export async function searchChats(
  containerId: string,
  query: string,
  caller: SearchCaller
): Promise<SearchHit[]> {
  const db = supabaseAdmin();
  const builder = db
    .from("chats")
    .select(
      "id, title, overview, workspace_id, updated_at, visibility, access_mode, owner_id"
    )
    .eq("workspace_id", containerId)
    .is("deleted_at", null)
    .ilike("title", containsPattern(query));
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as ChatRow[];
  const visible = await visibleChats(caller, rows);
  return visible.slice(0, SEARCH_GROUP_TOTAL_CAP).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.overview === "" ? null : row.overview,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface ChatRow extends CandidateRow {
  title: string;
  overview: string;
  updated_at: string;
}
