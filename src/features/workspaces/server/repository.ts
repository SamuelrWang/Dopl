import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceOverviewCounts,
  WorkspaceWithRole,
  Role,
} from "../types";
import {
  type WorkspaceMemberRow,
  type WorkspaceRow,
  mapWorkspaceRow,
  mapMemberRow,
} from "./dto";

const WORKSPACE_COLS =
  "id, owner_id, name, slug, public_id, description, icon_url, created_at, updated_at";
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
 * Oldest-OWNED workspace resolver: literal slug "default" (legacy), else oldest
 * owned by created_at ASC.
 *
 * ⚠ OWNERSHIP-based, diverging from active membership. ONLY for the signup
 * bootstrap (`ensureDefaultWorkspace`) and the Stripe webhook grandfather path.
 * MUST NOT be used for request auth — `resolveActiveWorkspace` resolves off
 * active memberships so an owned workspace cannot swallow another's request.
 */
export async function findDefaultWorkspaceForUser(
  userId: string
): Promise<Workspace | null> {
  const legacy = await findWorkspaceBySlug(userId, "default");
  if (legacy) return legacy;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select(WORKSPACE_COLS)
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapWorkspaceRow(data as WorkspaceRow) : null;
}

/**
 * Workspaces OWNED by a user. The Stripe webhook's grandfather path uses this
 * to detect ambiguous legacy-subscription mappings (2+ owned → warn).
 */
export async function countWorkspacesOwnedBy(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) throw error;
  return count ?? 0;
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

/**
 * Head-counts for the overview stat cards: three parallel
 * `count: "exact", head: true` queries. Soft-deleted bases/skills excluded.
 * ⚠ A failed count is `null` from PostgREST and degrades to 0, never throws.
 */
export async function countWorkspaceResources(
  workspaceId: string
): Promise<WorkspaceOverviewCounts> {
  const db = supabaseAdmin();
  const count = (table: string, soft: boolean) => {
    let q = db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (soft) q = q.is("deleted_at", null);
    return q;
  };
  const [kb, sk, mem] = await Promise.all([
    count("knowledge_bases", true),
    count("skills", true),
    db
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  return {
    knowledgeBases: kb.count ?? 0,
    skills: sk.count ?? 0,
    members: mem.count ?? 0,
  };
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
