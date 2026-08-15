import "server-only";
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
  KnowledgeEntryType,
  WriteSource,
} from "../types";

/**
 * Row interfaces (snake_case Postgres columns) and row→domain mappers to the
 * camelCase types in `../types.ts`. ⚠ `select(...)` in repository.ts uses the
 * *_COLS constants below, so row shape stays in sync with the migration.
 */

/**
 * ⚠ Postgres `text`/`varchar` reject NUL (U+0000) with an opaque 500
 * ("unsupported Unicode escape sequence \\u0000"). Strip NULs at the DB write
 * boundary so a stray control byte degrades to "content minus the NUL" (F-7).
 * Other C0 controls are valid Postgres text and are LEFT INTACT — titles/names
 * reject them via NAME_RE at the schema layer, where the error is clear.
 */
export function stripNulls<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? value.replace(/\u0000/g, "") : value) as T;
}

export const KNOWLEDGE_BASE_COLS =
  "id, workspace_id, name, slug, public_id, description, agent_write_enabled, visibility, access_mode, created_by, created_at, updated_at, deleted_at";

export const KNOWLEDGE_FOLDER_COLS =
  "id, workspace_id, knowledge_base_id, parent_id, name, description, position, created_by, created_at, updated_at, deleted_at";

export const KNOWLEDGE_ENTRY_COLS =
  "id, workspace_id, knowledge_base_id, folder_id, title, excerpt, body, entry_type, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

/** For `listEntriesForBase({ includeBody: false })` — skips the heavy `body`
 *  column. Repository merges in an empty `body` to keep the domain shape. */
export const KNOWLEDGE_ENTRY_META_COLS =
  "id, workspace_id, knowledge_base_id, folder_id, title, excerpt, entry_type, position, created_by, last_edited_by, last_edited_source, created_at, updated_at, deleted_at";

export interface KnowledgeBaseRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  public_id: string;
  description: string | null;
  agent_write_enabled: boolean;
  visibility: "public" | "private";
  access_mode: "workspace" | "teams";
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
  description: string | null;
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

/** Row variant when `body` was omitted from the SELECT. Repository merges in
 *  `body: ""` before mapping. */
export type KnowledgeEntryMetaRow = Omit<KnowledgeEntryRow, "body">;

export function mapBaseRow(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    publicId: row.public_id,
    description: row.description,
    agentWriteEnabled: row.agent_write_enabled,
    visibility: row.visibility,
    accessMode: row.access_mode,
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
    description: row.description,
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
