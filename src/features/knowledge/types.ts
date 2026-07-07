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

import type { Role } from "@/features/workspaces/types";

export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";

/**
 * Origin of a write call. Set at the route boundary from the auth
 * context (API key → "agent", session cookie → "user"). The service
 * checks this against `KnowledgeBase.agentWriteEnabled` before any
 * agent-origin mutation.
 */
export type WriteSource = "user" | "agent";

/**
 * Per-resource visibility (M-10). `public` rows are visible to every
 * workspace member at their role's default access level; `private`
 * rows are owner-only — invisible in lists, search, and the canvas
 * for non-owners (RLS enforces, service layer is belt-and-suspenders).
 *
 * For knowledge bases visibility is two-way: the owner or a workspace
 * admin can flip scope via the Sharing settings (narrowing transitions
 * are workflow-invariant-checked). Skills keep the original one-way
 * private → public rule. New items default to `'private'` from the
 * app code (DB column default is `'public'` so existing rows stay
 * visible, but `createBase` / `createSkill` override).
 */
export type Visibility = "public" | "private";

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  publicId: string;
  description: string | null;
  agentWriteEnabled: boolean;
  visibility: Visibility;
  /** 'workspace' = every member (role default level); 'teams' = granted teams only. */
  accessMode: "workspace" | "teams";
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
  /** Agent-facing summary of the folder's contents (≤300 chars).
   *  Surfaced in MCP get_tree / list_dir so agents can navigate
   *  without opening every file. Entries use `excerpt` for the same
   *  purpose; bases use `description`. */
  description: string | null;
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
  /** Caller's workspace role — used for team-access resolution without refetching membership. */
  role: Role;
  /**
   * If the request is authenticated via a workspace-scoped API key,
   * this is the workspace it's locked to. `null` for session callers
   * and personal API keys. Service layer reads this to enforce M-10:
   * workspace-scoped keys must NOT see private items, even ones
   * owned by the calling user — those keys may be shared between
   * humans and we don't want a teammate's draft leaking.
   */
  apiKeyWorkspaceId?: string | null;
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
// Canonical home is @/shared/lib/source-types (cross-feature: shared
// SourceIcon, skills connector chips, canvas panels). Re-exported here
// for knowledge-internal consumers.

export type {
  SourceConnection,
  SourceProvider,
} from "@/shared/lib/source-types";
