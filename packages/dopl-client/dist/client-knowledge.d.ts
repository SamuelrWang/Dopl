/**
 * Knowledge-base method group (Item 4) — link 3 of the chain documented in
 * `client-base.ts`. Pure delegation to `knowledge.ts`; no HTTP here.
 *
 * User-authored, editable knowledge bases. Path-based methods accept a base
 * id and a "/"-separated path; the server resolves to folder/entry rows.
 */
import { WorkspaceMethods } from "./client-workspaces.js";
import type { KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgeFolder, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
export declare class KnowledgeMethods extends WorkspaceMethods {
    listKbBases(): Promise<KnowledgeBase[]>;
    getKbBase(baseId: string): Promise<KnowledgeBase>;
    getKbTree(baseId: string, opts?: {
        entryLimit?: number;
        entryCursor?: string;
    }): Promise<KnowledgeTreeSnapshot>;
    createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
    updateKbBase(baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
    deleteKbBase(baseId: string): Promise<void>;
    readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry>;
    writeKbFileByPath(baseId: string, path: string, input?: KnowledgeWriteFileInput, expectedVersion?: string | null): Promise<KnowledgeWriteFileResult>;
    listKbDirByPath(baseId: string, path?: string): Promise<KnowledgeDirListing>;
    createKbFolderByPath(baseId: string, path: string, description?: string | null): Promise<KnowledgeFolder>;
    deleteKbByPath(baseId: string, path: string): Promise<KnowledgePathOpResult>;
    moveKbByPath(baseId: string, fromPath: string, toPath: string): Promise<KnowledgePathOpResult>;
    searchKb(query: string, opts?: {
        baseSlug?: string;
        limit?: number;
    }): Promise<KnowledgeSearchHit[]>;
}
