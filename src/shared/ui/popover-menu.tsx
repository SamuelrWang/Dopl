"use client";

/**
 * Popover + MenuItem — the shared dropdown primitive (design-system kit).
 * Replaces the hand-rolled fixed-backdrop menus that were copy-pasted
 * across members/teams components.
 *
 * Usage: render inside a `relative` wrapper next to the trigger.
 *
 *   <div className="relative">
 *     <button onClick={() => setOpen(v => !v)}>…</button>
 *     <Popover open={open} onClose={() => setOpen(false)}>
 *       <MenuItem active onSelect={…}>Label</MenuItem>
 *     </Popover>
 *   </div>
 *
 * Closes on backdrop click and Escape.
 */

import { useEffect, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function Popover({
  open,
  onClose,
  align = "left",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="menu"
        className={cn(
          "absolute top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border-default bg-bg-elevated py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_28px_-8px_rgba(0,0,0,0.16)]",
          align === "left" ? "left-0" : "right-0",
          className
        )}
      >
        {children}
      </div>
    </>
  );
}

export function MenuItem({
  active,
  onSelect,
  children,
  description,
  showCheck,
}: {
  active?: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Optional muted second line. */
  description?: string;
  /** Reserve a leading check column (option-list style menus). */
  showCheck?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left text-small transition-colors",
        active
          ? "bg-surface-selected text-text-primary"
          : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary"
      )}
    >
      {showCheck && (
        <Check
          size={11}
          className={cn("mt-1 shrink-0 text-text-primary", !active && "opacity-0")}
        />
      )}
      <span className="min-w-0">
        <span className="block text-text-primary">{children}</span>
        {description && (
          <span className="block text-caption leading-snug text-text-muted">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
