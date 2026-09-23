/** The popup's section model as pure functions, so behaviour is pinned without mounting. */

import {
  SEARCH_GROUP_ORDER,
  type SearchGroup,
  type SearchGroupKind,
  type SearchItem,
} from "../contracts";

/** Section labels: a noun, never a sentence or a count. */
export const GROUP_LABEL: Record<SearchGroupKind, string> = {
  channels: "Channels",
  messages: "Messages",
  threads: "Threads",
  artifacts: "Artifacts",
  knowledge: "Knowledge",
  agentIdentities: "Agent identities",
  members: "Members",
  skills: "Skills",
  chats: "Chats",
};

/**
 * Groups to draw, in payload order; drops, never reorders. An empty group would claim
 * rows exist, and an unknown kind (a newer server's) has no renderer or label.
 */
export function orderedGroups(groups: readonly SearchGroup[]): SearchGroup[] {
  return groups.filter(
    (group) =>
      group.items.length > 0 &&
      (SEARCH_GROUP_ORDER as readonly string[]).includes(group.kind)
  );
}

/** Rows in reading order as one list across groups, so the arrow keys cross sections. */
export function flatItems(groups: readonly SearchGroup[]): SearchItem[] {
  return orderedGroups(groups).flatMap((group) => group.items);
}

/** Wraps around the flat list, as every menu in the app does. */
export function moveIndex(active: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (((active + delta) % count) + count) % count;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escape everything, then let only bare `<mark>`/`</mark>` back in: an allow-list by
 * reconstruction, never a strip pass (a blocklist has bypasses). Feeds the only innerHTML.
 */
export function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/[&<>"]/g, (ch) => ESCAPES[ch])
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
