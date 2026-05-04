"use client";

/**
 * Tooltip — minimal accessible tooltip primitive.
 *
 * Wraps a single child trigger and renders a labeled popover on hover
 * AND keyboard focus. Audit A-020 fix: native `title=""` only fires on
 * mouse hover, so keyboard-only users tabbing through icon-only
 * controls (sidebar access badges, panel toolbars) never see the
 * description. This component listens to both events and exposes the
 * tooltip via `aria-describedby` so screen readers also pick it up.
 *
 * Intentionally tiny — no portal, no positioning library, no fade
 * animation. The bubble sits below-and-right of the trigger via plain
 * absolute positioning. If we ever need richer behavior (collision
 * detection, smart placement) swap to `@radix-ui/react-tooltip` and
 * keep the same call site shape.
 *
 * Usage:
 *
 *   <Tooltip label="You can edit this">
 *     <Edit2 size={10} />
 *   </Tooltip>
 *
 * The child is wrapped in a `<span>` that becomes the focus / hover
 * target. Pass `inline` to keep the wrapper inline-flex (default) or
 * `block` for full-width triggers.
 */

import { useId, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface Props {
  label: string;
  children: ReactNode;
  className?: string;
  /** Where to put the bubble relative to the trigger. */
  side?: "bottom" | "top" | "right";
}

export function Tooltip({
  label,
  children,
  className,
  side = "bottom",
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      // Make the wrapper focusable IF nothing inside is. Most callers
      // wrap an icon (non-focusable) inside a button or link, in which
      // case the parent already handles focus and this tabIndex is
      // ignored. For purely informational icons (no surrounding focusable
      // element), a tabIndex of -1 still picks up programmatic focus
      // without being added to the tab order.
      tabIndex={-1}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-white/[0.12] bg-[#0a0a0a] px-2 py-1 text-[10px] text-white/95 shadow-2xl shadow-black/60",
            side === "bottom" && "left-0 top-full mt-1",
            side === "top" && "left-0 bottom-full mb-1",
            side === "right" && "left-full top-0 ml-1",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

// Re-export so future call sites have one canonical import.
export type { ReactElement };
