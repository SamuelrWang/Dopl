/**
 * Domain types for the knowledge feature.
 *
 * These are the camelCase shapes the rest of the app sees. The
 * snake_case row types and the row→domain mappers live in `server/dto.ts`
 * (kept server-only so the row schema doesn't leak into client bundles).
 *
 * Knowledge bases are workspace-scoped folder/file trees:
 *   - `KnowledgeBase`    — top-level container, has the agent-write toggle.
 *   - `KnowledgeFolder`  — nestable folder (parent_id self-FK).
 *   - `KnowledgeEntry`   — leaf file. `body` is markdown; tables and
 *                          quotations are markdown syntax, not separate
 *                          entities.
 *
 * Soft-delete: every type carries `deletedAt`. `null` = active.
 */

export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";

/**
 * Origin of a write call. Set at the route boundary from the auth
 * context (API key → "agent", session cookie → "user"). The service
 * checks this against `KnowledgeBase.agentWriteEnabled` before any
 * agent-origin mutation.
 */
export type WriteSource = "user" | "agent";

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  agentWriteEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeFolder {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  parentId: string | null;
  name: string;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeEntry {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
  excerpt: string | null;
  body: string;
  entryType: KnowledgeEntryType;
  position: number;
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: WriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Request-scoped context that every service method takes.
 * Built at the route boundary in `server/service.ts#buildKnowledgeContext`.
 */
export interface KnowledgeContext {
  workspaceId: string;
  userId: string;
  source: WriteSource;
}

/**
 * Snapshot of a base's contents, useful for tree views and trash queries.
 * Folders and entries are flat arrays; the UI builds the hierarchy from
 * `parentId` / `folderId`.
 */
export interface KnowledgeTreeSnapshot {
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

// ─── Source provider types ──────────────────────────────────────────
//
// Used by the connector badges in the workspace overview and (legacy)
// by the skills feature. Folded here from `source-types.ts` for parity
// with the §3 layout (audit cohesion fix F-3); `source-types.ts` now
// re-exports these for the existing consumers (mostly the in-progress
// skills feature) and can be deleted once those imports are updated.

export type SourceProvider =
  | "slack"
  | "google-drive"
  | "gmail"
  | "notion"
  | "github";

export interface SourceConnection {
  provider: SourceProvider;
  name: string;
  status: "connected" | "available";
  meta?: string;
}
