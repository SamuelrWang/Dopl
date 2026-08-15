import "server-only";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type {
  Skill,
  SkillConnector,
  SkillFile,
  SkillStatus,
  SkillWriteSource,
} from "../types";

/** `skills` row shapes + snake_case → camelCase mappers. `connectors` JSONB
 *  arrives parsed and is cast through the row interfaces below. The SKILL.md
 *  body is columns on the skill row; `SKILL_BODY_COLS` / `mapSkillBodyRow`
 *  synthesize the `SkillFile` the API still exposes. */

export const SKILL_COLS =
  "id, workspace_id, slug, public_id, name, description, when_to_use, when_not_to_use, connectors, status, agent_write_enabled, visibility, access_mode, folder, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

/** Lighter projection for `skill_list` / index rows — drops the JSONB display
 *  arrays. Repository merges defaults so the domain shape stays consistent. */
export const SKILL_SUMMARY_COLS =
  "id, workspace_id, slug, public_id, name, description, when_to_use, when_not_to_use, status, agent_write_enabled, visibility, access_mode, folder, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

/** SKILL.md fields plus the skill columns needed to synthesize a `SkillFile`.
 *  `body_updated_at` is the CAS clock, surfaced as `SkillFile.updatedAt`. */
export const SKILL_BODY_COLS =
  "id, workspace_id, created_by, created_at, deleted_at, body, body_updated_at, body_edited_by, body_edited_source";

export interface SkillRow {
  id: string;
  workspace_id: string;
  slug: string;
  public_id: string;
  name: string;
  description: string;
  when_to_use: string;
  when_not_to_use: string | null;
  connectors: SkillConnector[];
  status: string;
  agent_write_enabled: boolean;
  visibility: "public" | "private";
  access_mode: "workspace" | "teams";
  folder: string | null;
  created_by: string | null;
  last_edited_by: string | null;
  last_edited_source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type SkillSummaryRow = Omit<SkillRow, "connectors">;

export interface SkillBodyRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  body: string;
  body_updated_at: string;
  body_edited_by: string | null;
  body_edited_source: string;
}

export function mapSkillRow(
  row: SkillRow,
  grantedTeamIds: string[] = []
): Skill {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    publicId: row.public_id,
    name: row.name,
    description: row.description,
    whenToUse: row.when_to_use,
    whenNotToUse: row.when_not_to_use,
    connectors: Array.isArray(row.connectors) ? row.connectors : [],
    status: row.status as SkillStatus,
    agentWriteEnabled: row.agent_write_enabled,
    visibility: row.visibility,
    accessMode: row.access_mode,
    folder: row.folder,
    grantedTeamIds,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    lastEditedSource: row.last_edited_source as SkillWriteSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapSkillSummaryRow(row: SkillSummaryRow): Skill {
  return mapSkillRow({ ...row, connectors: [] });
}

/** Synthesize the API's `SkillFile` from the body columns. Fields with no
 *  column are constant (`name` = SKILL.md, `position` = 0) or aliased off the
 *  skill row (`id`/`skillId` = skill id, `updatedAt` = body_updated_at). */
export function mapSkillBodyRow(row: SkillBodyRow): SkillFile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    skillId: row.id,
    name: PRIMARY_SKILL_FILE_NAME,
    body: row.body,
    position: 0,
    createdBy: row.created_by,
    lastEditedBy: row.body_edited_by,
    lastEditedSource: row.body_edited_source as SkillWriteSource,
    createdAt: row.created_at,
    updatedAt: row.body_updated_at,
    deletedAt: row.deleted_at,
  };
}
