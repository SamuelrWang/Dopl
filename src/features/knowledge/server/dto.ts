import "server-only";
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
  KnowledgeEntryType,
  WriteSource,
} from "../types";

/**
 * Row interfaces and row→domain mappers. The row shapes mirror the
 * snake_case Postgres columns; the mappers translate to the camelCase
 * domain types in `../types.ts`.
 *
 * `select(...)` in repository.ts uses the *_COLS constants below so
 * the row shape is explicit and stays in sync with the migration.
 */

export const KNOWLEDGE_BASE_COLS =
  "id, workspace_id, name, slug, description, agent_write_enabled, created_by, created_at, updated_at, deleted_at";

export const KNOWLEDGE_FOLDER_COLS =
  "id, workspace_id, knowledge_base_id, parent_id, name, position, created_by, created_at, updated_at, deleted_at";

export const KNOWLEDGE_ENTRY_COLS =
  "id, workspace_id, knowledge_base_id, folder_id, title, excerpt, body, entry_type, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

/**
 * Used by `listEntriesForBase({ includeBody: false })` to skip the
 * heavy `body` column when only metadata is needed (tree views, search
 * results). Repository merges in an empty `body` so the domain shape
 * stays consistent.
 */
export const KNOWLEDGE_ENTRY_META_COLS =
  "id, workspace_id, knowledge_base_id, folder_id, title, excerpt, entry_type, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export interface KnowledgeBaseRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_write_enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KnowledgeFolderRow {
  id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface KnowledgeEntryRow {
  id: string;
  workspace_id: string;
  knowledge_base_id: string;
  folder_id: string | null;
  title: string;
  excerpt: string | null;
  body: string;
  entry_type: string;
  position: number;
  created_by: string | null;
  last_edited_by: string | null;
  last_edited_source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Variant of the row used when `body` was omitted from the SELECT.
 * Repository merges in `body: ""` before mapping.
 */
export type KnowledgeEntryMetaRow = Omit<KnowledgeEntryRow, "body">;

export function mapBaseRow(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    agentWriteEnabled: row.agent_write_enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapFolderRow(row: KnowledgeFolderRow): KnowledgeFolder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    knowledgeBaseId: row.knowledge_base_id,
    parentId: row.parent_id,
    name: row.name,
    position: row.position,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapEntryRow(row: KnowledgeEntryRow): KnowledgeEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    knowledgeBaseId: row.knowledge_base_id,
    folderId: row.folder_id,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    entryType: row.entry_type as KnowledgeEntryType,
    position: row.position,
    createdBy: row.created_by,
    lastEditedBy: row.last_edited_by,
    lastEditedSource: row.last_edited_source as WriteSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
