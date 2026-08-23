/**
 * ONE message-preview truncator, for the two surfaces that put a snippet of
 * somebody's message on the wire: the workspace overview's activity feed and
 * the home surface's relationship list.
 *
 * ⚠ TRUNCATION IS A SERVER-SIDE CONCERN, never the renderer's — an untruncated
 * body on the wire is the payload both surfaces exist to avoid, and a clip in
 * CSS ships it anyway. Living here rather than in either feature is what stops
 * the two copies from drifting to different lengths.
 */

/** Chars of body kept for a preview. */
export const PREVIEW_CHARS = 120;

/** Whitespace-collapsed, clipped at `PREVIEW_CHARS` with an ellipsis. */
export function truncatePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS - 1)}…`
    : flat;
}
