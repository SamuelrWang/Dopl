"use client";

/**
 * Popover + MenuItem — the shared dropdown primitive (design-system kit).
 * Replaces the hand-rolled fixed-backdrop menus that were copy-pasted
 * across members/teams components.
 *
 * The SURFACE is the landing page's Menu dropdown, ported into the global
 * kit as `.menu-card` / `.menu-row` / `.menu-divider` (src/app/globals.css,
 * mirrored in apps/desktop-ui/src/styles/kit.css). Source of the design:
 * `src/features/marketing/marketing.css › .lp-nav-menu-card` driven by
 * `src/features/marketing/components/site-nav.tsx`. marketing.css is a
 * page-scoped sheet the app never loads, so the recipe was replicated in the
 * global layer rather than imported — edit them together.
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

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useClampedFixedPosition } from "@/shared/hooks/use-clamped-fixed-position";
import { cn } from "@/shared/lib/utils";

/** Exit animation length — keep in sync with `menuCardOut` in globals.css. */
const EXIT_MS = 140;

const SURFACE = "menu-card min-w-[160px]";

/** The bits of the panel element that differ between open and closing. */
type PanelChrome = {
  role?: "menu";
  inert?: boolean;
  "data-state": "open" | "closing";
  "data-origin": "left" | "right";
};

/** Read at event time rather than subscribed to: all it gates is whether a
 *  close waits for an animation, and the OS setting flipping mid-interaction
 *  is not a case worth a listener. (Same call as site-nav.tsx.) */
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
   * The card outlives `open` by EXIT_MS so `menuCardOut` can run. While it
   * plays, the card carries no `role` and is `inert`: it is a picture of a
   * menu, not a menu — a dismissed dropdown must leave the a11y tree and the
   * tab order at once, not 140ms later. The backdrop goes with it.
   *
   * Derived from the `open` TRANSITION during render rather than in an
   * effect: an effect would paint one frame of the closed card before the
   * exit started, and a synchronous `setState` in an effect body is a
   * cascading render (react-hooks/set-state-in-effect).
   */
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    // Reduced motion skips the phase entirely, so nothing waits on an
    // animation the stylesheet has turned off.
    setClosing(!open && !prefersReducedMotion());
  }

  /**
   * The anchor held through the exit. Every coordinate-mode caller closes by
   * clearing its anchor state, so `at` goes undefined in the same commit that
   * flips `open` — and the card still has an animation's worth of screen time
   * to be positioned for. Compared BY VALUE, not identity: `tree-context-menu`
   * passes an object literal, and an identity check would re-render forever.
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
      {/* Dismissed the moment `open` flips — the exit animation must never
          leave an invisible click-eater over the page. */}
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

/**
 * Mounted only while the card is on screen (open OR playing its exit), so
 * useClampedFixedPosition's measure-and-clamp layout effect runs on every
 * open, not just on coordinate changes.
 */
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

/**
 * Section rule between groups of rows inside a Popover — the kit's
 * `.menu-divider`, inset from the card's padding so it stops short of the
 * rounded corners. Use instead of a `border-t` on the group wrapper, which
 * on a padded card runs into the corner radius.
 */
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
        // `.menu-row` owns radius + the hover lift / press; only colour and
        // density are set here. `bg-none` kills the row's hover GRADIENT so a
        // destructive tint is not painted over by it.
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
