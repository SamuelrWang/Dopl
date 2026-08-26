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

export async function findWorkspaceBySlug(
  ownerId: string,
  slug: string
): Promise<Workspace | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select(WORKSPACE_COLS)
    .eq("owner_id", ownerId)
    .eq("slug", slug)
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
 */
export async function findMemberWorkspaceBySlug(
  userId: string,
  slug: string
): Promise<Workspace | null> {
  const memberships = await listWorkspacesForUser(userId);
  const matches = memberships.filter((c) => c.slug === slug);
  if (matches.length !== 1) return null;
  return matches[0];
}

/**
 * Oldest-owned STANDARD workspace: literal slug "default" (legacy), else oldest
 * by created_at ASC. ⚠ Link containers are never candidates — they carry no
 * plan and must not become anyone's default.
 *
 * ⚠ OWNERSHIP-based, diverging from active membership. THREE sanctioned uses:
 * the signup bootstrap (`ensureDefaultWorkspace`), the Stripe webhook
 * grandfather path, and the link-workspace billing reroute
 * (`billing/server/credits-service.ts`). MUST NOT be used for request auth —
 * `resolveActiveWorkspace` resolves off active memberships so an owned
 * workspace cannot swallow another's request.
 */
export async function findDefaultWorkspaceForUser(
  userId: string
): Promise<Workspace | null> {
  const legacy = await findWorkspaceBySlug(userId, "default");
  if (legacy && isStandardWorkspace(legacy)) return legacy;

  // ⚠ No `.limit(1)`: the kind filter runs in code, so the oldest row may be a
  // link container the pick has to skip. The read is ceiling-bounded instead
  // (`OWNED_WORKSPACE_LIMIT`).
  const owned = await listWorkspacesOwnedBy(userId);
  return owned.find(isStandardWorkspace) ?? null;
}

/**
 * STANDARD workspaces OWNED by a user. The Stripe webhook's grandfather path
 * uses this to detect ambiguous legacy-subscription mappings (2+ owned → warn);
 * link containers must not make an unambiguous mapping look ambiguous.
 */
export async function countWorkspacesOwnedBy(userId: string): Promise<number> {
  const owned = await listWorkspacesOwnedBy(userId);
  return owned.filter(isStandardWorkspace).length;
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
 * means the ceiling drops the NEWEST rows, and every caller wants the oldest —
 * `findDefaultWorkspaceForUser` reads `[0]` of the standard ones, so its answer
 * is identical with or without the limit. `countWorkspacesOwnedBy` only asks
 * "more than one?".
 *
 * ⚠ NOT a cold path any more: `findDefaultWorkspaceForUser` is on the MCP
 * credit-consume reroute, which runs once per tool call for every home-channel
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
  return out.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
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
 * Race-proof SELECT-or-INSERT of the default workspace via the
 * `ensure_default_workspace` RPC (migration 20260802200000): a per-owner
 * transaction-scoped advisory lock serializes concurrent callers so two cold
 * boots cannot double-create "Untitled". `created` = THIS call made it.
 */
export async function ensureDefaultWorkspaceRow(
  args: CreateWorkspaceArgs
): Promise<{ workspace: Workspace; created: boolean }> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("ensure_default_workspace", {
    p_owner_id: args.ownerId,
    p_name: args.name,
    p_slug: args.slug,
    p_public_id: generatePublicId(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | (WorkspaceRow & { created: boolean })
    | undefined;
  if (!row) throw new Error("ensure_default_workspace returned no row");
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
