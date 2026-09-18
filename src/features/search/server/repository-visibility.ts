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
 * 🔒 **WHO MAY SEE A ROW — ASKED OF THE FEATURE THAT OWNS THE ROW (F-716,
 * RESOLVED 2026-09-17).**
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * `repository-container-rows.ts` narrowed four tables with
 * `visibility = <widest> OR <owner> = caller`, a hand-written SQL restatement of
 * the two CHEAPEST arms of each feature's `canSee*`. F-716 filed that as a MISS
 * (a base lent into this container did not appear in the popup though its own
 * page listed it) on the argument that every missing arm could only ADD rows.
 *
 * ⚠ **THAT ARGUMENT WAS TRUE OF THE GRANT ARMS AND FALSE OF THE TEAM ONES, AND
 * THE SECOND HALF IS THE MORE URGENT ONE.** `visibility='public'` also admits a
 * `access_mode='teams'` skill or chat — which `canSeeSkill` / `canSeeChat`
 * REFUSE to a member who is in none of the granted teams and is not a workspace
 * admin. The old fence was therefore not a subset in one direction: it was a
 * miss on lent rows **and a leak on team-scoped ones**. The entry's "strict
 * subset" claim is corrected with the code.
 *
 * ── THE SHAPE, AND WHY IT IS NOT A FIFTH COPY ──────────────────────────────
 *
 * 🔒 **THE PREDICATES ARE IMPORTED, NEVER RESTATED.** `canSeeBase`,
 * `canSeeSkill`, `canSeeChat` and `canSeeTemplate` are called here with a
 * context built for the row's OWN container. F-716's own words for the
 * alternative: *"Doing it wrong would put a second, drifting copy of four
 * visibility predicates in a fifth feature"* — and `agent-templates ›
 * canSeeBaseRow` is the tree's standing example of what a copy costs (its
 * docblock: *"IF THAT FILE'S RULE CHANGES, THIS ONE IS THE COPY THAT WILL NOT
 * NOTICE"*).
 *
 * ⚠ **IT IS A CROSS-FEATURE IMPORT AND INVARIANTS §1 SAYS THERE ARE NONE.**
 * They disagree, and this is the side that was chosen: a predicate re-typed in a
 * fifth feature is a SECURITY rule with two answers, which is worse than a
 * layering rule with one exception. §1 now records the exception and its reason
 * rather than being silently broken — CLAUDE.md's *"never silently pick a
 * side"*. ⚠ **IT IS ONE-WAY AND IT IS PREDICATES ONLY**: nothing is imported
 * back out of search, and no feature's REPOSITORY is reached from here — the
 * rows come from this feature's own reads and the grant sets from
 * `src/shared/tenancy/`.
 *
 * ── THE COST, STATED ───────────────────────────────────────────────────────
 *
 * ⚠ **THE VISIBILITY NARROWING MOVED OUT OF SQL, SO THE READ FETCHES A
 * CANDIDATE PAGE AND CUTS IT HERE.** {@link SEARCH_CANDIDATE_ROW_LIMIT} bounds
 * the fetch; a container whose matching rows exceed it searches a bounded subset
 * and under-counts, exactly as `SEARCH_REACH_ROW_LIMIT` already does for bases.
 * **The CONTAINER fence did not move**: every candidate read is still
 * `WHERE workspace_id IN (<the reach>)`, so a row from a container the caller is
 * not in is never NAMED, let alone filtered.
 *
 * ⚠ **A SHARED CREDENTIAL NEVER REACHES ANY OF THIS.** Arm 2 of all four
 * predicates refuses it everything but the widest visibility, so the caller with
 * `ownerUserId === null` keeps the cheap SQL arm and no grant table is read —
 * the same rule, spelled as an absence.
 */

/**
 * ⚠ A ceiling on the page the PREDICATE is applied to, distinct from the group
 * cap: the group's 50 is what survives, this is what is looked at. Four times
 * the group cap, so a container would need 150 matching rows the caller cannot
 * see before one they can is dropped.
 */
export const SEARCH_CANDIDATE_ROW_LIMIT = 200;

/**
 * The caller, as the four predicates need them.
 *
 * ⚠ `role` IS PER CONTAINER and account scope spans many, so it is a MAP rather
 * than a field: the workspace-admin arm of `canSeeSkill` / `canSeeTemplate` is
 * about the row's container, never about "somewhere the caller is an admin".
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
    // ⚠ NEVER `caller.lockedWorkspaceId`. This axis is WHOSE REACH, and reading
    // the container lock for it is F-336 exactly.
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: caller.credentialSubjectUserId,
  };
}

/**
 * ⚠ `KnowledgeContext.role` IS NON-NULLABLE WHERE THE OTHER THREE ACCEPT
 * `null`, so the ONE context that needs a value gets the LEAST-PRIVILEGED one.
 * `canSeeBase` reads no role at all — that feature spends it in
 * `assertBaseVisible`'s teams check, which is not on this path — so this is a
 * type obligation being met fail-closed rather than a role being asserted.
 */
function knowledgeCtxFor(caller: SearchCaller, workspaceId: string) {
  const ctx = ctxFor(caller, workspaceId);
  return { ...ctx, role: ctx.role ?? ("viewer" as Role) };
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
 * 🔒 The two grant sets a request needs, read ONCE for the whole candidate page.
 * ⚠ **NOT ONE READ PER CONTAINER** — that fan is what F-716 said made the honest
 * fix non-trivial, and `shared/tenancy/resource-grant-reach.ts` is where it is
 * avoided: both readers key on the caller and on a resource-id page.
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
  // ⚠ ONE SYNTHETIC TEAM ID, AND IT IS HONEST. The predicates ask *"is any team
  // this row is lent to one of MINE"*; `teamGrantedResourceIds` has already
  // intersected those two sets, so the only faithful thing left to say is
  // "yes, by a team you are in". Carrying the real ids would be a second answer
  // to a question already answered — and the DTO's `grantedTeamIds`, which is
  // the one place the real ids matter, is not built on this path.
  return { myTeamIds: new Set([MINE]), byId };
}

/**
 * ⚠ **A STATED CEILING ON THE ONE PER-CONTAINER FAN IN THIS FILE.**
 * {@link teamsModeVisible} is the only reader here that cannot be batched across
 * containers, and its input page is `SEARCH_REACH_ROW_LIMIT` (500) rows — so without a
 * bound a pathological page is 500 concurrent multi-query reads. Containers past this
 * are DROPPED, which hides rows and never shows one: the same fail-closed direction
 * every other cap in this file takes.
 */
export const SEARCH_TEAMS_CONTAINER_LIMIT = 50;

/**
 * 🔒 **THE TEAMS NARROWING FOR KNOWLEDGE BASES — F-716's RESIDUAL, CLOSED 2026-09-17.**
 *
 * ⚠ **THIS IS NOT A SECOND TEAMS RULE.** `canSeeBase` has no teams arm; that feature
 * spends the question in `assertBaseVisible` / `filterTeamVisibleBases` through
 * `teams/server/access.ts › listEffectiveAccess` + `resolveLevel`, and those two are
 * what this calls. The same batch reader and the same resolver, a second caller.
 *
 * ⚠ **A CALLER WITH NO TEAMS-MODE ROW ON THE PAGE PAYS NOTHING**, which is what makes
 * the fan acceptable where `teamGrantedResourceIds` exists to avoid one.
 *
 * ⚠ **TWO WAYS TO DROP A ROW, BOTH CLOSED.** A container this caller holds no ROLE for
 * is not one they are in, so its rows go without a read — passing a guessed `viewer`
 * would skip `listEffectiveAccess`'s own membership check and admit a non-member's own
 * teams-mode row, which the base's page refuses. And `listEffectiveAccess` answering
 * `null` (not active, or a role with no level at all) drops them too.
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
 * Knowledge BASES the caller may see — `canSeeBase`, then the TEAMS narrowing the
 * base's own page applies ({@link teamsModeVisible}).
 *
 * ⚠ **THE ORDER MIRRORS `assertBaseVisible`**: M-10 + the grant arm first, the teams
 * question second, AND-ed. A teams-mode base `canSeeBase` already refuses never costs a
 * teams read.
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
