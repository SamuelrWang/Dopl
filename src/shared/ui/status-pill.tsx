import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** `live` greens only the dot (DESIGN-LANGUAGE §1: green is for live); `attention` and `done`
 *  tint the whole pill in their status token. */
export type StatusTone = "neutral" | "live" | "attention" | "done";

/** THE status pill (kit `.status-pill`): an optional dot and one word. */
export function StatusPill({
  tone = "neutral",
  dot = true,
  children,
  className,
}: {
  tone?: StatusTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone}>
      {dot && <span className="status-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
