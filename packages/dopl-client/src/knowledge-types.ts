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
 * `GET /api/knowledge/bases?shelf=` accepts. The MCP tool arg says
 * **`personal`** and is mapped onto this in exactly ONE place
 * (`packages/mcp-server/src/tools/shelf.ts`) — Samuel's ruling Q1, 2026-08-28.
 *
 * ⚠ ABSENT IS NOT A THIRD VALUE — it means NO FILTER, i.e. BOTH shelves, which
 * is what every pre-existing caller (MCP `list_bases` included) rides.
 *
 * ⚠ MIRRORS `src/features/knowledge/types.ts › KbShelf`. `home_scoped` is
 * deliberately NOT projected onto {@link KnowledgeBase} (the DTO omits it so no
 * client can re-implement the fence), which is why this is a write input and a
 * read FILTER and never a field on the row.
 */
export type KbShelf = "home" | "workspace";

/**
 * `GET /api/knowledge/bases`, as the rows PLUS the sibling keys this package
 * reads.
 *
 * 🔒 ⚠ **`homeScopedBaseIds` IS A SIBLING KEY AND NOT A FIELD ON THE ROW, AND
 * THE DIFFERENCE IS THE WHOLE DESIGN.** `home_scoped` is deliberately absent
 * from `src/features/knowledge/server/dto.ts › KNOWLEDGE_BASE_COLS` so no client
 * can re-implement the shelf FENCE from a projected column — and adding it to
 * {@link KnowledgeBase} would widen the SDK-mirrored row type and trip
 * `scripts/check-knowledge-type-drift.ts`. A sibling key is the shipped answer
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
   * Put the new base on the /home SHELF instead of the workspace Knowledge
   * page. ⚠ A REQUEST, NOT A DECISION: `src/features/knowledge/server/
   * service-base-writes.ts › resolveHomeScope` is the fence and it 403s rather
   * than downgrading. Omitted/false = the workspace shelf.
   */
  homeScoped?: boolean;
}

export interface KnowledgeBaseUpdateInput {
  name?: string;
  description?: string | null;
  slug?: string;
  agentWriteEnabled?: boolean;
  /** Via MCP, publish only (private→public); accessMode / team grants stay
   *  human-only. */
  visibility?: KnowledgeVisibility;
}

export interface KnowledgeWriteFileInput {
  body?: string;
  title?: string;
  /** Agent-facing summary (≤300 chars) shown in get_tree / list_dir. `null`
   *  clears; omitting leaves the existing excerpt. */
  excerpt?: string | null;
}

export interface KnowledgeWriteFileResult {
  entry: KnowledgeEntry;
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
