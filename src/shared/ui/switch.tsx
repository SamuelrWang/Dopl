"use client";

import { cn } from "@/shared/lib/utils";

/**
 * Switch — the kit toggle: a pill-shaped `.concave-track` (ink-filled
 * when on) carrying a raised white thumb, the same pressed-track /
 * raised-face language as SegmentedControl.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  /** Layout-only additions (margins) — recipes stay in the kit. */
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "concave-track relative h-5 w-9 shrink-0 cursor-pointer rounded-full p-0 transition-colors",
        checked && "bg-text-primary",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "raised-tab absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
