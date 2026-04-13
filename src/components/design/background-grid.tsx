/**
 * BackgroundGrid — applies the subtle blueprint grid pattern to a container.
 *
 * Most often applied to <body> via the `design-grid` class in globals.css,
 * but this component lets you scope it to a specific area if needed.
 */

import { cn } from "@/lib/utils";

interface BackgroundGridProps {
  className?: string;
  children?: React.ReactNode;
}

export function BackgroundGrid({ className, children }: BackgroundGridProps) {
  return (
    <div className={cn("design-grid", className)}>{children}</div>
  );
}
