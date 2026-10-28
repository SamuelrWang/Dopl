import { MENTION_TOKEN_RE, mentionHandleOf } from "./mentions";
import { maskNonTaggingRegions } from "./mentions-mask";

/**
 * A MENTION ROW'S SNIPPET, WINDOWED AROUND THE VIEWER'S OWN TAG (Samuel, 2026-10-15:
 * a preview that truncates before the @-tag must show "...text text @name text text..."
 * so the mention is always visible).
 *
 * ⚠ THE ROW DRAWS TWO LINES (`mentions-list.tsx`, `line-clamp-2`), so the tag has to
 * land near the FRONT of the snippet, not merely inside its 240 characters. A body whose
 * tag sits past {@link MENTION_SNIPPET_LEAD_CHARS} is cut to start that many characters
 * before it, snapped forward to a word boundary, with a leading "…".
 *
 * ⚠ THE TAG IS FOUND ON THE MASKED TEXT, the same funnel `mentions.ts › mentionTokensOf`
 * resolves through, so an `@you` inside code (which tags nobody) is never what the window
 * centres on. The mask blanks with spaces and keeps length, so its offsets index `flat`.
 *
 * ⚠ NO MATCH (the viewer's handle is not found as written) FALLS BACK TO THE LEADING CLIP,
 * which is exactly the old behaviour: never worse than before.
 */
export const MENTION_SNIPPET_LEAD_CHARS = 36;

export function mentionSnippetOf(
  body: string,
  viewerHandles: ReadonlySet<string>,
  maxChars: number
): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = viewerTagOffset(flat, viewerHandles);

  let start = 0;
  if (at !== null && at > MENTION_SNIPPET_LEAD_CHARS) {
    start = at - MENTION_SNIPPET_LEAD_CHARS;
    // Snap forward to the next word so the window never opens mid-word. Never past the tag.
    const space = flat.indexOf(" ", start);
    start = space !== -1 && space < at ? space + 1 : at;
  }

  const rest = flat.slice(start);
  const head = start > 0 ? "…" : "";
  if (rest.length <= maxChars) return `${head}${rest}`;
  return `${head}${rest.slice(0, maxChars).trimEnd()}…`;
}

/** Offset in `flat` of the first token naming one of `handles`, or null. */
function viewerTagOffset(flat: string, handles: ReadonlySet<string>): number | null {
  if (handles.size === 0 || !flat.includes("@")) return null;
  const masked = maskNonTaggingRegions(flat);
  // ⚠ `matchAll` clones the regex, so the shared `g` flag leaks no `lastIndex`.
  for (const match of masked.matchAll(MENTION_TOKEN_RE)) {
    const handle = mentionHandleOf(match[0]);
    if (handle !== null && handles.has(handle) && match.index !== undefined) {
      return match.index;
    }
  }
  return null;
}
