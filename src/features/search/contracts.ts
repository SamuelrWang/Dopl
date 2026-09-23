/**
 * The `GET /api/search` wire shape for the route and its clients. Not in `@dopl/contracts`,
 * which holds closed sets, not DTOs only one tree builds (INVARIANTS §1).
 */

export type SearchScope = "account" | "container";

/** The popup's sections; see {@link CONTAINER_ONLY_SEARCH_GROUPS}. */
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

/** Payload order is section order: the popup renders it and never sorts. */
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

/** Modules absent on home: account scope never queries these tables at all. */
export const CONTAINER_ONLY_SEARCH_GROUPS = [
  "members",
  "skills",
  "chats",
] as const satisfies readonly SearchGroupKind[];

/** Shorter than this answers 200 with no groups, never a 400. */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Items sent per group; the rest are counted, not sent. */
export const SEARCH_GROUP_ITEM_CAP = 8;

/** Ceiling on `total`, shown as `50+`; no group is scanned past it (INVARIANTS §9). */
export const SEARCH_GROUP_TOTAL_CAP = 50;

/** One hit. An optional field is omitted, never null-filled, when the kind has no value. */
export interface SearchItem {
  /** Unique within its group, not across groups. */
  id: string;
  kind: SearchGroupKind;
  title: string;
  subtitle?: string;
  /** Only `<mark>` survives escaping (`server/snippet.ts`): the one field safe as HTML. */
  snippet?: string;
  /** Always present: the fence's key, and the /home popup groups rows by it. */
  containerId: string;
  containerName?: string;
  channelId?: string;
  /** `channel_messages.seq`, the table-wide cursor a client jumps to. */
  seq?: number;
  threadId?: string;
  avatarUrls?: string[];
  color?: string;
  updatedAt?: string;
}

/** One section; a group with no items is omitted from the payload. */
export interface SearchGroup {
  kind: SearchGroupKind;
  /** Matches found, capped at {@link SEARCH_GROUP_TOTAL_CAP}; ≥ `items.length`. */
  total: number;
  /** At most {@link SEARCH_GROUP_ITEM_CAP}; never empty. */
  items: SearchItem[];
}

export interface SearchResponse {
  /** The trimmed query, echoed so a client can tell which keystroke answered. */
  q: string;
  scope: SearchScope;
  tookMs: number;
  groups: SearchGroup[];
}
