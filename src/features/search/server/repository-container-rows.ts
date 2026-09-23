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
  visibleIdentities,
  type CandidateRow,
  type SearchCaller,
} from "./repository-visibility";

/**
 * The container-fenced groups: knowledge, agent identities, members, skills, chats.
 * SQL keeps the container fence (`workspace_id IN <reach>`); the owning feature's
 * predicate then cuts each candidate page (`repository-visibility.ts`, F-716).
 * Members, skills and chats are never queried in account scope — an absence, so
 * `service.test.ts` asserts the tables are untouched.
 */

/** `null` is a credential with no person behind it, never "unknown". */
export type OwnerRef = string | null;

/**
 * Shared credentials take the predicate path too: a SQL `visibility = <widest>`
 * shortcut would admit teams-mode public skills and chats.
 */
const CANDIDATE_LIMIT = SEARCH_CANDIDATE_ROW_LIMIT;

/** Bounds the fence, not the page: past it a container under-counts rather than leaks. */
export const SEARCH_REACH_ROW_LIMIT = 500;

/**
 * Bases the caller may see — the fence every entry read is bounded by. Two queries,
 * not a join: PostgREST's embedded select filters the child, not the parent.
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
 * Entries matching by title or text, title hits first. `config` must be named, or the
 * tsquery side falls to `english` and matches nothing against the `simple` vector
 * (F-717). The title arm is not redundant: a prefix tsquery never matches mid-lexeme.
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
    // No lexeme: skip the round trip, never an unfiltered read.
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

/** Agent identities whose name matches; the table has no soft-delete column. */
export async function searchAgentIdentities(
  containerIds: string[],
  query: string,
  caller: SearchCaller
): Promise<SearchHit[]> {
  if (containerIds.length === 0) return [];
  const db = supabaseAdmin();
  const builder = db
    .from("agent_identities")
    .select(
      "id, name, description, workspace_id, updated_at, visibility, created_by"
    )
    .in("workspace_id", containerIds)
    .ilike("name", containsPattern(query));
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as IdentityRow[];
  const visible = await visibleIdentities(caller, rows);
  return visible.slice(0, SEARCH_GROUP_TOTAL_CAP).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.description,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface IdentityRow extends CandidateRow {
  name: string;
  description: string | null;
  updated_at: string;
}

/**
 * Members whose display name contains the query or whose email starts with it — a
 * contains-match on `com` would dump the roster. The email subtitle shows nothing the
 * Members page does not.
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
    // Every value goes through `orLiteral`, or a `,`/`.` in the query reshapes the filter.
    .or(
      `display_name.ilike.${orLiteral(containsPattern(query))},` +
        `email.ilike.${orLiteral(prefixPattern(query))}`
    )
    .order("display_name", { ascending: true })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.id,
    // A profile with no display name is a real state; email is the fallback title.
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

/** Skills whose name matches; drafts are kept — the predicate decides who sees them. */
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

/** Archived chats whose title matches; the owner column is `owner_id` here. */
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
