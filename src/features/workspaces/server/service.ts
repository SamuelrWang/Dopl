import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Workspace, WorkspaceMembership, Role } from "../types";
import { meetsMinRole } from "../types";
import { slugifyWorkspaceName } from "../slug";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import {
  deleteWorkspace,
  findWorkspaceById,
  findWorkspaceBySlug,
  findDefaultWorkspaceForUser,
  findMemberWorkspaceBySlug,
  findMembership,
  insertWorkspaceWithOwnerMembership,
  listWorkspacesForUser,
  listMembers,
  updateWorkspace,
} from "./repository";

export interface ResolvedMembership {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

/**
 * Authoritative auth lookup used by `withWorkspaceAuth`. Returns the workspace
 * + the caller's active membership, or throws an HttpError. Never returns
 * null — `404` is the cleanest response for both "not a member" and
 * "workspace does not exist" so existence isn't an oracle.
 */
export async function resolveMembershipOrThrow(
  workspaceId: string,
  userId: string
): Promise<ResolvedMembership> {
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  const membership = await findMembership(workspaceId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  return { workspace, membership };
}

/**
 * Resolve the active workspace for an authenticated request. Used by
 * `withWorkspaceAuth` — header takes priority, default workspace is the
 * fallback for during-rollout compatibility (Phase 1) and any UI that
 * hasn't been wired to send the header yet.
 */
export async function resolveActiveWorkspace(
  userId: string,
  headerWorkspaceId: string | null
): Promise<ResolvedMembership> {
  if (headerWorkspaceId) {
    return resolveMembershipOrThrow(headerWorkspaceId, userId);
  }
  const defaultWorkspace = await findDefaultWorkspaceForUser(userId);
  if (!defaultWorkspace) {
    // The P0 backfill creates one for every existing auth.users row;
    // a missing default workspace means a user signed up after the
    // backfill and the signup hook hasn't yet been added (Phase 2 work).
    // Auto-create one inline so the request can proceed.
    const created = await ensureDefaultWorkspace(userId);
    const membership = await findMembership(created.id, userId);
    if (!membership) {
      throw new HttpError(
        500,
        "WORKSPACE_BOOTSTRAP_FAILED",
        "Default workspace missing membership row"
      );
    }
    return { workspace: created, membership };
  }
  return resolveMembershipOrThrow(defaultWorkspace.id, userId);
}

/**
 * Idempotent: creates the user's default workspace if it doesn't exist yet.
 * Called from `resolveActiveWorkspace` and from signup hooks (Phase 2).
 *
 * Audit fix S-15: derives the slug via `slugifyWorkspaceName` instead
 * of hardcoding "default". Existing users with the legacy "default"
 * slug still resolve through `findDefaultWorkspaceForUser` (which
 * checks "default" first, then falls back to the user's oldest
 * workspace). New users get a kebab slug from the workspace name —
 * stays consistent with how rename / new-workspace flow already pick
 * slugs, and unblocks the future workspace-globally-unique migration
 * (audit finding S-4).
 *
 * Two concurrent calls for a brand-new user can both pass the existence
 * check and race to INSERT — the second hits the (owner_id, slug)
 * unique constraint and 500s. We catch that error code (Postgres 23505)
 * and re-read the row, returning whichever insert won.
 */
export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  const existing = await findDefaultWorkspaceForUser(userId);
  if (existing) return existing;
  const name = "My Workspace";
  const slug = slugifyWorkspaceName(name, []);
  try {
    return await insertWorkspaceWithOwnerMembership({
      ownerId: userId,
      name,
      slug,
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : null;
    if (code === "23505") {
      const winner = await findDefaultWorkspaceForUser(userId);
      if (winner) return winner;
    }
    throw err;
  }
}

export async function listMyWorkspaces(userId: string): Promise<Workspace[]> {
  return listWorkspacesForUser(userId);
}

export async function createWorkspaceForUser(
  userId: string,
  input: { name: string; description?: string | null }
): Promise<Workspace> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("workspaces")
    .select("slug")
    .eq("owner_id", userId);
  const taken = (existing ?? []).map((r) => (r as { slug: string }).slug);
  const slug = slugifyWorkspaceName(input.name, taken);
  return insertWorkspaceWithOwnerMembership({
    ownerId: userId,
    name: input.name,
    slug,
    description: input.description ?? null,
  });
}

export async function renameWorkspace(
  workspaceId: string,
  userId: string,
  patch: { name?: string; description?: string | null; slug?: string }
): Promise<Workspace> {
  const { workspace, membership } = await resolveMembershipOrThrow(workspaceId, userId);
  if (!meetsMinRole(membership.role, "admin")) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Only admins can edit workspace settings"
    );
  }

  const update: { name?: string; slug?: string; description?: string | null } = {};
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.name && patch.name !== workspace.name) update.name = patch.name;

  // Audit fix S-11: caller can override the slug explicitly. Validate
  // against the same rules slugifyWorkspaceName enforces — owner-scoped
  // uniqueness + RESERVED_WORKSPACE_SLUGS — so we surface a clean 4xx
  // instead of a Postgres 23505 on the (owner_id, slug) UNIQUE.
  // Owner-scoped slug list is loaded only once even if both branches
  // below need it.
  let slugTaken: string[] | null = null;
  const loadSlugTaken = async (): Promise<string[]> => {
    if (slugTaken !== null) return slugTaken;
    const db = supabaseAdmin();
    const { data: existing } = await db
      .from("workspaces")
      .select("slug")
      .eq("owner_id", workspace.ownerId)
      .neq("id", workspaceId);
    slugTaken = (existing ?? []).map((r) => (r as { slug: string }).slug);
    return slugTaken;
  };

  if (patch.slug && patch.slug !== workspace.slug) {
    const taken = await loadSlugTaken();
    if (taken.includes(patch.slug)) {
      throw new HttpError(
        409,
        "WORKSPACE_SLUG_TAKEN",
        `You already own a workspace with slug "${patch.slug}".`
      );
    }
    if (RESERVED_WORKSPACE_SLUGS.has(patch.slug)) {
      throw new HttpError(
        409,
        "WORKSPACE_SLUG_RESERVED",
        `"${patch.slug}" is reserved (collides with a top-level route).`
      );
    }
    update.slug = patch.slug;
  } else if (update.name) {
    // Name changed without an explicit slug override — re-derive.
    const taken = await loadSlugTaken();
    update.slug = slugifyWorkspaceName(update.name, taken);
  }

  if (Object.keys(update).length === 0) return workspace;
  return updateWorkspace(workspaceId, update);
}

export async function deleteWorkspaceForUser(
  workspaceId: string,
  userId: string
): Promise<void> {
  const { membership } = await resolveMembershipOrThrow(workspaceId, userId);
  if (membership.role !== "owner") {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Only the workspace owner can delete it"
    );
  }
  await deleteWorkspace(workspaceId);
}

export async function listWorkspaceMembers(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembership[]> {
  await resolveMembershipOrThrow(workspaceId, userId);
  return listMembers(workspaceId);
}

export function requireMinRole(role: Role, min: Role): void {
  if (!meetsMinRole(role, min)) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      `Requires ${min} role or higher`
    );
  }
}

export function findWorkspaceBySlugForUser(
  ownerId: string,
  slug: string
): Promise<Workspace | null> {
  return findWorkspaceBySlug(ownerId, slug);
}

/**
 * Membership-aware slug lookup — finds a workspace the user can access
 * regardless of ownership. Used by `/workspace/[slug]` and the settings
 * page so invited members reach the workspace via its public URL.
 */
export function findWorkspaceForMember(
  userId: string,
  slug: string
): Promise<Workspace | null> {
  return findMemberWorkspaceBySlug(userId, slug);
}
