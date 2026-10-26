import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** `live` greens only the dot (DESIGN-LANGUAGE §1: green is for live); `attention` and `done`
 *  tint the whole pill in their status token. */
export type StatusTone = "neutral" | "live" | "attention" | "done";

/** THE status pill (kit `.status-pill`): an optional dot and one word. */
export function StatusPill({
  tone = "neutral",
  dot = false,
  bare = false,
  children,
  className,
}: {
  tone?: StatusTone;
  dot?: boolean;
  /** No pill face: the dot and the word on the card's own ground. */
  bare?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone} data-bare={bare || undefined}>
      {dot && <span className="status-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
