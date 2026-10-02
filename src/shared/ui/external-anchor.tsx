"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";
import { openExternalUrl } from "@/shared/lib/open-external";

/**
 * ⚠ THE APP'S EXTERNAL-LINK IDIOM, not a second one — moved here from
 * `channels/components/message-markdown-links.tsx` on 2026-10-01 when the
 * ontology's `link` field became its second feature (that file re-exports it).
 * In the packaged renderer `window.open` is DENIED by the shell, so a bare
 * anchor is a dead click — `shared/lib/open-external.ts › openExternalUrl`
 * routes it through the bridge to the user's real browser. Off the bridge the
 * anchor's own `target="_blank"` is already right, which is why only the
 * bridged case preempts the default.
 *
 * ⚠ THE CALLER OWNS THE SCHEME CHECK — pass only an href it has already
 * allow-listed (http(s)/mailto); this component trusts what it is given.
 *
 * `rel="noreferrer noopener"` regardless: an untrusted author must not receive a
 * referrer or a handle on the opener.
 */
export function ExternalAnchor({
  href,
  title,
  className,
  children,
}: {
  href: string;
  title?: string;
  /** Layout only (truncation, flex); the link face is this component's. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("text-link underline underline-offset-2", className)}
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
