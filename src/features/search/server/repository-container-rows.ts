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

/**
 * THE FIVE GROUPS FENCED BY **CONTAINER MEMBERSHIP** — knowledge, agent
 * templates, members, skills, chats (2026-09-17).
 *
 * 🔒 ── THE SECOND FENCE, AND WHY IT IS NARROWER THAN `canSee*` ON PURPOSE ──
 *
 * Container membership admits the caller to the CONTAINER; it does not admit
 * them to every row in it. Four of these tables carry their own visibility axis,
 * and each is narrowed here by **the arms of its own `canSee*` predicate that
 * can be stated as a `WHERE` clause**:
 *
 *   * `knowledge_bases`  — `visibility='public' OR created_by = caller`
 *   * `agent_templates`  — `visibility='workspace' OR created_by = caller`
 *   * `skills`           — `visibility='public' OR created_by = caller`
 *   * `chats`            — `visibility='public' OR owner_id = caller`
 *
 * ⚠ **THAT IS A STRICT SUBSET OF WHAT THE FEATURE'S OWN PREDICATE ADMITS, AND
 * THE DIRECTION IS THE WHOLE ARGUMENT (F-716).** `knowledge/server/service-shared.ts ›
 * canSeeBase`, `skills/server/service-shared.ts › canSeeSkill`,
 * `agent-templates/server/service-shared.ts › canSeeTemplate` and
 * `chats/server/service-shared.ts › canSeeChat` each have further arms — a team
 * grant, a workspace-admin arm, a `resource_grants` row — that can only ever ADD
 * rows. Every arm dropped here makes the answer SMALLER. **A search that misses
 * a lent row is a miss; a search that shows a foreign one is a leak**, and the
 * first is the failure a popup is allowed to have. The clauses kept are exactly
 * the ones `20260504030000_visibility_private_resources.sql` states as the RLS
 * SELECT policy, so the fence and the policy say the same thing on the two
 * tables that have both.
 *
 * ⚠ **AND THE OWN-ROW ARM IS DROPPED ENTIRELY FOR A SHARED CREDENTIAL**, through
 * `shared/auth/credential-audience.ts › isSharedCredential` at the service. Arm 2
 * of every one of those predicates is that refusal (F-336/F-333): a credential
 * with nobody behind it inherits nobody's private rows, so passing
 * `ownerUserId: null` here is the search's spelling of the same rule.
 *
 * ⚠ **`members`, `skills` AND `chats` ARE NEVER CALLED IN ACCOUNT SCOPE**
 * (`contracts.ts › CONTAINER_ONLY_SEARCH_GROUPS`; Samuel 2026-09-17: *"those
 * modules do not exist on home"*). The service does not call them, and the
 * enforcement is an ABSENCE — which is what silently stops being true — so
 * `service.test.ts` asserts the tables are never queried rather than that the
 * groups came back empty.
 */

/**
 * The caller, as the visibility clauses need them. ⚠ `null` means **a credential
 * with no person behind it**, never "unknown": every own-row arm below is
 * skipped for it, which is the fail-closed direction.
 */
export type OwnerRef = string | null;

/**
 * ⚠ A base ceiling distinct from the group cap: it bounds the FENCE, not the
 * page. A container with more bases than this searches a bounded subset of them,
 * which under-counts rather than leaking, and nothing here claims otherwise.
 */
export const SEARCH_REACH_ROW_LIMIT = 500;

/**
 * 🔒 The knowledge BASES a search may name — the fence every entry read below is
 * bounded by. Two queries rather than a join, because the base set is also what
 * labels each hit (`subtitle` = the base's name) and PostgREST's embedded-select
 * would make the visibility clause a filter on the CHILD instead of the parent.
 */
export async function listReadableBases(
  containerIds: string[],
  ownerUserId: OwnerRef
): Promise<Map<string, { name: string; containerId: string }>> {
  const out = new Map<string, { name: string; containerId: string }>();
  if (containerIds.length === 0) return out;
  const db = supabaseAdmin();
  let query = db
    .from("knowledge_bases")
    .select("id, name, workspace_id")
    .in("workspace_id", containerIds)
    .is("deleted_at", null);
  query = applyVisibilityArm(query, "visibility", "public", "created_by", ownerUserId);
  const { data, error } = await query.limit(SEARCH_REACH_ROW_LIMIT);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    id: string;
    name: string;
    workspace_id: string;
  }>) {
    out.set(row.id, { name: row.name, containerId: row.workspace_id });
  }
  return out;
}

/**
 * Knowledge entries whose TITLE matches, or whose text does.
 *
 * 🔒 ⚠ **THE FULL-TEXT ARM READS `search_tsv`, AND THAT COLUMN IS ALREADY LIVE**
 * — `supabase/migrations/20260501020000_knowledge_fulltext.sql`, a GENERATED
 * STORED `tsvector` over `setweight(title,'A') || setweight(excerpt,'B') ||
 * setweight(body,'C')` with a GIN index, and it is present in
 * `src/shared/supabase/types.ts`, which is generated FROM THE DEPLOYED DATABASE.
 *
 * 🔒 ⚠ **`{config: "simple"}` IS NAMED HERE FOR THE SAME REASON IT IS NAMED ON
 * THE MESSAGES ARM, AND FOR A WHILE NEITHER DID (F-717).** PostgREST's `config`
 * parameterises the tsquery FUNCTION — `search_tsv=fts(simple).<q>` is
 * `search_tsv @@ to_tsquery('simple', $1)` — it does NOT wrap the column in a
 * second `to_tsvector`, which is what the comment that used to stand here
 * claimed. Omitted, the query side falls to the server's
 * `default_text_search_config` (`pg_catalog.english` on this deployment), and an
 * english-stemmed query against a `simple` vector silently matches nothing.
 * The generated column fixes the VECTOR's dictionary and says nothing about the
 * QUERY's. See `query-text.ts › SEARCH_TSQUERY_CONFIG` for the measurement.
 *
 * ⚠ **TWO QUERIES, MERGED, AND THE TITLE ARM IS STILL NOT REDUNDANT.**
 * `search_tsv` carries the title at weight A, and the FTS arm is now a PREFIX
 * `tsquery` (`query-text.ts › buildPrefixTsQuery`), so `kno` does reach
 * *Knowledge handbook* through it. The `ilike` arm survives because a prefix is
 * not a CONTAINS: somebody typing `handbook` expects *Knowledge handbook*, and
 * no `tsquery` matches the middle of a lexeme. Title hits come FIRST in the
 * merge — somebody typing a document's name is looking for the document.
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
    // ⚠ NO TOKEN, NO QUERY — a query of `???` has no lexeme to ask for, and the
    // title arm above still answers it. `null` here is a skipped round trip,
    // never an unfiltered read.
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

/** Agent templates whose NAME matches. ⚠ `agent_templates` has no soft-delete
 *  column; `visibility` is the only gate the row carries. */
export async function searchAgentTemplates(
  containerIds: string[],
  query: string,
  ownerUserId: OwnerRef
): Promise<SearchHit[]> {
  if (containerIds.length === 0) return [];
  const db = supabaseAdmin();
  let builder = db
    .from("agent_templates")
    .select("id, name, description, workspace_id, updated_at")
    .in("workspace_id", containerIds)
    .ilike("name", containsPattern(query));
  builder = applyVisibilityArm(
    builder,
    "visibility",
    "workspace",
    "created_by",
    ownerUserId
  );
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as TemplateRow[]).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.description,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  updated_at: string;
}

/**
 * Members of ONE container whose display name contains the query, or whose email
 * STARTS with it.
 *
 * ⚠ **EMAIL IS A PREFIX MATCH, NOT A CONTAINS.** An address is not prose: a
 * contains-match on `com` returns every member of the container, which is a
 * roster dump wearing a search result.
 * ⚠ `email` rides out as the subtitle, which is what the channel roster already
 * shows a co-member (`channels/server/dto.ts › mapMemberRow` scrubs the four
 * per-member SETTINGS to the viewer's own row and leaves `email` on every row).
 * This group is container-scoped and membership-fenced, so nobody sees an
 * address they could not already read on the Members page.
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
    // ⚠ RAW FILTER STRING — every value goes through `orLiteral`, or a query
    // containing `,` or `.` rewrites the filter's SHAPE (`query-text.ts`).
    .or(
      `display_name.ilike.${orLiteral(containsPattern(query))},` +
        `email.ilike.${orLiteral(prefixPattern(query))}`
    )
    .order("display_name", { ascending: true })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.id,
    // ⚠ The email is the fallback TITLE, exactly as `dto.ts › mapMessageRow`
    // resolves an author name — a profile with no display name is a real state.
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

/** Skills of ONE container whose NAME matches. ⚠ `status='draft'` rows are KEPT
 *  — a draft is the author's own work in progress and the visibility arm already
 *  decides who may see it. */
export async function searchSkills(
  containerId: string,
  query: string,
  ownerUserId: OwnerRef
): Promise<SearchHit[]> {
  const db = supabaseAdmin();
  let builder = db
    .from("skills")
    .select("id, name, description, workspace_id, updated_at")
    .eq("workspace_id", containerId)
    .is("deleted_at", null)
    .ilike("name", containsPattern(query));
  builder = applyVisibilityArm(
    builder,
    "visibility",
    "public",
    "created_by",
    ownerUserId
  );
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as SkillRow[]).map((row) => ({
    id: row.id,
    title: row.name,
    body: row.description,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  updated_at: string;
}

/** Archived chats of ONE container whose TITLE matches. ⚠ The owner column is
 *  `owner_id`, not `created_by` — the one table here that spells it differently. */
export async function searchChats(
  containerId: string,
  query: string,
  ownerUserId: OwnerRef
): Promise<SearchHit[]> {
  const db = supabaseAdmin();
  let builder = db
    .from("chats")
    .select("id, title, overview, workspace_id, updated_at")
    .eq("workspace_id", containerId)
    .is("deleted_at", null)
    .ilike("title", containsPattern(query));
  builder = applyVisibilityArm(
    builder,
    "visibility",
    "public",
    "owner_id",
    ownerUserId
  );
  const { data, error } = await builder
    .order("updated_at", { ascending: false })
    .limit(SEARCH_GROUP_TOTAL_CAP);
  if (error) throw error;
  return ((data ?? []) as ChatRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.overview === "" ? null : row.overview,
    containerId: row.workspace_id,
    updatedAt: row.updated_at,
  }));
}

interface ChatRow {
  id: string;
  title: string;
  overview: string;
  workspace_id: string;
  updated_at: string;
}

/** The minimum a PostgREST builder has to offer for {@link applyVisibilityArm}. */
interface FilterableQuery<T> {
  eq(column: string, value: string): T;
  or(filter: string): T;
}

/**
 * 🔒 **THE ONE PLACE THE VISIBILITY ARM IS WRITTEN**, for all four tables that
 * carry one.
 *
 * ⚠ **A `null` OWNER COLLAPSES TO `eq`, NOT TO A ONE-ARMED `or`.** With no
 * person behind the credential the own-row arm cannot match anything, and
 * spelling it as `or(visibility.eq.public)` would leave a filter shaped like a
 * two-armed one for the next editor to "complete".
 * ⚠ `ownerUserId` is a `auth.users` UUID and could not carry an `.or()`
 * metacharacter today — it is quoted anyway, because that is a fact about the
 * CALLER and not about this function (`resolve-resource.ts › orLiteral`'s words).
 */
function applyVisibilityArm<T extends FilterableQuery<T>>(
  query: T,
  visibilityColumn: string,
  widestValue: string,
  ownerColumn: string,
  ownerUserId: OwnerRef
): T {
  if (ownerUserId === null) return query.eq(visibilityColumn, widestValue);
  return query.or(
    `${visibilityColumn}.eq.${orLiteral(widestValue)},` +
      `${ownerColumn}.eq.${orLiteral(ownerUserId)}`
  );
}
