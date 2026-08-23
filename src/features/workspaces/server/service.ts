import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceWithRole,
  Role,
} from "../types";
import { isStandardWorkspace, meetsMinRole } from "../types";
import { slugifyWorkspaceName } from "../slug";
import { touchLastSeen } from "./last-seen";
import { seedNewWorkspace } from "./seed-workspace";
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
  ensureDefaultWorkspaceRow,
} from "./repository";

export interface ResolvedMembership {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

/**
 * A reachable workspace + the membership facts the lookup already read to prove
 * reachability, so no caller re-asks `GET /api/workspaces/me` for them.
 */
export interface MemberWorkspace {
  workspace: Workspace;
  role: Role;
  userId: string;
}

/** One entry in a `WORKSPACE_REQUIRED` body so the caller can pick a target. */
export interface WorkspaceChoice {
  name: string;
  slug: string;
  role: Role;
}

/**
 * Workspace-resolution failure from `resolveActiveWorkspace`. ⚠ FLAT
 * billing-style envelope (`{ error, message, workspaces? }`, mirroring
 * `entitlementDeniedBody`), NOT the nested `HttpError` shape, so the MCP client
 * and web `apiRequest` surface code + message verbatim.
 */
export class WorkspaceResolutionError extends Error {
  readonly status = 400 as const;
  readonly code: "WORKSPACE_REQUIRED" | "WORKSPACE_INVALID";
  readonly workspaces?: WorkspaceChoice[];

  constructor(
    code: "WORKSPACE_REQUIRED" | "WORKSPACE_INVALID",
    message: string,
    workspaces?: WorkspaceChoice[]
  ) {
    super(message);
    this.name = "WorkspaceResolutionError";
    this.code = code;
    this.workspaces = workspaces;
  }

  toResponseBody(): {
    error: string;
    message: string;
    workspaces?: WorkspaceChoice[];
  } {
    const body: { error: string; message: string; workspaces?: WorkspaceChoice[] } = {
      error: this.code,
      message: this.message,
    };
    if (this.workspaces) body.workspaces = this.workspaces;
    return body;
  }
}

const WORKSPACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authoritative auth lookup behind `withWorkspaceAuth`: workspace + the
 * caller's active membership, or throws `HttpError`. ⚠ Never null — 404 answers
 * both "not a member" and "does not exist" so existence isn't an oracle.
 */
export async function resolveMembershipOrThrow(
  workspaceId: string,
  userId: string
): Promise<ResolvedMembership> {
  // ⚠ PARALLEL, not sequential: both reads key only on `workspaceId` (plus
  // `userId`), and series adds a DB round trip to every route behind
  // `withWorkspaceAuth`. ⚠ 404 ordering is preserved exactly — a missing
  // workspace answers before the membership is judged, so a non-member of a
  // real workspace is indistinguishable from a member of a nonexistent one.
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
 * Resolve the active workspace for an authenticated request
 * (`withWorkspaceAuth`, `GET /api/workspaces/me`). ⚠ Fail-CLOSED: there is NO
 * silent default-workspace fallback.
 *
 *   1. `X-Workspace-Id` header (or export `?workspaceId=`, threaded as
 *      `headerWorkspaceId`) — UUID only. Blank or non-UUID → 400
 *      `WORKSPACE_INVALID`, never coerced to "no header".
 *   2. No header → the caller's ACTIVE STANDARD memberships
 *      (`listWorkspacesWithRoleForUser`), ONE query powering count,
 *      auto-target and the 400 body:
 *        - exactly 1 → auto-target (role from the same lookup);
 *        - 0 → 400 `WORKSPACE_REQUIRED`, `workspaces: []`;
 *        - 2+ → 400 `WORKSPACE_REQUIRED` listing {name, slug, role}.
 *
 * ⚠ `kind='link'` containers are NOT candidates and are NOT listed: a user with
 * one standard workspace and N home-channel links still auto-targets their
 * standard one, and a link-only user gets WORKSPACE_REQUIRED exactly as a
 * membership-less user does today. Reaching a link workspace is an EXPLICIT
 * act — step 1's header (or `workspace=`), which stays unfiltered.
 *
 * ⚠ NEVER use `findDefaultWorkspaceForUser` here — oldest-OWNED only
 * (billing-webhook legacy), which diverges from membership. The API-key
 * workspace lock is applied by `withWorkspaceAuth` before this runs.
 */
export async function resolveActiveWorkspace(
  userId: string,
  headerWorkspaceId: string | null
): Promise<ResolvedMembership> {
  if (headerWorkspaceId !== null) {
    const trimmed = headerWorkspaceId.trim();
    if (!WORKSPACE_ID_RE.test(trimmed)) {
      throw new WorkspaceResolutionError(
        "WORKSPACE_INVALID",
        "X-Workspace-Id must be a workspace UUID. Omit it to auto-target your workspace when you belong to exactly one, or pass a UUID from GET /api/workspaces."
      );
    }
    return resolveMembershipOrThrow(trimmed, userId);
  }

  const memberships = (await listWorkspacesWithRoleForUser(userId)).filter(
    isStandardWorkspace
  );
  if (memberships.length === 1) {
    return resolveMembershipOrThrow(memberships[0].id, userId);
  }

  const workspaces: WorkspaceChoice[] = memberships.map((w) => ({
    name: w.name,
    slug: w.slug,
    role: w.role,
  }));
  const message =
    memberships.length === 0
      ? "You are not an active member of any workspace. Create one with POST /api/workspaces, then retry."
      : `You belong to ${memberships.length} workspaces, so this request needs an explicit target. Set the X-Workspace-Id header (or pass workspace= on MCP tool calls) to one of the workspaces listed below.`;
  throw new WorkspaceResolutionError("WORKSPACE_REQUIRED", message, workspaces);
}

/**
 * Idempotent: creates the user's default workspace if absent. Called from
 * `resolveActiveWorkspace` (auth callback, first-time route hit) and signup.
 */
export async function ensureDefaultWorkspace(userId: string): Promise<Workspace> {
  // Fast path — no lock taken when the workspace already exists.
  const existing = await findDefaultWorkspaceForUser(userId);
  if (existing) return existing;
  const name = "Untitled";
  // ⚠ Race-proofing lives in the DATABASE — catch-23505 cannot work here (slug
  // uniqueness constraints dropped, public_id never collides). The
  // `ensure_default_workspace` RPC serializes check-then-insert under a
  // per-owner advisory lock; `created` says whether THIS call owes the seed.
  const { workspace, created } = await ensureDefaultWorkspaceRow({
    ownerId: userId,
    name,
    slug: slugifyWorkspaceName(name),
  });
  if (created) {
    // Starter corpus. Best-effort + idempotent (never throws).
    await seedNewWorkspace(workspace.id, userId);
  }
  return workspace;
}

/**
 * Onboarding helper: name the default workspace, + optional description.
 * ⚠ Only fires while the name is still the placeholder "Untitled" — a user
 * rename (settings, MCP) wins. Idempotent.
 */
export async function renameDefaultWorkspaceIfUntitled(
  userId: string,
  name: string,
  description?: string | null
): Promise<Workspace> {
  const workspace = await ensureDefaultWorkspace(userId);
  if (workspace.name !== "Untitled") return workspace;
  const patch: { name: string; slug: string; description?: string | null } = {
    name,
    slug: slugifyWorkspaceName(name),
  };
  if (description !== undefined) patch.description = description;
  return updateWorkspace(workspace.id, patch);
}

/**
 * The caller's workspaces, each row carrying their role and (once the column
 * exists) its `kind`.
 *
 * ⚠ UNFILTERED, deliberately: the desktop main process discovers home channels
 * by fanning over `GET /api/workspaces`, so dropping `kind='link'` here would
 * stop home-channel agents waking. Filtering is the CONSUMER's job — every
 * user-facing list runs the rows through `isStandardWorkspace`.
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

  // Slug is cosmetic (publicId is the URL identity), so no uniqueness check.
  // Reserved top-level route names are still gated so a workspace cannot
  // visually claim `/login`, `/settings`, etc.
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
 * Set or clear a workspace's icon URL. Admin+. ⚠ The URL is produced
 * server-side by the upload route (Supabase Storage public URL) or null to
 * clear — never user-supplied, hence no URL validation beyond the role gate.
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

/**
 * Membership-aware publicId lookup: the workspace iff the caller is an active
 * member, plus the MEMBERSHIP FACTS the read already had. ⚠ The route resolver
 * surfaces 404 (not 403) so existence is not an oracle.
 */
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
