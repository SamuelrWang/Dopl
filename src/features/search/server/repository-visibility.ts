import "server-only";
import type { Role } from "@/features/workspaces/types";
import {
  grantedResourceIds,
  teamGrantedResourceIds,
  NO_GRANTS,
  type GrantedResourceIds,
} from "@/shared/tenancy/resource-grant-reach";
import { canSeeBase } from "@/features/knowledge/server/service-shared";
import {
  listEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import { canSeeSkill } from "@/features/skills/server/service-shared";
import { canSeeChat } from "@/features/chats/server/service-shared";
import { canSeeIdentity } from "@/features/agent-identities/server/service-shared";
import type { KnowledgeBase } from "@/features/knowledge/types";
import type { Skill } from "@/features/skills/types";
import type { AgentIdentity } from "@/features/agent-identities/types";

/**
 * Search's visibility fence: each row is asked of its owning feature's `canSee*`,
 * imported never restated — a one-way, predicates-only exception to INVARIANTS §1
 * (F-716). The container fence stays in SQL; only the per-row cut happens here.
 */

/** 4× the group cap, so 150 hidden matches can precede a visible one. */
export const SEARCH_CANDIDATE_ROW_LIMIT = 200;

/** Role is per container: the workspace-admin arm is about the row's container. */
export interface SearchCaller {
  userId: string;
  /** `null` = a credential standing for nobody; no grant table is read for it. */
  ownerUserId: string | null;
  credentialSubjectUserId: string | null;
  roleByContainer: ReadonlyMap<string, Role>;
}

function ctxFor(caller: SearchCaller, workspaceId: string) {
  return {
    workspaceId,
    userId: caller.userId,
    role: caller.roleByContainer.get(workspaceId) ?? null,
    source: "user" as const,
    // Never the container lock: it answers which workspace, not which rows (F-336).
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: caller.credentialSubjectUserId,
  };
}

/** `KnowledgeContext.role` is required; `canSeeBase` reads none, so `guest` only meets the type. */
function knowledgeCtxFor(caller: SearchCaller, workspaceId: string) {
  const ctx = ctxFor(caller, workspaceId);
  return { ...ctx, role: ctx.role ?? ("guest" as Role) };
}

/** A candidate row, before any predicate has run. */
export interface CandidateRow {
  id: string;
  workspace_id: string;
  visibility: string;
  access_mode?: string | null;
  created_by?: string | null;
  owner_id?: string | null;
}

/**
 * Both grant sets, read once per candidate page rather than per container. None for a
 * shared credential: every predicate refuses it past the widest visibility anyway.
 */
async function grantSets(
  caller: SearchCaller,
  type: "knowledge_base" | "agent_identity" | "skill" | "chat",
  ids: readonly string[],
  opts: { scope?: boolean; team?: boolean } = {}
): Promise<{ scoped: GrantedResourceIds; team: GrantedResourceIds }> {
  if (caller.ownerUserId === null || ids.length === 0) {
    return { scoped: NO_GRANTS, team: NO_GRANTS };
  }
  const [scoped, team] = await Promise.all([
    opts.scope === false
      ? Promise.resolve(NO_GRANTS)
      : grantedResourceIds(caller.userId, type, ids),
    opts.team === false
      ? Promise.resolve(NO_GRANTS)
      : teamGrantedResourceIds(caller.userId, type, ids),
  ]);
  return { scoped, team };
}

/** Team-grant context in the shape the skill/chat/identity predicates take. */
function teamCtx(granted: GrantedResourceIds, ids: readonly string[]) {
  const MINE = "granted";
  const byId = new Map<string, string[]>();
  for (const id of ids) if (granted.has(id)) byId.set(id, [MINE]);
  // One synthetic team id suffices: `teamGrantedResourceIds` already intersected
  // the row's teams with the caller's.
  return { myTeamIds: new Set([MINE]), byId };
}

/**
 * Cap on {@link teamsModeVisible}'s per-container fan, which cannot be batched.
 * Containers past it are dropped: rows hidden, never shown (fail-closed).
 */
export const SEARCH_TEAMS_CONTAINER_LIMIT = 50;

/**
 * Teams narrowing for knowledge bases: `canSeeBase` has no teams arm, so this calls
 * the same `listEffectiveAccess` + `resolveLevel` as `assertBaseVisible` (F-716).
 * Fail-closed: a container with no caller role is skipped, never guessed as `viewer`
 * (that bypasses the membership check), and a `null` answer drops its rows.
 */
async function teamsModeVisible<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<Set<string>> {
  const teamsMode = rows.filter((r) => (r.access_mode ?? "workspace") === "teams");
  if (teamsMode.length === 0) return new Set();
  const roleByContainer = new Map<string, Role>();
  for (const row of teamsMode) {
    if (roleByContainer.size >= SEARCH_TEAMS_CONTAINER_LIMIT) break;
    const role = caller.roleByContainer.get(row.workspace_id);
    if (role !== undefined) roleByContainer.set(row.workspace_id, role);
  }
  const access = await Promise.all(
    [...roleByContainer].map(
      async ([workspaceId, role]) =>
        [
          workspaceId,
          await listEffectiveAccess(workspaceId, caller.userId, { role }),
        ] as const
    )
  );
  const byContainer = new Map(access);
  const visible = new Set<string>();
  for (const row of teamsMode) {
    const acc = byContainer.get(row.workspace_id);
    if (!acc) continue;
    if (resolveLevel(acc, "knowledge_base", row.id, "teams") !== null) {
      visible.add(row.id);
    }
  }
  return visible;
}

/**
 * Knowledge bases the caller may see: `canSeeBase` AND-ed with the teams narrowing,
 * in `assertBaseVisible`'s order, so a refused base costs no teams read.
 */
export async function visibleBases<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<T[]> {
  const { scoped } = await grantSets(
    caller,
    "knowledge_base",
    rows.map((r) => r.id),
    { team: false }
  );
  const admitted = rows.filter((row) =>
    canSeeBase(
      knowledgeCtxFor(caller, row.workspace_id),
      {
        id: row.id,
        visibility: row.visibility,
        createdBy: row.created_by ?? null,
      } as unknown as KnowledgeBase,
      scoped
    )
  );
  const teamsOk = await teamsModeVisible(caller, admitted);
  return admitted.filter(
    (row) => (row.access_mode ?? "workspace") !== "teams" || teamsOk.has(row.id)
  );
}

/** Skills the caller may see — team grant and workspace-admin arms included. */
export async function visibleSkills<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<T[]> {
  const ids = rows.map((r) => r.id);
  const { team } = await grantSets(caller, "skill", ids, { scope: false });
  const { myTeamIds, byId } = teamCtx(team, ids);
  return rows.filter((row) =>
    canSeeSkill(
      ctxFor(caller, row.workspace_id),
      {
        id: row.id,
        visibility: row.visibility,
        accessMode: row.access_mode ?? "workspace",
        createdBy: row.created_by ?? null,
      } as unknown as Skill,
      { myTeamIds, bySkill: byId }
    )
  );
}

/** Chats the caller may see — the team grant arm included. */
export async function visibleChats<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<T[]> {
  const ids = rows.map((r) => r.id);
  const { team } = await grantSets(caller, "chat", ids, { scope: false });
  const { myTeamIds, byId } = teamCtx(team, ids);
  return rows.filter((row) =>
    canSeeChat(
      ctxFor(caller, row.workspace_id),
      {
        id: row.id,
        visibility: row.visibility,
        access_mode: row.access_mode ?? "workspace",
        owner_id: row.owner_id ?? null,
      } as never,
      { myTeamIds, byChat: byId }
    )
  );
}

/** Agent identities the caller may see — scope grant, team share and admin. */
export async function visibleIdentities<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<T[]> {
  const ids = rows.map((r) => r.id);
  const { scoped, team } = await grantSets(caller, "agent_identity", ids);
  const { myTeamIds, byId } = teamCtx(team, ids);
  return rows.filter((row) =>
    canSeeIdentity(
      ctxFor(caller, row.workspace_id),
      {
        id: row.id,
        visibility: row.visibility,
        createdBy: row.created_by ?? null,
      } as unknown as AgentIdentity,
      { myTeamIds, byIdentity: byId, grantedIds: scoped }
    )
  );
}
