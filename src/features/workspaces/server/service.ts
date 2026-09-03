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
import { findPersonalContainerId } from "@/shared/tenancy/personal-container";

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

/**
 * Workspace-resolution failure from `resolveActiveWorkspace`. ⚠ FLAT
 * billing-style envelope (`{ error, message }`, mirroring
 * `entitlementDeniedBody`), NOT the nested `HttpError` shape, so the MCP client
 * and web `apiRequest` surface code + message verbatim.
 *
 * 🔒 **ONE CODE SINCE B10** — `WORKSPACE_INVALID`, "you named something that is
 * not a workspace id". `WORKSPACE_REQUIRED` and the `workspaces: []` choice list
 * it carried are DELETED: naming nothing is no longer a question, so there is no
 * refusal to render and nothing to pick from. A caller who names nothing gets
 * their own container.
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
 * (`withWorkspaceAuth`, `GET /api/workspaces/me`).
 *
 *   1. `X-Workspace-Id` header (or export `?workspaceId=`, threaded as
 *      `headerWorkspaceId`) — UUID only. Blank or non-UUID → 400
 *      `WORKSPACE_INVALID`, never coerced to "no header".
 *   2. No header → **the caller's PERSONAL CONTAINER**, minted on first ask.
 *
 * 🔒 **THE ANSWER IS A CONSTANT, NOT A LOOKUP (Samuel's ruling B10).** *"The
 * home channel is now the default … all workspaces are just normal
 * workspaces."* What went from this function is the whole apparatus that used
 * to derive one: the membership COUNT, the sole-membership auto-target, the
 * `WORKSPACE_REQUIRED` refusal at 0 and at 2+, and the `WorkspaceChoice[]` list
 * the refusal carried. None of them has a question left to answer — a caller
 * who names nothing means their own container, and a caller who means anything
 * else names it.
 *
 * ⚠ **THIS IS STILL FAIL-CLOSED, AND FOR A BETTER REASON THAN BEFORE.** The old
 * refusal was fail-closed because it refused; this is fail-closed because the
 * answer cannot be somebody ELSE's workspace. A container is minted for the
 * caller, owned by the caller, with exactly one member — so an unnamed request
 * can no longer land on a tenant the caller merely belongs to, which is the
 * cross-tenant hazard the count was standing in for.
 *
 * ⚠ The API-key workspace LOCK is applied by `withWorkspaceAuth` before this
 * runs, so a locked credential never reaches step 2.
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
  // ⚠ Fail-closed even on the container just ensured: the membership read is
  // what every other caller of this function gets, and a revoked row must 404
  // here exactly as it does on a named workspace.
  return resolveMembershipOrThrow(container.id, userId);
}

/**
 * THE CALLER'S HOME — their one `kind='personal'` container, minted if absent.
 *
 * 🔒 **THE ONE ANSWER TO "WHICH WORKSPACE, WHEN NOTHING IS NAMED"** (ruling
 * B10), and the replacement for the provisioning call that derived one.
 * Every entry point that used to provision a default calls this: the auth
 * callback, `POST /api/boot`'s provisioning mode, `resolveActiveWorkspace` and
 * onboarding.
 *
 * ⚠ ONE ROUND TRIP, DELIBERATELY. The old shape read first and locked only on a
 * miss; the RPC's own `SELECT` under a per-owner advisory lock is the same
 * check, so the fast path bought a second query to avoid an uncontended lock.
 * Race-proofing lives in the DATABASE either way — `workspaces_personal_owner_uidx`
 * makes a second container unrepresentable, so a catch-23505 here would be
 * reporting a bug rather than resolving a race.
 *
 * ⚠ `created` SAYS WHETHER THIS CALL OWES THE SEED. A first container is the
 * only container a brand-new account has, so the starter corpus lands in it.
 */
export async function ensurePersonalContainer(userId: string): Promise<Workspace> {
  const { workspace, created } = await ensurePersonalContainerRow(userId);
  if (created) {
    // Starter corpus. Best-effort + idempotent (never throws).
    await seedNewWorkspace(workspace.id, userId);
  }
  return workspace;
}

/**
 * Is `workspaceId` this user's OWN home?
 *
 * ⚠ EXPORTED FOR THE TWO `resolveHomeScope` FENCES —
 * `knowledge/server/service-base-gates.ts` and
 * `agent-templates/server/service-writes.ts` — which asked the same question of
 * the derived default and must not each grow their own spelling of the new one.
 * It is stated here rather than in `shared/tenancy/personal-container.ts`
 * because it is a POLICY over that module's read, and this feature owns the
 * policy; that module answers WHERE a row lives and holds no opinion about who.
 *
 * ⚠ FALSE, never null: "not minted yet" and "not yours" are the same refusal to
 * a fence, and a fence that distinguishes them leaks whether a container exists.
 */
export async function isOwnPersonalContainer(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  return (await findPersonalContainerId(userId)) === workspaceId;
}

/**
 * The name `ensure_personal_container` mints when there is nothing to inherit —
 * a brand-new account with no workspace to be named after.
 *
 * ⚠ **THE LITERAL IS THE MIGRATION'S** (`20260922120000` §2's restatement of
 * `COALESCE(origin.name, 'Personal')`), so the two are pinned together by
 * `workspaces/b10-no-derived-default.test.ts` rather than by whoever reads
 * both files next. Drift is silent in BOTH directions: onboarding would either
 * refuse to name a fresh container or overwrite one a user already named.
 */
export const PERSONAL_CONTAINER_PLACEHOLDER_NAME = "Personal";

/**
 * Onboarding helper: name the caller's home, + optional description.
 *
 * ⚠ Only fires while the name is still the placeholder — a user rename
 * (settings, MCP) wins, and so does the name the container inherited from the
 * workspace it was minted from. Idempotent.
 *
 * ⚠ **THE SLUG IS NOT TOUCHED, AND THE MIGRATION'S ARGUMENT IS WHY.**
 * `ensure_personal_container` mints the constant `personal` precisely so this
 * row is never routed to by slug (it has its own surface, `/home`), and
 * `findMemberWorkspaceBySlug` answers `null` on 2+ matches. Re-sluggifying it
 * to the user's chosen name would put a second row in that scan under a name a
 * real workspace is likely to hold — F-561, re-opened by a rename.
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
