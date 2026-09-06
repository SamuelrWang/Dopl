/**
 * Knowledge-base methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-knowledge.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { KbShelf, KnowledgeBase, KnowledgeBaseCreateInput, KnowledgeBaseListPayload, KnowledgeBaseUpdateInput, KnowledgeDirListing, KnowledgeEntry, KnowledgePathOpResult, KnowledgeReadFileResult, KnowledgeSearchHit, KnowledgeTreeSnapshot, KnowledgeWriteFileInput, KnowledgeWriteFileResult, StartupContext } from "./knowledge-types.js";
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
/**
 * 🔒 **THE CREATE'S GATES, RUN WITHOUT THE CREATE** — `POST
 * /api/knowledge/bases?dryRun=1`. Resolves when the same body would be
 * ACCEPTED; throws the create's own error when it would be refused. Nothing is
 * written either way, and there is no row to return.
 *
 * ⚠ **A SECOND METHOD OVER ONE ENDPOINT, LIKE `listKbBases` /
 * `listKbBasesPayload`** — not a second endpoint, and not a flag on
 * {@link createKbBase}. A flag would make that method answer `KnowledgeBase |
 * null`, and a caller reading the null as "created, row unavailable" is the
 * mistake this whole slice exists to stop.
 *
 * ⚠ **SEND THE BODY YOU WOULD SEND**, `acknowledgeShared` included: the answer
 * is only about the body it was asked with.
 */
export declare function dryRunKbBase(t: DoplTransport, input: KnowledgeBaseCreateInput): Promise<void>;
export declare function updateKbBase(t: DoplTransport, baseId: string, patch: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
export declare function deleteKbBase(t: DoplTransport, baseId: string): Promise<void>;
/**
 * Pin or unpin a whole base — whether its entries are handed to every agent
 * session launched in this workspace.
 *
 * ⚠ TWO IDEMPOTENT VERBS BEHIND ONE BOOLEAN, NEVER A TOGGLE. `pinned` picks the
 * HTTP verb (`PUT` / `DELETE`); the request states the END STATE, so a retry
 * after a timeout that actually landed re-asserts it instead of flipping it
 * back. On workspace-wide state a silent un-do would change what every session
 * launched afterwards starts with.
 *
 * ⚠ A WORKSPACE FACT, NOT A FAVOURITE — the star methods write the caller's own
 * row and this writes the base. Hence a `member` floor server-side where a star
 * takes the viewer default.
 */
export declare function setKbBasePinned(t: DoplTransport, baseId: string, pinned: boolean): Promise<void>;
/** The single-entry half of {@link setKbBasePinned} — one document joins the
 *  startup context without its whole base. Same two-verb contract. */
export declare function setKbEntryPinned(t: DoplTransport, entryId: string, pinned: boolean): Promise<void>;
/**
 * The pinned reading list a session starts with — every entry of a pinned base
 * plus every individually pinned entry, capped.
 *
 * ⚠ READ `truncated` AND `omitted`. A payload that renders as the whole of what
 * is pinned when it is not is the bug this shape exists to prevent
 * (INVARIANTS §9); `omitted` carries addresses to fetch the rest with
 * `readKbFileByPath`.
 */
export declare function getKbStartupContext(t: DoplTransport): Promise<StartupContext>;
export declare function readKbFileByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgeEntry>;
/**
 * A PART of an entry: one `section=`, or the outline alone.
 *
 * ⚠ **A SEPARATE METHOD RATHER THAN AN OPTION ON {@link readKbFileByPath}**,
 * because the two answer different shapes and the whole-document read is on
 * every existing caller's path. ⚠ **THE NARROWING IS A QUERY PARAMETER, NOT A
 * POST-FILTER**: the body that did not match never crosses the wire.
 */
export declare function readKbFilePart(t: DoplTransport, baseId: string, path: string, opts?: {
    section?: string;
    outline?: boolean;
}): Promise<KnowledgeReadFileResult>;
export declare function writeKbFileByPath(t: DoplTransport, baseId: string, path: string, input?: KnowledgeWriteFileInput, expectedVersion?: string | null): Promise<KnowledgeWriteFileResult>;
export declare function listKbDirByPath(t: DoplTransport, baseId: string, path?: string): Promise<KnowledgeDirListing>;
export declare function createKbFolderByPath(t: DoplTransport, baseId: string, path: string, description?: string | null): Promise<import("./knowledge-types.js").KnowledgeFolder>;
export declare function deleteKbByPath(t: DoplTransport, baseId: string, path: string): Promise<KnowledgePathOpResult>;
export declare function moveKbByPath(t: DoplTransport, baseId: string, fromPath: string, toPath: string): Promise<KnowledgePathOpResult>;
export declare function searchKb(t: DoplTransport, query: string, opts?: {
    baseSlug?: string;
    limit?: number;
}): Promise<KnowledgeSearchHit[]>;
