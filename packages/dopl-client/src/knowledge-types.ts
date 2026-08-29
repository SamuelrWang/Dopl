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
