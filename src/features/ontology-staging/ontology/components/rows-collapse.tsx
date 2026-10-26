"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * The Rows display's fold: the repo's height-slide recipe
 * (`kanban-column-header.tsx` details: grid rows 0fr ↔ 1fr over an
 * `overflow-hidden` child), plus an opacity fade. Children stay mounted so they
 * slide out rather than vanish; `inert` takes the folded content off the tab
 * order and the a11y tree, which `overflow: hidden` alone does not.
 *
 * No first-paint animation: the folded state comes from storage synchronously
 * (`use-rows-collapsed.ts`), and a CSS transition never runs on a node's initial
 * values, so a reload paints closed lanes closed.
 */
export function RowsCollapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid w-full transition-[grid-template-rows,opacity] duration-[220ms] ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
    </div>
  );
}

/** The fold's chevron: one icon, turned 90° when open, turning with the slide. */
export function RowsChevron({ open, size }: { open: boolean; size: number }) {
  return (
    <ChevronRight
      size={size}
      aria-hidden
      className={cn(
        "transition-transform duration-[220ms] ease-out motion-reduce:transition-none",
        open && "rotate-90"
      )}
    />
  );
}
