import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine, SkeletonText } from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
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
 *
 * ⚠ THE DETAIL COLUMN WAS THE STALE HALF (re-measured 2026-08-30). It ghosted a
 * `px-6 pt-6 gap-5` document — a title, a paragraph and two flat cards — which
 * was the pre-overhaul info face. What opening a base shows now is
 * `detail/base-overview.tsx`: NO title, NO wrapper, two `SectionPanel`s
 * standing directly in `.infoBody` (12px gap, 12px pad). And they are WELLS —
 * `SECTION_PANEL_GROUND`, frame-model level 3 — because this column sits inside
 * the shell's white `.pageCard`; a flat shimmer block there resolved into a gray
 * panel appearing under the reader.
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
      {/* HEADER STRIP — 52px, spanning both columns. Crumbs left; then the
          `w-52` search well (lg and up) and THREE 26px round controls —
          download, settings, delete (`detail/base-header.tsx`). */}
      <div className={cn(kv.baseHead, "border-b border-border-default")}>
        <SkeletonLine w={96} h={12} />
        <SkeletonLine w={10} h={10} />
        <SkeletonLine w={132} h={12} />
        <div className={kv.headSpacer} />
        <Skeleton className="mr-1 hidden h-8 w-52 rounded-[9px] lg:block" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[26px] w-[26px] shrink-0 rounded-full" />
        ))}
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

        {/* THE DETAIL COLUMN — the info face's two flat wells, in `.infoBody`'s
            own gap and padding. */}
        <div className={cn(kv.detailPane, "border-l border-border-default")}>
          <div className={kv.infoBody}>
            <InfoPanelGhost lines={3} />
            <InfoPanelGhost lines={4} />
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/**
 * One section of the info face — Details, then Contents.
 *
 * ⚠ NOT `SectionPanel` ITSELF: it takes a `label` STRING and paints it as an
 * `<h2>`, and a skeleton carries no text. What it keeps is the box
 * (`rounded-[14px] p-3`), the `data-section-panel` hook — the one /home's record
 * pane repaints every panel through — and `SECTION_PANEL_GROUND`, so this ghost
 * re-grounds with `detail/meta-card.tsx` and `detail/overview-contents.tsx`
 * rather than beside them.
 */
function InfoPanelGhost({ lines }: { lines: number }) {
  return (
    <div
      data-section-panel
      className={cn("rounded-[14px] p-3", SECTION_PANEL_GROUND)}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <SkeletonLine w={72} h={9} />
      </div>
      <SkeletonText lines={lines} className="px-1" />
    </div>
  );
}

/** Tree rows taper — a folder list is not a column of equal bars. */
const RAIL_ROW_WIDTHS = ["78%", "62%", "88%", "54%", "70%", "46%"];
