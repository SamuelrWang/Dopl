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
import { touchLastSeen } from "./last-seen";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import {
  deleteWorkspace,
  findWorkspaceById,
  findWorkspaceByPublicId,
  findDefaultWorkspaceForUser,
  findMemberWorkspaceBySlug,
  findMembership,
  insertWorkspaceWithOwnerMembership,
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
  touchLastSeen(workspaceId, userId, membership.lastSeenAt);
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
 * Called from `resolveActiveWorkspace` (used by the auth callback +
 * any first-time route hit) and from signup hooks. Slug uniqueness is
 * no longer required (publicId is the unique routing key), but the
 * SELECT-then-INSERT shape is racy: a fast OAuth round-trip can land
 * on `/canvas` while the callback is still inserting, both call
 * `ensureDefaultWorkspace`, both see "no existing," and both try to
 * insert. The second insert blew up with a unique-constraint or
 * left two "Untitled" rows depending on which constraint fired.
 *
 * Fix (Audit A-019): catch the unique-constraint violation on the
 * second concurrent insert and resolve via a re-fetch — the first
 * caller already created the row we wanted. No advisory lock needed
 * since the unique constraint already serialises us; we just need to
 * recover gracefully.
 */
export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  const existing = await findDefaultWorkspaceForUser(userId);
  if (existing) return existing;
  const name = "Untitled";
  try {
    const workspace = await insertWorkspaceWithOwnerMembership({
      ownerId: userId,
      name,
      slug: slugifyWorkspaceName(name),
    });
    return workspace;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const after = await findDefaultWorkspaceForUser(userId);
      if (after) return after;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres SQLSTATE 23505 = unique_violation. Supabase JS surfaces it
  // either as `{ code }` on the error object or wrapped in a message;
  // check both shapes defensively.
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code === "23505") return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.includes("23505");
}

/**
 * Onboarding helper: give the user's default workspace its real name
 * ("{FirstName}'s Workspace") once we know who they are. Only fires
 * while the workspace still carries the provisioning placeholder name
 * ("Untitled") — if the user already renamed it (settings, MCP), their
 * name wins and this is a no-op. Idempotent, so onboarding completion
 * can safely retry.
 */
export async function renameDefaultWorkspaceIfUntitled(
  userId: string,
  name: string
): Promise<Workspace> {
  const workspace = await ensureDefaultWorkspace(userId);
  if (workspace.name !== "Untitled") return workspace;
  return updateWorkspace(workspace.id, {
    name,
    slug: slugifyWorkspaceName(name),
  });
}

/**
 * List the caller's workspaces; each row carries the caller's role on
 * the workspace. Used by `GET /api/workspaces` (so the agent's
 * `list_workspaces` MCP tool gets `{id, slug, name, role, ...}` in one
 * round trip) and the workspace switcher UI.
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
  const workspace = await insertWorkspaceWithOwnerMembership({
    ownerId: userId,
    name: input.name,
    slug: slugifyWorkspaceName(input.name),
    description: input.description ?? null,
  });
  return workspace;
}

export async function renameWorkspace(
  workspaceId: string,
  userId: string,
  patch: { name?: string; description?: string | null; slug?: string }
): Promise<Workspace> {
  const { workspace, membership } = await resolveMembershipOrThrow(workspaceId, userId);
  requireMinRole(membership.role, "admin");

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

/**
 * Set or clear a workspace's icon URL. Admin+ only. The URL is produced
 * server-side by the upload route (Supabase Storage public URL) or passed
 * as null to clear — never user-supplied, so there's no URL validation
 * here beyond the role gate.
 */
export async function updateWorkspaceIcon(
  workspaceId: string,
  userId: string,
  iconUrl: string | null
): Promise<Workspace> {
  const { membership } = await resolveMembershipOrThrow(workspaceId, userId);
  requireMinRole(membership.role, "admin");
  return updateWorkspace(workspaceId, { iconUrl });
}

export async function deleteWorkspaceForUser(
  workspaceId: string,
  userId: string
): Promise<void> {
  const { membership } = await resolveMembershipOrThrow(workspaceId, userId);
  requireMinRole(membership.role, "owner");

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
