import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./skeleton-surface.module.css";

/**
 * THE OUTERMOST ELEMENT OF EVERY PER-PAGE SKELETON — the announcement and the
 * motion opt-out, and NOT a shape.
 *
 * ⚠ **IT MOVED DOWN OUT OF `apps/desktop-ui/src/components/skeletons/` ON
 * 2026-09-17** (wave 2, item 6's seam): `ChannelRecordSkeleton` is a CHANNELS
 * shape and belongs in `src/features/channels/`, which cannot import `#/` — so
 * the wrapper it stands in had to be reachable from both trees. The SPA path
 * re-exports this, so no call site moved.
 *
 * ⚠ THE SHIMMER PRIMITIVE IS NOT HERE AND MUST NOT BE FORKED HERE. It is
 * `@/shared/ui/skeleton` — `Skeleton` (the one pulse recipe: `animate-pulse`
 * over `bg-surface-raised-2`), plus `SkeletonBar` / `SkeletonLine` /
 * `SkeletonText` / `SkeletonRow` / `TranscriptSkeleton` on top of it. Every
 * block a page skeleton paints comes out of that file, so a restyle of the
 * ghost fill lands everywhere at once. This wrapper adds the two things a
 * SURFACE owes that an atom cannot:
 *
 *   1. IT ANNOUNCES ITSELF. The visual is `aria-hidden` shimmer end to end, so
 *      without `role="status"` + `aria-busy` + an `sr-only` label a screen
 *      reader gets silence while a page loads. `aria-live="polite"` for the
 *      reason the kit's own two shells use it: the label is a status, not an
 *      alert.
 *   2. IT DROPS THE PULSE UNDER `prefers-reduced-motion` — see
 *      `skeleton-surface.module.css`. Static blocks in the same geometry, never
 *      nothing.
 *
 * ⚠ IT PAINTS NO GROUND. `className` is the page's own surface recipe
 * (`page-float`, the app-shell root, /home's `bg-home-panel` panel …) — the
 * same division `shared/ui/section-panel.tsx` draws, and for the same reason: a
 * skeleton that carried its own fill would resolve into a surface the page
 * never had.
 */
export function SkeletonSurface({
  label,
  className,
  children,
}: {
  /** Screen-reader-only status text. ⚠ The ONLY text a skeleton may contain. */
  label: string;
  /** The page's own surface recipe. See the docblock — this component has none. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(styles.surface, className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * THE SAME MOTION OPT-OUT WITHOUT THE ANNOUNCEMENT — for a CHROME ghost that
 * stands OUTSIDE the announcing region.
 *
 * ⚠ IT EXISTS FOR EXACTLY ONE SHAPE: `components/skeletons/shell-skeleton.tsx ›
 * ShellChromeSkeleton`, which paints the account rail and the sidebar around a
 * PAGE skeleton that brings its own `SkeletonSurface`. Nesting two `role="status"`
 * regions would announce one load twice; painting the chrome outside the wrapper
 * entirely would drop `prefers-reduced-motion` for those blocks, which INVARIANTS
 * §1A forbids ("static blocks in the same geometry, never nothing"). This is the
 * half that is a surface — the module class — and none of the half that is a
 * status.
 *
 * ⚠ `aria-hidden`, because the announcement it is missing lives on its sibling.
 * ⚠ IT PAINTS NO GROUND either, for `SkeletonSurface`'s reason: `className` is
 * the real chrome's own recipe (`account-rail.module.css › .rail`,
 * `app-shell.module.css › .sidebar`).
 */
export function SkeletonChrome({
  className,
  children,
}: {
  /** The real chrome's own class — see the docblock. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-hidden className={cn(styles.surface, className)}>
      {children}
    </div>
  );
}
