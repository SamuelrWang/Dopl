import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  isSharedCredential,
  type LockedCredentialLike,
} from "@/shared/auth/credential-audience";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * 🔒 **AN ID RESOLVES ITS OWN TENANCY** — the one read in the tree that looks
 * across containers, and the thing that makes `workspace=` unnecessary on a
 * read rather than merely ignorable.
 *
 * ⚠ **GENERALISED OUT OF `features/agent-templates/server/repository-tenancy.ts`
 * ON 2026-09-02.** That file was the "ONE CONSUMER" tenancy repository behind
 * the "it lives elsewhere" refusal (T35): it could say WHERE a ref lived but the
 * read could not GO there, so the product grew a classifier, three label shapes,
 * a desktop duck-type and an MCP doctrine paragraph to explain a miss. The query
 * is the same query; what changed is that its answer is now an ADDRESS a read
 * follows instead of a sentence a human reads.
 *
 * ── 🔒 THE FENCE, WHICH IS THE WHOLE MODULE ───────────────────────────────
 *
 * `supabaseAdmin()` bypasses RLS, so the four clauses below ARE the fence and
 * they must be read together. A row is nameable here only when ALL of:
 *   1. **the caller is somebody.** A SHARED credential (one that may be passed
 *      between humans) resolves NOTHING — it inherits no one person's reach.
 *      Arm 2 of every `canSee*` predicate, restated rather than re-decided.
 *   2. **the container is one the caller ACTIVELY belongs to**, at or above
 *      {@link CONTAINER_READ_FLOOR}. A pending invitation is not a membership
 *      and a revoked one is not either.
 *   3. **the credential's own workspace lock**, when it carries one — a locked
 *      credential resolves inside its lock and nowhere else (§4 layer B1). ⚠
 *      This module NARROWS on the lock; it never widens and never removes it.
 *   4. **the caller could already list the row for themselves** — `created_by`
 *      is the caller, or the row is visible to every member of its container.
 *
 * ⚠ **CLAUSE 4 IS WHY THIS IS NOT AN EXISTENCE ORACLE.** Another member's
 * private (or team-scoped) row matches neither arm in any container, so no
 * answer built on this read can name one, and probing an id you do not own
 * returns exactly what a nonexistent id returns: `null`. That is the property
 * the 404-never-403 surface is built on, not a side effect of the query.
 *
 * ⚠ **RESOLUTION IS NOT AUTHORISATION.** It is strictly NARROWER than any
 * feature's visibility matrix (it cannot see a team-scoped row an admin can), so
 * a caller must still put the row through that matrix in the container this
 * answers. Two fences, in that order; neither is sufficient alone.
 *
 * ⚠ **NO FALLBACK ACROSS TENANCY.** One query, one answer. An id lookup never
 * degrades into a name lookup, and a name lookup never picks — both would make
 * "no such id" and "no such name" answer through each other.
 */

/**
 * The resources whose ids resolve. ⚠ **ONE ENTRY IS THE PILOT, ON PURPOSE**
 * (spec §Wave A / A12): agent templates only. Adding `knowledge_base` and
 * `skill` is a row in {@link RESOURCE_TABLES} and their read paths — not a
 * second resolver.
 */
export type ResourceType = "agent_template";

/**
 * What each resource's table calls the two columns the fence reads.
 *
 * ⚠ `sharedVisibility` DIFFERS PER RESOURCE and that is the reason this is a
 * table rather than a constant: templates say `workspace`, knowledge bases and
 * skills say `public`, for the same "every member of the container" meaning.
 * ⚠ `shelfColumn` is `null` where the table has no personal-shelf flag.
 */
interface ResourceTable {
  table: string;
  ownerColumn: string;
  sharedVisibility: string;
  shelfColumn: string | null;
}

const RESOURCE_TABLES: Record<ResourceType, ResourceTable> = {
  agent_template: {
    table: "agent_templates",
    ownerColumn: "created_by",
    sharedVisibility: "workspace",
    shelfColumn: "home_scoped",
  },
};

/**
 * 🔒 The membership floor a container must clear before its rows are nameable.
 *
 * ⚠ `guest` RANKS BELOW IT AND THAT IS THE POINT. Every resource route in the
 * product sits at `withWorkspaceAuth`'s `viewer` floor, so a guest cannot read
 * these rows in their own container — resolving ids there would be a door under
 * that floor rather than an extra fact.
 */
const CONTAINER_READ_FLOOR: Role = "viewer";

/** The two credential facts the fence reads, plus who is behind it. Structural
 *  on purpose: every feature context already satisfies it without importing
 *  this module. */
export interface ResourceCaller extends LockedCredentialLike {
  userId: string;
}

/**
 * WHERE an id lives, and the caller's standing there — an ADDRESS, never row
 * content.
 *
 * ⚠ `name` IS THE ONE EXCEPTION and it earns it: a caller who resolved by id
 * has not been told anything (they named it), and a caller who resolved by name
 * supplied it. It is what lets a refusal say *which* row without a second read.
 * ⚠ `containerRole` IS CARRIED SO THE READ THAT FOLLOWS IS THE SAME READ. A
 * caller re-based into the resolved container with a guessed role would silently
 * lose the rows their real role can see (a team-scoped attachment, a sharing
 * set) — the same read answering two ways depending on which door it came
 * through is the confusion this whole slice removes.
 */
export interface ResolvedResource {
  type: ResourceType;
  id: string;
  name: string;
  containerId: string;
  containerName: string;
  containerKind: string;
  /** The personal-shelf flag, `false` for tables that have none. ⚠ A LABEL
   *  INPUT — never projected onto a DTO. */
  homeScoped: boolean;
  containerRole: Role;
}

/**
 * 🔒 **RESOLVE ONE ID TO THE CONTAINER IT LIVES IN.** `null` = "not nameable by
 * you", which covers "no such row", "somebody else's private row" and "outside
 * your lock" as ONE answer, deliberately.
 *
 * ⚠ At most one row can match: an id is a primary key and is globally unique,
 * which is the property that makes `workspace=` redundant on a read.
 */
export async function resolveResource(
  caller: ResourceCaller,
  type: ResourceType,
  id: string
): Promise<ResolvedResource | null> {
  const [row] = await findResources(caller, type, { id });
  return row ?? null;
}

/**
 * The NAME half of the same fence — every clause identical, many answers
 * possible.
 *
 * ⚠ **IT RETURNS THEM ALL AND PICKS NONE.** Names are not unique (a unique
 * index across a visibility boundary would leak a private row's existence
 * through a conflict error), so the caller decides what a tie means: the launch
 * lane refuses and lists, the "it lives elsewhere" label takes one
 * deterministically. A pick made here would make both of those a lie.
 *
 * ⚠ MATCHING IS CASE-INSENSITIVE **EXACT**, never a prefix or a pattern: the
 * `ilike` argument is an escaped literal, so a `%` in a caller-supplied name
 * matches a `%` and not "anything".
 */
export async function resolveResourcesByName(
  caller: ResourceCaller,
  type: ResourceType,
  name: string
): Promise<ResolvedResource[]> {
  return findResources(caller, type, { name });
}

/**
 * Containers the caller may name rows in → their role in each. Clauses 1–3 of
 * the fence, and the ONLY place they are decided.
 *
 * ⚠ `status='active'` — `workspaces/server/repository.ts › findMembership`
 * carries the scar of omitting it (a removed admin still measured as one).
 * ⚠ `workspace_members` is read here rather than imported from
 * `features/workspaces`: §1 forbids the cross-feature import and this is two
 * columns of one table. The same argument `listTeamIdsForUser` makes.
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
  // 🔒 Clause 3. The lock is a WORKSPACE fence and is applied as one — it
  // narrows the candidate set and answers nothing about which rows inside it
  // the caller may see (F-333/F-336: that conflation is the defect).
  if (caller.apiKeyWorkspaceId) {
    query = query.eq("workspace_id", caller.apiKeyWorkspaceId);
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
 * THE ONE QUERY. Clause 4 is the `.or()`; clauses 1–3 are the guard and the
 * `.in()` above it.
 *
 * ⚠ **THE `workspaces!inner` EMBED IS THE CHILD→PARENT DIRECTION AND IS NOT THE
 * ONE `app/api/user/delete/route.ts` WARNS ABOUT** (asked and answered
 * 2026-09-02). That note is about joining OUT of `workspaces` after the May 2026
 * denormalizations; this embeds a row's own parent by FK — the identical shape
 * `workspaces/server/repository.ts › listWorkspacesForUser` and
 * `home/server/repository-containers.ts › listLinkContainers` run on every
 * workspace list in the product. Query shape pinned, un-mocked, in
 * `resolve-resource.test.ts`; every service suite above it mocks this module, so
 * that file is the only thing that ever asserts a filter here.
 */
async function findResources(
  caller: ResourceCaller,
  type: ResourceType,
  ref: { id: string } | { name: string }
): Promise<ResolvedResource[]> {
  // 🔒 Clause 1, and it costs nothing: a shared credential never even asks.
  if (isSharedCredential(caller)) return [];
  const containers = await listContainersForCaller(caller);
  if (containers.size === 0) return [];
  const spec = RESOURCE_TABLES[type];
  const db = supabaseAdmin();
  let query = db
    .from(spec.table)
    .select(selectList(spec))
    .in("workspace_id", [...containers.keys()])
    .or(
      `${spec.ownerColumn}.eq.${caller.userId},visibility.eq.${spec.sharedVisibility}`
    );
  query =
    "id" in ref
      ? query.eq("id", ref.id)
      : query.ilike("name", escapeLikeLiteral(ref.name));
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ResourceRow[];
  return rows.map((row) => toResolved(type, spec, row, containers));
}

/** The row shape `select` asks for. ⚠ Supabase types a 1:1 embed as an array;
 *  the flatten below goes through `unknown` exactly as
 *  `workspaces/server/repository.ts › listWorkspacesForUser` does. */
interface ResourceRow {
  id: string;
  name: string;
  workspace_id: string;
  workspace:
    | { name: string; kind: string }
    | Array<{ name: string; kind: string }>;
  [shelfColumn: string]: unknown;
}

function selectList(spec: ResourceTable): string {
  return [
    "id",
    "name",
    "workspace_id",
    spec.shelfColumn,
    "workspace:workspaces!inner(name, kind)",
  ]
    .filter((column): column is string => column !== null)
    .join(", ");
}

function toResolved(
  type: ResourceType,
  spec: ResourceTable,
  row: ResourceRow,
  containers: Map<string, Role>
): ResolvedResource {
  const container = Array.isArray(row.workspace)
    ? row.workspace[0]
    : row.workspace;
  return {
    type,
    id: row.id,
    name: row.name,
    containerId: row.workspace_id,
    // ⚠ Never `undefined` into a rendered refusal, and never a guessed `link`:
    // a blank name and `standard` are the answers that claim the least.
    containerName: container?.name ?? "",
    containerKind: container?.kind ?? "standard",
    // ⚠ `=== true`, so a null column is FALSE rather than truthy-unknown.
    homeScoped: spec.shelfColumn !== null && row[spec.shelfColumn] === true,
    // ⚠ Non-null by construction: the row's container came out of `.in()` over
    // this very map. `viewer` is the fail-closed floor if that ever stops
    // holding.
    containerRole: containers.get(row.workspace_id) ?? CONTAINER_READ_FLOOR,
  };
}

/** `%`, `_` and `\` are LITERALS in a name. Unescaped, a caller-supplied `%`
 *  turns an exact match into "anything". */
function escapeLikeLiteral(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
