import "server-only";
import type {
  Skill,
  SkillConnector,
  SkillExample,
  SkillFile,
  SkillRun,
  SkillStatus,
  SkillWriteSource,
} from "../types";

/**
 * Row shapes for the `skills` and `skill_files` tables and the
 * snake_case → camelCase mappers consumed by the repository. JSONB
 * columns (`connectors`, `examples`, `recent_runs`) come back as
 * parsed arrays from the Supabase client; we cast through the row
 * interfaces below.
 */

export const SKILL_COLS =
  "id, workspace_id, slug, name, description, when_to_use, when_not_to_use, connectors, examples, recent_runs, total_invocations, status, agent_write_enabled, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

/**
 * Lighter projection for `skill_list` and the index page row — drops
 * the JSONB display arrays. The repository merges in defaults so the
 * camelCase domain shape stays consistent.
 */
export const SKILL_SUMMARY_COLS =
  "id, workspace_id, slug, name, description, when_to_use, when_not_to_use, status, agent_write_enabled, total_invocations, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export const SKILL_FILE_COLS =
  "id, workspace_id, skill_id, name, body, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export const SKILL_FILE_META_COLS =
  "id, workspace_id, skill_id, name, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export interface SkillRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string;
  when_to_use: string;
  when_not_to_use: string | null;
  connectors: SkillConnector[];
  examples: SkillExample[];
  recent_runs: SkillRun[];
  total_invocations: number;
  status: string;
  agent_write_enabled: boolean;
  created_by: string | null;
  last_edited_by: string | null;
  last_edited_source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SkillSummaryRow = Omit<
  SkillRow,
  "connectors" | "examples" | "recent_runs"
>;

export interface SkillFileRow {
  id: string;
  workspace_id: string;
  skill_id: string;
  name: string;
  body: string;
  position: number;
  created_by: string | null;
  last_edited_by: string | null;
  last_edited_source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SkillFileMetaRow = Omit<SkillFileRow, "body">;

export function mapSkillRow(row: SkillRow): Skill {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    whenToUse: row.when_to_use,
    whenNotToUse: row.when_not_to_use,
    connectors: Array.isArray(row.connectors) ? row.connectors : [],
    examples: Array.isArray(row.examples) ? row.examples : [],
    recentRuns: Array.isArray(row.recent_runs) ? row.recent_runs : [],
    totalInvocations: row.total_invocations,
    status: row.status as SkillStatus,
    agentWriteEnabled: row.agent_write_enabled,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    lastEditedSource: row.last_edited_source as SkillWriteSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapSkillSummaryRow(row: SkillSummaryRow): Skill {
  return mapSkillRow({
    ...row,
    connectors: [],
    examples: [],
    recent_runs: [],
  });
}

export function mapSkillFileRow(row: SkillFileRow): SkillFile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    skillId: row.skill_id,
    name: row.name,
    body: row.body,
    position: row.position,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    lastEditedSource: row.last_edited_source as SkillWriteSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
