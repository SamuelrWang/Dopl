"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** String → standard truncated heading style. ReactNode → verbatim (use for
   *  inline-editable titles, e.g. `EditableTitle`). */
  title: string | ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * Slim 52px header at the top of a page's content panel. In-flow, NOT fixed:
 * pages render inside the AppShell's white panel, so scrolling content passes
 * beneath its border.
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
        <span className="text-title font-medium text-text-primary truncate">
          {title}
        </span>
      ) : (
        title
      )}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
