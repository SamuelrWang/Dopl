"use client";

/**
 * **A BODY'S INLINE MARKDOWN, WITH NO BLOCKS — the preview arm** (Samuel, 2026-10-10:
 * the main chat area shows raw `**asterisks**` where the agent panel shows bold).
 *
 * The transcript's own bodies have rendered as markdown since 2026-08-21
 * (`message-markdown.tsx`) and every message face in the agent window goes through
 * that same renderer (`agent-stream-prose.tsx`). What was left plain in the channel
 * surface is the PREVIEW lanes — a thread card's opening line, a Tags-inbox snippet,
 * a system row — so one agent's `**Done**` read as bold in one column and as four
 * characters in the other.
 *
 * ⚠ 1. IT IS NOT A SECOND RENDERER, AND THAT IS THE WHOLE POINT. The emphasis rule,
 * the code face, the link allow-list (`message-markdown-links.tsx › safeHref`) and
 * the mention leaf (`message-markdown-mentions.tsx › MentionText`) are the block
 * renderer's, reached through its exported {@link Inline}. This file owns ONE
 * decision: which lexer runs.
 *
 * ⚠ 2. **`Lexer.lexInline`, NOT `marked.lexer`, AND THE REASON IS THE CLAMP.** These
 * lanes are bounded by `line-clamp-2` / `line-clamp-3`, and `agent-stream-prose.tsx`
 * rule 4 already measured what block markdown does under one: `line-clamp` is a
 * `-webkit-box` rule that does not clamp a container of SIBLING blocks, so a preview
 * lexed into paragraphs, lists and fences would grow past its two lines and push the
 * card open. Inline tokens render as ONE run inside the caller's own element, so the
 * clamp the caller already wrote keeps working untouched. ⚠ A heading's `#`, a
 * bullet's `-` and a fence's backticks therefore stay as characters here — which is
 * honest for a preview: the line is a FRAGMENT of a body, and claiming structure for
 * it would be claiming something the clamp cut away.
 *
 * ⚠ 3. **RULE 1 OF THE BLOCK RENDERER HOLDS UNCHANGED: NO HTML STRING IS EVER
 * PRODUCED.** `lexInline` returns tokens; {@link Inline} maps them to elements this
 * tree constructed, and an `html` token renders as its own literal text. There is no
 * `dangerouslySetInnerHTML` on this path either, so an untrusted preview is exactly
 * as safe as the body it previews.
 *
 * ⚠ 4. **THE CALLER HANDS A BUILT `ctx`.** {@link bodyContextOf} walks the roster, and
 * these lanes are LISTS — `mentions-list.tsx` holds one context in a `useMemo` for the
 * whole page and says why. A component that built its own per row would re-walk the
 * roster for every row drawn.
 */

import { Lexer } from "marked";
import { Inline } from "./message-markdown";
import type { BodyContext } from "./message-markdown-context";

export function MessageMarkdownInline({
  text,
  ctx,
}: {
  text: string;
  /** Built by `message-markdown.tsx › bodyContextOf` — see rule 4. */
  ctx: BodyContext;
}) {
  // ⚠ GFM ON, to match the block arm's lexer options: strikethrough and autolinks are
  // inline rules, and a `~~word~~` that struck through in the transcript and not in its
  // own preview would be the two-ends-disagree failure this file exists to close.
  return <Inline tokens={Lexer.lexInline(text, { gfm: true })} ctx={ctx} />;
}
