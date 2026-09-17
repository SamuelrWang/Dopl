/**
 * THE GLOBAL SEARCH CONTRACT — the wire shape `GET /api/search` answers, and the
 * one declaration both the route and its clients read (Samuel, 2026-09-17:
 * *"when a user searches, the search pop up is separated into sections. So,
 * Channels, messages, knowledge, agent template, etc. It's basically doing a
 * text search across the home space."*).
 *
 * ⚠ **IT IS NOT IN `@dopl/contracts`, AND THAT IS THAT PACKAGE'S OWN RULE
 * APPLIED RATHER THAN AN OVERSIGHT** (INVARIANTS §1; `packages/contracts/src/
 * index.ts` rule 2: *"CLOSED SETS AND THE SHAPES BUILT DIRECTLY ON THEM. NOT
 * DTOs. A row shape that only one tree ever builds does not [belong]"*). These
 * rows are built in `src/` and nowhere else; `apps/desktop-ui` MAY import root
 * `src/` (§1, the /home-face rule), which is the path its popup takes. Neither
 * `packages/dopl-client` nor `packages/mcp-server` states this shape, so there
 * is no second copy for the package to collapse.
 *
 * ⚠ **THE GROUP KIND IS A CLOSED SET AND `SEARCH_GROUP_ORDER` IS ITS ONLY
 * ORDERING.** The popup renders sections in payload order, so a group's place in
 * the list is part of the contract and not a renderer preference. The `satisfies`
 * below makes a kind added to the union without a place in the order a COMPILE
 * error rather than a section that silently never renders.
 */

/** Which reach a search runs over. */
export type SearchScope = "account" | "container";

/**
 * The sections the popup draws. ⚠ `members`, `skills` and `chats` are
 * CONTAINER-ONLY (see {@link CONTAINER_ONLY_SEARCH_GROUPS}).
 */
export type SearchGroupKind =
  | "channels"
  | "messages"
  | "threads"
  | "artifacts"
  | "knowledge"
  | "agentTemplates"
  | "members"
  | "skills"
  | "chats";

/** Payload order. ⚠ The renderer does not sort; this IS the section order. */
export const SEARCH_GROUP_ORDER = [
  "channels",
  "messages",
  "threads",
  "artifacts",
  "knowledge",
  "agentTemplates",
  "members",
  "skills",
  "chats",
] as const satisfies readonly SearchGroupKind[];

/**
 * 🔒 **THE THREE MODULES THAT DO NOT EXIST ON HOME (Samuel, 2026-09-17:
 * *"those modules do not exist on home"*).** Account scope never returns them —
 * not "returns them empty": an empty group is omitted anyway (see
 * {@link SearchGroup}), and the point of stating the set here is that the
 * service NEVER QUERIES those tables account-wide, so a `kind='link'` or
 * `kind='personal'` container cannot contribute a member row to a home search.
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
 * The ceiling on `SearchGroup.total`. ⚠ **`total` IS A TRUE COUNT UP TO HERE AND
 * THIS NUMBER AT OR ABOVE IT** — 50 means "50 or more", which is why the popup
 * renders it as `50+`. A group is never scanned past this, so a bigger number
 * could only be bought with an unbounded read (INVARIANTS §9).
 */
export const SEARCH_GROUP_TOTAL_CAP = 50;

/** One hit. ⚠ Every optional field is OMITTED when this kind has no honest
 *  answer for it — never null-filled, never defaulted (INVARIANTS §9). */
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
   * ⚠ **PLAIN TEXT WITH `<mark>…</mark>` AND NOTHING ELSE.** Every other
   * character is HTML-escaped at the source (`server/snippet.ts`), so a body
   * containing `<script>` arrives as `&lt;script&gt;`. A renderer may therefore
   * set this as HTML; it may NOT assume the same of any other field.
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

/** One section. ⚠ A group with NO items is omitted from the payload entirely. */
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
