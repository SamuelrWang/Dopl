import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
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
import { SkillAgentWriteDisabledError } from "./errors";

/**
 * Shared internals for the skills service: context construction, the
 * `canSeeSkill` visibility matrix + grant precompute, the grant-set DTO
 * decorator, and the agent-write gate.
 * ⚠ `./repository.ts` bypasses RLS via the service-role client — every
 * caller MUST filter by `ctx.workspaceId` or workspaces leak into each other.
 */

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  ⚠ REQUIRED — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
}

export function buildSkillContext(auth: AuthLike): SkillContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    credentialSubjectUserId: auth.credentialSubjectUserId,
  };
}

/** ⚠ Postgres `text` cannot store U+0000 — a stray NUL from a paste or raw
 *  agent output surfaces as an opaque INTERNAL_ERROR at the DB boundary.
 *  Strip from every written string. Undefined/null pass through. */
export function stripNullBytes<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? value.replace(/\u0000/g, "") : value) as T;
}

/** Precomputed grant context for visibility checks over a row set. Mirrors
 *  `grantsForRows` in the chats service. */
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

/** Caller's teams + skill grants, fetched only when some row is team-scoped
 *  and not the caller's own. Fixed query count per request. */
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
    needsMembership && !isSharedCredential(ctx)
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
 * Three-way visibility filter. Same model as `canSeeChat`:
 *   - public + workspace mode: always
 *   - public + teams mode: owner, workspace admins, or a granted team's
 *     members. Never via a SHARED credential.
 *   - private via a credential with a person behind it: owner-only
 *   - private via a SHARED credential: never
 *
 * ⚠ ARM 2 IS `isSharedCredential`, NOT THE WORKSPACE LOCK — the mirror of
 * `knowledge/server/service-shared.ts › canSeeBase`, moved with it on
 * 2026-08-27 (F-336).
 */
export function canSeeSkill(
  ctx: SkillContext,
  skill: Skill,
  grants: SkillGrantCtx
): boolean {
  if (skill.visibility === "public" && skill.accessMode !== "teams") return true;
  if (isSharedCredential(ctx)) return false;
  if (skill.createdBy === ctx.userId) return true;
  if (skill.visibility !== "public") return false;
  if (ctx.role !== null && meetsMinRole(ctx.role, "admin")) return true;
  const granted = grants.bySkill.get(skill.id) ?? [];
  return granted.some((teamId) => grants.myTeamIds.has(teamId));
}

/** ⚠ Grant set for the DTO: owners and admins only. Other viewers get an
 *  empty list — team composition must not leak through a shared skill. */
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
 * Gate for agent-origin skill writes. Rule is the effective access level:
 * role default on workspace-mode skills, grant level on team-mode ones.
 * Writes need 'edit'. (An agent flipping `agentWriteEnabled` is rejected in
 * updateSkill, which doesn't call here.)
 */
export async function assertAgentWriteAllowed(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  if (ctx.source !== "agent") return;
  // ⚠ Order matters: `agent_write_enabled=false` is checked BEFORE the
  // team-access check, so the read-only flag beats an agent holding "edit".
  if (!skill.agentWriteEnabled) {
    throw new SkillAgentWriteDisabledError(skill.slug);
  }
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
