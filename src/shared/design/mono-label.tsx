/**
 * MonoLabel — The canonical openclaw label pattern.
 *
 * `font-mono text-[10px] uppercase tracking-wide`
 *
 * Used throughout for section labels, status text, metadata, timestamps.
 * Optional accent bar (coral/mint/gold) on the left.
 */

import * as React from "react";
import { cn } from "@/shared/lib/utils";

interface MonoLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional left accent bar color (CSS color string — use --coral, --mint, --gold) */
  accentColor?: string;
  /** Text opacity variant */
  tone?: "default" | "strong" | "muted";
}

const toneStyles: Record<NonNullable<MonoLabelProps["tone"]>, string> = {
  default: "text-white/70",
  strong: "text-white/90",
  muted: "text-white/50",
};

export function MonoLabel({
  className,
  accentColor,
  tone = "default",
  children,
  ...props
}: MonoLabelProps) {
  if (accentColor) {
    return (
      <span
        data-slot="mono-label"
        className={cn("inline-flex items-center gap-2", className)}
      >
        <span
          className="w-0.5 h-4 rounded-full"
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-wide",
            toneStyles[tone]
          )}
          {...props}
        >
          {children}
        </span>
      </span>
    );
  }

  return (
    <span
      data-slot="mono-label"
      className={cn(
        "font-mono text-[10px] uppercase tracking-wide",
        toneStyles[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
