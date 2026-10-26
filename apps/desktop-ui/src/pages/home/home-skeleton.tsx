import { cn } from "@/shared/lib/utils";
import { ChannelRecordGhost } from "@/features/channels/components/channel-record-skeleton";
import { OverviewGhost } from "@/features/home/components/overview/overview-skeleton";
import {
  GHOST_FLAT_FACE,
  Skeleton,
  SkeletonBar,
  SkeletonLine,
} from "@/shared/ui/skeleton";
import { WELL_FACES } from "@/features/channels/components/collapse-wells";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { PanelsGhost } from "@/shared/ui/section-panel-ghost";
import { KbCardsGhost } from "@/features/knowledge/components/knowledge-skeletons";
import { IdentityCardsGhost } from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { AccountRailSkeleton } from "#/components/skeletons/shell-skeleton";
import { HOME_CHANNEL_WELLS, type HomeChannelWellId } from "./channel-wells";
import { HomeFrame, HomeHeaderRow, HomeListColumn } from "./home-frame";
import { HOME_DEFAULT_TAB, HOME_TABS, type HomeTab } from "./home-tabs";

/**
 * /home's loading shapes: the page frame, and one per record-pane face. Geometry is the page's own
 * by reference (`HomeFrame`, `--home-list-w`, `KbCardsGhost`, `IDENTITY_GRID`, the Overview's own
 * module), never re-typed. No text and nothing pressable; the label is `SkeletonSurface`'s `sr-only` line.
 */

/**
 * The whole /home frame while the page reads are in flight: rail, header, list, and the record
 * pane on the face the page will open on (the remembered one once boot names the user).
 */
export function HomePageSkeleton({
  label = "Opening home",
  face = HOME_DEFAULT_TAB,
}: {
  label?: string;
  face?: HomeTab;
}) {
  return (
    <SkeletonSurface label={label} className={shell.root}>
      <HomeFrame
        face={face}
        rail={<AccountRailSkeleton />}
        header={<HomeHeaderGhost />}
        list={<HomeListGhost />}
      >
        <FaceGhost face={face} />
      </HomeFrame>
    </SkeletonSurface>
  );
}

/** One face's record pane, inside a surface that already announces the load. The ontology face
 *  paints its own loading shape once mounted, so it ghosts an empty pane. */
function FaceGhost({ face }: { face: HomeTab }) {
  if (face === "overview") return <OverviewGhost />;
  if (face === "channels") return <ChannelRecordGhost />;
  if (face === "ontology") return null;
  return (
    <div className={PANELS}>
      {face === "knowledge" ? (
        <PanelsGhost label="Knowledge base" cards={<KbCardsGhost />} />
      ) : (
        <PanelsGhost label="Agent Identity" cards={<IdentityCardsGhost count={4} />} />
      )}
    </div>
  );
}

const PANELS = "flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3";

/** /home → Identities while the container list is in flight: the identities' own four-column grid
 *  (not the Knowledge grid). */
export function HomeIdentityPanelsSkeleton({
  label = "Loading identities",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface label={label} className={PANELS}>
      <PanelsGhost label="Agent Identity" cards={<IdentityCardsGhost count={4} />} />
    </SkeletonSurface>
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
