/**
 * Domain types for the user's knowledge bases.
 *
 * ⚠ Mirrors `src/features/knowledge/types.ts` — hand-synced. On drift, the API
 * responses are the source of truth.
 */
export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";
export type KnowledgeWriteSource = "user" | "agent";
/**
 * `public` = visible to every workspace member at their role's default access;
 * `private` = owner-only.
 */
export type KnowledgeVisibility = "public" | "private";
export interface KnowledgeBase {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    publicId: string;
    description: string | null;
    agentWriteEnabled: boolean;
    visibility: KnowledgeVisibility;
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
    /** Agent-facing summary of contents (≤300 chars). */
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
    lastEditedSource: KnowledgeWriteSource;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
export interface KnowledgeTreeSnapshot {
    base: KnowledgeBase;
    folders: KnowledgeFolder[];
    entries: KnowledgeEntry[];
    /** Present only when entry paging was requested (`entryLimit`). */
    entryTotal?: number;
    /** Opaque cursor for next entry page; null = last page. */
    nextEntryCursor?: string | null;
}
export interface KnowledgeDirListing {
    folder: KnowledgeFolder | null;
    folders: KnowledgeFolder[];
    entries: KnowledgeEntry[];
}
export interface KnowledgeBaseCreateInput {
    name: string;
    description?: string;
    slug?: string;
    agentWriteEnabled?: boolean;
}
export interface KnowledgeBaseUpdateInput {
    name?: string;
    description?: string | null;
    slug?: string;
    agentWriteEnabled?: boolean;
    /** Via MCP, publish only (private→public); accessMode / team grants stay
     *  human-only. */
    visibility?: KnowledgeVisibility;
}
export interface KnowledgeWriteFileInput {
    body?: string;
    title?: string;
    /** Agent-facing summary (≤300 chars) shown in get_tree / list_dir. `null`
     *  clears; omitting leaves the existing excerpt. */
    excerpt?: string | null;
}
export interface KnowledgeWriteFileResult {
    entry: KnowledgeEntry;
}
export interface KnowledgePathOpResult {
    kind: "folder" | "entry";
    id: string;
}
export interface KnowledgeSearchHit {
    entryId: string;
    knowledgeBaseId: string;
    folderId: string | null;
    title: string;
    excerpt: string | null;
    /** ⚠ Carries `<b>` tags around matched terms — strip or render. */
    snippet: string;
    rank: number;
    updatedAt: string;
}
