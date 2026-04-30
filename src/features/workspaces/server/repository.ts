import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Workspace, WorkspaceMembership, Role } from "../types";
import {
  type WorkspaceMemberRow,
  type WorkspaceRow,
  mapWorkspaceRow,
  mapMemberRow,
} from "./dto";

const WORKSPACE_COLS = "id, owner_id, name, slug, description, created_at, updated_at";
const MEMBER_COLS =
  "workspace_id, user_id, role, status, joined_at, invited_by, invited_at";

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
 * Membership-aware slug lookup. Walks every workspace the user is an
 * active member of, returns the one whose slug matches. Used by the
 * workspace page + settings routes so invited members can reach a workspace
 * they don't own. Returns null if no membership-by-slug match.
 *
 * Slugs are unique per (owner, slug) — two different owners could each
 * have a workspace with the same slug (e.g. "default"). Users joining
 * workspaces from multiple owners would in principle hit a collision; we
 * resolve by preferring the workspace the caller themselves owns, then
 * fall back to the first non-owned membership match. Callers that need
 * stricter resolution should pass a workspace UUID, not slug, to the API.
 */
export async function findMemberWorkspaceBySlug(
  userId: string,
  slug: string
): Promise<Workspace | null> {
  const owned = await findWorkspaceBySlug(userId, slug);
  if (owned) return owned;
  const memberships = await listWorkspacesForUser(userId);
  return memberships.find((c) => c.slug === slug) ?? null;
}

/**
 * Default workspace resolver — every user has one workspace with slug='default'
 * (created by the P0 backfill). Returns null only if a brand-new user
 * predates the trigger that should create one for them on signup. Phase 1
 * code paths fall back to this when no `X-Workspace-Id` header is provided.
 */
export async function findDefaultWorkspaceForUser(
  userId: string
): Promise<Workspace | null> {
  return findWorkspaceBySlug(userId, "default");
}

export async function listWorkspacesForUser(userId: string): Promise<Workspace[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select(`workspace:workspaces!inner(${WORKSPACE_COLS})`)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  // Supabase typings model nested joins as arrays even when the join is
  // 1:1; cast through unknown so we can flatten the workspace object.
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
    // Roll back the workspace insert so we don't leave an orphan.
    await db.from("workspaces").delete().eq("id", workspace.id);
    throw memberError;
  }
  return workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  patch: { name?: string; slug?: string; description?: string | null }
): Promise<Workspace> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.description !== undefined) update.description = patch.description;
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
