import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./skeletons.module.css";

/**
 * THE OUTERMOST ELEMENT OF EVERY PER-PAGE SKELETON — the announcement and the
 * motion opt-out, and NOT a shape.
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
 *      `skeletons.module.css`. Static blocks in the same geometry, never
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
