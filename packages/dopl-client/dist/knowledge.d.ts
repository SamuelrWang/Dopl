/**
 * Knowledge-base methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-knowledge.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { KbShelf, KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseListPayload, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgePathOpResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult } from "./knowledge-types.js";
/**
 * The bases this caller may READ, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves — the pre-existing contract every caller
 * rides, and the reason this stayed a no-arg call for so long. The narrowing is
 * a `WHERE` server-side, not a post-filter, so a shelf the caller did not ask
 * for never reaches the wire.
 */
export declare function listKbBasesPayload(t: DoplTransport, opts?: {
    shelf?: KbShelf;
}): Promise<KnowledgeBaseListPayload>;
/**
 * The rows alone. ⚠ DELEGATES to {@link listKbBasesPayload} rather than issuing
 * its own request — one HTTP call either way, and one place that knows the URL.
 * Kept as its own method because most callers want the array and nothing else;
 * widening its return would have been a breaking change for all of them to buy
 * a key one caller reads.
 */
export declare function listKbBases(t: DoplTransport, opts?: {
    shelf?: KbShelf;
}): Promise<KnowledgeBase[]>;
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
