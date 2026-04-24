/**
 * PillBar — the navbar container that holds Pill children.
 *
 * Renders an elevated Surface with horizontal flex layout. Has subtle internal
 * padding so the inner pills are spaced from the edges. Optionally renders a
 * leading element (like a logo image).
 */

import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Surface } from "./surface";

interface PillBarProps extends React.HTMLAttributes<HTMLDivElement> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}

export function PillBar({
  className,
  leading,
  trailing,
  children,
  ...props
}: PillBarProps) {
  return (
    <Surface
      data-slot="pill-bar"
      variant="elevated"
      shape="pill"
      className={cn(
        "inline-flex items-center gap-2 p-2",
        className
      )}
      {...props}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="flex items-center gap-1">{children}</div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </Surface>
  );
}
