/**
 * Domain types for the user's knowledge bases (Item 4).
 *
 * Mirrors `src/features/knowledge/types.ts` in the main app — kept in
 * sync by hand for now. If they ever drift, the API responses become
 * the source of truth.
 *
 * Distinct from `Pack`/`PackFile` types in this package: those are the
 * read-only Dopl knowledge packs (specialist verticals). These are the
 * user-authored, editable knowledge bases.
 */
export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";
export type KnowledgeWriteSource = "user" | "agent";
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
    lastEditedSource: KnowledgeWriteSource;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
export interface KnowledgeTreeSnapshot {
    base: KnowledgeBase;
    folders: KnowledgeFolder[];
    entries: KnowledgeEntry[];
}
export interface KnowledgeDirListing {
    folder: KnowledgeFolder | null;
    folders: KnowledgeFolder[];
    entries: KnowledgeEntry[];
}
export interface KnowledgeTrashSnapshot {
    bases: KnowledgeBase[];
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
}
export interface KnowledgeWriteFileInput {
    body?: string;
    title?: string;
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
    /** Snippet has `<b>` tags around matched terms — strip or render. */
    snippet: string;
    rank: number;
    updatedAt: string;
}
