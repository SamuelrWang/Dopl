/**
 * Knowledge-base method group — link 3 of the chain in `client-base.ts`. Pure
 * delegation to `knowledge.ts`; no HTTP here.
 *
 * Path-based methods take a base id and a "/"-separated path; the server
 * resolves to folder/entry rows.
 */
import { WorkspaceMethods } from "./client-workspaces.js";
import type { KbShelf, KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseListPayload, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgeFolder, KnowledgePathOpResult, KnowledgeReadFileResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
export declare class KnowledgeMethods extends WorkspaceMethods {
    listKbBases(opts?: {
        shelf?: KbShelf;
    }): Promise<KnowledgeBase[]>;
    /** The rows PLUS the shelf sibling key. ⚠ Same single request as
     *  {@link listKbBases}; read `homeScopedBaseIds` as `?? []` (INVARIANTS §8). */
    listKbBasesPayload(opts?: {
        shelf?: KbShelf;
        channelId?: string;
    }): Promise<KnowledgeBaseListPayload>;
    getKbBase(baseId: string): Promise<KnowledgeBase>;
    getKbTree(baseId: string, opts?: {
        entryLimit?: number;
        entryCursor?: string;
    }): Promise<KnowledgeTreeSnapshot>;
    createKbBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
    /** 🔒 {@link createKbBase}'s gates without its write — resolves if that body
     *  would be accepted, throws the create's own error if it would not. The
     *  confirm class asks this BEFORE minting a token, so a preview cannot
     *  promise a create the confirmed call refuses. */
    dryRunKbBase(input: KnowledgeBaseCreateInput): Promise<void>;
    updateKbBase(baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
    deleteKbBase(baseId: string): Promise<void>;
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
