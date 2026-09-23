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
import { seedNewWorkspace } from "./seed-workspace";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import {
  deleteWorkspace,
  findWorkspaceById,
  findWorkspaceByPublicId,
  findMemberWorkspaceBySlug,
  findMembership,
  insertWorkspaceWithOwnerMembership,
  listWorkspacesWithRoleForUser,
  listMembers,
  updateWorkspace,
  ensurePersonalContainerRow,
} from "./repository";
import { assertWorkspacePermanent } from "./authz";
import { scrubHiddenPresence } from "./dto";

export interface ResolvedMembership {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

/** A reachable workspace + the membership facts the lookup already read, so no caller re-asks. */
export interface MemberWorkspace {
  workspace: Workspace;
  role: Role;
  userId: string;
}

/**
 * `resolveActiveWorkspace`'s one failure: a named id that is not a workspace UUID. Flat `{ error, message }`
 * envelope like `entitlementDeniedBody`, not `HttpError`'s, so MCP and `apiRequest` surface it verbatim.
 */
export class WorkspaceResolutionError extends Error {
  readonly status = 400 as const;
  readonly code = "WORKSPACE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceResolutionError";
  }

  toResponseBody(): { error: string; message: string } {
    return { error: this.code, message: this.message };
  }
}

const WORKSPACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Workspace + the caller's active membership behind `withWorkspaceAuth`. One 404 answers both
 * "not a member" and "does not exist", so existence isn't an oracle.
 */
export async function resolveMembershipOrThrow(
  workspaceId: string,
  userId: string
): Promise<ResolvedMembership> {
  // Parallel: in series this adds a round trip to every authed route. The 404 answer is unchanged.
  const [workspace, membership] = await Promise.all([
    findWorkspaceById(workspaceId),
    findMembership(workspaceId, userId),
  ]);
  if (!workspace) throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  touchLastSeen(workspaceId, userId, membership.lastSeenAt);
  return { workspace, membership };
}

/**
 * The request's workspace: the `X-Workspace-Id` header (UUID only; blank or non-UUID is 400, never
 * coerced to "no header"), else the caller's personal container. Fail-closed: an unnamed request lands
 * only on a container the caller owns alone. `withWorkspaceAuth` applies the API-key lock before this.
 */
export async function resolveActiveWorkspace(
  userId: string,
  headerWorkspaceId: string | null
): Promise<ResolvedMembership> {
  if (headerWorkspaceId !== null) {
    const trimmed = headerWorkspaceId.trim();
    if (!WORKSPACE_ID_RE.test(trimmed)) {
      throw new WorkspaceResolutionError(
        "X-Workspace-Id must be a workspace UUID. Omit it to target your own home, or pass a UUID from GET /api/workspaces."
      );
    }
    return resolveMembershipOrThrow(trimmed, userId);
  }

  const container = await ensurePersonalContainer(userId);
  // Membership is re-read even here: a revoked row must 404 as it does on a named workspace.
  return resolveMembershipOrThrow(container.id, userId);
}

/**
 * The caller's one `kind='personal'` home, minted if absent: the answer when nothing is named. One RPC;
 * `workspaces_personal_owner_uidx` makes a second container unrepresentable. Never seeded: a home space
 * starts empty (only `createWorkspaceForUser` seeds).
 */
export async function ensurePersonalContainer(userId: string): Promise<Workspace> {
  const { workspace } = await ensurePersonalContainerRow(userId);
  return workspace;
}

/**
 * The name `ensure_personal_container` mints for a brand-new account. The literal is the migration's
 * `COALESCE(origin.name, 'Personal')`, pinned by `b10-no-derived-default.test.ts`.
 */
export const PERSONAL_CONTAINER_PLACEHOLDER_NAME = "Personal";
/** The home's name after onboarding if the user typed none; agents read a workspace-shaped name as one. */
export const PERSONAL_CONTAINER_DEFAULT_NAME = "Home";

/**
 * Onboarding: name the caller's home while it still has the placeholder name (any rename wins). The slug
 * stays `personal`: `findMemberWorkspaceBySlug` answers `null` on 2+ matches, so re-slugging collides (F-561).
 */
export async function renamePersonalContainerIfPlaceholder(
  userId: string,
  name: string,
  description?: string | null
): Promise<Workspace> {
  const workspace = await ensurePersonalContainer(userId);
  if (workspace.name !== PERSONAL_CONTAINER_PLACEHOLDER_NAME) return workspace;
  const patch: { name: string; description?: string | null } = { name };
  if (description !== undefined) patch.description = description;
  return updateWorkspace(workspace.id, patch);
}

/**
 * The caller's workspaces with role and `kind`, unfiltered: desktop discovers home channels through
 * `GET /api/workspaces`. User-facing lists filter through `isStandardWorkspace`.
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
  // Starter corpus (best-effort, never throws).
  await seedNewWorkspace(workspace.id, userId);
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

  // Slug is cosmetic (publicId routes), so no uniqueness check; reserved top-level route names are refused.
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

/** Set or clear a workspace's icon URL (admin+). The upload route produces the URL; no validation here. */
export async function updateWorkspaceIcon(
  workspaceId: string,
  userId: string,
  iconUrl: string | null
): Promise<Workspace> {
  const { membership } = await resolveMembershipOrThrow(workspaceId, userId);
  requireMinRole(membership.role, "admin");
  return updateWorkspace(workspaceId, { iconUrl });
}

/**
 * Destroy a workspace (owner-only). A `kind='personal'` home is permanent, and its owner is exactly who
 * this refuses. The guard runs after the role gate so a non-owner learns nothing about the row's kind.
 */
export async function deleteWorkspaceForUser(
  workspaceId: string,
  userId: string
): Promise<void> {
  const { workspace, membership } = await resolveMembershipOrThrow(workspaceId, userId);
  requireMinRole(membership.role, "owner");
  assertWorkspacePermanent(workspace);

  await deleteWorkspace(workspaceId);
}

/** The roster, presence scrubbed per caller's role; its one consumer is the members route. */
export async function listWorkspaceMembers(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembership[]> {
  const { membership } = await resolveMembershipOrThrow(workspaceId, userId);
  const members = await listMembers(workspaceId);
  return scrubHiddenPresence(members, userId, membership.role);
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

/** Membership-aware slug lookup — access regardless of ownership. */
export async function findWorkspaceForMember(
  userId: string,
  slug: string
): Promise<MemberWorkspace | null> {
  const workspace = await findMemberWorkspaceBySlug(userId, slug);
  if (!workspace) return null;
  const membership = await findMembership(workspace.id, userId);
  if (!membership || membership.status !== "active") return null;
  return { workspace, role: membership.role, userId };
}

/** Membership-aware publicId lookup; the route resolver answers 404 (not 403) so existence is no oracle. */
export async function findWorkspaceForMemberByPublicId(
  userId: string,
  publicId: string
): Promise<MemberWorkspace | null> {
  const workspace = await findWorkspaceByPublicId(publicId);
  if (!workspace) return null;
  const membership = await findMembership(workspace.id, userId);
  if (!membership || membership.status !== "active") return null;
  return { workspace, role: membership.role, userId };
}
