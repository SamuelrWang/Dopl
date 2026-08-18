/**
 * Knowledge-base methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-knowledge.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
export declare function listKbBases(t: DoplTransport): Promise<KnowledgeBase[]>;
export declare function getKbBase(t: DoplTransport, baseId: string): Promise<KnowledgeBase>;
export declare function getKbTree(t: DoplTransport, baseId: string, opts?: {
    entryLimit?: number;
    entryCursor?: string;
}): Promise<KnowledgeTreeSnapshot>;
export declare function createKbBase(t: DoplTransport, input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
export declare function updateKbBase(t: DoplTransport, baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
export declare function deleteKbBase(t: DoplTransport, baseId: string): Promise<void>;
export declare function readKbFileByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgeEntry>;
export declare function writeKbFileByPath(t: DoplTransport, baseId: string, path: string, input?: KnowledgeWriteFileInput, expectedVersion?: string | null): Promise<KnowledgeWriteFileResult>;
export declare function listKbDirByPath(t: DoplTransport, baseId: string, path?: string): Promise<KnowledgeDirListing>;
export declare function createKbFolderByPath(t: DoplTransport, baseId: string, path: string, description?: string | null): Promise<import("./knowledge-types.js").KnowledgeFolder>;
export declare function deleteKbByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgePathOpResult>;
export declare function moveKbByPath(t: DoplTransport, baseId: string, fromPath: string, toPath: string): Promise<KnowledgePathOpResult>;
export declare function searchKb(t: DoplTransport, query: string, opts?: {
    baseSlug?: string;
    limit?: number;
}): Promise<KnowledgeSearchHit[]>;
