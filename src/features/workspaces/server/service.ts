import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceOverviewCounts,
  WorkspaceWithRole,
  Role,
} from "../types";
import { meetsMinRole } from "../types";
import { slugifyWorkspaceName } from "../slug";
import { touchLastSeen } from "./last-seen";
import { seedNewWorkspace } from "./seed-workspace";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import {
  countWorkspaceResources,
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

/** One entry in a `WORKSPACE_REQUIRED` body so the caller can pick a target. */
export interface WorkspaceChoice {
  name: string;
  slug: string;
  role: Role;
}

/**
 * Workspace-resolution failure surfaced by `resolveActiveWorkspace` when a
 * request can't be pinned to a single workspace. Uses the FLAT billing-style
 * envelope (`{ error, message, workspaces? }`, mirroring
 * `entitlementDeniedBody`) — NOT the nested `HttpError` shape — so the MCP
 * client / web `apiRequest` surface the code + message verbatim.
 *
 *   - WORKSPACE_REQUIRED (400): no header and the caller has 0 or 2+ active
 *     memberships. `workspaces` lists every membership ({name, slug, role});
 *     when empty the message points at `POST /api/workspaces` to create one.
 *   - WORKSPACE_INVALID (400): the `X-Workspace-Id` header (or the export
 *     `?workspaceId=` param) is present-but-blank or not a UUID. Never
 *     coerced to "no header", never a 500.
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
 * `withWorkspaceAuth` and `GET /api/workspaces/me`. Fail-CLOSED and
 * explicit — there is NO silent default-workspace fallback (MCP-2):
 *
 *   1. `X-Workspace-Id` header (or export `?workspaceId=` param, threaded
 *      here as `headerWorkspaceId`) — UUID only. Present-but-blank or a
 *      non-UUID value → 400 `WORKSPACE_INVALID` (never coerced to "no
 *      header"; a slug in the header used to 500 — now a clean 400).
 *   2. No header → the caller's ACTIVE memberships
 *      (`listWorkspacesWithRoleForUser`). This ONE query powers the count,
 *      the auto-target, and the 400 body:
 *        - exactly 1 → auto-target it (role from the same lookup);
 *        - 0 → 400 `WORKSPACE_REQUIRED`, `workspaces: []`, message points
 *          at `POST /api/workspaces`;
 *        - 2+ → 400 `WORKSPACE_REQUIRED` listing {name, slug, role}.
 *
 * NEVER use `findDefaultWorkspaceForUser` here — that is oldest-OWNED only
 * (billing-webhook legacy) and diverges from membership (owns 0 / member of
 * 1, owns 1 / member of 3). The API-key workspace lock is applied by the
 * caller (`withWorkspaceAuth`) before this runs, not here.
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

  const memberships = await listWorkspacesWithRoleForUser(userId);
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
  // Fast path — no lock taken when the workspace already exists.
  const existing = await findDefaultWorkspaceForUser(userId);
  if (existing) return existing;
  const name = "Untitled";
  // Race-proofing moved INTO the database (2026-08-02): the old
  // catch-23505 recovery here became dead code when the slug uniqueness
  // constraints were dropped (20260502120000 / 20260504000000 — public_id
  // is random and never collides), so two concurrent callers could both
  // insert "Untitled". The ensure_default_workspace RPC serializes
  // check-then-insert under a per-owner advisory lock; `created` tells us
  // whether THIS call won and therefore owes the seed.
  const { workspace, created } = await ensureDefaultWorkspaceRow({
    ownerId: userId,
    name,
    slug: slugifyWorkspaceName(name),
  });
  if (created) {
    // Seed the "how to use Dopl" starter corpus. Best-effort + idempotent
    // (never throws), so a seed hiccup can't wedge workspace creation.
    await seedNewWorkspace(workspace.id, userId);
  }
  return workspace;
}

/**
 * Onboarding helper: give the user's default workspace its real name
 * (either what the user typed on the final onboarding step, or the
 * auto-name "{FirstName}'s Workspace") once we know who they are. An
 * optional description is set in the same write. Only fires while the
 * workspace still carries the provisioning placeholder name ("Untitled")
 * — if the user already renamed it (settings, MCP), their name wins and
 * this is a no-op. Idempotent, so onboarding completion can safely retry.
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

/**
 * Head-counts for the overview page's stat cards. The `/overview` server
 * component and `GET /api/workspaces/[workspaceSlug]/overview-counts` both
 * read through here so the RSC page and the SPA can never drift — the page
 * used to inline these `supabaseAdmin()` queries itself (ENGINEERING §8:
 * pages don't talk to Supabase).
 *
 * Membership is NOT checked here; both callers resolve the workspace
 * membership-scoped first (`resolvePageWorkspace` / `resolveApiWorkspace`).
 */
export async function getWorkspaceOverviewCounts(
  workspaceId: string
): Promise<WorkspaceOverviewCounts> {
  return countWorkspaceResources(workspaceId);
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
  // Seed the "how to use Dopl" starter corpus (best-effort, never throws).
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
