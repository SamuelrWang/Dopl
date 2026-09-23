"use client";

/** Cross-fades its children when the view changes. The `key` remount IS the animation: the old
 *  tree is gone the instant the new one mounts, so stale content is never held. */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function FadeSwap({
  viewKey,
  className,
  children,
}: {
  /** Names the view, never data — else every realtime push remounts the transcript. */
  viewKey: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      key={viewKey}
      data-fade-swap={viewKey}
      // Duration lives in `.fade-swap-in` in both stylesheets (`src/app/globals.css`,
      // `apps/desktop-ui/src/styles/kit.css`); off under reduced motion.
      className={cn("fade-swap-in", className)}
    >
      {children}
    </div>
  );
}
