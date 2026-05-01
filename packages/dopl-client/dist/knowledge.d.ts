/**
 * Knowledge-base methods for `DoplClient` (Item 4). Each function takes
 * the shared `DoplTransport` as its first arg and hits the matching
 * Next.js API route. The `DoplClient` class wraps these into instance
 * methods for caller ergonomics.
 *
 * Path-based methods (`writeFileByPath`, `readFileByPath`,
 * `createFolderByPath`, `listDirByPath`, `moveByPath`, `deleteByPath`)
 * use the path-based REST endpoints added in Phase 4.C.
 */
import type { DoplTransport } from "./transport.js";
import type { KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTrashSnapshot, KnowledgeTreeSnapshot, KnowledgeWriteFileInput } from "./knowledge-types.js";
export declare function listKbBases(t: DoplTransport): Promise<KnowledgeBase[]>;
export declare function getKbBase(t: DoplTransport, baseId: string): Promise<KnowledgeBase>;
export declare function getKbTree(t: DoplTransport, baseId: string): Promise<KnowledgeTreeSnapshot>;
export declare function createKbBase(t: DoplTransport, input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
export declare function updateKbBase(t: DoplTransport, baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
export declare function deleteKbBase(t: DoplTransport, baseId: string): Promise<void>;
export declare function restoreKbBase(t: DoplTransport, baseId: string): Promise<KnowledgeBase>;
export declare function readKbFileByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgeEntry>;
export declare function writeKbFileByPath(t: DoplTransport, baseId: string, path: string, input?: KnowledgeWriteFileInput): Promise<KnowledgeEntry>;
export declare function listKbDirByPath(t: DoplTransport, baseId: string, path?: string): Promise<KnowledgeDirListing>;
export declare function createKbFolderByPath(t: DoplTransport, baseId: string, path: string): Promise<import("./knowledge-types.js").KnowledgeFolder>;
export declare function deleteKbByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgePathOpResult>;
export declare function moveKbByPath(t: DoplTransport, baseId: string, fromPath: string, toPath: string): Promise<KnowledgePathOpResult>;
export declare function listKbTrash(t: DoplTransport, baseId?: string): Promise<KnowledgeTrashSnapshot>;
export declare function restoreKbFolder(t: DoplTransport, folderId: string): Promise<import("./knowledge-types.js").KnowledgeFolder>;
export declare function restoreKbEntry(t: DoplTransport, entryId: string): Promise<KnowledgeEntry>;
export declare function searchKb(t: DoplTransport, query: string, opts?: {
    baseSlug?: string;
    limit?: number;
}): Promise<KnowledgeSearchHit[]>;
