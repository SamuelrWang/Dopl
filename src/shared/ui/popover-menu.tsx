"use client";

/**
 * Popover + MenuItem — shared dropdown primitive (kit).
 *
 * ⚠ Surface `.menu-card` / `.menu-row` / `.menu-divider` is hand-copied in THREE
 * places — src/app/globals.css, apps/desktop-ui/src/styles/kit.css, and its
 * source `src/features/marketing/marketing.css › .lp-nav-menu-card`.
 * marketing.css is page-scoped and never loaded by the app, hence the replica.
 * Edit them together — with ONE documented exception since 2026-09-10: the option
 * HOVER FACE. Samuel's global rule flattened `.menu-row:hover` to
 * `var(--menu-item-hover-bg)` in the two APP copies; `.lp-nav-menu-item` keeps the
 * raised gradient because marketing is exempt from this kit (DESIGN-SYSTEM.md says
 * so on the `.menu-card` row). A second since 2026-10-26: the WIDTH rule below is the
 * two app copies' only; the landing nav sizes its own card. Everything else about the
 * three still moves together.
 *
 * Trigger-anchored (default) needs a `relative` wrapper. Coordinate
 * (`at={{x,y}}`) portals to <body>, viewport-clamped. Backdrop swallows the
 * dismiss-click so it can't fall through to whatever sits under the cursor.
 *
 * WIDTH IS THE KIT'S, not the caller's (Samuel, 2026-10-26: dropdowns "way wider
 * than the maximum text width"). `.menu-card` sizes to its widest row, floored at
 * `--menu-min-width` or `triggerWidth`, capped at `--menu-max-width`, both inside
 * the viewport; `MenuItem` labels truncate at the cap unless `wrap`. Pass a
 * `className` width only when the content needs a stable one (a search field, a
 * form, an accordion that grows as it opens, a right-edge anchor computed from it).
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useClampedFixedPosition } from "@/shared/hooks/use-clamped-fixed-position";
import { cn } from "@/shared/lib/utils";

/** Exit animation length — keep in sync with `menuCardOut` in globals.css. */
const EXIT_MS = 140;

/** Sizing lives on the class itself (`.menu-card`'s width rule); no width utility here. */
const SURFACE = "menu-card";

/** Panel attrs that differ between open and closing. */
type PanelChrome = {
  role?: "menu";
  inert?: boolean;
  "data-state": "open" | "closing";
  "data-origin": "left" | "right";
  "data-wrap"?: "true";
};

/** The trigger-width floor, as the custom property `.menu-card`'s `min-width` reads. */
function floorStyle(triggerWidth?: number): CSSProperties | undefined {
  if (!triggerWidth || triggerWidth <= 0) return undefined;
  return { "--menu-trigger-width": `${Math.round(triggerWidth)}px` } as CSSProperties;
}

/**
 * Trigger-anchored panels are `absolute`, so nothing else keeps a content-sized card
 * on screen: shift it with `translate` (composes with the entrance `transform`
 * instead of fighting it) until both edges clear the gutter. Edges come from
 * `offsetWidth` off the origin edge, not the rect's width: mid-entrance the rect is
 * the keyframe's `scale(0.98)` box.
 */
function useViewportNudge(ref: RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    el.style.translate = "";
    const gutter =
      parseFloat(getComputedStyle(el).getPropertyValue("--menu-viewport-gutter")) || 8;
    const rect = el.getBoundingClientRect();
    const left = el.dataset.origin === "right" ? rect.right - el.offsetWidth : rect.left;
    const right = left + el.offsetWidth;
    let dx = 0;
    if (right > window.innerWidth - gutter) dx = window.innerWidth - gutter - right;
    if (left + dx < gutter) dx = gutter - left;
    if (dx !== 0) el.style.translate = `${Math.round(dx)}px 0`;
  }, [ref, active]);
}

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
  triggerWidth,
  wrap,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  /** Coordinate mode: open at these viewport px, portaled + clamped. */
  at?: { x: number; y: number };
  /** The trigger's px width: the card never opens narrower than what opened it. */
  triggerWidth?: number;
  /** Long `MenuItem` labels wrap instead of truncating at the width cap. */
  wrap?: boolean;
  /** Width overrides only, for content that needs a stable box (see header). */
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

  const anchoredRef = useRef<HTMLDivElement | null>(null);
  useViewportNudge(anchoredRef, open && !at && !lastAt);

  if (!open && !closing) return null;

  const panelProps: PanelChrome = {
    role: closing ? undefined : "menu",
    inert: closing,
    "data-state": closing ? "closing" : "open",
    "data-origin": align,
    ...(wrap ? { "data-wrap": "true" as const } : {}),
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
        triggerWidth={triggerWidth}
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
        ref={anchoredRef}
        style={floorStyle(triggerWidth)}
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
  triggerWidth,
  className,
  children,
}: {
  at: { x: number; y: number };
  onClose: () => void;
  closing: boolean;
  panelProps: PanelChrome;
  triggerWidth?: number;
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
      <div
        {...panelProps}
        ref={ref}
        style={{ ...style, ...floorStyle(triggerWidth) }}
        className={cn("z-[1000]", SURFACE, className)}
      >
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
  checked,
  icon,
  destructive,
}: {
  active?: boolean;
  onSelect: () => void;
  children: ReactNode;
  description?: string;
  /** Reserve a leading check column (option-list style menus). */
  showCheck?: boolean;
  /**
   * MULTI-SELECT ROW: the row becomes a `menuitemcheckbox` carrying `aria-checked`.
   *
   * ⚠ STATE ONLY, NEVER PAINT — the caller draws its own box (through `icon`), because
   * a checkbox face is a per-surface decision and `showCheck`'s tick is a SINGLE-select
   * sentence ("this option is current"). Omitted, the row is an ordinary `menuitem` and
   * nothing about the existing callers changes.
   */
  checked?: boolean;
  icon?: ReactNode;
  /** Danger-token styling for irreversible actions. */
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        // `.menu-row` owns radius + the hover/press FACE; only colour + density here.
        // ⚠ `bg-none` is BELT-AND-BRACES since 2026-09-10: the hover face is a flat
        // `var(--menu-item-hover-bg)` now, not a gradient, so a destructive
        // `hover:bg-danger/10` already wins on its own (utilities layer over
        // components). It stays because it costs nothing and states the intent — a
        // destructive row must never wear the shared option gray.
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
      <span className="min-w-0 flex-1">
        {/* `.menu-row-label`: one truncated line at the card's cap (wrapped under
            `Popover wrap`); `title` carries the full text a truncated label hides. */}
        <span
          className={cn("menu-row-label", destructive ? "text-danger" : "text-text-primary")}
          title={typeof children === "string" ? children : undefined}
        >
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
