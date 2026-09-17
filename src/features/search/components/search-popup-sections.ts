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
 * ⚠ **THE ORDER IS THE CONTRACT'S, AND THIS FILE DECLARES NONE OF ITS OWN.**
 * `contracts.ts › SEARCH_GROUP_ORDER` is the payload order the service builds in
 * (`search/server/service.ts`), so the renderer walks the groups AS GIVEN and
 * never sorts — a second ordering here is a second answer to "which section is
 * first", and the two would drift the day a kind is added.
 */

/**
 * The centred label that sits IN the hairline above each section.
 *
 * ⚠ MINIMAL COPY — a noun, never a sentence and never a count. The section's
 * size is visible; naming it "3 channels" would be a second place for a number
 * to be wrong.
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
 * The groups the popup will draw — **IN PAYLOAD ORDER, WHICH IS
 * `SEARCH_GROUP_ORDER`** (the contract says so; see the note above). This
 * function DROPS, it never reorders.
 *
 * ⚠ **AN EMPTY GROUP IS NOT A SECTION.** The contract already omits one, so this
 * is belt-and-braces over a payload from an older or a stubbed server: a hairline
 * with a label and nothing under it says "there are Skills here" to a reader who
 * is scanning for exactly that.
 * ⚠ **AN UNKNOWN KIND IS DROPPED, NOT APPENDED.** A newer server may grow a
 * group this bundle has no row renderer and no label for; appending it would
 * paint an unlabelled section of `undefined`.
 */
export function orderedGroups(groups: readonly SearchGroup[]): SearchGroup[] {
  return groups.filter(
    (group) =>
      group.items.length > 0 &&
      (SEARCH_GROUP_ORDER as readonly string[]).includes(group.kind)
  );
}

/**
 * Every row, in the order the eye reads them — which is what ↑/↓ walk.
 *
 * ⚠ **ONE FLAT LIST ACROSS THE GROUPS, NOT A CURSOR PER SECTION.** Arrow keys
 * move through the popup, not within a section: a reader pressing ↓ at the foot
 * of Channels expects the first Message, and a per-section cursor would trap
 * them.
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
 * THE SNIPPET SANITISER — escape EVERYTHING, then let `<mark>` back in.
 *
 * ⚠ **ALLOW-LIST BY RECONSTRUCTION, NEVER A STRIP PASS.** A "remove the tags I
 * do not like" filter is a blocklist, and every blocklist has a bypass
 * (`<scr<script>ipt>`, an attribute on the allowed tag, a stray `<` the parser
 * heals). Escaping first makes the string inert; the only two sequences that
 * become markup again are the two spelled here, with no attributes possible.
 * ⚠ The result is handed to `dangerouslySetInnerHTML` — that is the ONLY such
 * call in this feature, and it reads this function's output or nothing.
 */
export function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/[&<>"]/g, (ch) => ESCAPES[ch])
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
