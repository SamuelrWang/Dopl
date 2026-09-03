import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  isSharedCredential,
  type CredentialAxes,
} from "@/shared/auth/credential-audience";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { findPersonalContainerId } from "./personal-container";
import { grantedResourceIds } from "./resource-grant-reach";

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
 *      credential resolves inside its lock, **plus its own operator's PERSONAL
 *      container**, and nowhere else (§4 layer B1 + rulings B10/#18). ⚠ This
 *      module NARROWS on the lock; it never widens it past that one container
 *      and never removes it. See {@link lockedCandidates}.
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
 * The resources whose ids resolve. ⚠ **A12 SHIPPED ONE ENTRY AS A PILOT; B2
 * COMPLETED THE SET** (2026-09-02). Everything an id can name on a read is a row
 * in {@link RESOURCE_TABLES} — adding a fifth is a row and a read path, never a
 * second resolver.
 */
export type ResourceType =
  | "agent_template"
  | "knowledge_base"
  | "skill"
  | "chat";

/**
 * What each resource's table calls the columns the fence reads. ⚠ **EVERY FIELD
 * IS A CONSTANT WRITTEN HERE**; none of it is ever caller-supplied, which is
 * what makes {@link ResourceTable.sharedArm} safe to interpolate raw.
 *
 * ⚠ `nameColumn` — `chats` calls it `title`. The select ALIASES it back to
 * `name` so one row shape serves every type.
 * ⚠ `sharedArm` is a POSTGREST FILTER FRAGMENT, not a value, and that is the
 * reason it is a fragment: "visible to every member of the container" is ONE
 * column on `agent_templates` (`visibility = 'workspace'`) and TWO everywhere
 * else — a `public` base/skill/chat in `access_mode = 'teams'` is visible to the
 * GRANTED TEAMS and not to the container, so naming it here would widen clause 4
 * into the existence oracle the clause exists to close.
 * ⚠ `deletedColumn` is `null` where a delete is a `DELETE`. A soft-deleted row
 * is not listable by anyone, so it must not be nameable either — otherwise an id
 * resolves a container for a row every read path skips.
 */
interface ResourceTable {
  table: string;
  ownerColumn: string;
  nameColumn: string;
  sharedArm: string;
  deletedColumn: string | null;
}

/** The "every member of the container may read it" arm for the three tables
 *  that carry `access_mode`. ⚠ BOTH halves are required — see
 *  {@link ResourceTable.sharedArm}. */
const SHARED_WITH_CONTAINER =
  "and(visibility.eq.public,access_mode.eq.workspace)";

const RESOURCE_TABLES: Record<ResourceType, ResourceTable> = {
  agent_template: {
    table: "agent_templates",
    ownerColumn: "created_by",
    nameColumn: "name",
    // ⚠ `agent_templates` has no `access_mode`: its third value IS `team`, so
    // the team scope is already outside this arm rather than hidden inside it.
    sharedArm: "visibility.eq.workspace",
    // ⚠ No soft delete — `20260822200000_agent_templates.sql`: "A delete is a
    // `DELETE`, and both junctions go with it".
    deletedColumn: null,
  },
  knowledge_base: {
    table: "knowledge_bases",
    ownerColumn: "created_by",
    nameColumn: "name",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
  skill: {
    table: "skills",
    ownerColumn: "created_by",
    nameColumn: "name",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
  chat: {
    table: "chats",
    ownerColumn: "owner_id",
    // ⚠ A chat's label is its `title`; there is no `name` column to fall back
    // on, so the alias in {@link selectList} is load-bearing rather than tidy.
    nameColumn: "title",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
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

/** The two credential AXES the fence reads (clauses 1 and 3), plus who is
 *  asking. Structural on purpose: every feature context already satisfies it
 *  without importing this module. */
export interface ResourceCaller extends CredentialAxes {
  userId: string;
  /** WHICH CONTAINER the credential is fenced to (`mcp_tokens.container_id`);
   *  `null`/absent = unfenced. Clause 3 narrows on it and never widens. */
  apiKeyWorkspaceId?: string | null;
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
  /**
   * 🔒 **DID THIS CALLER CREATE THE ROW?** ⚠ **REPLACED `homeScoped` ON
   * 2026-09-02 (slice B15)**, when the `home_scoped` column was dropped and the
   * personal shelf became a CONTAINER (`containerKind === "personal"`) rather
   * than a boolean beside one.
   *
   * ⚠ **IT IS AN AUTHORISATION INPUT, NOT A LABEL, AND IT IS THE ONE FIELD HERE
   * THAT IS.** `resolveResource` answers what the caller may NAME; lending a row
   * to somebody else needs the narrower question, and the copy ops' R2 fence
   * (`copy-target.ts › notOwnedRefusal`, deleted with them) is where it comes
   * from. ⚠ `=== true` against a NULLABLE owner column, so a row whose author
   * left the workspace (`created_by` is `SET NULL`) fails closed.
   */
  ownedByCaller: boolean;
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
  // 🔒 Clause 3, the CONTAINER axis. It is a tenancy fence and is applied as
  // one — it narrows the candidate set and answers nothing about which rows
  // inside it the caller may see. That second question is clause 1's SUBJECT
  // axis (F-333/F-336: reading one off the other is the defect).
  if (caller.apiKeyWorkspaceId) {
    query = query.in(
      "workspace_id",
      await lockedCandidates(caller.apiKeyWorkspaceId, caller.userId)
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
 * 🔒 **THE CONTAINERS A LOCKED CREDENTIAL MAY STILL NAME ROWS IN: ITS LOCK, AND
 * THE OPERATOR'S OWN PERSONAL CONTAINER** (found in the 1.26.0 smoke).
 *
 * ⚠ The clause narrowed to the lock ALONE, so an agent on a home channel's
 * `container_session` credential answered `base_not_found` for a base on its own
 * operator's shelf — against the ruling the shelf-as-a-tenancy exists to serve
 * (B10 / #18): *"what lets a personal template or KB be used from ANY container
 * the user is in — the id resolves its own container."* While the shelf was a
 * `WHERE` inside a workspace the operator was already in, the lock never had to
 * name it; the moment it became a CONTAINER, the lock fenced the operator out of
 * their own notes.
 *
 * ⚠ **IT WIDENS BY EXACTLY ONE CONTAINER, WHICH IS WHY IT IS A LIST AND NOT A
 * SECOND QUERY.** The ids go into the SAME `workspace_members` read, so clause 2
 * still decides and clause 4 still refuses; every OTHER container stays fenced.
 * ⚠ **A SHARED CREDENTIAL REACHES THIS NOWHERE, AND CLAUSE 1 IS WHY** — it
 * points at no one person's shelf, so {@link findResources} has already returned
 * `[]`. Restating the refusal here would be a second copy of the arm the two
 * axes exist to keep apart (F-333/F-336).
 * ⚠ ONE INDEXED PROBE (`workspaces_personal_owner_uidx`), on the LOCKED lane
 * only: an unfenced credential never asks.
 */
async function lockedCandidates(
  lockedWorkspaceId: string,
  userId: string
): Promise<string[]> {
  const personal = await findPersonalContainerId(userId);
  return personal === null || personal === lockedWorkspaceId
    ? [lockedWorkspaceId]
    : [lockedWorkspaceId, personal];
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
    .or(`${spec.ownerColumn}.eq.${orLiteral(caller.userId)},${spec.sharedArm}`);
  // 🔒 A TRASHED ROW IS NOT NAMEABLE. It is absent from every list the caller
  // could run, so naming it would break clause 4 in the one direction nothing
  // else notices — the read that follows this address finds nothing and 404s,
  // and the ADDRESS is what leaked.
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

/** ⚠ A grantee holds no membership of the row's container, so the map they are
 *  resolved against is empty and {@link toResolved} takes its fail-closed floor.
 *  Shared and frozen — it is the same empty answer every time. */
const NO_MEMBERSHIPS: ReadonlyMap<string, Role> = new Map();

/**
 * 🔒 **A ROW LENT TO A SCOPE THE CALLER IS IN IS NAMEABLE BY THEM — CLAUSE 4's
 * THIRD ARM** (F-662).
 *
 * ⚠ **THE TS SIDE WAS THE NARROW HALF, SO THIS IS A REPAIR AND NOT A WIDENING.**
 * `dopl_grant_admits()` has been an arm of `dopl_knowledge_base_readable()` and
 * `can_current_user_read_agent_template()` since `20260923140000`, and
 * `canSeeBase` / `canSeeTemplate` carry the same arm — policy and matrix both
 * admitted a lent row while the NAMING lane refused it.
 * `resource-grant-reach.ts` recorded the gap in its own header.
 *
 * ⚠ **A SECOND QUERY, NOT A THIRD ARM ON THE FIRST.** A grantee fails the
 * container `.in()` AND both `.or()` arms by construction, so an arm inside that
 * group is unreachable — the mistake `20260923140000` §3b had to undo on the
 * knowledge child policies.
 * ⚠ **ON A MISS, AND FOR AN ID ONLY.** A name is not a global handle, and an id
 * lookup that degraded into a name lookup is the fallback this module forbids.
 * 🔒 **NOT AN EXISTENCE ORACLE**: `grantedResourceIds` answers from the CALLER's
 * own memberships, so an ungranted id returns `null` with no read of the row.
 */
async function findGrantedResource(
  caller: ResourceCaller,
  type: ResourceType,
  spec: ResourceTable,
  id: string
): Promise<ResolvedResource[]> {
  const granted = await grantedResourceIds(caller.userId, type, [id]);
  if (!granted.has(id)) return [];
  // ⚠ NO CONTAINER FILTER AND NO `.or()`: the grant IS the standing, and both
  // of those are the fence the grant is reached AROUND. The soft-delete filter
  // stays — a trashed row is listable by nobody, grantee included.
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
  /** ⚠ The OWNER column, whose NAME differs per table (`created_by` /
   *  `owner_id`), so it is read through `spec.ownerColumn` rather than declared. */
  [ownerColumn: string]: unknown;
}

function selectList(spec: ResourceTable): string {
  return [
    "id",
    // ⚠ ALIASED, ALWAYS. `name:name` is the identity case and is written the
    // same way as `name:title` so no reader has to check which table is which.
    `name:${spec.nameColumn}`,
    "workspace_id",
    // 🔒 PROJECTED FOR THE OWNERSHIP ANSWER, never for a DTO — see
    // `ResolvedResource.ownedByCaller`.
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
    // ⚠ Never `undefined` into a rendered refusal, and never a guessed `link`:
    // a blank name and `standard` are the answers that claim the least.
    containerName: container?.name ?? "",
    containerKind: container?.kind ?? "standard",
    // ⚠ Both halves may be null (an unattributed row, an unresolved caller) and
    // neither is evidence of ownership, so neither passes.
    ownedByCaller: row[spec.ownerColumn] === callerUserId,
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

/**
 * A value going into a RAW `.or()` filter string, quoted.
 *
 * ⚠ **THE NAME PATH ESCAPED AND THE ID PATH DID NOT, WHICH IS THE ASYMMETRY THIS
 * REMOVES** (2026-09-02). `.or()` takes a filter STRING that PostgREST parses:
 * `,` splits the arms, `.` splits column-operator-value, and `)` closes a group,
 * so a value carrying any of them changes the query's SHAPE rather than its
 * subject. `caller.userId` is a `auth.users` UUID today and cannot carry one —
 * which is a fact about the CALLER, not about this function, and it is the kind
 * of fact that changes when an id type does. The clause it sits in is the
 * tenancy fence, so it is escaped where it is written and not where it is
 * proved.
 *
 * ⚠ DOUBLE-QUOTED, not stripped: PostgREST reads a quoted value literally, and
 * dropping characters would silently resolve a DIFFERENT row.
 */
function orLiteral(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}
