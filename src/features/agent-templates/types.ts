/**
 * Agent-template domain types. A template is a PERSISTENT agent identity —
 * name, instructions, a default model, user-defined fields and referenced
 * knowledge bases — that outlives any session spawned from it. camelCase here;
 * snake_case row shapes in `server/dto.ts`.
 *
 * ⚠ VISIBILITY IS ONE FIELD HERE AND TWO IN SKILLS/CHATS/KBs. Those features
 * store `visibility` ('public'|'private') × `accessMode` ('workspace'|'teams')
 * because `accessMode` was added to a live table and its default was the
 * backfill; `src/features/skills/scope.ts › skillScope` is the helper that
 * collapses the pair back into exactly the three values below. This table is
 * new and stores the collapsed form directly. When porting a predicate across,
 * `visibility === "team"` here == `visibility "public" + accessMode "teams"`
 * there.
 */

/**
 * ⚠ **{@link TemplateVisibility} IS DECLARED IN `@dopl/contracts ›
 * workspaces.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice A13) — it had a
 * twin in `packages/dopl-client/src/agent-template-types.ts` with no script
 * between them. No import path changed.
 */
import type { TemplateVisibility } from "@dopl/contracts";

export type { TemplateVisibility };


import type { Role } from "@/features/workspaces/types";

export const TEMPLATE_VISIBILITIES: readonly TemplateVisibility[] = [
  "private",
  "team",
  "workspace",
] as const;

/**
 * One user-defined custom field. Free-form by design — the product does not
 * know what an operator wants to carry into a session (a persona's tone, a
 * repo path, a customer id), so it does not model it. Both halves are short
 * labels: they are spliced into the launch payload an agent reads.
 */
export interface TemplateField {
  key: string;
  value: string;
}

/**
 * A knowledge base attached to a template — a REFERENCE, never a copy. Only
 * `{id, name}` is carried; the agent reads the base itself through the
 * knowledge tools, so a base that later goes private or is deleted degrades to
 * "gone" rather than to a stale snapshot living in a template.
 */
export interface TemplateKnowledgeBaseRef {
  id: string;
  name: string;
}

/**
 * WHICH SHELF a template lives on — the /home Agents pane's "Personal" section,
 * or the workspace Agents page. Two PLACES over one table (Samuel's ruling
 * 2026-08-27) and, since 2026-09-02, two CONTAINERS: the boolean of
 * `20260901120000` is dropped by `20260923120000_drop_home_scoped.sql` and the
 * personal shelf is the caller's own `kind='personal'` workspace. See
 * `features/knowledge/types.ts › KbShelf`, which carries the argument.
 *
 * ⚠ MIRRORED FROM `features/knowledge/types.ts › KbShelf`, NOT IMPORTED — §1
 * forbids the cross-feature import, and `canSeeBase` is mirrored into this
 * feature for the same reason. Same vocabulary, two declarations, on purpose.
 *
 * ⚠ NOT A FIELD ON `AgentTemplate`, and never make it one. It is a WRITE input
 * (`AgentTemplateCreateInput.homeScoped`, which ROUTES the row) and a READ
 * FILTER (`GET /api/agent-templates?shelf=`); nothing shelf-shaped is projected
 * onto the row, so the cached list payload gains no new key and §8's
 * stale-cache rule has nothing to apply to.
 *
 * 🔒 IT IS NOT THE VISIBILITY AXIS. `visibility` says who may READ; this says
 * which surface LISTS. `canSeeTemplate` never sees it.
 *
 * ⚠ ABSENT IS NOT A THIRD VALUE — it means NO FILTER, which is what keeps the
 * launch picker and `resolveTemplateForLaunch` seeing the whole workspace.
 */
export type TemplateShelf = "home" | "workspace";

export interface AgentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  /** The system-prompt-shaped block. Prose: multi-line is legitimate. */
  instructions: string | null;
  /** Default model identifier, passed through at spawn. Null = the desktop's
   *  own default; this layer holds no model roster. */
  model: string | null;
  fields: TemplateField[];
  visibility: TemplateVisibility;
  /**
   * Teams this template is shared with. ⚠ Populated only when `visibility` is
   * `'team'`, and only for the creator / workspace admins — team composition is
   * a leak otherwise, exactly as `Skill.grantedTeamIds` is gated.
   */
  teamIds: string[];
  /** Attached KBs. ⚠ Only the ones the READING caller may see — the DTO is
   *  viewer-filtered, so two callers can get different lists for one row. */
  knowledgeBases: TemplateKnowledgeBaseRef[];
  /**
   * HOW MANY ATTACHMENTS THE VIEWER FILTER DROPPED — a COUNT and nothing else
   * (Samuel's ruling, 2026-09-05).
   *
   * 🔒 ⚠ **A NUMBER IS THE WHOLE DISCLOSURE, AND THAT IS THE POINT.** The
   * dropped bases' ids, names, workspace and container are exactly what the
   * viewer filter exists to withhold, so none of them may ride here; what the
   * caller learns is only that THIS ROLE NAMES SOMETHING IT CANNOT REACH, which
   * is a fact about the caller's own session rather than about the base.
   * ⚠ **IT IS NOT PROBED FOR.** It is arithmetic over the junction rows the
   * decoration already read minus the ones the filter kept — no second query,
   * and nothing anywhere asks where a missing base actually lives.
   * ⚠ **OPTIONAL BECAUSE THE DECORATION IS**: a row that never went through
   * `decorateWithKnowledgeBases` has no answer, and `0` would be a claim.
   * Consumers read `?? 0`, which is the honest reading of "not decorated".
   */
  unreachableKnowledgeBaseCount?: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The flattened payload the desktop fetches at spawn time and the future launch
 * integration consumes VERBATIM. Deliberately NOT `AgentTemplate`: it carries
 * no ids, no visibility and no timestamps, because none of them is an input to
 * starting an agent, and a launch payload that grows fields is a payload
 * whose consumer has to guess which ones matter.
 */
export interface ResolvedAgentTemplate {
  name: string;
  instructions: string | null;
  model: string | null;
  fields: TemplateField[];
  knowledgeBases: TemplateKnowledgeBaseRef[];
  /**
   * THE SEVENTH KEY (2026-09-05): how many attached bases this launch CANNOT
   * reach. Always a number here — the launch payload has one producer, so
   * "not decorated" cannot arrive and `0` is a real answer.
   *
   * ⚠ **IT EXISTS SO THE AGENT CAN SAY SO.** A base attached in one container
   * and launched in another simply vanished from `knowledgeBases`, and an agent
   * cannot report a gap it was never told about — it read a role that named no
   * knowledge and behaved as though none was attached. With this the desktop's
   * ROLE block tells it to say *"I don't have access to this knowledge base in
   * this channel"*, which is the whole of the ruling.
   * ⚠ **A COUNT, NEVER A LOCATION.** See {@link AgentTemplate} for the argument;
   * the launch payload is the one place a leak would land in prompt text.
   * ⚠ **IT NEVER BLOCKS A LAUNCH.** The agent starts, minus the base.
   */
  unreachableKnowledgeBaseCount: number;
  /**
   * Did the RESOLVING caller write this template? (G-1, 2026-08-22.)
   *
   * ⚠ THE ONE EXCEPTION TO "no ownership in a launch payload", and it earns it:
   * the desktop's ROLE block wears a different SECURITY HEADER for another
   * member's instructions than for the operator's own, and the gate cannot be
   * built without knowing which this is. A COMPUTED BOOLEAN rather than
   * `createdBy` — it discloses nothing the caller does not already know from the
   * list endpoint, and a raw creator id in a launch payload is a fact the
   * launcher has no use for. `false` when the author has left the workspace
   * (`created_by` is `SET NULL`), which is the correct direction: nobody left
   * can vouch for it.
   */
  authoredByCaller: boolean;
}

/**
 * Request-scoped context built at the route boundary from auth metadata.
 * Mirrors `SkillContext` / `KnowledgeContext` field for field so the three
 * services read the same way.
 */
export interface AgentTemplateContext {
  workspaceId: string;
  userId: string;
  /** API-key callers = agent, session callers = user. */
  source: "user" | "agent";
  /** Caller's workspace role. Null when auth didn't resolve one → treated as
   *  non-admin, so team-scoped templates require a linked team. */
  role: Role | null;
  /**
   * Workspace this credential is fenced to. ⚠ *WHICH WORKSPACE* ONLY — it is
   * NOT the visibility answer, which is the F-333/F-336 defect (fixed
   * 2026-08-27). See {@link AgentTemplateContext.credentialSubjectUserId}.
   */
  apiKeyWorkspaceId?: string | null;
  /**
   * WHOSE REACH this credential inherits (`mcp_tokens.subject_user_id`); `null`
   * = nobody in particular. ⚠ Read ONLY through
   * `shared/auth/credential-audience.ts › isSharedCredential`. A credential that
   * may be passed between humans (CI runners, service accounts) gets NO private
   * visibility — M-10, same rule as `canSeeSkill` / `canSeeBase`. A container
   * SESSION is one human's session and is not that.
   */
  credentialSubjectUserId: string | null;
}
