import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceWithRole,
  Role,
} from "../types";
import { isStandardWorkspace } from "../types";
import {
  type WorkspaceMemberRow,
  type WorkspaceRow,
  mapWorkspaceRow,
  mapMemberRow,
} from "./dto";

/**
 * ⚠ EXPLICIT AGAIN (2026-08-24), and the star it replaces was a DATED EXPIRY
 * rather than a lapse: `kind` shipped in `20260823150000_home_link_channels`,
 * naming a nonexistent column in a PostgREST select is a 42703 ERROR rather
 * than a null, so `*` was the only safe spelling while that migration was
 * unapplied. It has applied — the measurement is `supabase migration list` /
 * MCP `list_migrations`, where the NAME matches and the version is re-stamped
 * (INVARIANTS §12) — so the expiry is discharged here and §9's list-reads-select-
 * columns rule holds again with nothing carved out of it.
 *
 * ⚠ NO query filters on `kind` even now: every kind filter in this feature runs
 * in CODE, through `isStandardWorkspace`, so there is one predicate to read.
 */
const WORKSPACE_COLS =
  "id, owner_id, name, slug, public_id, description, icon_url, kind, created_at, updated_at";
const MEMBER_COLS =
  "workspace_id, user_id, role, status, joined_at, invited_by, invited_at, last_seen_at";

export async function findWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select(WORKSPACE_COLS)
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkspaceRow(data as WorkspaceRow) : null;
}

/**
 * Primary routing lookup. `public_id` is globally unique, so no
 * owner/membership filter here — authz is `resolveMembershipOrThrow`.
 */
export async function findWorkspaceByPublicId(
  publicId: string
): Promise<Workspace | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select(WORKSPACE_COLS)
    .eq("public_id", publicId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkspaceRow(data as WorkspaceRow) : null;
}

/**
 * Membership-aware slug lookup — legacy slug-only URL fallback only.
 * ⚠ Returns null on zero OR 2+ matches: slug uniqueness is not enforced
 * post-publicId, so an ambiguous legacy URL must 404 rather than route to the
 * wrong workspace. Canonical `{slug}-{publicId}` URLs bypass this entirely.
 *
 * ⚠ **STANDARD KINDS ONLY (2026-09-02, F-561).** `link` and `personal`
 * containers are memberships with slugs too, and neither has ever had a URL of
 * this shape — counting them makes a real workspace's own legacy URL ambiguous
 * (2 matches → `null` → 404) whenever a hidden container beside it shares the
 * slug. `link` has carried that since `20260823150000`; `20260920120000` mints
 * a second such kind for every user. ⚠ POSITIVE form (§4A, F-295).
 */
export async function findMemberWorkspaceBySlug(
  userId: string,
  slug: string
): Promise<Workspace | null> {
  const memberships = await listWorkspacesForUser(userId);
  const matches = memberships
    .filter(isStandardWorkspace)
    .filter((c) => c.slug === slug);
  if (matches.length !== 1) return null;
  return matches[0];
}

/**
 * The answer to "which standard workspace does this person unambiguously own",
 * and the COUNT the ambiguity is judged from — one read, both facts.
 */
export interface SoleOwnedStandardWorkspace {
  /** The single owned standard workspace. `null` whenever `count !== 1`. */
  workspace: Workspace | null;
  /** How many STANDARD workspaces the user owns. `0` and `2+` both refuse. */
  count: number;
}

/**
 * The caller's SOLE owned standard workspace — **billing's question and only
 * billing's** (spec §7 answer (a), the one option that changes nobody's bill).
 *
 * 🔒 **THE DERIVED DEFAULT IS DELETED** (Samuel's ruling B10). This is what is
 * LEFT of the lookup that answered "the default": the legacy `slug='default'`
 * branch and the oldest-owned pick are gone, and what remains REFUSES rather
 * than guessing — the old shape picked the oldest of N and warned, and a wrong
 * guess there is a charge against a workspace nobody chose. `count` comes back
 * so a caller can name WHICH refusal (nothing to bill vs. too many) without a
 * second read.
 *
 * ⚠ TWO CALLERS, BOTH ABOUT MONEY — the Stripe grandfather path and the
 * container burn reroute. **Tenancy never calls it**: every "where am I" answer
 * is the caller's personal container.
 * ⚠ OWNERSHIP-based, diverging from active membership, and that is right for a
 * bill — the plan hangs off the owner. It MUST NOT be used for request auth.
 * ⚠ Containers are never candidates (neither kind carries a plan), through the
 * POSITIVE `isStandardWorkspace` (§4A, F-295).
 */
export async function findSoleOwnedStandardWorkspace(
  userId: string
): Promise<SoleOwnedStandardWorkspace> {
  // ⚠ No `.limit(1)`: the kind filter runs in code, so the rows read may hold
  // containers the count has to skip. The read is ceiling-bounded instead
  // (`OWNED_WORKSPACE_LIMIT`), and "sole" needs the count anyway.
  const owned = (await listWorkspacesOwnedBy(userId)).filter(isStandardWorkspace);
  return {
    workspace: owned.length === 1 ? owned[0] : null,
    count: owned.length,
  };
}

/**
 * Ceiling on the owned-workspace read below. ⚠ A CEILING, not a page: an
 * account owns a handful of real workspaces and one link container per
 * relationship, and 200 is the same order as `HOME_RELATIONSHIP_LIMIT` for the
 * same reason — containers are contacts, not a feed.
 */
const OWNED_WORKSPACE_LIMIT = 200;

/**
 * Every workspace owned by a user, oldest first. Kind filtering is the
 * caller's.
 *
 * ⚠ BOUNDED, and the ordering is what makes the bound safe: `created_at ASC`
 * means the ceiling drops the NEWEST rows, and the sole caller asks only "is
 * there exactly one standard row here?" — an account that owns 200 workspaces
 * is ambiguous under any prefix of them.
 *
 * ⚠ NOT a cold path: `findSoleOwnedStandardWorkspace` is on the MCP
 * credit-consume reroute, which runs once per tool call for every container
 * agent. An unbounded scan there is a per-call full read of one owner's
 * workspaces.
 */
async function listWorkspacesOwnedBy(userId: string): Promise<Workspace[]> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select(WORKSPACE_COLS)
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(OWNED_WORKSPACE_LIMIT);
  if (error) throw error;
  return ((data ?? []) as WorkspaceRow[]).map(mapWorkspaceRow);
}

export async function listWorkspacesForUser(userId: string): Promise<Workspace[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select(`workspace:workspaces!inner(${WORKSPACE_COLS})`)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  // ⚠ Supabase typings model nested joins as arrays even when 1:1; cast
  // through unknown to flatten the workspace object.
  const rows = (data ?? []) as unknown as Array<{ workspace: WorkspaceRow | WorkspaceRow[] }>;
  const workspaces: Workspace[] = [];
  for (const row of rows) {
    const c = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;
    if (c) workspaces.push(mapWorkspaceRow(c));
  }
  return workspaces.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * `listWorkspacesForUser` + the member's role, one query. ⚠ Active memberships
 * only — pending invitations don't count, revoked members excluded.
 *
 * ⚠ PLUS ONE bounded fan-out for `memberCount` (§9's rule: one `IN (ids)` query,
 * never per-row). The MCP directory lock needs to know whether each link
 * container is SOLO or SHARED at BOOT, and boot may not add a loopback per
 * workspace ({@link bootServer}'s own comment). See
 * {@link countActiveMembersByWorkspace} for why a failure there is not fatal.
 */
export async function listWorkspacesWithRoleForUser(
  userId: string
): Promise<WorkspaceWithRole[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select(`role, workspace:workspaces!inner(${WORKSPACE_COLS})`)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    role: Role;
    workspace: WorkspaceRow | WorkspaceRow[];
  }>;
  const out: WorkspaceWithRole[] = [];
  for (const row of rows) {
    const c = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;
    if (c) out.push({ ...mapWorkspaceRow(c), role: row.role });
  }
  const counts = await countActiveMembersByWorkspace(
    db,
    out.map((w) => w.id)
  );
  for (const w of out) {
    const n = counts.get(w.id);
    if (n !== undefined) w.memberCount = n;
  }
  return out.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * ACTIVE member counts for a bounded set of workspaces, folded in one query.
 *
 * ⚠ ROWS, NOT `count: "exact"`. PostgREST has no GROUP BY, so a per-workspace
 * exact count would be N round trips (`repository-overview.ts ›
 * countActiveMembers` is that shape, correctly, for ONE workspace). The rows
 * here are `(workspace_id)` only and the caller's own memberships bound the set,
 * so the fold is cheap and the read carries no member identity at all.
 *
 * ⚠ IT SWALLOWS ITS OWN FAILURE and answers an EMPTY MAP. A workspace with no
 * entry gets NO `memberCount` key, which every consumer reads as "unknown" and
 * the directory lock reads as NOT SOLO — narrowed, the fail-closed direction.
 * Throwing instead would take `GET /api/workspaces` down with it, and that route
 * is what the desktop's channel listener fans over (§4A): a count nobody can
 * read must not stop the app from knowing which channels to watch.
 */
async function countActiveMembersByWorkspace(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (workspaceIds.length === 0) return counts;
  const { data, error } = await db
    .from("workspace_members")
    .select("workspace_id")
    .in("workspace_id", workspaceIds)
    .eq("status", "active");
  if (error) return counts;
  for (const row of (data ?? []) as { workspace_id: string }[]) {
    counts.set(row.workspace_id, (counts.get(row.workspace_id) ?? 0) + 1);
  }
  return counts;
}

export async function findMembership(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembership | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select(MEMBER_COLS)
    // 🔒 `status='active'` (added 2026-08-26). THIS READ IS AN AUTHZ READ — its
    // callers compare `.role` against a floor (`service.ts ›
    // requireWorkspaceRole`, `home/server/service-writes.ts ›
    // mintContainerLink`) — and without the filter it happily returned a
    // `revoked` or `pending` row's role, so a removed admin still measured as
    // one. Every sibling read here gates on status; this one did not, and
    // nothing in its shape said so.
    .eq("status", "active")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMemberRow(data as WorkspaceMemberRow) : null;
}

/**
 * The workspace's ACTIVE OWNER — the `workspace_members` row at `role='owner'`,
 * not `workspaces.owner_id`. Used by the link-container billing reroute
 * (`billing/server/credits-service.ts › resolveBillingTarget`, §4A) to find the
 * OPERATOR who pays for a burn inside a container.
 *
 * ⚠ MEMBERSHIP IS THE SOURCE, AND THAT IS THE POINT: `workspaces.owner_id` is a
 * column nothing keeps in step with departures, while an active owner ROW is a
 * DB guarantee — `20260720184806_workspace_last_active_owner_guard.sql` (H-5)
 * RAISEs on the delete/demote that would leave a workspace with zero. So `null`
 * here means the workspace is gone, never that ownership merely drifted. Do NOT
 * add an `owner_id` fallback: a second mechanism is a second thing to drift.
 *
 * ⚠ NOT AN AUTHZ READ. It answers "who pays", never "who may". Ordered oldest
 * first so a workspace that somehow carries two owners answers deterministically
 * rather than by PostgREST's row order.
 */
export async function findActiveOwnerUserId(
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("role", "owner")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { user_id: string } | null)?.user_id ?? null;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMembership[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select(MEMBER_COLS)
    .eq("workspace_id", workspaceId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as WorkspaceMemberRow[]).map(mapMemberRow);
}

/**
 * `userId` → their WORKSPACE role, for a bounded set of users in one workspace.
 * Used by the channel roster to render a member's workspace-level standing (the
 * "Guest" pill, 2026-08-25) — the channel_members row only carries the
 * channel-scoped role (`owner`/`member`), never `guest`. ⚠ Bounded by the caller's
 * user-id list (§9): never the whole workspace. Absent/empty input → empty map.
 */
export async function listMemberRolesByUserIds(
  workspaceId: string,
  userIds: string[]
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (userIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("user_id, role")
    // ⚠ `status='active'` (added 2026-08-26) — every sibling read here gates on
    // it and this one did not. The consumer is the roster's "Guest" pill, so a
    // departed member's `revoked` row rendered their STALE role: a peer removed
    // from the container kept whatever pill they had, and a departed guest kept
    // reading as a guest beside a name that is no longer a member. An absent
    // entry maps `?? null` → "not a guest", which is the fail-safe answer.
    .eq("status", "active")
    .eq("workspace_id", workspaceId)
    .in("user_id", userIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ user_id: string; role: Role }>) {
    out.set(row.user_id, row.role);
  }
  return out;
}

export interface CreateWorkspaceArgs {
  ownerId: string;
  name: string;
  slug: string;
  description?: string | null;
}

export async function insertWorkspaceWithOwnerMembership(
  args: CreateWorkspaceArgs
): Promise<Workspace> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .insert({
      owner_id: args.ownerId,
      name: args.name,
      slug: args.slug,
      public_id: generatePublicId(),
      description: args.description ?? null,
    })
    .select(WORKSPACE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create workspace");
  const workspace = mapWorkspaceRow(data as WorkspaceRow);

  const { error: memberError } = await db.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: args.ownerId,
    role: "owner" as Role,
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) {
    // Roll back the workspace insert so no orphan is left.
    await db.from("workspaces").delete().eq("id", workspace.id);
    throw memberError;
  }
  return workspace;
}

/**
 * Race-proof SELECT-or-INSERT of the caller's PERSONAL CONTAINER via the
 * `ensure_personal_container` RPC (migration 20260920120000): a per-owner
 * advisory lock serializes concurrent callers so two cold boots cannot mint two
 * containers. `created` = THIS call made it.
 *
 * ⚠ TAKES ONLY AN OWNER, so it takes no `CreateWorkspaceArgs`: the name and
 * `created_at` are the DATABASE's, minted from the row this container replaces
 * (`personal_container_origin_of`, migration 20260922120000) so nothing is
 * invented, and the slug is the constant `personal`.
 *
 * ⚠ `kind` COMES BACK AND MUST. `mapWorkspaceRow` reads an ABSENT kind as
 * `standard` (§4A), which would put a personal container in the rail; the RPC
 * returns the column for exactly this reason.
 */
export async function ensurePersonalContainerRow(
  ownerId: string
): Promise<{ workspace: Workspace; created: boolean }> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("ensure_personal_container", {
    p_owner_id: ownerId,
    p_public_id: generatePublicId(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | (WorkspaceRow & { created: boolean })
    | undefined;
  if (!row) throw new Error("ensure_personal_container returned no row");
  return { workspace: mapWorkspaceRow(row), created: row.created };
}

export async function updateWorkspace(
  workspaceId: string,
  patch: {
    name?: string;
    slug?: string;
    description?: string | null;
    iconUrl?: string | null;
  }
): Promise<Workspace> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.iconUrl !== undefined) update.icon_url = patch.iconUrl;
  const { data, error } = await db
    .from("workspaces")
    .update(update)
    .eq("id", workspaceId)
    .select(WORKSPACE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update workspace");
  return mapWorkspaceRow(data as WorkspaceRow);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("workspaces").delete().eq("id", workspaceId);
  if (error) throw error;
}

export interface ProfileSummary {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Batch profile lookup for member-list hydration — one query, not a per-user
 * `auth.admin.getUserById` loop.
 */
export async function listProfileSummaries(
  userIds: string[]
): Promise<Map<string, ProfileSummary>> {
  const out = new Map<string, ProfileSummary>();
  if (userIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", userIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>) {
    out.set(row.id, {
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    });
  }
  return out;
}
