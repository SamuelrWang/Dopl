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
import { canSeeTemplate } from "@/features/agent-templates/server/service-shared";
import type { KnowledgeBase } from "@/features/knowledge/types";
import type { Skill } from "@/features/skills/types";
import type { AgentTemplate } from "@/features/agent-templates/types";

/**
 * F-716 (resolved 2026-09-17): who may see a row is asked of the feature that
 * owns the row. The SQL fence this replaced (`visibility = <widest> OR owner =
 * caller`) both missed lent rows AND leaked `access_mode='teams'` ones, which
 * `canSeeSkill` / `canSeeChat` refuse to a non-granted member.
 *
 * The predicates are imported, never restated — a fifth copy would be a security
 * rule with two answers. That is a deliberate exception to INVARIANTS §1, one-way
 * and predicates only: no feature repository is reached from here.
 *
 * The narrowing moved out of SQL, so reads fetch a candidate page and cut it
 * here, bounded by {@link SEARCH_CANDIDATE_ROW_LIMIT} (over the cap, a container
 * under-counts). The CONTAINER fence did not move: candidate reads are still
 * `WHERE workspace_id IN (<the reach>)`.
 *
 * A shared credential (`ownerUserId === null`) is refused everything but the
 * widest visibility by arm 2 of all four predicates, so no grant table is read.
 */

/**
 * Ceiling on the page the predicate is applied to, distinct from the group cap of
 * 50: four times it, so a container needs 150 matching rows the caller cannot see
 * before one they can is dropped.
 */
export const SEARCH_CANDIDATE_ROW_LIMIT = 200;

/**
 * The caller, as the four predicates need them. `role` is a map because it is per
 * container: the workspace-admin arm is about the row's container, never about
 * "somewhere the caller is an admin".
 */
export interface SearchCaller {
  userId: string;
  /** `null` = a credential standing for nobody. Every arm below is skipped. */
  ownerUserId: string | null;
  credentialSubjectUserId: string | null;
  roleByContainer: ReadonlyMap<string, Role>;
}

/** What every predicate's context needs, filled for ONE container. */
function ctxFor(caller: SearchCaller, workspaceId: string) {
  return {
    workspaceId,
    userId: caller.userId,
    role: caller.roleByContainer.get(workspaceId) ?? null,
    source: "user" as const,
    // Never `caller.lockedWorkspaceId` — this axis is whose reach, and reading
    // the container lock for it is F-336 exactly.
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: caller.credentialSubjectUserId,
  };
}

/**
 * `KnowledgeContext.role` is non-nullable where the other three accept `null`, so
 * it gets the least-privileged value. `canSeeBase` reads no role at all: this is a
 * type obligation met fail-closed, not a role being asserted.
 */
function knowledgeCtxFor(caller: SearchCaller, workspaceId: string) {
  const ctx = ctxFor(caller, workspaceId);
  return { ...ctx, role: ctx.role ?? ("guest" as Role) };
}

/** The rows a candidate read hands over, before any predicate has spoken. */
export interface CandidateRow {
  id: string;
  workspace_id: string;
  visibility: string;
  access_mode?: string | null;
  created_by?: string | null;
  owner_id?: string | null;
}

/**
 * The two grant sets a request needs, read once for the whole candidate page —
 * not once per container. Both readers key on the caller and a resource-id page.
 */
async function grantSets(
  caller: SearchCaller,
  type: "knowledge_base" | "agent_template" | "skill" | "chat",
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

/** teamId lists per resource, as the skill/chat/template contexts spell them. */
function teamCtx(granted: GrantedResourceIds, ids: readonly string[]) {
  const MINE = "granted";
  const byId = new Map<string, string[]>();
  for (const id of ids) if (granted.has(id)) byId.set(id, [MINE]);
  // One synthetic team id: the predicates only ask whether any team the row is
  // lent to is one of the caller's, and `teamGrantedResourceIds` already
  // intersected those sets. Real ids matter only for `grantedTeamIds`, not here.
  return { myTeamIds: new Set([MINE]), byId };
}

/**
 * Ceiling on the one per-container fan here: {@link teamsModeVisible} cannot be
 * batched across containers, and its input page is 500 rows. Containers past this
 * are dropped, which hides rows and never shows one — fail-closed, like every
 * other cap in this file.
 */
export const SEARCH_TEAMS_CONTAINER_LIMIT = 50;

/**
 * The teams narrowing for knowledge bases — F-716's residual, closed 2026-09-17.
 * Not a second teams rule: `canSeeBase` has no teams arm, so this calls the same
 * `listEffectiveAccess` + `resolveLevel` that `assertBaseVisible` does.
 *
 * A caller with no teams-mode row on the page pays nothing, which is what makes
 * the per-container fan acceptable.
 *
 * Fail-closed both ways: a container the caller holds no role for is skipped
 * without a read (a guessed `viewer` would bypass `listEffectiveAccess`'s own
 * membership check), and a `null` answer drops the rows too.
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
 * Knowledge bases the caller may see. The order mirrors `assertBaseVisible` —
 * M-10 + grant arm first, then {@link teamsModeVisible}, AND-ed — so a base
 * `canSeeBase` already refuses never costs a teams read.
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

/** Agent templates the caller may see — scope grant, team share and admin. */
export async function visibleTemplates<T extends CandidateRow>(
  caller: SearchCaller,
  rows: readonly T[]
): Promise<T[]> {
  const ids = rows.map((r) => r.id);
  const { scoped, team } = await grantSets(caller, "agent_template", ids);
  const { myTeamIds, byId } = teamCtx(team, ids);
  return rows.filter((row) =>
    canSeeTemplate(
      ctxFor(caller, row.workspace_id),
      {
        id: row.id,
        visibility: row.visibility,
        createdBy: row.created_by ?? null,
      } as unknown as AgentTemplate,
      { myTeamIds, byTemplate: byId, grantedIds: scoped }
    )
  );
}
