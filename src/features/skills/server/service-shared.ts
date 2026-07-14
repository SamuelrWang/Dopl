import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import { meetsLevel } from "@/features/teams/access-levels";
import { effectiveResourceAccess } from "@/features/teams/server/access";
import {
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Skill, SkillContext } from "../types";

/**
 * Shared internals for the skills service. Context construction, the
 * `canSeeSkill` visibility matrix + its grant-precompute helper, the
 * grant-set DTO decorator, and the agent-write gate — used by more than
 * one of the per-domain service modules (`service-reads`,
 * `service-writes`, `service-body`, `service-trash`, `service-history`).
 *
 * The repository (`./repository.ts`) bypasses RLS via the service-role
 * client — every caller MUST filter by `ctx.workspaceId` so cross-
 * workspace leakage stays impossible.
 */

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

export function buildSkillContext(auth: AuthLike): SkillContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

/** Precomputed grant context for visibility checks over a set of rows.
 *  Mirrors `grantsForRows` in the chats service. */
export interface SkillGrantCtx {
  /** Teams the caller belongs to. Fetched only when needed. */
  myTeamIds: Set<string>;
  /** skillId → teamIds granted read access. */
  bySkill: Map<string, string[]>;
}

const EMPTY_SKILL_GRANTS: SkillGrantCtx = {
  myTeamIds: new Set(),
  bySkill: new Map(),
};

/** Fetch the caller's teams + skill grants — but only when some row is
 *  team-scoped and not the caller's own (fixed query count per request). */
export async function grantsForSkills(
  ctx: SkillContext,
  rows: Skill[]
): Promise<SkillGrantCtx> {
  const teamScoped = rows.filter(
    (s) => s.visibility === "public" && s.accessMode === "teams"
  );
  if (teamScoped.length === 0) return EMPTY_SKILL_GRANTS;
  const needsMembership = teamScoped.some((s) => s.createdBy !== ctx.userId);
  const [myTeams, grants] = await Promise.all([
    needsMembership && !ctx.apiKeyWorkspaceId
      ? listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    listGrantsForResources(
      ctx.workspaceId,
      "skill",
      teamScoped.map((s) => s.id)
    ),
  ]);
  const bySkill = new Map<string, string[]>();
  for (const g of grants) {
    bySkill.set(g.resourceId, [...(bySkill.get(g.resourceId) ?? []), g.teamId]);
  }
  return { myTeamIds: new Set(myTeams), bySkill };
}

/**
 * Three-way visibility filter (M-10 extended for team scoping — the
 * exact model `canSeeChat` uses):
 *   - Public + workspace mode: always.
 *   - Public + teams mode: owner, workspace admins, or members of a
 *     granted team. Never via a workspace-scoped API key.
 *   - Private via session or personal credential: owner-only.
 *   - Private via workspace-scoped API key: never.
 */
export function canSeeSkill(
  ctx: SkillContext,
  skill: Skill,
  grants: SkillGrantCtx
): boolean {
  if (skill.visibility === "public" && skill.accessMode !== "teams") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  if (skill.createdBy === ctx.userId) return true;
  if (skill.visibility !== "public") return false;
  if (ctx.role !== null && meetsMinRole(ctx.role, "admin")) return true;
  const granted = grants.bySkill.get(skill.id) ?? [];
  return granted.some((teamId) => grants.myTeamIds.has(teamId));
}

/** Grant set for the DTO — owners (and admins) see it; other viewers get
 *  an empty list so team composition doesn't leak through a shared skill. */
export function withGrantSet(
  ctx: SkillContext,
  skill: Skill,
  grants: SkillGrantCtx
): Skill {
  if (skill.accessMode !== "teams") return skill;
  const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  if (skill.createdBy !== ctx.userId && !isAdmin) return skill;
  return { ...skill, grantedTeamIds: grants.bySkill.get(skill.id) ?? [] };
}

/**
 * Gate for agent-origin skill writes. Skills participate in the team
 * access matrix now (skill_team_sharing), so the rule is the effective
 * access level: role default on workspace-mode skills, grant level on
 * team-mode ones. Writes need 'edit'.
 *
 * `SkillAgentWriteDisabledError` is still thrown when an agent tries
 * to flip `agentWriteEnabled` itself in updateSkill — that path
 * doesn't call here.
 */
export async function assertAgentWriteAllowed(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  if (ctx.source !== "agent") return;
  const membership = await findMembership(ctx.workspaceId, ctx.userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  const level = await effectiveResourceAccess(
    ctx.userId,
    ctx.workspaceId,
    "skill",
    skill.id,
    { role: membership.role }
  );
  if (level === null || !meetsLevel(level, "edit")) {
    throw new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      "Your access on this skill is read-only"
    );
  }
}
