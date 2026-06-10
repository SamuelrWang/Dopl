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
 * Slim 52px header bar at the top of a page's content panel. In-flow
 * (NOT fixed): every page now renders inside the AppShell's white
 * panel, so the bar sits at the top of the panel and scrolling content
 * passes beneath its border.
 */
export function PageTopBar({ title, leading, trailing, className }: Props) {
  return (
    <div
      className={cn(
        "h-[52px] shrink-0 border-b border-border-subtle",
        "flex items-center px-6 gap-2",
        className,
      )}
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
