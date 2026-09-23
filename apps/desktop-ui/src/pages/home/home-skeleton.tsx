import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonBar } from "@/shared/ui/skeleton";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import {
  IdentityCardsGhost,
  SectionPanelGhost,
} from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { AccountRailSkeleton } from "#/components/skeletons/shell-skeleton";
import { PLOT_HEIGHT_CLASS } from "#/components/charts/bar-series";
import { HOME_TABS } from "./home-tabs";
import { GHOST_FLAT_FACE } from "./home-ghost-face";
import { HomeListGhost } from "./home-list-skeleton";
import home from "./home.module.css";

/**
 * /home's loading shapes: the page frame, and one per record-pane face. Geometry is the page's own
 * classes by reference (`--home-list-w`, `home.kbCards`, `IDENTITY_GRID`, `PLOT_HEIGHT_CLASS`),
 * never re-typed. No text and nothing pressable; the label is `SkeletonSurface`'s `sr-only` line.
 */

/** The whole /home frame while the page reads are in flight: rail, header, list, record pane. */
export function HomePageSkeleton({ label = "Opening home" }: { label?: string }) {
  return (
    // `!ml-0`: the panel butts flush against the rail, as on the page (`index.tsx`).
    <SkeletonSurface label={label} className={shell.root}>
      <div className={shell.body}>
        <AccountRailSkeleton />
        <div className={shell.surface}>
          <main
            className={cn(
              "page-float !ml-0 flex flex-1 flex-col overflow-hidden bg-home-panel",
              home.page
            )}
          >
            <HomeHeaderGhost />

            <div className="flex min-h-0 flex-1">
              <HomeListGhost />
              <div
                className={cn(
                  // The record pane's own frame, verbatim from `index.tsx` — a ROW, not a column.
                  "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card"
                )}
                data-frame-skin
              >
                <OverviewFaceGhost />
              </div>
            </div>
          </main>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/** /home → Knowledge while the base list is in flight: two flat sections over the card grid. */
export function HomeKnowledgePanelsSkeleton({
  label = "Loading knowledge",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3"
    >
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost w={122} />}>
        <KbCardsGhost />
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost w={140} />} caption>
        <KbCardsGhost />
      </SectionPanelGhost>
    </SkeletonSurface>
  );
}

/** /home → Identities while the container list is in flight: the same two sections over the
 *  identities' own four-column grid (not the Knowledge grid). */
export function HomeIdentityPanelsSkeleton({
  label = "Loading identities",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3"
    >
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost w={132} />}>
        <IdentityCardsGhost count={4} />
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost w={92} />} caption>
        <IdentityCardsGhost count={4} />
      </SectionPanelGhost>
    </SkeletonSurface>
  );
}

/** Every /home section heading ghost is one width. */
const HEADING_W = 148;

/** A section header's create-button ghost. */
function CreateGhost({ w }: { w: number }) {
  return <SkeletonBar h={28} w={w} className="rounded-lg" />;
}

function KbCardsGhost() {
  return (
    <div className={home.kbCards}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={home.kbCell}>
          <Skeleton className="h-full w-full rounded-[14px]" />
        </div>
      ))}
    </div>
  );
}

/**
 * `home-header.tsx`'s three boxes: the list-width cell (a cell, not a `pl-`), one inert pill per
 * `HOME_TABS` entry sized from its label, then search + Profile.
 */
function HomeHeaderGhost() {
  return (
    <div className="flex items-center justify-between gap-3 py-3 pr-5">
      <div className="flex min-w-0 items-center">
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          {/* The "New channel" pill: hug-width and left-aligned, as the real `PAGE_ACTION_BTN`. */}
          <Skeleton className="h-9 w-[112px] rounded-full" />
        </div>
        <div className="flex items-center gap-1.5">
          {HOME_TABS.map(({ key, label }) => (
            <SkeletonBar
              key={key}
              h={36}
              w={`calc(${label.length}ch + 24px)`}
              className="rounded-full"
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {/* 260px = `kit.css › .search-expand[data-open="true"]`: /home renders the search open. */}
        <Skeleton className="h-9 w-[260px] rounded-full" />
        <Skeleton className="h-9 w-[72px] rounded-full" />
      </div>
    </div>
  );
}

/**
 * The record pane on the face the page opens on (`HOME_DEFAULT_TAB`, Overview): Usage and the
 * channel rails. Token spend is not ghosted — it folds away when no row exists. The Usage cards
 * wear `GHOST_FLAT_FACE`, not the page's `.bento` (skeletons are flat).
 */
function OverviewFaceGhost() {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* USAGE — one well holding the capacity bar, then the plot. */}
        <SectionPanelGhost headingWidth={HEADING_W}>
          <div className="flex flex-col gap-3">
            <div className={cn(GHOST_FLAT_FACE, "p-3.5")}>
              <Skeleton className="h-[46px] w-full rounded-[10px]" />
            </div>
            <div className={cn(GHOST_FLAT_FACE, "flex flex-col p-3.5")}>
              <Skeleton
                className={cn(PLOT_HEIGHT_CLASS, "w-full rounded-[10px]")}
              />
            </div>
          </div>
        </SectionPanelGhost>

        {/* ALL CHANNELS — two rows of two rails. */}
        <SectionPanelGhost headingWidth={HEADING_W}>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-[14px]" />
            ))}
          </div>
        </SectionPanelGhost>
      </div>
    </div>
  );
}
