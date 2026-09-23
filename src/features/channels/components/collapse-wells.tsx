"use client";

/**
 * The collapsible gray well: a toggling header, a body animated by `.collapse-grid`, one
 * spinning chevron. Well sets and persisted open state live in `well-state.ts`.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";
import { useWells, type WellSpec, type WellStore } from "./well-state";

/** One item, already filed into a well by the caller. */
export interface WellItem<Id extends string = string> {
  key: string;
  well: Id;
  node: ReactNode;
}

/** Must match `.collapse-grid`'s 200ms transition (globals.css + desktop `kit.css`); 0 under reduced motion. */
export const WELL_COLLAPSE_MS = 200;

/**
 * Whether a well's content is rendered: open, or one transition past close (collapsed = unmounted,
 * INVARIANTS §5). Reduced motion unmounts at once, since the kit turns the transition off.
 */
function useWellContent(open: boolean): boolean {
  const [trailing, setTrailing] = useState(open);
  useEffect(() => {
    if (trailing === open) return;
    const instant =
      open ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // 0ms timer on open: `react-hooks/set-state-in-effect` rejects a synchronous setState here.
    const timer = setTimeout(
      () => setTrailing(open),
      instant ? 0 : WELL_COLLAPSE_MS
    );
    return () => clearTimeout(timer);
  }, [open, trailing]);
  return open || trailing;
}

/** Verbatim, not composed with `cn()`: suites assert this exact string. */
const WELL_HEADER =
  "flex min-h-[30px] w-full min-w-0 cursor-pointer items-center justify-between gap-2 pl-1 text-left";

/**
 * One well. The whole header row is the button (no nested button); its `h3` supplies the
 * accessible name. One rotated chevron, not a swapped pair, so the turn can animate.
 */
export function Well({
  label,
  open,
  onToggle,
  face = PANEL_WELL,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Fill only (`PANEL_WELL` or `PANEL_WELL_ON_PANEL`); both share `WELL_BOX` geometry. */
  face?: string;
  children: ReactNode;
}) {
  const mounted = useWellContent(open);
  // `children` is undefined for an empty `showEmpty` well, so `body` is null and `pt-2` drops.
  const body = mounted ? (children ?? null) : null;
  return (
    <section className={face}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={WELL_HEADER}
      >
        <h3 className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>{label}</h3>
        <span aria-hidden className={NAKED_ICON_BUTTON}>
          <ChevronRight
            size={NAKED_ICON}
            data-well-chevron=""
            className={cn(
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              open ? "rotate-90" : "rotate-0"
            )}
          />
        </span>
      </button>
      {/* Always rendered: the closed state is what the box grows from. `.collapse-grid > *` needs
          `min-height: 0` or `0fr` animates nothing (docs/DESIGN-SYSTEM.md `.collapse-grid`).
          `-mt-2`/`pt-2` moves the well's `gap-2` inside the animated box (else a collapsed well is 8px taller).
          `-mx-3`/`px-3` widens the `overflow: hidden` clip box so card shadows aren't cut; tied to the well's `p-3`.
          `pb-3`/`-mb-3` is the same bleed on the bottom edge, only while open so a closing well shows no strip. */}
      <div
        className={cn("collapse-grid -mx-3 -mt-2", open && "-mb-3 pb-3")}
        data-open={open}
        aria-hidden={!open}
      >
        {/* `pt-2` only with a body: a padded empty column can't collapse below its padding. */}
        <div className={cn(PANEL_ROWS, "px-3", body !== null && "pt-2")}>
          {body}
        </div>
      </div>
    </section>
  );
}

/** The caller's wells over one ordered, already-filed list; order is preserved, nothing sorts or buckets. */
export function WellsColumn<Id extends string>({
  wells,
  items,
  storageKey,
  store,
  face,
  showEmpty = false,
  forceOpen = false,
}: {
  /** Render order. */
  wells: readonly WellSpec<Id>[];
  items: readonly WellItem<Id>[];
  /** This surface's storage key — see {@link useWells}. */
  storageKey: string;
  /** `"device"` (default) survives a restart; `"session"` survives only a page change. */
  store?: WellStore;
  face?: string;
  /** Draw empty wells (header only, no placeholder copy). Default `false` is the safe default. */
  showEmpty?: boolean;
  /** Open every non-empty well regardless of stored state (e.g. while filtering); does not write the store. */
  forceOpen?: boolean;
}) {
  const { isOpen, toggle } = useWells(storageKey, wells, store);
  const grouped = useMemo(() => {
    const out = new Map<Id, WellItem<Id>[]>();
    for (const item of items) {
      const bucket = out.get(item.well);
      if (bucket) bucket.push(item);
      else out.set(item.well, [item]);
    }
    return out;
  }, [items]);

  return (
    <div className="flex flex-col gap-2">
      {wells.map((well) => {
        const bucket = grouped.get(well.id);
        if (!showEmpty && (!bucket || bucket.length === 0)) return null;
        return (
          <Well
            key={well.id}
            label={well.label}
            open={
              isOpen(well.id) || (forceOpen && (bucket?.length ?? 0) > 0)
            }
            onToggle={() => toggle(well.id)}
            face={face}
          >
            {bucket?.map((item) => (
              <Fragment key={item.key}>{item.node}</Fragment>
            ))}
          </Well>
        );
      })}
    </div>
  );
}
