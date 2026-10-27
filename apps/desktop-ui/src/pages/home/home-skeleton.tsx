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
import {
  CreateGhost,
  HEADING_W,
  PanelsGhost,
  SectionPanelGhost,
} from "@/shared/ui/section-panel-ghost";
import { KbCardsGhost } from "@/features/knowledge/components/knowledge-skeletons";
import { IdentityCardsGhost } from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { AccountRailSkeleton } from "#/components/skeletons/shell-skeleton";
import { IDENTITY_GRID_RAIL } from "@/features/agent-identities/components/identity-section";
import { HOME_CHANNEL_WELLS, type HomeChannelWellId } from "./channel-wells";
import { HomeFrame, HomeHeaderRow, HomeListColumn } from "@/features/home/components/shell/home-frame";
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
  if (face === "identities") return <IdentitiesGhost />;
  return (
    <div className={PANELS}>
      <PanelsGhost label="Knowledge base" cards={<KbCardsGhost />} />
    </div>
  );
}

const PANELS = "flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3";

export function HomeIdentityPanelsSkeleton({
  label = "Loading identities",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface label={label} className="flex min-w-0 flex-1">
      <IdentitiesGhost />
    </SkeletonSurface>
  );
}

/** `identities-home.tsx`'s frame by its own kit classes: the head lines and two flat sections in
 *  the 3/4 column, the Activity rail in the 1/4. */
function IdentitiesGhost() {
  const create = <CreateGhost label="Agent Identity" />;
  return (
    <div className="rail-layout">
      <div className="rail-layout-cols">
        <div className="rail-layout-main">
          <div className="flex flex-col gap-3">
            <SkeletonLine w={220} h={10} />
            <SkeletonBar h={36} w={260} className="rounded-full" />
          </div>
          <SectionPanelGhost flat headingWidth={HEADING_W} action={create}>
            <IdentityCardsGhost count={3} grid={IDENTITY_GRID_RAIL} />
          </SectionPanelGhost>
          <SectionPanelGhost flat headingWidth={HEADING_W} action={create}>
            <IdentityCardsGhost count={3} grid={IDENTITY_GRID_RAIL} />
          </SectionPanelGhost>
        </div>
        <div className="rail-layout-aside">
          <SectionPanelGhost flat headingWidth={72}>
            <Skeleton className="h-15.5 rounded-xl" />
          </SectionPanelGhost>
        </div>
      </div>
    </div>
  );
}
/** `home-header.tsx`'s cells: the New channel pill, one label bar per `HOME_TABS` entry sized
 *  from its label, then the 260px search pill and Profile. */
function HomeHeaderGhost() {
  return (
    <HomeHeaderRow
      lead={<Skeleton className="h-9 w-31 rounded-full" />}
      tabs={
        <div className="flex h-9 items-center gap-5.5">
          {HOME_TABS.map(({ key, label }) => (
            <SkeletonLine key={key} w={`calc(${label.length}ch)`} h={12} />
          ))}
        </div>
      }
      trail={
        <>
          <Skeleton className="h-9 w-65 rounded-full" />
          <Skeleton className="h-9 w-22 rounded-full" />
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
        <SkeletonBar h={face.chevron} w={face.chevron} className="rounded-mark" />
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
        "flex w-full flex-col gap-1 rounded-xl bg-home-card px-2.75 py-2.25"
      )}
    >
      <div className="flex h-4.5 items-center justify-between gap-2">
        <SkeletonLine w="58%" h={11} />
        <SkeletonLine w={30} h={8} />
      </div>
      <div className="flex h-4.5 items-center gap-1">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>
    </div>
  );
}
