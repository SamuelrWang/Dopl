"use client";

/**
 * Popover + MenuItem — shared dropdown primitive (kit).
 *
 * ⚠ Surface `.menu-card` / `.menu-row` / `.menu-divider` is hand-copied in THREE
 * places — src/app/globals.css, apps/desktop-ui/src/styles/kit.css, and its
 * source `src/features/marketing/marketing.css › .lp-nav-menu-card`.
 * marketing.css is page-scoped and never loaded by the app, hence the replica.
 * Edit them together.
 *
 * Trigger-anchored (default) needs a `relative` wrapper. Coordinate
 * (`at={{x,y}}`) portals to <body>, viewport-clamped. Backdrop swallows the
 * dismiss-click so it can't fall through to whatever sits under the cursor.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useClampedFixedPosition } from "@/shared/hooks/use-clamped-fixed-position";
import { cn } from "@/shared/lib/utils";

/** Exit animation length — keep in sync with `menuCardOut` in globals.css. */
const EXIT_MS = 140;

const SURFACE = "menu-card min-w-[160px]";

/** Panel attrs that differ between open and closing. */
type PanelChrome = {
  role?: "menu";
  inert?: boolean;
  "data-state": "open" | "closing";
  "data-origin": "left" | "right";
};

/** Read at event time, not subscribed: only gates whether a close waits on an
 *  animation. OS setting flipping mid-interaction isn't worth a listener. */
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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
  /**
   * Card outlives `open` by EXIT_MS for `menuCardOut`. While it plays it carries
   * no `role` and is `inert` — a dismissed dropdown must leave the a11y tree and
   * tab order at once, not 140ms later. Backdrop goes with it.
   *
   * ⚠ Derived from the `open` TRANSITION during render, not an effect: an effect
   * paints one frame of the closed card first, and setState in an effect body is
   * a cascading render (react-hooks/set-state-in-effect).
   */
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    // Reduced motion skips the phase — nothing waits on a disabled animation.
    setClosing(!open && !prefersReducedMotion());
  }

  /**
   * Anchor held through the exit: callers clear `at` in the same commit that
   * flips `open`, but the card still needs positioning. ⚠ Compared BY VALUE —
   * `tree-context-menu` passes an object literal; identity re-renders forever.
   */
  const [lastAt, setLastAt] = useState(at);
  if (at && (at.x !== lastAt?.x || at.y !== lastAt?.y)) setLastAt(at);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open && !closing) return null;

  const panelProps: PanelChrome = {
    role: closing ? undefined : "menu",
    inert: closing,
    "data-state": closing ? "closing" : "open",
    "data-origin": align,
  };

  const anchor = at ?? lastAt;
  if (anchor) {
    if (typeof document === "undefined") return null;
    return createPortal(
      <CoordinatePanel
        at={anchor}
        onClose={onClose}
        closing={closing}
        panelProps={panelProps}
        className={className}
      >
        {children}
      </CoordinatePanel>,
      document.body
    );
  }

  return (
    <>
      {/* Dismissed the moment `open` flips — exit animation must never leave an
          invisible click-eater over the page. */}
      {!closing && <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />}
      <div
        {...panelProps}
        className={cn(
          "absolute top-full z-50 mt-2.5",
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

/** Mounted only while on screen, so useClampedFixedPosition's measure-and-clamp
 *  effect runs on every open, not just on coordinate changes. */
function CoordinatePanel({
  at,
  onClose,
  closing,
  panelProps,
  className,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  closing: boolean;
  panelProps: PanelChrome;
  className?: string;
  children: ReactNode;
}) {
  const { ref, style } = useClampedFixedPosition<HTMLDivElement>(at.x, at.y);

  return (
    <>
      {!closing && (
        <div
          className="fixed inset-0 z-[999]"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
          aria-hidden
        />
      )}
      <div {...panelProps} ref={ref} style={style} className={cn("z-[1000]", SURFACE, className)}>
        {children}
      </div>
    </>
  );
}

/** Kit `.menu-divider` — use instead of a `border-t` on the group wrapper,
 *  which on a padded card runs into the corner radius. */
export function MenuDivider() {
  return <div className="menu-divider" role="separator" />;
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
  description?: string;
  /** Reserve a leading check column (option-list style menus). */
  showCheck?: boolean;
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
        // `.menu-row` owns radius + hover lift/press; only colour + density here.
        // `bg-none` kills the row's hover GRADIENT so a destructive tint survives.
        "menu-row flex w-full cursor-pointer items-start gap-2 px-2.5 py-1.5 text-left text-small",
        destructive
          ? "text-danger hover:bg-danger/10 hover:bg-none focus-visible:bg-danger/10 focus-visible:bg-none"
          : active
            ? "bg-surface-selected text-text-primary"
            : "text-text-secondary hover:text-text-primary focus-visible:text-text-primary"
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
