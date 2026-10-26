import { cn } from "@/shared/lib/utils";
import {
  GHOST_FLAT_FACE,
  Skeleton,
  SkeletonBar,
  SkeletonLine,
} from "@/shared/ui/skeleton";
import { WELL_FACES } from "@/features/channels/components/collapse-wells";
import { PAGE_ACTION_ICON } from "@/shared/ui/page-action-button";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import {
  IdentityCardsGhost,
  SectionPanelGhost,
} from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { AccountRailSkeleton } from "#/components/skeletons/shell-skeleton";
import { PLOT_HEIGHT_CLASS } from "#/components/charts/bar-series";
import { HOME_CHANNEL_WELLS, type HomeChannelWellId } from "./channel-wells";
import { HomeFrame, HomeHeaderRow, HomeListColumn } from "./home-frame";
import { HOME_DEFAULT_TAB, HOME_TABS } from "./home-tabs";
import home from "./home.module.css";

/**
 * /home's loading shapes: the page frame, and one per record-pane face. Geometry is the page's own
 * by reference (`HomeFrame`, `--home-list-w`, `home.kbCards`, `IDENTITY_GRID`, `PLOT_HEIGHT_CLASS`),
 * never re-typed. No text and nothing pressable; the label is `SkeletonSurface`'s `sr-only` line.
 */

/** The whole /home frame while the page reads are in flight: rail, header, list, record pane. */
export function HomePageSkeleton({ label = "Opening home" }: { label?: string }) {
  return (
    <SkeletonSurface label={label} className={shell.root}>
      <HomeFrame
        face={HOME_DEFAULT_TAB}
        rail={<AccountRailSkeleton />}
        header={<HomeHeaderGhost />}
        list={<HomeListGhost />}
      >
        <OverviewFaceGhost />
      </HomeFrame>
    </SkeletonSurface>
  );
}

/** /home → Knowledge while the base list is in flight: two flat sections over the card grid. No
 *  caption under either heading — the real panels print label + control only (2026-09-09). */
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
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Knowledge base" />}>
        <KbCardsGhost />
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Knowledge base" />}>
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
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Agent Identity" />}>
        <IdentityCardsGhost count={4} />
      </SectionPanelGhost>
      <SectionPanelGhost headingWidth={HEADING_W} action={<CreateGhost label="Agent Identity" />}>
        <IdentityCardsGhost count={4} />
      </SectionPanelGhost>
    </SkeletonSurface>
  );
}

/** Every /home section heading ghost is one width. */
const HEADING_W = 148;

/**
 * A section header's create-button ghost: `panel-buttons.tsx › CreateButton` is `PAGE_ACTION_BTN`
 * (`h-9 rounded-full px-[15px]`) holding a 13px plus, a `gap-1.5`, then its label — so the width is
 * sized from the label the real button prints, and two sections with one label ghost one width.
 */
function CreateGhost({ label }: { label: string }) {
  return (
    <SkeletonBar
      h={36}
      w={`calc(${label.length}ch + ${15 * 2 + PAGE_ACTION_ICON + 6}px)`}
      className="rounded-full"
    />
  );
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

/** `home-header.tsx`'s cells: the New channel pill, one label bar per `HOME_TABS` entry sized
 *  from its label, then the 260px search pill and Profile. */
function HomeHeaderGhost() {
  return (
    <HomeHeaderRow
      lead={<Skeleton className="h-9 w-[124px] rounded-full" />}
      tabs={
        <div className="flex h-9 items-center gap-[22px]">
          {HOME_TABS.map(({ key, label }) => (
            <SkeletonLine key={key} w={`calc(${label.length}ch)`} h={12} />
          ))}
        </div>
      }
      trail={
        <>
          <Skeleton className="h-9 w-[260px] rounded-full" />
          <Skeleton className="h-9 w-[88px] rounded-full" />
        </>
      }
    />
  );
}

/**
 * The record pane on the face the page opens on (`HOME_DEFAULT_TAB`, Overview): Usage (the
 * credit card, then the histogram card with its control row) and the channel rails. Token spend is not ghosted — it folds away when no row exists. The Usage cards
 * wear `GHOST_FLAT_FACE`, not the page's `.bento` (skeletons are flat).
 */
function OverviewFaceGhost() {
  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* USAGE — one well holding the capacity bar, then the plot. */}
        <SectionPanelGhost headingWidth={HEADING_W}>
          <div className="flex flex-col gap-3">
            {/* "Credit spend": the card's own `h3` (`mb-2`), then the bar at `CreditsBar`'s 54px. */}
            <div className={cn(GHOST_FLAT_FACE, "p-3.5")}>
              <div className="mb-2 flex h-5 items-center">
                <SkeletonLine w={92} h={12} />
              </div>
              <Skeleton className="h-[54px] w-full rounded-lg" />
            </div>
            {/* The histogram: `overview-sections.tsx › UsageChart`'s control row (scope menu left;
                month stepper and total right), then the plot at `mt-3`. */}
            <div className={cn(GHOST_FLAT_FACE, "flex flex-col p-3.5")}>
              <div className="flex items-center justify-between gap-3">
                <SkeletonLine w={108} h={12} />
                <div className="flex min-w-0 shrink-0 items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    <span className="flex items-center justify-center p-2">
                      <SkeletonBar h={MONTH_ARROW} w={MONTH_ARROW} className="rounded-[4px]" />
                    </span>
                    <SkeletonLine w={84} h={12} />
                    <span className="flex items-center justify-center p-2">
                      <SkeletonBar h={MONTH_ARROW} w={MONTH_ARROW} className="rounded-[4px]" />
                    </span>
                  </div>
                  <SkeletonLine w={36} h={9} />
                </div>
              </div>
              <Skeleton
                className={cn(PLOT_HEIGHT_CLASS, "mt-3 w-full rounded-[10px]")}
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

/** `overview-usage-filter.tsx › MONTH_ARROW_ICON` (file-private there): the stepper's 16px glyph in
 *  `NAKED_ICON_BUTTON`'s `p-2` box. */
const MONTH_ARROW = 16;

/* ── The channel column: the well headings and the rows under them ── */

/** Rows each OPEN well stands in for — per well, because a list is mostly Recent. */
const WELL_ROWS: Record<HomeChannelWellId, number> = {
  pinned: 2,
  recent: 4,
  earlier: 3,
};

/** The column's wells, read from `HOME_CHANNEL_WELLS` (set, order and `defaultOpen`). */
function HomeListGhost() {
  return (
    <HomeListColumn>
      <div className="flex flex-col gap-2">
        {HOME_CHANNEL_WELLS.map((well) => (
          <WellGhost
            key={well.id}
            label={well.label}
            // A closed well ghosts its heading only, as the loaded column opens it.
            rows={well.defaultOpen ? WELL_ROWS[well.id] : 0}
          />
        ))}
      </div>
    </HomeListColumn>
  );
}

/** One well: the heading bar and its caret, then the rows, on `WellsColumn`'s heading geometry. */
function WellGhost({ label, rows }: { label: string; rows: number }) {
  const face = WELL_FACES.heading;
  return (
    <section aria-hidden className={face.box}>
      <div className="flex w-full min-w-0 items-center justify-between gap-2 px-1 pt-1.5">
        <SkeletonLine w={`calc(${label.length}ch)`} h={10} />
        <SkeletonBar h={face.chevron} w={face.chevron} className="rounded-[4px]" />
      </div>
      {rows > 0 && (
        <div className={face.rows}>
          {Array.from({ length: rows }).map((_, i) => (
            <HomeRowGhost key={i} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One channel row, flat (skeletons carry no elevation): the row's two 18px lines in its padding. */
function HomeRowGhost() {
  return (
    <div
      aria-hidden
      className={cn(
        GHOST_FLAT_FACE,
        "flex w-full flex-col gap-1 rounded-xl bg-home-card px-[11px] py-[9px]"
      )}
    >
      <div className="flex h-[18px] items-center justify-between gap-2">
        <SkeletonLine w="58%" h={11} />
        <SkeletonLine w={30} h={8} />
      </div>
      <div className="flex h-[18px] items-center gap-1">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>
    </div>
  );
}
