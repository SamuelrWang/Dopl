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
/**
 * WHICH SHELF a base lives on — the /home Knowledge pane, or the workspace
 * Knowledge page. Two PLACES over one table, excluding each other BOTH ways.
 *
 * ⚠ THIS IS THE WIRE VOCABULARY (`home` | `workspace`), which is what
 * `GET /api/knowledge/bases?shelf=` accepts. ⚠ **THE MCP SURFACE NO LONGER
 * SPEAKS IT (2026-09-02, slice B15).** `tools/shelf.ts › toWireShelf` mapped an
 * operator-facing `personal` onto this (Samuel's ruling Q1, 2026-08-28); the
 * tool argument, the mapper and the file are deleted, because on that surface
 * the personal container is simply the tenancy the call is in.
 *
 * ⚠ ABSENT IS NOT A THIRD VALUE — it means NO FILTER, i.e. BOTH shelves, which
 * is what every pre-existing caller (MCP `list_bases` included) rides.
 *
 * ⚠ MIRRORS `src/features/knowledge/types.ts › KbShelf`. ⚠ **THE SHELF IS A
 * TENANCY SINCE 2026-09-02 (wave B slice B15)** — the personal one is the
 * caller's own `kind='personal'` container, not a boolean beside a workspace —
 * so there is nothing shelf-shaped to project onto {@link KnowledgeBase}, and
 * this stays a write input and a read FILTER, never a field on the row.
 */
export type KbShelf = "home" | "workspace";
/**
 * `GET /api/knowledge/bases`, as the rows PLUS the sibling keys this package
 * reads.
 *
 * 🔒 ⚠ **`homeScopedBaseIds` IS A SIBLING KEY AND NOT A FIELD ON THE ROW, AND
 * THE DIFFERENCE IS THE WHOLE DESIGN.** Adding it to {@link KnowledgeBase} would
 * widen the SDK-mirrored row type and trip
 * `scripts/check-knowledge-type-drift.ts` — and since 2026-09-02 there is no
 * column to add: the key answers "is this row in my personal container". A sibling key is the shipped answer
 * for exactly this shape (`channelGrants` and `starredBaseIds` on this same
 * response).
 *
 * ⚠ **ABSENT IS A REAL STATE — READ IT AS `?? []` AT EVERY SITE (INVARIANTS
 * §8).** An older server sends no such key, and this response is cached. The
 * fail-safe reading of "I do not know which shelf this base is on" is NOT
 * "personal": an unknown id simply carries no label, which is the same answer
 * the surface gave before the key existed.
 */
export interface KnowledgeBaseListPayload {
    bases: KnowledgeBase[];
    /** Ids of the listed bases that live on the caller's PERSONAL (/home) shelf.
     *  ⚠ Only ever ids that are in `bases` — never a wider set. */
    homeScopedBaseIds?: string[];
    /**
     * Ids of the listed bases that are PINNED — their entries are handed to every
     * agent session launched in this workspace ({@link StartupContext}).
     *
     * ⚠ A WORKSPACE FACT, NOT THE CALLER'S OWN, which is the difference from the
     * star list: two members reading this response get the same array.
     *
     * ⚠ SAME `?? []` RULE as `homeScopedBaseIds` (INVARIANTS §8) — an older
     * server sends no such key and this response is cached. Absent reads as "no
     * card is marked", which is what the surface showed before the key existed.
     */
    pinnedBaseIds?: string[];
}
/**
 * PINNED STARTUP CONTEXT (T81) — what an agent session is handed the moment it
 * starts, so nobody re-pastes the same three documents by hand.
 *
 * `GET /api/knowledge/startup-context` returns every entry of a PINNED base plus
 * every individually pinned entry, de-duped on entry id and capped so a launch
 * prompt cannot be made unbounded by curating one large base.
 *
 * ⚠ Mirrors `src/features/knowledge/server/service-startup-context.ts`. It is
 * deliberately NOT in `src/features/knowledge/types.ts`, so
 * `scripts/check-knowledge-type-drift.ts` (which pins the four row types) has
 * nothing new to compare and this shape can move with its one endpoint.
 */
export interface StartupContextItem {
    baseId: string;
    baseName: string;
    baseSlug: string;
    entryId: string;
    path: string;
    title: string;
    body: string;
}
/** ⚠ AN ADDRESS, NEVER A BODY — enough to fetch the entry
 *  (`dopl_kb(op="read_file", base, path)`) and nothing of its content. */
export interface StartupContextPointer {
    baseId: string;
    baseSlug: string;
    entryId: string;
    path: string;
    title: string;
}
export interface StartupContext {
    items: StartupContextItem[];
    /** Pinned content that did NOT fit under the cap — an address, never a body. */
    omitted: StartupContextPointer[];
    /** Body characters actually included, i.e. the sum over `items`. */
    chars: number;
    /**
     * ⚠ LOAD-BEARING (INVARIANTS §9): a clipped read that renders like an
     * exhausted one is the bug. `true` means there IS pinned content this payload
     * does not carry — say so, rather than presenting `items` as the whole of what
     * the workspace pinned. `omitted` names what was measured and dropped; a row
     * ceiling can additionally hide content it does not name.
     */
    truncated: boolean;
}
export interface KnowledgeBaseCreateInput {
    name: string;
    description?: string;
    slug?: string;
    agentWriteEnabled?: boolean;
    /**
     * Initial visibility. Omitted → the service defaults to `'private'` (start
     * drafty, share later). ⚠ `'public'` publishes to every workspace member the
     * moment the row lands — inside a link CONTAINER that is the peer standing in
     * the room, which is why it is the knowledge half of the MCP confirm class.
     */
    visibility?: KnowledgeVisibility;
    /**
     * Put the new base on the PERSONAL SHELF instead of the workspace Knowledge
     * page. ⚠ A REQUEST, NOT A DECISION, and since 2026-09-02 it ROUTES the row's
     * container rather than being stored on it: `src/shared/tenancy/
     * personal-container.ts › personalWriteWorkspaceId` is the fence and it 403s
     * rather than downgrading. Omitted/false = the container the call is in.
     */
    homeScoped?: boolean;
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ REQUIRED ONLY ON THE NARROW PREDICATE — a `kind='link'` container with
     * two or more active members, and the row landing at the SHARED visibility.
     * The server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED` without it and IGNORES
     * it everywhere else (`src/features/workspaces/server/shared-publish.ts`).
     * The MCP surface sets it from a spent `confirm_token`, never on its own.
     */
    acknowledgeShared?: boolean;
}
export interface KnowledgeBaseUpdateInput {
    name?: string;
    description?: string | null;
    slug?: string;
    agentWriteEnabled?: boolean;
    /** Via MCP, publish only (private→public); accessMode / team grants stay
     *  human-only. */
    visibility?: KnowledgeVisibility;
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ REQUIRED ONLY ON THE NARROW PREDICATE — a `kind='link'` container with
     * two or more active members, and the row landing at the SHARED visibility.
     * The server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED` without it and IGNORES
     * it everywhere else (`src/features/workspaces/server/shared-publish.ts`).
     * The MCP surface sets it from a spent `confirm_token`, never on its own.
     */
    acknowledgeShared?: boolean;
}
export interface KnowledgeWriteFileInput {
    body?: string;
    title?: string;
    /** Agent-facing summary (≤300 chars) shown in get_tree / list_dir. `null`
     *  clears; omitting leaves the existing excerpt. */
    excerpt?: string | null;
    /**
     * Replace ONE `#`/`##`/`###` section — `body` is that section's new content,
     * spliced server-side under the same `expectedVersion` precondition. A
     * heading that does not exist is APPENDED at `##`; an ambiguous one refuses
     * (409 `KNOWLEDGE_SECTION_AMBIGUOUS`).
     */
    section?: string;
}
/** One heading, as an address. */
export interface KnowledgeOutlineRow {
    heading: string;
    /** 1, 2 or 3. */
    level: number;
    /** What reading this section costs — a parent's count CONTAINS its children's. */
    chars: number;
    /** Char offset of the heading, which is where `offset=` resumes. */
    start: number;
    /** 1-based line of the heading. */
    line: number;
}
export interface KnowledgeOutline {
    sections: KnowledgeOutlineRow[];
    /** The whole entry's length. */
    totalChars: number;
}
/**
 * What a `section=` read resolved to.
 *
 * ⚠ **A MISS IS A 200, NOT A 404** — the entry resolved and the heading did
 * not, so the answer carries the outline and the retry needs no second call.
 */
export type KnowledgeSectionOutcome = {
    ok: true;
    heading: string;
    level: number;
    start: number;
    end: number;
    chars: number;
} | {
    ok: false;
    reason: "SECTION_NOT_FOUND";
} | {
    ok: false;
    reason: "SECTION_AMBIGUOUS";
    matches: KnowledgeOutlineRow[];
};
/**
 * A PART read: the entry with `body` narrowed to the section asked for (empty
 * on a miss and on an outline-only read), plus the outline of the whole.
 */
export interface KnowledgeReadFileResult {
    entry: KnowledgeEntry;
    outline?: KnowledgeOutline;
    section?: KnowledgeSectionOutcome;
}
export interface KnowledgeWriteFileResult {
    entry: KnowledgeEntry;
    /**
     * The outline of what was SAVED. ⚠ `?? undefined` at every reader (INVARIANTS
     * §8): an older server sends no such key and this response is cached.
     */
    outline?: KnowledgeOutline;
    /** `true` when `section` named no existing heading and one was appended. */
    sectionCreated?: boolean;
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
