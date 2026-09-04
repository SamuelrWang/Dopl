/**
 * Knowledge-base method group — link 3 of the chain in `client-base.ts`. Pure
 * delegation to `knowledge.ts`; no HTTP here.
 *
 * Path-based methods take a base id and a "/"-separated path; the server
 * resolves to folder/entry rows.
 */
import { WorkspaceMethods } from "./client-workspaces.js";
import type { KbShelf, KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseListPayload, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgeFolder, KnowledgePathOpResult, KnowledgeReadFileResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult, StartupContext } from "./knowledge-types.js";
export declare class KnowledgeMethods extends WorkspaceMethods {
    listKbBases(opts?: {
        shelf?: KbShelf;
    }): Promise<KnowledgeBase[]>;
    /** The rows PLUS the shelf sibling key. ⚠ Same single request as
     *  {@link listKbBases}; read `homeScopedBaseIds` as `?? []` (INVARIANTS §8). */
    listKbBasesPayload(opts?: {
        shelf?: KbShelf;
    }): Promise<KnowledgeBaseListPayload>;
    getKbBase(baseId: string): Promise<KnowledgeBase>;
    getKbTree(baseId: string, opts?: {
        entryLimit?: number;
        entryCursor?: string;
    }): Promise<KnowledgeTreeSnapshot>;
    createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
    updateKbBase(baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
    deleteKbBase(baseId: string): Promise<void>;
    /** Pin/unpin a base for the WORKSPACE's agent launches (T81). ⚠ `pinned`
     *  picks the verb — two idempotent verbs, never a toggle. */
    setKbBasePinned(baseId: string, pinned: boolean): Promise<void>;
    /** The single-entry half of {@link setKbBasePinned}. */
    setKbEntryPinned(entryId: string, pinned: boolean): Promise<void>;
    /** The pinned reading list a session starts with. ⚠ Read `truncated` /
     *  `omitted` — see {@link StartupContext}. */
    getKbStartupContext(): Promise<StartupContext>;
    readKbFileByPath(baseId: string, path: string): Promise<KnowledgeEntry>;
    readKbFilePart(baseId: string, path: string, opts?: {
        section?: string;
        outline?: boolean;
    }): Promise<KnowledgeReadFileResult>;
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
