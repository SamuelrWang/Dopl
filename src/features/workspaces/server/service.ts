import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceWithRole,
  Role,
} from "../types";
import { meetsMinRole } from "../types";
import { slugifyWorkspaceName } from "../slug";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import {
  deleteWorkspace,
  findWorkspaceById,
  findWorkspaceByPublicId,
  findWorkspaceBySlug,
  findDefaultWorkspaceForUser,
  findMemberWorkspaceBySlug,
  findMembership,
  insertWorkspaceWithOwnerMembership,
  listWorkspacesForUser,
  listWorkspacesWithRoleForUser,
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
 * Called from `resolveActiveWorkspace` and from signup hooks. Slug
 * uniqueness is no longer required (publicId is the unique routing
 * key), so this is a single insert with no retry loop.
 */
export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  const existing = await findDefaultWorkspaceForUser(userId);
  if (existing) return existing;
  const name = "Untitled";
  return insertWorkspaceWithOwnerMembership({
    ownerId: userId,
    name,
    slug: slugifyWorkspaceName(name),
  });
}

export async function listMyWorkspaces(userId: string): Promise<Workspace[]> {
  return listWorkspacesForUser(userId);
}

/**
 * Same as `listMyWorkspaces` but each row carries the caller's role on
 * the workspace. Used by `GET /api/workspaces` (so the agent's
 * `list_workspaces` MCP tool gets `{id, slug, name, role, ...}` in one
 * round trip) and the workspace switcher UI. Both behaviors are
 * additive — the role-less callers can ignore the new field.
 */
export async function listMyWorkspacesWithRole(
  userId: string
): Promise<WorkspaceWithRole[]> {
  return listWorkspacesWithRoleForUser(userId);
}

export async function createWorkspaceForUser(
  userId: string,
  input: { name: string; description?: string | null }
): Promise<Workspace> {
  return insertWorkspaceWithOwnerMembership({
    ownerId: userId,
    name: input.name,
    slug: slugifyWorkspaceName(input.name),
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

  // Slug is purely cosmetic now (publicId is the URL identity), so
  // there's no uniqueness check. We still gate against reserved
  // top-level route names so a workspace can't visually claim
  // `/login`, `/settings`, etc., even though the route resolver
  // wouldn't actually serve it from there.
  if (patch.slug && patch.slug !== workspace.slug) {
    if (RESERVED_WORKSPACE_SLUGS.has(patch.slug)) {
      throw new HttpError(
        409,
        "WORKSPACE_SLUG_RESERVED",
        `"${patch.slug}" is reserved (collides with a top-level route).`
      );
    }
    update.slug = patch.slug;
  } else if (update.name) {
    update.slug = slugifyWorkspaceName(update.name);
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

/**
 * Membership-aware publicId lookup. Returns the workspace if and only
 * if the caller is an active member. Used by the route resolver to
 * surface 404 (not 403) for workspaces the user can't access — the
 * existence of a workspace at a given publicId is not an oracle.
 */
export async function findWorkspaceForMemberByPublicId(
  userId: string,
  publicId: string
): Promise<Workspace | null> {
  const workspace = await findWorkspaceByPublicId(publicId);
  if (!workspace) return null;
  const membership = await findMembership(workspace.id, userId);
  if (!membership || membership.status !== "active") return null;
  return workspace;
}
