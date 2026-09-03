/**
 * Domain types for AGENT TEMPLATES — persistent agent identities (name,
 * instructions, default model, custom fields, attached knowledge bases) that
 * outlive any session spawned from them.
 *
 * ⚠ Mirrors `src/features/agent-templates/types.ts` — hand-synced, the same way
 * `knowledge-types.ts` mirrors the knowledge feature. On drift the API response
 * is the source of truth. ⚠ No drift GATE covers this pair:
 * `scripts/check-knowledge-type-drift.ts` names four knowledge interfaces and
 * `scripts/check-role-drift.ts` names the role set; neither reaches here, so
 * both halves must move in ONE change.
 */

/**
 * ⚠ **{@link TemplateVisibility} IS DECLARED IN `@dopl/contracts ›
 * workspaces.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice A13) — it was a
 * hand mirror of `src/features/agent-templates/types.ts`. No consumer import
 * changed.
 */
import type { TemplateVisibility } from "@dopl/contracts";

export type { TemplateVisibility };


/** One user-defined custom field. Both halves are short LABELS: they are
 *  spliced into the launch payload an agent reads back line by line. */
export interface TemplateField {
  key: string;
  value: string;
}

/** A knowledge base attached to a template — a REFERENCE, never a copy. */
export interface TemplateKnowledgeBaseRef {
  id: string;
  name: string;
}

/**
 * WHICH SHELF a template lives on — the /home Agents pane's "Personal" section,
 * or the workspace Agents page. Two PLACES over one table, and they exclude
 * each other BOTH ways.
 *
 * ⚠ THIS IS THE WIRE VOCABULARY (`home` | `workspace`), which is what
 * `GET /api/agent-templates?shelf=` accepts. The MCP tool arg says
 * **`personal`** and is mapped onto this in exactly ONE place
 * (`packages/mcp-server/src/tools/shelf.ts`) — Samuel's ruling Q1, 2026-08-28.
 *
 * ⚠ ABSENT IS NOT A THIRD VALUE — it means NO FILTER, which is what keeps the
 * launch picker and every pre-existing caller seeing the whole workspace.
 *
 * 🔒 IT IS NOT THE VISIBILITY AXIS. `visibility` says who may READ; this says
 * which surface LISTS.
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
  /** ⚠ Populated only when `visibility` is `'team'`, and only for the creator /
   *  workspace admins — team composition is a leak otherwise. */
  teamIds: string[];
  /** ⚠ Only the ones the READING caller may see — the DTO is viewer-filtered,
   *  so two callers can get different lists for one row. */
  knowledgeBases: TemplateKnowledgeBaseRef[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/agent-templates`, as the rows PLUS the shelf sibling key.
 *
 * 🔒 ⚠ **SIBLING KEY, NOT A ROW FIELD**, for the same reason
 * `KnowledgeBaseListPayload.homeScopedBaseIds` is one: nothing shelf-shaped is
 * projected onto the row (and since 2026-09-02 there is no column to project —
 * the shelf is the row's own container), so the cached list payload gains no new
 * key THERE and §8's stale-cache rule applies HERE — read it as `?? []`.
 */
export interface AgentTemplateListPayload {
  templates: AgentTemplate[];
  /** Ids of the listed templates on the caller's PERSONAL (/home) shelf. */
  homeScopedTemplateIds?: string[];
}

export interface AgentTemplateCreateInput {
  name: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  fields?: TemplateField[];
  visibility?: TemplateVisibility;
  /** ⚠ Requires `visibility: 'team'`; the server refuses the pair otherwise
   *  rather than dropping it. */
  teamIds?: string[];
  /** REPLACE-SET, never merged. Every id must be visible to the caller. */
  knowledgeBaseIds?: string[];
  /**
   * Put the new template on the PERSONAL SHELF instead of the workspace Agents
   * page. ⚠ A REQUEST, NOT A DECISION, and since 2026-09-02 it ROUTES the row's
   * container rather than being stored on it: `src/shared/tenancy/
   * personal-container.ts › personalWriteWorkspaceId` is the fence and it 403s
   * rather than downgrading. Omitted/false = the container the call is in.
   */
  homeScoped?: boolean;
  /**
   * 🔒 "I know this publishes into a room somebody else is standing in."
   *
   * ⚠ REQUIRED ONLY ON THE NARROW PREDICATE — a `kind='link'` container with
   * two or more active members, and the row landing at the SHARED visibility.
   * The server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED` without it and IGNORES
   * it everywhere else (`src/features/workspaces/server/shared-publish.ts`).
   * The MCP surface sets it from a spent `confirm_token`, never on its own.
   */
  acknowledgeShared?: boolean;
}

/**
 * All fields optional. ⚠ `null` and ABSENT differ and both are meaningful:
 * absent leaves the column alone, `null` CLEARS it. `fields`,
 * `knowledgeBaseIds` and `teamIds` are REPLACE-SET.
 *
 * ⚠ NO `homeScoped`. The shelf is set at CREATE and never written again (F-342,
 * and Samuel's ruling Q8 2026-08-28 keeps it that way for v1) — the server's
 * update schema does not accept it, so neither does this.
 */
export interface AgentTemplateUpdateInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  fields?: TemplateField[];
  visibility?: TemplateVisibility;
  teamIds?: string[];
  knowledgeBaseIds?: string[];
  /**
   * 🔒 "I know this publishes into a room somebody else is standing in."
   *
   * ⚠ REQUIRED ONLY ON THE NARROW PREDICATE — a `kind='link'` container with
   * two or more active members, and the row landing at the SHARED visibility.
   * The server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED` without it and IGNORES
   * it everywhere else (`src/features/workspaces/server/shared-publish.ts`).
   * The MCP surface sets it from a spent `confirm_token`, never on its own.
   */
  acknowledgeShared?: boolean;
}
