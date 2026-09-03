import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import {
  grantedResourceIds,
  NO_GRANTS,
  type GrantedResourceIds,
} from "@/shared/tenancy/resource-grant-reach";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type {
  AgentTemplate,
  AgentTemplateContext,
  TemplateKnowledgeBaseRef,
} from "../types";
import * as repo from "./repository";
import type { KnowledgeBaseAccessRow } from "./repository";

/**
 * Cross-cutting gates for the agent-templates service: context construction,
 * the `canSeeTemplate` visibility matrix and its batch precompute, the
 * viewer-filtered sharing/attachment decoration, and the mirrored knowledge
 * access predicate the KB-attach gate is built on.
 *
 * ⚠ `./repository.ts` bypasses RLS via the service-role client — every caller
 * MUST filter by `ctx.workspaceId` or workspaces leak into each other.
 */

// ─── Context ────────────────────────────────────────────────────────────

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

export function buildAgentTemplateContext(
  auth: AuthLike
): AgentTemplateContext {
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

export function isWorkspaceAdmin(ctx: AgentTemplateContext): boolean {
  return ctx.role !== null && meetsMinRole(ctx.role, "admin");
}

// ─── Visibility ─────────────────────────────────────────────────────────

/**
 * Precomputed sharing context for a row set. Same shape and same fetch
 * discipline as `skills/server/service-shared.ts › SkillGrantCtx`: a FIXED
 * number of queries per request, no matter how many templates there are.
 */
export interface TemplateShareCtx {
  /** Teams the caller belongs to. Fetched only when some row needs it. */
  myTeamIds: Set<string>;
  /** templateId → linked team ids. */
  byTemplate: Map<string, string[]>;
  /**
   * Template ids lent to a channel or container the caller is in — the GRANT
   * axis, added 2026-09-02 (F-604). ⚠ It rides this context rather than a
   * second parameter precisely because a second parameter is what a caller
   * forgets: every existing `canSeeTemplate` call already threads a
   * `TemplateShareCtx`, so the arm arrives everywhere at once.
   */
  grantedIds: GrantedResourceIds;
}

const EMPTY_SHARE_CTX: TemplateShareCtx = {
  myTeamIds: new Set(),
  byTemplate: new Map(),
  grantedIds: NO_GRANTS,
};

export async function shareCtxForTemplates(
  ctx: AgentTemplateContext,
  rows: AgentTemplate[]
): Promise<TemplateShareCtx> {
  const teamScoped = rows.filter((t) => t.visibility === "team");
  // ⚠ **THE `team` SHORT-CIRCUIT NO LONGER SHORT-CIRCUITS THE WHOLE CONTEXT.**
  // A grant is orthogonal to visibility — a `private` row is the ordinary thing
  // to lend — so returning `EMPTY_SHARE_CTX` for a row set with no team-scoped
  // member would have dropped the grant arm on exactly the rows it is for. The
  // grant read has its own empty-input short-circuit.
  const grantedIds = await grantedResourceIds(
    ctx.userId,
    "agent_template",
    rows.filter((t) => needsGrantArm(ctx, t)).map((t) => t.id)
  );
  if (teamScoped.length === 0) {
    return grantedIds === NO_GRANTS
      ? EMPTY_SHARE_CTX
      : { ...EMPTY_SHARE_CTX, grantedIds };
  }
  // The caller's own team-scoped rows are visible without a membership lookup,
  // and a SHARED credential never gets one (it has no person behind it).
  // ⚠ `isSharedCredential`, not the lock: a container session HAS a person
  // behind it, so it resolves teams like the human it acts for (F-336).
  const needsMembership = teamScoped.some((t) => t.createdBy !== ctx.userId);
  const [myTeams, links] = await Promise.all([
    needsMembership && !isSharedCredential(ctx)
      ? repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    repo.listTeamLinksForTemplates(
      ctx.workspaceId,
      teamScoped.map((t) => t.id)
    ),
  ]);
  const byTemplate = new Map<string, string[]>();
  for (const link of links) {
    byTemplate.set(link.templateId, [
      ...(byTemplate.get(link.templateId) ?? []),
      link.teamId,
    ]);
  }
  return { myTeamIds: new Set(myTeams), byTemplate, grantedIds };
}

/**
 * THE VISIBILITY MATRIX. Arms in evaluation order, and the order is
 * load-bearing:
 *   1. `workspace`                      → every member, including agents.
 *   2. a SHARED credential              → NOTHING further (M-10: such a
 *                                         credential may be shared between
 *                                         humans, so it never inherits one
 *                                         person's reach).
 *   3. creator                          → always.
 *   4. a GRANT into a channel or container the caller is in → yes.
 *   5. `private`                        → nobody else, ADMINS INCLUDED.
 *   6. workspace admin, `team`          → always.
 *   7. `team` + a shared team in common → yes.
 *
 * ⚠ **ARM 4 IS NEW ON 2026-09-02 (F-604) AND ITS POSITION IS THE DECISION.** A
 * lent row is `private` — that is the ordinary thing to lend — so anywhere
 * below arm 5 it would be unreachable and B15's write door would go on writing
 * rows nothing reads. It is BELOW arm 2 for the reason arm 2 exists: a
 * credential that stands for nobody has no membership of the granted scope to
 * read the grant through. `shared/tenancy/resource-grant-reach.ts` holds the
 * lookup and states which levels admit a HUMAN read.
 *
 * ⚠ ARM 5 BEFORE ARM 6 IS THE WHOLE OF "PRIVATE MEANS PRIVATE": a workspace
 * admin administers SHARING, which is why they pass on a `team` template, and
 * that is not a licence to read a teammate's private one. `canSeeSkill` orders
 * its arms the same way (it returns false for `visibility !== "public"` before
 * reaching its admin check).
 *
 * ⚠ THIS FUNCTION AND `agent_templates_member_select` IN
 * `supabase/migrations/20260822200000_agent_templates.sql` ARE ONE RULE WRITTEN
 * TWICE — same arms, same order, including the admin arm's placement INSIDE the
 * team branch. They must move together. `20260716150000_chats_team_aware_rls.sql`
 * is the record of what it costs when they do not: RLS stayed permissive after
 * the service tightened, and a team-scoped transcript leaked through PostgREST
 * to every member for as long as nobody compared them.
 *
 * 🔒 ⚠ ARM 2 ASKS `isSharedCredential`, NOT `ctx.apiKeyWorkspaceId` — F-333,
 * ruled by Samuel and fixed 2026-08-27. The old form made every PRIVATE
 * template invisible to the agents running in a container: layer B1 sets the
 * lock for every read a session in a shared container makes, so such a row could
 * not be listed, named or resolved by the very agent it was made for. ⚠ **THE
 * CASE THAT SURFACED IT WAS THE "Use in this channel" COPY**, which forced
 * `private` and is deleted in B15; the arm is unchanged and the population it
 * covers is now every personal row. **A container-session credential is the operator's own session**,
 * so arm 3 (creator) now answers for it exactly as it answers for the operator
 * at their keyboard. ⚠ NO PEER EXPOSURE IS OPENED: the peer, and the peer's own
 * agent, carry the PEER's user id, so arm 3 misses and arm 5 (`private` → nobody
 * else, admins included) refuses them — unless the row was deliberately GRANTED
 * to a scope that peer is in, which is arm 4 and is the point of it. Guests never reach a template surface at
 * all — every `agent-templates` route and `POST /api/channels/launch-directives`
 * sits at `withWorkspaceAuth`'s `viewer` floor and `guest` ranks below it.
 */
/**
 * Rows whose answer arm 4 could still CHANGE — the negation of arms 1-3, and
 * the twin of `knowledge/server/service-shared.ts › needsGrantArm`.
 *
 * ⚠ **A DELIBERATE MIRROR OF THE ARMS BELOW, PINNED AS ONE** by
 * `shared/tenancy/grant-read-arm.test.ts`, which drives every (credential ×
 * visibility × author) combination through both and fails if a row this says NO
 * about would have had its answer moved by a grant. It buys the case that
 * matters: a workspace whose templates are all `workspace`-visible, or all the
 * caller's own, asks the grant table nothing.
 */
export function needsGrantArm(
  ctx: AgentTemplateContext,
  template: AgentTemplate
): boolean {
  return (
    template.visibility !== "workspace" &&
    !isSharedCredential(ctx) &&
    template.createdBy !== ctx.userId
  );
}

export function canSeeTemplate(
  ctx: AgentTemplateContext,
  template: AgentTemplate,
  share: TemplateShareCtx
): boolean {
  if (template.visibility === "workspace") return true;
  if (isSharedCredential(ctx)) return false;
  if (template.createdBy !== null && template.createdBy === ctx.userId) {
    return true;
  }
  // 🔒 ARM 4 IS THE GRANT (F-604, 2026-09-02), AND IT PRECEDES THE `private`
  // REFUSAL RATHER THAN FOLLOWING IT. A lent row is `private` — that is the
  // ordinary thing to lend — so an arm below arm 5 would never be reached, and
  // the write door B15 shipped would go on writing rows nothing reads. It stays
  // BELOW the shared-credential refusal for the reason `canSeeBase`'s twin
  // states: a credential standing for nobody has no membership of the granted
  // scope to read the grant through.
  if (share.grantedIds.has(template.id)) return true;
  if (template.visibility === "private") return false;
  if (isWorkspaceAdmin(ctx)) return true;
  const linked = share.byTemplate.get(template.id) ?? [];
  return linked.some((teamId) => share.myTeamIds.has(teamId));
}

/**
 * ⚠ THE SHARING SET IS FOR OWNERS AND ADMINS ONLY. A teammate who can SEE a
 * team-scoped template has no business learning which OTHER teams it is shared
 * with — that is workspace org-chart information leaking through a template.
 * Same rule as `skills/server/service-shared.ts › withGrantSet`.
 */
export function withSharingSet(
  ctx: AgentTemplateContext,
  template: AgentTemplate,
  share: TemplateShareCtx
): AgentTemplate {
  if (template.visibility !== "team") return { ...template, teamIds: [] };
  const maySee =
    (template.createdBy !== null && template.createdBy === ctx.userId) ||
    isWorkspaceAdmin(ctx);
  if (!maySee) return { ...template, teamIds: [] };
  return { ...template, teamIds: share.byTemplate.get(template.id) ?? [] };
}

// ─── Knowledge-base access (the attach gate's predicate) ────────────────

/**
 * `canSeeBase` MIRRORED, not imported — `@/features/knowledge` is another
 * feature and §1 forbids the import, so the rule is restated over rows this
 * feature reads for itself. Kept deliberately identical in shape to
 * `knowledge/server/service-shared.ts › canSeeBase` + `assertBaseVisible`:
 *   public + workspace mode  → any member
 *   public + teams mode      → creator, workspace admin, or a granted team
 *   private                  → creator only, and NEVER via a SHARED credential
 *                              (`isSharedCredential`, moved with `canSeeBase`
 *                              on 2026-08-27 — F-336)
 *
 * ⚠ IF THAT FILE'S RULE CHANGES, THIS ONE IS THE COPY THAT WILL NOT NOTICE.
 * The failure direction is over-permissive (attaching a KB the caller lost
 * access to), so the drift is worth a test rather than a comment alone —
 * `service-writes.test.ts › KB attach validation` pins each arm.
 *
 * ⚠ THAT FILENAME WAS `service.test.ts` UNTIL 2026-08-23 AND NO SUCH FILE HAS
 * EVER EXISTED (F-290, the F-280 class repeated). A reviewer checking whether
 * the tripwire was really written grepped a path that resolves to nothing and
 * would reasonably have concluded it was not. ⚠ NOTHING CHECKS THIS: the file
 * refs `scripts/check-doc-refs.mjs` resolves are the ones inside `docs/` — its
 * one pass over `src/` matches `F-NNN` ids only — so a `.test.ts` cited from a
 * SOURCE docblock is verified by no gate. Cite carefully; it is a hand-check.
 */
export function canSeeBaseRow(
  ctx: AgentTemplateContext,
  base: KnowledgeBaseAccessRow,
  grantedTeamsByBase: Map<string, string[]>,
  myTeamIds: Set<string>
): boolean {
  if (base.visibility === "private") {
    if (isSharedCredential(ctx)) return false;
    return base.createdBy !== null && base.createdBy === ctx.userId;
  }
  if (base.accessMode !== "teams") return true;
  if (base.createdBy !== null && base.createdBy === ctx.userId) return true;
  if (isWorkspaceAdmin(ctx)) return true;
  if (isSharedCredential(ctx)) return false;
  const granted = grantedTeamsByBase.get(base.id) ?? [];
  return granted.some((teamId) => myTeamIds.has(teamId));
}

/**
 * Resolve KB ids to `{id, name}` refs, dropping every base the CALLER cannot
 * currently read. Used by BOTH the attach gate (where a dropped id is an
 * error) and the read path (where it is simply omitted) — one predicate, two
 * consumers, so an attach can never permit what a read would hide.
 *
 * Fixed query count: at most three, regardless of how many bases.
 */
export async function resolveVisibleKnowledgeBases(
  ctx: AgentTemplateContext,
  ids: string[]
): Promise<TemplateKnowledgeBaseRef[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const bases = await repo.listKnowledgeBaseAccessRows(ctx.workspaceId, unique);
  if (bases.length === 0) return [];
  const teamScoped = bases.filter(
    (b) => b.visibility !== "private" && b.accessMode === "teams"
  );
  const needsTeams =
    teamScoped.length > 0 &&
    !isSharedCredential(ctx) &&
    !isWorkspaceAdmin(ctx) &&
    teamScoped.some((b) => b.createdBy !== ctx.userId);
  const [grants, myTeams] = await Promise.all([
    needsTeams
      ? repo.listKnowledgeBaseTeamGrants(
          ctx.workspaceId,
          teamScoped.map((b) => b.id)
        )
      : Promise.resolve([]),
    needsTeams
      ? repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
  ]);
  const grantedTeamsByBase = new Map<string, string[]>();
  for (const g of grants) {
    grantedTeamsByBase.set(g.knowledgeBaseId, [
      ...(grantedTeamsByBase.get(g.knowledgeBaseId) ?? []),
      g.teamId,
    ]);
  }
  const myTeamIds = new Set(myTeams);
  return bases
    .filter((b) => canSeeBaseRow(ctx, b, grantedTeamsByBase, myTeamIds))
    .map((b) => ({ id: b.id, name: b.name }));
}
