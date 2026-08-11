import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import {
  capLevel,
  defaultLevelForRole,
  maxLevel,
  meetsLevel,
  type AccessLevel,
  type AccessMode,
  type TeamResourceType,
} from "../access-levels";
import type { EffectiveAccessResult, TeamsModeResourceAccess } from "../types";
import {
  getResourceAccessMeta,
  listGrantsForTeams,
  listTeamIdsForUser,
  listTeamsModeResources,
} from "./repository";

/**
 * Resolve a member's effective access level on a single resource.
 *
 *   not an active member            -> null
 *   admin/owner                     -> edit
 *   resource missing/deleted        -> null
 *   access_mode = 'workspace'       -> role default
 *   access_mode = 'teams', creator  -> edit (capped at role ceiling)
 *   access_mode = 'teams'           -> max grant level across the user's
 *                                      teams (capped), or null if none
 */
export async function effectiveResourceAccess(
  userId: string,
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  opts?: { role?: Role }
): Promise<AccessLevel | null> {
  let role = opts?.role;
  if (!role) {
    const membership = await findMembership(workspaceId, userId);
    if (!membership || membership.status !== "active") return null;
    role = membership.role;
  }
  if (meetsMinRole(role, "admin")) return "edit";

  const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
  if (!meta) return null;

  const ceiling = defaultLevelForRole(role);
  if (meta.accessMode === "workspace") return ceiling;
  if (meta.createdBy === userId) return ceiling;

  const teamIds = await listTeamIdsForUser(workspaceId, userId);
  if (teamIds.length === 0) return null;
  const grants = await listGrantsForTeams(workspaceId, teamIds);
  let level: AccessLevel | null = null;
  for (const g of grants) {
    if (g.resourceType === resourceType && g.resourceId === resourceId) {
      level = maxLevel(level, g.level);
    }
  }
  return level === null ? null : capLevel(level, ceiling);
}

/**
 * Throws if the caller lacks the required level: 404 when they can't see
 * the resource at all (don't leak existence), 403 when they can see it
 * but the level is insufficient.
 */
export async function requireEffectiveAccess(
  userId: string,
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  requiredLevel: AccessLevel,
  opts?: { role?: Role }
): Promise<void> {
  const level = await effectiveResourceAccess(
    userId,
    workspaceId,
    resourceType,
    resourceId,
    opts
  );
  if (level === null) {
    // `RESOURCE_NOT_FOUND` for every non-KB type. The literal used to be
    // `WORKFLOW_NOT_FOUND` — this guard has covered chats, chat folders and
    // skills for a long time and only the code still said otherwise. It was
    // renamed with the workflows deletion (2026-08-11) after a whole-repo
    // grep found the producer below was the ONLY mention of the old literal:
    // no consumer branched on it in `src/`, `apps/`, `packages/` or the
    // desktop tree. It matches what `teams/server/service.ts` already throws
    // for the same condition.
    throw new HttpError(
      404,
      resourceType === "knowledge_base" ? "KNOWLEDGE_BASE_NOT_FOUND" : "RESOURCE_NOT_FOUND",
      resourceType === "knowledge_base" ? "Knowledge base not found" : "Resource not found"
    );
  }
  if (!meetsLevel(level, requiredLevel)) {
    throw new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      `Your access on this ${resourceType.replace("_", " ")} is read-only`
    );
  }
}

/**
 * Batch resolution for list filtering — fixed query count regardless of
 * resource count. Pass `opts.role` (from the auth context) to skip the
 * membership fetch. Returns null if the user isn't an active member.
 */
export async function listEffectiveAccess(
  workspaceId: string,
  userId: string,
  opts?: { role?: Role }
): Promise<EffectiveAccessResult | null> {
  let role = opts?.role;
  if (!role) {
    const membership = await findMembership(workspaceId, userId);
    if (!membership || membership.status !== "active") return null;
    role = membership.role;
  }

  if (meetsMinRole(role, "admin")) {
    return { defaultLevel: "edit", isAdmin: true, teamsModeResources: [] };
  }

  const ceiling = defaultLevelForRole(role);
  const [scoped, teamIds] = await Promise.all([
    listTeamsModeResources(workspaceId),
    listTeamIdsForUser(workspaceId, userId),
  ]);
  const grants =
    teamIds.length > 0 ? await listGrantsForTeams(workspaceId, teamIds) : [];
  const grantMap = new Map<string, AccessLevel>();
  for (const g of grants) {
    const key = `${g.resourceType}:${g.resourceId}`;
    grantMap.set(key, maxLevel(grantMap.get(key) ?? null, g.level) as AccessLevel);
  }

  const teamsModeResources: TeamsModeResourceAccess[] = scoped.map((r) => {
    if (r.createdBy === userId) {
      return { resourceType: r.resourceType, resourceId: r.resourceId, level: ceiling };
    }
    const granted = teamIds.length
      ? grantMap.get(`${r.resourceType}:${r.resourceId}`) ?? null
      : null;
    return {
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      level: granted === null ? null : capLevel(granted, ceiling),
    };
  });

  return { defaultLevel: ceiling, isAdmin: false, teamsModeResources };
}

/**
 * The wire shape of `GET /api/workspaces/[workspaceSlug]/my-access`, and of
 * the `myAccess` half of `POST /api/boot`. Stable since the per-member
 * override era — the SPA seeds one endpoint's cache entry from the other's
 * answer, so the two MUST NOT drift; that is why the projection lives here
 * rather than inline in either route.
 */
export interface MyAccessPayload {
  defaultLevel: AccessLevel;
  overrides: Array<{
    resourceType: TeamResourceType;
    resourceId: string;
    level: AccessLevel;
  }>;
}

/**
 * Project a batch result onto that wire shape.
 *
 * `level: null` (a teams-mode resource with no grant) maps to `"read"`, NOT
 * to omission: the client treats a missing entry as the ROLE DEFAULT ("edit"
 * for members), which would flip a just-revoked KB panel back to editable.
 * "read" keeps affordances locked until the lists refetch and drop the
 * resource entirely.
 */
export function toMyAccessPayload(result: EffectiveAccessResult): MyAccessPayload {
  return {
    defaultLevel: result.defaultLevel,
    overrides: result.teamsModeResources.map((r) => ({
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      level: r.level ?? ("read" as const),
    })),
  };
}

/**
 * Pure lookup against a batch result: the caller's level on one resource.
 * Workspace-mode resources resolve to the default level; teams-mode
 * resources resolve via the precomputed array (null = invisible).
 */
export function resolveLevel(
  acc: EffectiveAccessResult,
  resourceType: TeamResourceType,
  resourceId: string,
  accessMode: AccessMode
): AccessLevel | null {
  if (acc.isAdmin) return "edit";
  if (accessMode === "workspace") return acc.defaultLevel;
  const hit = acc.teamsModeResources.find(
    (r) => r.resourceType === resourceType && r.resourceId === resourceId
  );
  return hit ? hit.level : null;
}
