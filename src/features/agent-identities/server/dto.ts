import "server-only";
import {
  IDENTITY_FIELD_TYPES,
  type AgentIdentity,
  type IdentityField,
  type IdentityFieldType,
  type IdentityVisibility,
} from "../types";

/**
 * `agent_identities` row shape + snake_case → camelCase mapping. `fields`
 * arrives from PostgREST already parsed out of JSONB and is narrowed here —
 * never trusted, because a row written before a schema change is still a row.
 *
 * ⚠ `teamIds` and `knowledgeBases` are NOT columns. They are side-loaded by the
 * repository from the two junctions and passed in, so the mapper stays a pure
 * row→domain function with no IO and the caller decides what a given reader is
 * allowed to be told (see `withSharingSet` in `service-shared.ts`).
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
  /** Optional: a stale PostgREST schema cache (or a pre-column fixture) omits it. */
  runtime?: string | null;
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
    // The CHECK constraint is the guarantee; the cast is not a validation.
    visibility: row.visibility as IdentityVisibility,
    teamIds: [],
    knowledgeBases: [],
    knowledge: [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
