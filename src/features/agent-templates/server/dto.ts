import "server-only";
import type {
  AgentTemplate,
  TemplateField,
  TemplateKnowledgeBaseRef,
  TemplateVisibility,
} from "../types";

/**
 * `agent_templates` row shape + snake_case → camelCase mapping. `fields`
 * arrives from PostgREST already parsed out of JSONB and is narrowed here —
 * never trusted, because a row written before a schema change is still a row.
 *
 * ⚠ `teamIds` and `knowledgeBases` are NOT columns. They are side-loaded by the
 * repository from the two junctions and passed in, so the mapper stays a pure
 * row→domain function with no IO and the caller decides what a given reader is
 * allowed to be told (see `withSharingSet` in `service-shared.ts`).
 */

export const AGENT_TEMPLATE_COLS =
  "id, workspace_id, name, description, instructions, model, fields, visibility, created_by, created_at, updated_at";

export interface AgentTemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  model: string | null;
  fields: unknown;
  visibility: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * ⚠ DEFENSIVE, and the reason is the DB CHECK's own scope: the migration
 * asserts `jsonb_typeof(fields) = 'array'` and a SIZE, and deliberately leaves
 * ELEMENT shape to zod (a per-write jsonb walk is the cost `20260731110000`
 * declined to pay). So the database guarantees an array and nothing about what
 * is in it — a malformed element is dropped here rather than reaching a launch
 * payload as `{key: undefined}`.
 */
export function normalizeFields(raw: unknown): TemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { key, value } = item as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    out.push({ key, value });
  }
  return out;
}

export interface TemplateSideload {
  teamIds?: string[];
  knowledgeBases?: TemplateKnowledgeBaseRef[];
}

export function mapAgentTemplateRow(
  row: AgentTemplateRow,
  sideload: TemplateSideload = {}
): AgentTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    model: row.model,
    fields: normalizeFields(row.fields),
    // The CHECK constraint is the guarantee; the cast is not a validation.
    visibility: row.visibility as TemplateVisibility,
    teamIds: sideload.teamIds ?? [],
    knowledgeBases: sideload.knowledgeBases ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
