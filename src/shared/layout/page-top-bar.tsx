"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /**
   * Title to display. When a string, rendered with the standard
   * truncated heading style. When a ReactNode, rendered verbatim —
   * use this for inline-editable titles (e.g. EditableTitle below).
   */
  title: string | ReactNode;
  /** Optional inline icon shown to the left of the title. */
  leading?: ReactNode;
  /** Optional content (buttons, status) on the right side. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Slim 52px chrome bar pinned to the top of the main content area
 * (right of the sidebar). Its bottom border aligns with the sidebar
 * header's bottom border to form one continuous horizontal line across
 * the viewport — same shape as Attio / Linear / Basepoint.
 *
 * Pages that render this should add `pt-[68px]` (52px bar + ~16px
 * breathing room) to their content wrapper so it isn't hidden behind
 * the bar. The bar is `fixed`, so it sits above scrolling content.
 */
export function PageTopBar({ title, leading, trailing, className }: Props) {
  return (
    <div
      className={cn(
        "fixed top-0 right-0 left-0 md:left-64 h-[52px] z-[5]",
        "border-b border-white/[0.06] flex items-center px-6 gap-2 pointer-events-auto",
        className,
      )}
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      {leading}
      {typeof title === "string" ? (
        <span className="text-sm font-medium text-text-primary truncate">
          {title}
        </span>
      ) : (
        title
      )}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
