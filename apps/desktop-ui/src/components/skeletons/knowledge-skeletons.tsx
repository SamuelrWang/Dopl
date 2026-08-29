import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine, SkeletonText } from "@/shared/ui/skeleton";
import kv from "@/features/knowledge/components/knowledge-v2/knowledge-v2.module.css";
import { SkeletonSurface } from "./skeleton-surface";

/**
 * THE TWO KNOWLEDGE-V2 SHAPES, GHOSTED — and they live HERE rather than beside
 * one page because BOTH hosts of that surface load through them:
 * `pages/knowledge/index.tsx` (the workspace page, at `.page-float`) and
 * `pages/home/knowledge-base-view.tsx` (the /home record pane, `embedded`).
 * One geometry, two mounts, exactly as the surface itself is (INVARIANTS §7).
 *
 * ⚠ THE GEOMETRY IS THE REAL MODULE'S CLASSES, NOT NUMBERS COPIED OUT OF IT.
 * `knowledge-v2.module.css` is imported and its `.home` / `.cardGrid` /
 * `.baseHead` / `.rail` / `.detailPane` are what these render into — so the
 * 52px header, the 232px rail, the 3×244px card grid and their breakpoints
 * cannot drift from the loaded view. Re-stating any of those as a Tailwind
 * arbitrary value here would be a second copy of a number the page already
 * owns. (R3: geometry by reference.)
 *
 * ⚠ THE TWO DIVIDERS ARE TAILWIND UTILITIES, exactly as the real view emits
 * them — `.baseHead` takes `border-b border-border-default`
 * (`detail/base-header.tsx`), `.detailPane` takes `border-l
 * border-border-default` (`detail/detail-panel.tsx`). That is deliberate there:
 * `pages/home/home.module.css › .frame` selects on those class names to widen
 * and repaint them in the account palette. Drawn any other way the skeleton
 * would wear neutral hairlines inside a pane whose every line is /home's.
 */

/** How many ghost cards a grid stands in for — two full rows at 3 columns. */
const GRID_CARDS = 6;

/**
 * The knowledge ROOT — head row, hero band, filter pills, card grid.
 *
 * ⚠ MODE-ACCURATE, and that is the whole point of having two of these. The
 * workspace page already chose its ghost by whether `:kbSlug` is present; a
 * base-shaped ghost that resolved into a card grid is the "shape the user never
 * asked for" its own docblock warns about.
 */
export function KnowledgeHomeSkeleton({
  label = "Loading knowledge",
  embedded = false,
}: {
  label?: string;
  /** No `.page-float` — the host already paints the surface (see the file doc). */
  embedded?: boolean;
}) {
  return (
    <SkeletonSurface
      label={label}
      className={cn(!embedded && "page-float", kv.shell, kv.shellHome)}
    >
      <div className={kv.home}>
        <div className={kv.homeHead}>
          <SkeletonLine w={168} h={20} />
          <div className={kv.headSpacer} />
          {/* The search well is `w-64` on the real head. */}
          <Skeleton className="h-9 w-64 rounded-[9px]" />
        </div>

        {/* ONE rounded container: the 210px image band, then the chat panel
            band under it — `.homeHero` supplies the border, radius and margin. */}
        <div className={kv.homeHero}>
          <Skeleton className={cn(kv.homeHeroBand, "rounded-none")} />
        </div>

        {/* Filter pills sit under the hero's hairline. */}
        <div className={cn(kv.homeFilters, "flex gap-2")}>
          <Skeleton className="h-8 w-[74px] rounded-full" />
          <Skeleton className="h-8 w-[92px] rounded-full" />
          <Skeleton className="h-8 w-[68px] rounded-full" />
        </div>

        <div className={kv.homeBody}>
          <div className={kv.cardGrid}>
            {Array.from({ length: GRID_CARDS }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full rounded-[14px]" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/**
 * An OPENED base — header strip spanning the panel, then the folder rail and
 * the detail column beneath it (the one-panel-three-parts shape Samuel ruled
 * for on 2026-08-28).
 */
export function KnowledgeBaseSkeleton({
  label = "Loading knowledge base",
  embedded = false,
}: {
  label?: string;
  embedded?: boolean;
}) {
  return (
    <SkeletonSurface
      label={label}
      className={cn(!embedded && "page-float", kv.shell)}
    >
      {/* HEADER STRIP — 52px, spanning both columns. Crumbs left, controls right. */}
      <div className={cn(kv.baseHead, "border-b border-border-default")}>
        <SkeletonLine w={96} h={12} />
        <SkeletonLine w={10} h={10} />
        <SkeletonLine w={132} h={12} />
        <div className={kv.headSpacer} />
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>

      <div className={kv.baseBody}>
        {/* THE THIN RAIL — `.rail` is the 232px width and the clip; `.railInner`
            holds the fixed inner measure so nothing squashes. */}
        <div className={kv.rail}>
          <div className={kv.railInner}>
            <div className={kv.railHead}>
              <SkeletonLine w={44} h={10} />
            </div>
            <div className={cn(kv.railBody, "flex flex-col gap-2 px-3")}>
              {RAIL_ROW_WIDTHS.map((w, i) => (
                <SkeletonLine key={i} w={w} h={11} />
              ))}
            </div>
          </div>
        </div>

        {/* THE DETAIL COLUMN — title, then the section blocks the info face
            stacks. */}
        <div className={cn(kv.detailPane, "border-l border-border-default")}>
          <div className="flex min-h-0 flex-1 flex-col gap-5 px-6 pt-6">
            <SkeletonLine w="42%" h={22} />
            <SkeletonText lines={3} />
            <Skeleton className="h-[104px] w-full rounded-[14px]" />
            <Skeleton className="h-[104px] w-full rounded-[14px]" />
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/** Tree rows taper — a folder list is not a column of equal bars. */
const RAIL_ROW_WIDTHS = ["78%", "62%", "88%", "54%", "70%", "46%"];
