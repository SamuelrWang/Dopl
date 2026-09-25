import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import { homeSpaceWriteWorkspaceId, resolveShelfScope } from "@/shared/tenancy/home-space";
import type {
  AgentIdentity,
  IdentityField,
  IdentityShelf,
  IdentityVisibility,
} from "../types";
import {
  AGENT_IDENTITY_COLS,
  mapAgentIdentityRow,
  type AgentIdentityRow,
} from "./dto";

/**
 * Raw I/O for agent identities and their two junctions. A read answering "what may this caller see"
 * takes `readClient()` (the caller's RLS when `RLS_CALLER_SCOPED_READS` is on); reads of tables the
 * RLS phases do not cover, and every write, stay on `supabaseAdmin()` — so each filters by workspace.
 */

// ─── Identities ──────────────────────────────────────────────────────────

/** One workspace's identities; `shelf` picks the tenancy (`resolveShelfScope`), undefined = no filter. */
export async function listIdentitiesForWorkspace(
  workspaceId: string,
  shelf?: IdentityShelf
): Promise<AgentIdentity[]> {
  const db = readClient();
  const scope = await resolveShelfScope(workspaceId, shelf);
  const { data, error } = await db
    .from("agent_identities")
    .select(AGENT_IDENTITY_COLS)
    .in("workspace_id", scope.workspaceIds)
    // Name order (`agent_identities_workspace_name_idx`) is the order every surface displays.
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as AgentIdentityRow[]).map((r) =>
    mapAgentIdentityRow(r)
  );
}

/**
 * Which of `identityIds` live in the caller's home space. Callers pass the post-visibility
 * list — the id set is the fence — and the same resolver the list uses answers "home".
 */
export async function listHomeScopedIdentityIds(
  workspaceId: string,
  identityIds: string[]
): Promise<string[]> {
  if (identityIds.length === 0) return [];
  const scope = await resolveShelfScope(workspaceId, "home");
  if (scope.workspaceIds.length === 0) return [];
  const { data, error } = await readClient()
    .from("agent_identities")
    .select("id")
    .in("workspace_id", scope.workspaceIds)
    .in("id", identityIds);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

export async function findIdentityById(
  workspaceId: string,
  id: string
): Promise<AgentIdentity | null> {
  const db = readClient();
  const { data, error } = await db
    .from("agent_identities")
    .select(AGENT_IDENTITY_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? mapAgentIdentityRow(data as unknown as AgentIdentityRow)
    : null;
}

export interface InsertIdentityArgs {
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  model: string | null;
  runtime?: string | null;
  fields: IdentityField[];
  visibility: IdentityVisibility;
  /** A routing flag, not a column: `true` files the row in the author's home space. */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * A personal write lands in the container or refuses (twin of `repository-bases.ts › insertBase`).
 * The workspace is resolved before the builder chain: an `await` between `.from()` and `.insert()`
 * interleaves a second query into the builder.
 */
export async function insertIdentity(
  args: InsertIdentityArgs
): Promise<AgentIdentity> {
  const db = supabaseAdmin();
  const workspaceId = await homeSpaceWriteWorkspaceId(args);
  const { data, error } = await db
    .from("agent_identities")
    .insert({
      workspace_id: workspaceId,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      model: args.model,
      runtime: args.runtime ?? null,
      fields: args.fields,
      visibility: args.visibility,
      created_by: args.createdBy,
    })
    .select(AGENT_IDENTITY_COLS)
    .single();
  if (error || !data) {
    throw error || new Error("Failed to insert agent identity");
  }
  return mapAgentIdentityRow(data as unknown as AgentIdentityRow);
}

/** `undefined` = leave the column alone, `null` = clear it. */
export interface UpdateIdentityPatch {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  runtime?: string | null;
  fields?: IdentityField[];
  /** Trusted as given — the service decides who may re-scope. */
  visibility?: IdentityVisibility;
}

/**
 * The optimistic-concurrency precondition is a where clause (`.eq("updated_at", expected)`), never a
 * read-then-compare (F-747); zero rows with a precondition returns `null` (the 412), never throws.
 * Same contract as `knowledge/server/repository-entries.ts › updateEntryRow`.
 */
export async function updateIdentityRow(
  workspaceId: string,
  id: string,
  patch: UpdateIdentityPatch
): Promise<AgentIdentity>;
export async function updateIdentityRow(
  workspaceId: string,
  id: string,
  patch: UpdateIdentityPatch,
  expectedUpdatedAt: string | undefined
): Promise<AgentIdentity | null>;
export async function updateIdentityRow(
  workspaceId: string,
  id: string,
  patch: UpdateIdentityPatch,
  expectedUpdatedAt?: string
): Promise<AgentIdentity | null> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.instructions !== undefined) update.instructions = patch.instructions;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.runtime !== undefined) update.runtime = patch.runtime;
  if (patch.fields !== undefined) update.fields = patch.fields;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  // Never set `updated_at` by hand: `agent_identities_touch_updated_at` stamps it.
  // An empty scalar patch must SELECT, not UPDATE — PostgREST cannot emit an empty SET (F-404).
  const query = (
    Object.keys(update).length === 0
      ? db.from("agent_identities").select(AGENT_IDENTITY_COLS)
      : db.from("agent_identities").update(update).select(AGENT_IDENTITY_COLS)
  )
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  // The precondition applies on both branches, the empty-patch read included.
  const { data, error } = await (expectedUpdatedAt === undefined
    ? query
    : query.eq("updated_at", expectedUpdatedAt)
  ).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Zero rows under a precondition is the CAS losing the race, not a failure.
    if (expectedUpdatedAt !== undefined) return null;
    throw new Error("Failed to update agent identity");
  }
  return mapAgentIdentityRow(data as unknown as AgentIdentityRow);
}

/**
 * Permanent delete. The knowledge junction cascades by FK; the team links are polymorphic
 * `resource_grants` rows with no FK, purged by the `resource_grants_cleanup` trigger.
 */
export async function hardDeleteIdentity(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("agent_identities")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw error;
}

// ─── Team links (resource_grants, scope_type='team') ────────────────────

/**
 * This feature's slice of `resource_grants`, spread into every statement: the table is shared by five
 * resource types × three scope types, so a statement missing either half reads — or deletes —
 * another lane's rows.
 */
const IDENTITY_TEAM_GRANT = {
  scope_type: "team",
  resource_type: "agent_identity",
} as const;

/** Team links for many identities in one query. */
export async function listTeamLinksForIdentities(
  workspaceId: string,
  identityIds: string[]
): Promise<Array<{ identityId: string; teamId: string }>> {
  if (identityIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id, scope_id")
    .match({ workspace_id: workspaceId, ...IDENTITY_TEAM_GRANT })
    .in("resource_id", identityIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ resource_id: string; scope_id: string }>
  ).map((r) => ({ identityId: r.resource_id, teamId: r.scope_id }));
}

/** Replace-set: clear, then insert (never add/remove verbs over a set two clients edit). */
export async function replaceTeamLinks(
  workspaceId: string,
  identityId: string,
  teamIds: string[],
  grantedBy: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const del = await db
    .from("resource_grants")
    .delete()
    .match({
      workspace_id: workspaceId,
      resource_id: identityId,
      ...IDENTITY_TEAM_GRANT,
    });
  if (del.error) throw del.error;
  if (teamIds.length === 0) return;
  const { error } = await db.from("resource_grants").insert(
    [...new Set(teamIds)].map((teamId) => ({
      ...IDENTITY_TEAM_GRANT,
      scope_id: teamId,
      resource_id: identityId,
      workspace_id: workspaceId,
      // An identity team link has no edit concept; writes stay creator-or-admin.
      level: "read",
      // The grantor `enforce_resource_grant()` judges; NULL = same-container equality.
      created_by: grantedBy,
    }))
  );
  if (error) throw error;
}

/** Team ids the caller belongs to. Service role: `team_members` is outside the RLS phases, and this
 *  feeds the TS predicate rather than a row the caller is shown. */
export async function listTeamIdsForUser(
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select("team_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id);
}

/** Which of `teamIds` exist in this workspace (write-path validation, service role). */
export async function filterTeamIdsInWorkspace(
  workspaceId: string,
  teamIds: string[]
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("teams")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", teamIds);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

// ─── Knowledge-base attachments (`repository-knowledge-links.ts`) ────────
export {
  listKnowledgeLinksForIdentities,
  replaceKnowledgeLinks,
  listKnowledgeBaseAccessRows,
  listKnowledgeBaseTeamGrants,
  listLiveFoldersForBases,
  listLiveEntryRows,
  type KnowledgeBaseAccessRow,
  type KnowledgeFolderRow,
  type KnowledgeEntryRow,
  type IdentityKnowledgeLinkRow,
} from "./repository-knowledge-links";
