/**
 * StatusDot — Square status indicator with optional mono label.
 *
 * Direct port of openclaw's status indicator pattern.
 * Important: the dot is `rounded-none` (square), NOT a circle.
 *
 * Variants:
 *  - online:     emerald solid
 *  - connecting: amber pulsing
 *  - offline:    red solid
 *  - neutral:    white/40 (inactive)
 */

import * as React from "react";
import { cn } from "@/shared/lib/utils";

export type StatusDotState =
  | "online"
  | "connecting"
  | "offline"
  | "neutral";

interface StatusDotProps extends React.HTMLAttributes<HTMLDivElement> {
  state: StatusDotState;
  label?: string;
  /** Show the label text next to the dot (mono uppercase) */
  showLabel?: boolean;
}

const dotStyles: Record<StatusDotState, string> = {
  online: "bg-emerald-700",
  connecting: "bg-amber-500 animate-pulse",
  offline: "bg-red-600",
  neutral: "bg-white/40",
};

const labelStyles: Record<StatusDotState, string> = {
  online: "text-emerald-600",
  connecting: "text-amber-400",
  offline: "text-red-500",
  neutral: "text-white/40",
};

const defaultLabels: Record<StatusDotState, string> = {
  online: "Online",
  connecting: "Connecting",
  offline: "Offline",
  neutral: "Idle",
};

export function StatusDot({
  state,
  label,
  showLabel = true,
  className,
  ...props
}: StatusDotProps) {
  const displayLabel = label ?? defaultLabels[state];

  return (
    <div
      data-slot="status-dot"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    >
      <div
        className={cn(
          "w-2 h-2 rounded-none block flex-shrink-0",
          dotStyles[state]
        )}
      />
      {showLabel && (
        <span
          className={cn(
            "hidden sm:inline font-mono text-[10px] uppercase tracking-wide",
            labelStyles[state]
          )}
        >
          {displayLabel}
        </span>
      )}
    </div>
  );
}
