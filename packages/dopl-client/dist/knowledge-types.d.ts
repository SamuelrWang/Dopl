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
    /**
     * Heading names per entry id (`## Errors`), present only when `headings`
     * was asked for. ⚠ `?? EMPTY` at every reader (INVARIANTS §8): an older
     * server sends no such key and this response is cached.
     */
    entryHeadings?: Record<string, string[]>;
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
     * 🔒 **WHICH OF THESE BASES ARE SHARED INTO ONE CHANNEL** — present ONLY when
     * the read named a `channelId`, absent otherwise.
     *
     * ⚠ **ABSENT AND `{}` ARE DIFFERENT ANSWERS, AND THE DIFFERENCE IS THE POINT**
     * (the server states it too): absent means NOT ASKED, `{}` means asked and
     * none granted. A reader that collapses the two reports "nothing is shared in
     * this channel" about a call that never asked.
     *
     * ⚠ Same `?? EMPTY` rule as the two id lists above (INVARIANTS §8) — an older
     * server sends no such key and this response is cached.
     *
     * ⚠ **THE VALUE IS DELIBERATELY LOOSE.** Every SDK reader asks only whether a
     * key is PRESENT; mirroring `src/features/knowledge/types.ts ›
     * ChannelResourceGrant`'s level union here would be a hand-copy with no gate
     * over it, bought for a field nothing in this package reads.
     */
    channelGrants?: Record<string, {
        level: string;
        guestWrite: boolean;
    }>;
}
export interface KnowledgeBaseCreateInput {
    name: string;
    /**
     * 🔒 **IDEMPOTENCY KEY (S53)** — a create re-sent under the same key returns
     * the FIRST base instead of minting a second. Author-scoped server-side by a
     * partial unique index; the same contract `client_msg_id` carries on the
     * channel lane.
     */
    clientWriteId?: string;
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
     * 🔒 **CREATE THE BASE *AND* SHARE IT INTO THIS CHANNEL, IN ONE CALL** —
     * DESTINATION 2, and the only way to reach it (Samuel's rulings 2026-08-27
     * and 2026-09-18). Mirrors `src/features/knowledge/schema.ts ›
     * KnowledgeBaseCreateSchema.shareToChannelId`.
     *
     * The grant is always `level: 'visible'`, `guestWrite: false`, and the base is
     * rolled back if it fails — so this never half-lands. It is what the /home
     * Shared section's create button sends, and since 2026-09-18 a `kind='link'`
     * container REFUSES a private create without it
     * (`features/workspaces/server/home-channel-destination.ts`).
     *
     * ⚠ NOT the same question as `acknowledgeShared` below: this asks for ONE
     * channel's grant row while the base stays private, that one is the WORKSPACE
     * axis — every member of the container at once.
     */
    shareToChannelId?: string;
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
    /**
     * 🔒 **IDEMPOTENCY KEY (S53)** — a write re-sent under the same key converges
     * on the FIRST call's entry instead of upserting a second one, and the result
     * says `converged: true`. Author-scoped server-side by a partial unique index,
     * so one member's key can never hand back another member's row. The same
     * contract `client_msg_id` carries on the channel lane.
     */
    clientWriteId?: string;
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
    /** Every heading served, when more than one matched (a read never refuses as ambiguous). */
    served?: string[];
    /** How the heading matched, when not as written. */
    match?: "normalized" | "contains";
} | {
    ok: false;
    reason: "SECTION_NOT_FOUND";
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
    /**
     * 🔒 **`true` WHEN THIS CALL WROTE NOTHING** (S53) — the entry came back off
     * `clientWriteId` and is an EARLIER call's result. ⚠ `?? false` at every
     * reader (INVARIANTS §8): an older server sends no such key, and absent must
     * read as "this call wrote" — the behaviour before the field existed.
     */
    converged?: boolean;
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
    /**
     * The base's slug and the entry's `/`-path — what a follow-up
     * `read_file(base, path)` takes. ⚠ `?? EMPTY` at every reader (INVARIANTS
     * §8): an older server sends neither key and this response is cached.
     */
    baseSlug?: string;
    path?: string;
}
