/**
 * THE POPUP'S SECTION MODEL — order, labels, the flat keyboard order, and the
 * snippet sanitiser. Pure functions only: this file renders nothing, so the
 * popup's behaviour can be pinned without mounting it.
 */

import {
  SEARCH_GROUP_ORDER,
  type SearchGroup,
  type SearchGroupKind,
  type SearchItem,
} from "../contracts";

/**
 * The order is the contract's: this file declares none of its own. The renderer
 * walks the groups as given and never sorts.
 */

/**
 * The centred label that sits in the hairline above each section. A noun, never a
 * sentence and never a count — the section's size is already visible.
 */
export const GROUP_LABEL: Record<SearchGroupKind, string> = {
  channels: "Channels",
  messages: "Messages",
  threads: "Threads",
  artifacts: "Artifacts",
  knowledge: "Knowledge",
  agentTemplates: "Agent templates",
  members: "Members",
  skills: "Skills",
  chats: "Chats",
};

/**
 * The groups the popup will draw, in payload order. This function DROPS; it never
 * reorders.
 *
 * An empty group is not a section — belt-and-braces over an older or stubbed
 * server, since a labelled hairline with nothing under it claims rows exist.
 * An unknown kind is dropped, not appended: a newer server may grow a group this
 * bundle has no renderer or label for.
 */
export function orderedGroups(groups: readonly SearchGroup[]): SearchGroup[] {
  return groups.filter(
    (group) =>
      group.items.length > 0 &&
      (SEARCH_GROUP_ORDER as readonly string[]).includes(group.kind)
  );
}

/**
 * Every row in the order the eye reads them, which is what the arrow keys walk.
 * One flat list across the groups, not a cursor per section: a reader pressing
 * down at the foot of Channels expects the first Message.
 */
export function flatItems(groups: readonly SearchGroup[]): SearchItem[] {
  return orderedGroups(groups).flatMap((group) => group.items);
}

/** Wrap the active index around the flat list — `move(-1)` at the top lands on
 *  the last row, which is how every menu in the app behaves. */
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
 * The snippet sanitiser: escape everything, then let `<mark>` back in.
 *
 * Allow-list by RECONSTRUCTION, never a strip pass — a "remove the tags I dislike"
 * filter is a blocklist and every blocklist has a bypass. Escaping first makes the
 * string inert, and only the two sequences spelled here become markup again, with
 * no attributes possible. The result feeds this feature's only
 * `dangerouslySetInnerHTML`.
 */
export function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/[&<>"]/g, (ch) => ESCAPES[ch])
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
