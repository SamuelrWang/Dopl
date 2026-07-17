"use client";

/**
 * Popover + MenuItem — the shared dropdown primitive (design-system kit).
 * Replaces the hand-rolled fixed-backdrop menus that were copy-pasted
 * across members/teams components.
 *
 * Two positioning modes:
 *
 * Trigger-anchored (default) — render inside a `relative` wrapper next
 * to the trigger; opens below it, closes on backdrop click and Escape:
 *
 *   <div className="relative">
 *     <button onClick={() => setOpen(v => !v)}>…</button>
 *     <Popover open={open} onClose={() => setOpen(false)}>
 *       <MenuItem active onSelect={…}>Label</MenuItem>
 *     </Popover>
 *   </div>
 *
 * Coordinate (`at={{ x, y }}`) — portals to <body> at fixed viewport
 * coords, clamped fully on-screen (context menus, cursor-anchored
 * pickers); closes on backdrop click and Escape. The backdrop swallows
 * the dismiss-click so it can't fall through to whatever sits under
 * the cursor (nav links, row selects):
 *
 *   <Popover open={!!anchor} at={anchor ?? undefined} onClose={close}>…</Popover>
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useClampedFixedPosition } from "@/shared/hooks/use-clamped-fixed-position";
import { cn } from "@/shared/lib/utils";

const SURFACE =
  "min-w-[160px] rounded-lg border border-border-default bg-bg-elevated py-1 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_28px_-8px_rgba(0,0,0,0.16)]";

export function Popover({
  open,
  onClose,
  align = "left",
  at,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  /** Coordinate mode: open at these viewport px, portaled + clamped. */
  at?: { x: number; y: number };
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

  if (at) {
    if (typeof document === "undefined") return null;
    return createPortal(
      <CoordinatePanel at={at} onClose={onClose} className={className}>
        {children}
      </CoordinatePanel>,
      document.body
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="menu"
        className={cn(
          "absolute top-full z-50 mt-1",
          SURFACE,
          align === "left" ? "left-0" : "right-0",
          className
        )}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Mounted only while open so useClampedFixedPosition's measure-and-clamp
 * layout effect runs on every open, not just on coordinate changes.
 */
function CoordinatePanel({
  at,
  onClose,
  className,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { ref, style } = useClampedFixedPosition<HTMLDivElement>(at.x, at.y);

  return (
    <>
      <div
        className="fixed inset-0 z-[999]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-hidden
      />
      <div role="menu" ref={ref} style={style} className={cn("z-[1000]", SURFACE, className)}>
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
  icon,
  destructive,
}: {
  active?: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Optional muted second line. */
  description?: string;
  /** Reserve a leading check column (option-list style menus). */
  showCheck?: boolean;
  /** Optional leading icon (inherits the row's text color). */
  icon?: ReactNode;
  /** Danger-token styling for irreversible actions. */
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left text-small transition-colors",
        destructive
          ? "text-danger hover:bg-danger/10"
          : active
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
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span className="min-w-0">
        <span className={cn("block", destructive ? "text-danger" : "text-text-primary")}>
          {children}
        </span>
        {description && (
          <span className="block text-caption leading-snug text-text-muted">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
