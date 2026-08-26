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

import type { Role } from "@/features/workspaces/types";

/**
 * Three-way sharing scope.
 *   private   → the creator (and workspace admins) only
 *   team      → members of any team linked through `agent_template_teams`
 *   workspace → every active workspace member
 */
export type TemplateVisibility = "private" | "team" | "workspace";

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
   * 2026-08-27). See {@link AgentTemplateContext.apiKeyWorkspaceLockKind}.
   */
  apiKeyWorkspaceId?: string | null;
  /**
   * `mcp_tokens.workspace_lock_kind`. ⚠ Read ONLY through
   * `shared/auth/credential-audience.ts › isSharedCredential`; absent reads as
   * a SHARED credential. A credential that may be shared between humans (CI
   * runners, service accounts) gets NO private visibility — M-10, same rule as
   * `canSeeSkill` / `canSeeBase`. A container-SESSION credential is one human's
   * session and is not that.
   */
  apiKeyWorkspaceLockKind?: string | null;
}
