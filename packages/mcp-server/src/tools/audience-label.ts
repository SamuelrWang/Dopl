/**
 * 🔒 **WHO CAN SEE THIS ROW, AS A LABEL — ONE TABLE, BOTH LIST SURFACES**
 * (S21/S23, 2026-09-18).
 *
 * ⚠ **THE ROW USED TO PRINT ITS `visibility` COLUMN, AND THAT IS A DIFFERENT
 * QUESTION.** Since destination 2 a home-channel base is STORED `private` and
 * SHARED by a `channel_resource_grants` row (`knowledge-ops-read.ts ›
 * opListBases`), so a base every member of the room can read rendered
 * `· private` — the column, printed faithfully, saying the opposite of the
 * truth. A template is the mirror image: `visibility="workspace"` inside a home
 * channel means "the other people in this relationship", never "everyone in
 * your company".
 *
 * ⚠ **SO THE LABEL IS DERIVED FROM THE GROUP THE ROW IS IN**, which is the
 * thing the list already computed from the grant and the container — never from
 * the column on its own. `container-destination.ts › DESTINATION_HEADINGS` is
 * the sibling table for the HEADINGS, and these are the per-row answers under
 * them; two hand-typed sets is how two surfaces end up naming one audience
 * differently.
 *
 * ⚠ **`nobody` IS NOT A TAUTOLOGY UNDER THE LEGACY HEADING.** A row is read one
 * line at a time — quoted into a plan, pasted into a post — and a line that
 * carries only its heading's context loses it the moment it travels.
 */
export const AUDIENCE_LABELS = {
  /** Destination 1, and a `private` row in a standard workspace. */
  you: "only you",
  /** Destination 2 — shared into the home channel this call is in. */
  channel: "everyone in this channel",
  /** `public` base / `workspace` template in a STANDARD workspace. */
  workspace: "every member of this workspace",
  /** F-735's orphans: reachable from no surface in the app. */
  nobody: "nobody — not reachable in the app",
} as const;

export type AudienceLabel = (typeof AUDIENCE_LABELS)[keyof typeof AUDIENCE_LABELS];
