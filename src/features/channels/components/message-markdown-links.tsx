"use client";

/**
 * WHAT A MESSAGE BODY MAY LINK TO, AND HOW THAT LINK OPENS — the transcript
 * renderer's LINK POLICY, split out of `message-markdown.tsx` on 2026-08-22.
 *
 * ⚠ THE SEAM IS A REASON TO CHANGE, NOT A LINE COUNT (INVARIANTS §1). That file
 * maps markdown TOKENS to React elements and changes when markdown support does;
 * this one is a SECURITY allow-list plus the shell's external-link idiom, and it
 * changes when somebody finds a scheme or a shell behaviour we did not think of.
 * The cap is what forced the question (the file reached 500 when the GFM
 * task-list case landed, F-252); the answer is this seam, which was already
 * there.
 *
 * ⚠ IT DELIBERATELY IMPORTS NOTHING FROM ITS PARENT. `MessageLink` — which needs
 * the parent's `Inline` to render a link's own child tokens — stays over there
 * and reaches for {@link safeHref} and {@link ExternalAnchor}, so the dependency
 * runs one way and there is no cycle to reason about.
 */

/**
 * THE ONLY PROTOCOLS A MESSAGE MAY LINK TO. Pure and exported for its test.
 *
 * ⚠ AN UNPARSEABLE OR UNLISTED HREF IS NOT A LINK AT ALL — the caller renders
 * the link's TEXT and drops the anchor. `javascript:`, `data:`, `file:` and
 * `vbscript:` all parse cleanly as URLs, so a check for "does this parse" is no
 * check; the allow-list is what does the work, and it is positive rather than a
 * deny-list because the next scheme somebody finds is the one a deny-list has
 * not heard of.
 *
 * ⚠ RELATIVE HREFS ARE REFUSED TOO, deliberately. A transcript is not a
 * document: there is nothing in the app for `/settings` or `#top` to mean, and
 * in the packaged renderer the base is a `file://` document, where a relative
 * link resolves against the bundle.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeHref(href: string | null | undefined): string | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // `URL` lower-cases the protocol, so `JavaScript:` cannot slip the set.
  return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
}

/**
 * ⚠ THE APP'S EXTERNAL-LINK IDIOM lives in `shared/ui/external-anchor.tsx`
 * since 2026-10-01 (the ontology's `link` field is its second feature);
 * re-exported so this stays the transcript's import path of record.
 */
export { ExternalAnchor } from "@/shared/ui/external-anchor";
