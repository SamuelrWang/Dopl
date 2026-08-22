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

import type { ReactNode } from "react";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";
import { openExternalUrl } from "@/shared/lib/open-external";

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
 * ⚠ THE APP'S EXISTING EXTERNAL-LINK IDIOM, not a second one
 * (`channels-onboarding-core.tsx` is the other caller of this exact shape). In
 * the packaged renderer `window.open` is DENIED by the shell, so a bare anchor
 * is a dead click — `shared/lib/open-external.ts › openExternalUrl` routes it
 * through the bridge to the real browser. Off the bridge the anchor's own
 * `target="_blank"` is already right, which is why only the bridged case
 * preempts the default.
 *
 * `rel="noreferrer noopener"` regardless: an untrusted author must not receive a
 * referrer or a handle on the opener.
 */
export function ExternalAnchor({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      className="text-link underline underline-offset-2"
      onClick={(e) => {
        if (isSpaRenderer()) {
          e.preventDefault();
          void openExternalUrl(href);
        }
      }}
    >
      {children}
    </a>
  );
}
