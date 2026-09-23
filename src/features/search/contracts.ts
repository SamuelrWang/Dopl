/**
 * The wire shape `GET /api/search` answers — one declaration for the route and
 * its clients.
 *
 * Deliberately not in `@dopl/contracts`: that package holds closed sets, not DTOs
 * only one tree builds (INVARIANTS §1). `apps/desktop-ui` may import root `src/`.
 *
 * The group kind is a closed set and `SEARCH_GROUP_ORDER` is its only ordering —
 * the popup renders in payload order, so a group's place is part of the contract.
 * The `satisfies` makes a kind added without a place a compile error rather than
 * a section that silently never renders.
 */

/** Which reach a search runs over. */
export type SearchScope = "account" | "container";

/**
 * The sections the popup draws. `members`, `skills` and `chats` are
 * container-only (see {@link CONTAINER_ONLY_SEARCH_GROUPS}).
 */
export type SearchGroupKind =
  | "channels"
  | "messages"
  | "threads"
  | "artifacts"
  | "knowledge"
  | "agentIdentities"
  | "members"
  | "skills"
  | "chats";

/** Payload order. The renderer does not sort; this IS the section order. */
export const SEARCH_GROUP_ORDER = [
  "channels",
  "messages",
  "threads",
  "artifacts",
  "knowledge",
  "agentIdentities",
  "members",
  "skills",
  "chats",
] as const satisfies readonly SearchGroupKind[];

/**
 * (2026-09-17) The three modules that do not exist on home. Account scope never
 * QUERIES these tables — not merely "returns them empty" — so a `link` or
 * `personal` container cannot contribute a member row to a home search.
 */
export const CONTAINER_ONLY_SEARCH_GROUPS = [
  "members",
  "skills",
  "chats",
] as const satisfies readonly SearchGroupKind[];

/** Shorter than this and the answer is 200 with NO groups, never a 400. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Items carried per group. The rest of the matches are counted, not sent. */
export const SEARCH_GROUP_ITEM_CAP = 8;

/**
 * The ceiling on `SearchGroup.total`: a true count below it, and "50 or more" at
 * it, which is why the popup renders `50+`. A group is never scanned past this,
 * so a bigger number would need an unbounded read (INVARIANTS §9).
 */
export const SEARCH_GROUP_TOTAL_CAP = 50;

/** One hit. Every optional field is omitted when this kind has no honest answer
 *  for it — never null-filled, never defaulted (INVARIANTS §9). */
export interface SearchItem {
  /** The row's own id. Unique within its group, not across groups. */
  id: string;
  kind: SearchGroupKind;
  /** What to draw as the row's headline. Never empty. */
  title: string;
  /** Where it lives, in the caller's words — a channel name, a base name, an
   *  email. Plain text, never marked up. */
  subtitle?: string;
  /**
   * Plain text with `<mark>…</mark>` and nothing else — every other character is
   * HTML-escaped at the source (`server/snippet.ts`). A renderer may set THIS as
   * HTML; it may not assume the same of any other field.
   */
  snippet?: string;
  /** The container the row belongs to. Always present — it is the fence's own
   *  key, and the popup groups rows by it on the /home face. */
  containerId: string;
  containerName?: string;
  channelId?: string;
  /** `channel_messages.seq` — the table-wide cursor, so a client can jump. */
  seq?: number;
  threadId?: string;
  avatarUrls?: string[];
  color?: string;
  updatedAt?: string;
}

/** One section. A group with no items is omitted from the payload entirely. */
export interface SearchGroup {
  kind: SearchGroupKind;
  /** Matches found, capped at {@link SEARCH_GROUP_TOTAL_CAP}. ≥ `items.length`. */
  total: number;
  /** At most {@link SEARCH_GROUP_ITEM_CAP}. Never empty — see above. */
  items: SearchItem[];
}

export interface SearchResponse {
  /** The TRIMMED query, echoed so a client can tell which keystroke answered. */
  q: string;
  scope: SearchScope;
  /** Wall-clock milliseconds the search took, server-side. */
  tookMs: number;
  /** In {@link SEARCH_GROUP_ORDER}. Empty for a too-short query. */
  groups: SearchGroup[];
}
