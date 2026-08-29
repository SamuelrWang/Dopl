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
 * Three-way sharing scope.
 *   private   → the creator (and workspace admins) only
 *   team      → members of any team linked through `agent_template_teams`
 *   workspace → every active workspace member
 *
 * ⚠ ONE field, not the `visibility` × `accessMode` PAIR that skills / chats /
 * knowledge bases carry — the server type's docblock carries the porting rule.
 */
export type TemplateVisibility = "private" | "team" | "workspace";

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
 * `KnowledgeBaseListPayload.homeScopedBaseIds` is one: `home_scoped` is
 * deliberately absent from `server/dto.ts › AGENT_TEMPLATE_COLS`, so the cached
 * list payload gains no new key on the ROW and §8's stale-cache rule has nothing
 * to apply to there. It applies HERE instead — read it as `?? []`.
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
   * Put the new template on the /home SHELF instead of the workspace Agents
   * page. ⚠ A REQUEST, NOT A DECISION: `src/features/agent-templates/server/
   * service-writes.ts › resolveTemplateHomeScope` is the fence and it 403s
   * rather than downgrading. Omitted/false = the workspace shelf.
   */
  homeScoped?: boolean;
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
}
