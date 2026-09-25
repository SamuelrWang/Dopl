import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  isSharedCredential,
  type CredentialAxes,
} from "@/shared/auth/credential-audience";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { resolveHomeSpaceReach } from "./home-space-reach";
import { grantedResourceIds } from "./resource-grant-reach";

/**
 * Resolves an id (or name) to the container it lives in — the one read that looks across containers.
 * `supabaseAdmin()` bypasses RLS, so these clauses ARE the fence; a row is nameable only when all hold:
 *   1. the caller is a person: a shared credential resolves nothing (arm 2 of every `canSee*`).
 *   2. the container is one the caller actively belongs to, at or above {@link CONTAINER_READ_FLOOR}.
 *   3. a locked credential resolves inside its lock plus its operator's home space, never
 *      wider ({@link lockedCandidates}).
 *   4. the caller could already list the row: they created it, or it is shared with the whole
 *      container — or, by id only, it is lent to a scope they are in ({@link findGrantedResource}).
 * Clause 4 is why this is no existence oracle: another member's private row answers `null`, exactly
 * like a missing id (404-never-403).
 * Resolution is not authorisation: callers still run the feature's visibility matrix in the resolved
 * container. No fallback: an id lookup never degrades into a name lookup, and a name lookup never picks.
 */

import {
  CONTAINER_READ_FLOOR,
  RESOURCE_TABLES,
  type ResourceTable,
  type ResourceType,
} from "./resolve-resource-tables";
export type { ResourceType } from "./resolve-resource-tables";

/** The credential axes the fence reads (clauses 1 and 3) plus the asker; structural, so every
 *  feature context satisfies it without importing this module. */
export interface ResourceCaller extends CredentialAxes {
  userId: string;
  /** The container the credential is locked to (`mcp_tokens.container_id`); `null`/absent =
   *  unlocked. Clause 3 narrows on it and never widens. */
  apiKeyWorkspaceId?: string | null;
  /** Forwarded to {@link resolveHomeSpaceReach}, which does not branch on them; optional because
   *  feature contexts already carry them under these names. */
  source?: string | null;
  sessionId?: string | null;
}

/**
 * Where an id lives and the caller's standing there — an address, never row content. `name` is safe:
 * the caller supplied the id or the name. `containerRole` is carried so the follow-up read uses the
 * caller's real role, not a guess that would drop rows that role can see.
 */
export interface ResolvedResource {
  type: ResourceType;
  id: string;
  name: string;
  containerId: string;
  containerName: string;
  containerKind: string;
  /** Did this caller create the row? An authorisation input, not a label: lending needs it
   *  (`shared/grants/service.ts › assertGrantableResource`). Compared against a nullable owner
   *  column, so an orphaned row (owner SET NULL) fails closed. */
  ownedByCaller: boolean;
  containerRole: Role;
}

/** Resolve one id to its container. `null` = not nameable by you — no such row, someone else's
 *  private row, or outside your lock — one answer, deliberately. */
export async function resolveResource(
  caller: ResourceCaller,
  type: ResourceType,
  id: string
): Promise<ResolvedResource | null> {
  const [row] = await findResources(caller, type, { id });
  return row ?? null;
}

/**
 * The name half of the same fence. Returns every match and picks none: names are not unique (a unique
 * index across a visibility boundary would leak a private row via a conflict error), so the caller
 * decides a tie. Case-insensitive exact match — the `ilike` argument is an escaped literal.
 */
export async function resolveResourcesByName(
  caller: ResourceCaller,
  type: ResourceType,
  name: string
): Promise<ResolvedResource[]> {
  return findResources(caller, type, { name });
}

/**
 * Containers the caller may name rows in → their role in each: clauses 1–3, decided only here.
 * `status='active'` is required: a pending or revoked membership is not one.
 */
async function listContainersForCaller(
  caller: ResourceCaller
): Promise<Map<string, Role>> {
  const db = supabaseAdmin();
  let query = db
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", caller.userId)
    .eq("status", "active");
  // Clause 3, the container axis: narrows the candidate set only. Which rows inside it are visible
  // is clause 1's subject axis — reading one off the other is F-333/F-336.
  if (caller.apiKeyWorkspaceId) {
    query = query.in(
      "workspace_id",
      await lockedCandidates(caller, caller.apiKeyWorkspaceId)
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    workspace_id: string;
    role: Role;
  }>;
  const containers = new Map<string, Role>();
  for (const row of rows) {
    if (!meetsMinRole(row.role, CONTAINER_READ_FLOOR)) continue;
    containers.set(row.workspace_id, row.role);
  }
  return containers;
}

/**
 * Containers a locked credential may still name rows in: its lock, plus the operator's personal
 * container when `home-space-reach.ts` answers open. Widens by exactly one container, inside the same
 * `workspace_members` read, so clauses 2 and 4 still apply and every other container stays fenced.
 * A closed answer stays `[lock]`, never a refusal, so the id takes the ordinary 404 path.
 */
async function lockedCandidates(
  caller: ResourceCaller,
  lockedWorkspaceId: string
): Promise<string[]> {
  const reach = await resolveHomeSpaceReach({
    userId: caller.userId,
    credentialSubjectUserId: caller.credentialSubjectUserId,
    // The room is the lock: a DB fact off the token row, never a header or the container asked about.
    workspaceId: lockedWorkspaceId,
    source: caller.source,
    sessionId: caller.sessionId,
  });
  return reach.kind === "open" && reach.containerId !== lockedWorkspaceId
    ? [lockedWorkspaceId, reach.containerId]
    : [lockedWorkspaceId];
}

/**
 * The one query: clause 4 is the `.or()`, clauses 1–3 the guard and the `.in()`. The
 * `workspaces!inner` embed is child→parent by FK, not the join `app/api/user/delete/route.ts` warns
 * about. Filters are pinned un-mocked only in `resolve-resource.test.ts`.
 */
async function findResources(
  caller: ResourceCaller,
  type: ResourceType,
  ref: { id: string } | { name: string }
): Promise<ResolvedResource[]> {
  // Clause 1: a shared credential never even queries.
  if (isSharedCredential(caller)) return [];
  const containers = await listContainersForCaller(caller);
  if (containers.size === 0) return [];
  const spec = RESOURCE_TABLES[type];
  const db = supabaseAdmin();
  let query = db
    .from(spec.table)
    .select(selectList(spec))
    .in("workspace_id", [...containers.keys()])
    .or(`${spec.ownerColumn}.eq.${orLiteral(caller.userId)},${spec.sharedArm}`);
  // A trashed row is on no list, so naming it would break clause 4 and leak its address.
  if (spec.deletedColumn) query = query.is(spec.deletedColumn, null);
  query =
    "id" in ref
      ? query.eq("id", ref.id)
      : query.ilike(spec.nameColumn, escapeLikeLiteral(ref.name));
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ResourceRow[];
  if (rows.length > 0 || !("id" in ref)) {
    return rows.map((row) =>
      toResolved(type, spec, row, containers, caller.userId)
    );
  }
  return findGrantedResource(caller, type, spec, ref.id);
}

/** A grantee holds no membership in the row's container, so {@link toResolved} takes its
 *  fail-closed role floor. */
const NO_MEMBERSHIPS: ReadonlyMap<string, Role> = new Map();

/**
 * Clause 4's third arm: a row lent to a scope the caller is in is nameable (F-662), matching
 * `dopl_grant_admits()` inside `dopl_knowledge_base_readable()` / `can_current_user_read_agent_identity()`
 * and `canSeeBase` / `canSeeIdentity`. A second query, because a grantee fails the container `.in()`
 * and both `.or()` arms by construction. Id only, on a miss — a name is not a global handle.
 * Not an oracle: `grantedResourceIds` answers from the caller's own memberships, so an ungranted id
 * reads no row.
 */
async function findGrantedResource(
  caller: ResourceCaller,
  type: ResourceType,
  spec: ResourceTable,
  id: string
): Promise<ResolvedResource[]> {
  const granted = await grantedResourceIds(caller.userId, type, [id]);
  if (!granted.has(id)) return [];
  // No container filter and no `.or()`: the grant is the standing. The soft-delete filter stays —
  // a trashed row is listable by nobody, grantee included.
  let query = supabaseAdmin()
    .from(spec.table)
    .select(selectList(spec))
    .eq("id", id);
  if (spec.deletedColumn) query = query.is(spec.deletedColumn, null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as ResourceRow[]).map((row) =>
    toResolved(type, spec, row, NO_MEMBERSHIPS, caller.userId)
  );
}

/** The row `select` asks for. Supabase may type the 1:1 embed as an array; {@link toResolved}
 *  flattens it. */
interface ResourceRow {
  id: string;
  name: string;
  workspace_id: string;
  workspace:
    | { name: string; kind: string }
    | Array<{ name: string; kind: string }>;
  /** The owner column; its name differs per table, so it is read via `spec.ownerColumn`. */
  [ownerColumn: string]: unknown;
}

function selectList(spec: ResourceTable): string {
  return [
    "id",
    // Always aliased, so `chats.title` and every `name` share one row shape.
    `name:${spec.nameColumn}`,
    "workspace_id",
    // Projected for `ownedByCaller` only, never for a DTO.
    spec.ownerColumn,
    "workspace:workspaces!inner(name, kind)",
  ].join(", ");
}

function toResolved(
  type: ResourceType,
  spec: ResourceTable,
  row: ResourceRow,
  containers: ReadonlyMap<string, Role>,
  callerUserId: string
): ResolvedResource {
  const container = Array.isArray(row.workspace)
    ? row.workspace[0]
    : row.workspace;
  return {
    type,
    id: row.id,
    name: row.name,
    containerId: row.workspace_id,
    // Never `undefined` in a refusal, never a guessed kind: blank and `standard` claim the least.
    containerName: container?.name ?? "",
    containerKind: container?.kind ?? "standard",
    // A null on either side is not evidence of ownership, so it never passes.
    ownedByCaller: row[spec.ownerColumn] === callerUserId,
    // Present for member lookups (the row came from `.in()` over this map); `viewer` is the
    // fail-closed floor otherwise, including for a grantee.
    containerRole: containers.get(row.workspace_id) ?? CONTAINER_READ_FLOOR,
  };
}

/** `%`, `_` and `\` are literals in a name; unescaped, a caller's `%` would match anything. */
function escapeLikeLiteral(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * Quote a value for a raw `.or()` filter string, where `,` `.` `)` would change the query's shape.
 * This clause is the tenancy fence, so it is escaped where written even though a UUID cannot carry
 * them. Quoted, not stripped — stripping would resolve a different row.
 */
function orLiteral(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
