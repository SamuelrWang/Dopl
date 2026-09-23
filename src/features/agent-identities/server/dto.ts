import "server-only";
import {
  IDENTITY_FIELD_TYPES,
  type AgentIdentity,
  type IdentityField,
  type IdentityFieldType,
  type IdentityVisibility,
} from "../types";

/**
 * `agent_identities` row shape and its mapping. `teamIds` / `knowledge*` are not columns: the
 * service decorates them per viewer (`service-shared.ts › withSharingSet`, `decorateWithKnowledgeBases`).
 */

export const AGENT_IDENTITY_COLS =
  "id, workspace_id, name, description, instructions, model, runtime, fields, visibility, created_by, created_at, updated_at";

export interface AgentIdentityRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  model: string | null;
  /** Optional: a stale PostgREST schema cache omits it. */
  runtime?: string | null;
  fields: unknown;
  visibility: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The DB CHECK guarantees only an array ≤ 8192 bytes, never element shape — malformed elements drop. */
function normalizeFields(raw: unknown): IdentityField[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { key, value, type } = item as { key?: unknown; value?: unknown; type?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    // An unknown `type` reads as absent (= text), never as a refusal of the field.
    const known = IDENTITY_FIELD_TYPES.includes(type as IdentityFieldType);
    out.push(known ? { key, value, type: type as IdentityFieldType } : { key, value });
  }
  return out;
}

export function mapAgentIdentityRow(row: AgentIdentityRow): AgentIdentity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    model: row.model,
    runtime: row.runtime ?? null,
    fields: normalizeFields(row.fields),
    // The column CHECK is the guarantee; the cast is not a validation.
    visibility: row.visibility as IdentityVisibility,
    teamIds: [],
    knowledgeBases: [],
    knowledge: [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
