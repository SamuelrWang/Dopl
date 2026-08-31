import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import {
  Skeleton,
  SkeletonBar,
  SkeletonLine,
  TranscriptSkeleton,
} from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import home from "./home.module.css";

/**
 * /home's LOADING SHAPES — the page frame, and one per face of the record pane.
 *
 * ⚠ THE GEOMETRY IS THE PAGE'S OWN CLASSES, READ BY REFERENCE (R3). The list
 * column is `w-[var(--home-list-w)]` and the header is `pl-[var(--home-list-w)]`
 * — the SAME var, the same two places `home.module.css › .page` says are
 * load-bearing, so the ghost selector starts on the ghost record pane's left
 * edge exactly as the real ones do. The Knowledge face's grid is
 * `home.kbCards` itself, not a re-typed `repeat(3, …)` / `224px`: the card size,
 * the gap and the 1080px step-down cannot drift from the loaded pane, and a
 * re-tune of that grid moves the ghost with it.
 *
 * ⚠ THE THREE-FACE SELECTOR IS GHOSTED, NEVER FAKE-INTERACTIVE. It is the kit's
 * `.seg-track` (the real control's own track recipe — 3px pad, 3px gap, the
 * `--seg-fill` ground) holding three inert blocks. No `<button>`, no labels: a
 * skeleton that offered a pressable tab would be offering a face the page has
 * not loaded.
 *
 * ⚠ NO TEXT ANYWHERE. The label goes to `SkeletonSurface`'s `sr-only` status
 * line and nowhere else.
 */

/** Rows the list column stands in for. Enough to fill the column, no more. */
const LIST_ROWS = 7;

/**
 * THE WHOLE /home FRAME while the three page reads are in flight — account rail,
 * the base panel with its header, the relationship list, and the record pane.
 *
 * ⚠ IT MIRRORS THE FRAME, not a generic page. This gate used to render the
 * shared `PageShellSkeleton` inside a bare `h-screen` div, which resolved into
 * a surface /home has never had: a 52px top bar over a centred `max-w-[960px]`
 * column, where the real page is a dark slab holding a rail, a 290px list and a
 * bordered record pane.
 */
export function HomePageSkeleton({ label = "Opening home" }: { label?: string }) {
  return (
    // `!ml-0` (×2) for the reason `index.tsx`'s own docblock gives: the panel
    // butts flush against the rail, so the visible dark column is the 54px rail
    // exactly. The frame ink itself is the SHELL's since 2026-08-30 — the three
    // `!bg-home-frame` overrides are gone from both this ghost and the page, so
    // neither can drift off the other or off the workspace shell.
    <SkeletonSurface label={label} className={shell.root}>
      <div className={shell.body}>
        <HomeRailGhost />
        <div className={shell.surface}>
          <main
            className={cn(
              "page-float !ml-0 flex flex-1 flex-col overflow-hidden bg-home-panel",
              home.page
            )}
          >
            {/* ⚠ THE LEFT PAD IS THE LIST COLUMN'S WIDTH — one var, two places. */}
            <div className="flex items-center justify-between gap-3 py-3 pl-[var(--home-list-w)] pr-5">
              {/* The Chat / Knowledge / Agents selector, ghosted. */}
              <div className="seg-track">
                <Skeleton className="h-[30px] w-[62px] rounded-full" />
                <Skeleton className="h-[30px] w-[92px] rounded-full" />
                <Skeleton className="h-[30px] w-[70px] rounded-full" />
              </div>
              <div className="flex items-center gap-2.5">
                {/* Collapsed search pill, then the one primary action. */}
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 w-[112px] rounded-full" />
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <HomeListGhost />
              <div
                className={cn(
                  // The record pane's own frame, verbatim from `index.tsx` —
                  // a COLUMN of the surface, bounded by the account palette's
                  // 2px line rather than by an elevation.
                  "mb-3 mr-3 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card",
                  // `home.frame` carries that colour and weight INTO the
                  // hairlines below, so the ghost header's divider is the
                  // account palette's, like the real pane's.
                  home.frame
                )}
              >
                <RecordPaneHeadGhost />
                <div className="min-h-0 flex-1 px-4 py-4">
                  <TranscriptSkeleton bubbles={4} />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/**
 * /home → Knowledge, while the channel-scoped base list is in flight. TWO FLAT
 * SECTIONS over the three-column card grid.
 *
 * ⚠ THE PANE'S OWN COLUMN, `gap-3 p-3`, exactly as the loaded pane is — so the
 * sections do not move when the read lands.
 */
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
      {/* SHARED IN THIS CHANNEL */}
      <PanelGhost actionWidth={122}>
        <KbCardsGhost />
      </PanelGhost>
      {/* PERSONAL — the one caption line under the heading. */}
      <PanelGhost actionWidth={140} caption>
        <KbCardsGhost />
      </PanelGhost>
    </SkeletonSurface>
  );
}

/**
 * /home → Agents, while the container template list is in flight. The SAME two
 * flat sections, over the templates' own auto-fill grid.
 *
 * ⚠ NOT THE KNOWLEDGE GRID. The two faces really do differ here: Knowledge is
 * `home.kbCards` (3 fixed columns, 224px rows), Agents is
 * `template-section.tsx › TemplateGrid`'s `auto-fill` at a 196px minimum over
 * `min-h-[92px]` cards. A skeleton that shared one grid would resolve into the
 * wrong one on whichever face it did not come from.
 */
export function HomeAgentPanelsSkeleton({
  label = "Loading agents",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3"
    >
      <PanelGhost ground={SECTION_PANEL_GROUND} actionWidth={132}>
        <TemplateCardsGhost />
      </PanelGhost>
      <PanelGhost ground={SECTION_PANEL_GROUND} actionWidth={92} caption>
        <TemplateCardsGhost />
      </PanelGhost>
    </SkeletonSurface>
  );
}

/**
 * One `SectionPanel`-shaped region: heading row, optional caption, body.
 *
 * ⚠ IT IS NOT `SectionPanel` ITSELF, and the reason is the no-text rule: that
 * component takes a `label` STRING and paints it as an `<h2>`, which is the one
 * thing a loading state must not do (a heading that says "Personal" over a
 * shimmering grid asserts a section the read has not confirmed). What it DOES
 * keep is the two things the page depends on — `data-section-panel`, the
 * attribute `home.module.css › .frame` repaints every panel in this pane
 * through, and the `rounded-[14px] p-3` box — so the ghost stands on /home's
 * panel gray like its loaded counterpart and needs no palette of its own.
 */
function PanelGhost({
  children,
  ground,
  actionWidth,
  caption = false,
}: {
  children: ReactNode;
  /** The workspace default ground; /home's `.frame` overrides it either way. */
  ground?: string;
  /** The header-right create button's ghost width. */
  actionWidth: number;
  caption?: boolean;
}) {
  return (
    <div data-section-panel className={cn("rounded-[14px] p-3", ground)}>
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <SkeletonLine w={148} h={10} />
        <SkeletonBar h={28} w={actionWidth} className="rounded-lg" />
      </div>
      {caption && (
        <div className="px-1 pb-2.5">
          <SkeletonLine w="58%" h={9} />
        </div>
      )}
      {children}
    </div>
  );
}

/** ⚠ `home.kbCards` ITSELF — see the file docblock. The 224px row height and
 *  the 1080px step-down come from the grid, never from this file. */
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

/** ⚠ `TemplateGrid`'s grid class VERBATIM — a Tailwind arbitrary value cannot
 *  be imported, so it is copied as one string and pinned by the source scan in
 *  `components/skeletons/page-skeletons.test.tsx`. */
function TemplateCardsGhost() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-[14px]" />
      ))}
    </div>
  );
}

/** The account rail — the Dopl tile, the rule, workspace tiles, the create tile.
 *  ⚠ Width from `--shell-rail-w` and 40px tiles at a 7px gutter, which is the
 *  rail's own geometry (`account-rail.module.css`), not a look picked here. */
function HomeRailGhost() {
  return (
    <div className="flex w-[var(--shell-rail-w)] shrink-0 flex-col items-center gap-[7px] pt-[7px]">
      <Skeleton className="h-10 w-10 rounded-[13px]" />
      {/* ⚠ The divider rule the real rail drew here is GONE (2026-08-30) and so
          is its ghost; the account/container break is the 4px `.workspaces`
          opens with on top of the 7px gap — `mt-1` mirrors that exactly. */}
      <Skeleton className="mt-1 h-10 w-10 rounded-[13px]" />
      <Skeleton className="h-10 w-10 rounded-[13px]" />
      <Skeleton className="h-10 w-10 rounded-[13px]" />
    </div>
  );
}

/** The relationship list — floating raised rows in the 290px column. */
function HomeListGhost() {
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-1">
        {Array.from({ length: LIST_ROWS }).map((_, i) => (
          <HomeRowGhost key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * One relationship row. ⚠ THE RAISED FACE IS THE ROW'S OWN RECIPE
 * (`.auth-btn-3d-light` + the row's box), so the swap to real rows is a
 * content change and not a change of surface — but it is a `<div>`, not a
 * `<button>`: a skeleton offers nothing to press. Avatar 32px = `Avatar
 * size="sm"`, or the rows sit at two heights across the swap.
 */
function HomeRowGhost() {
  return (
    <div
      aria-hidden
      className="auth-btn-3d-light flex w-full items-start gap-2.5 rounded-[14px] px-2.5 py-2.5"
    >
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <SkeletonLine w="58%" h={11} />
          <SkeletonLine w={30} h={8} />
        </div>
        <SkeletonLine w="76%" h={9} />
        <SkeletonLine w="46%" h={9} />
      </div>
    </div>
  );
}

/** The record pane's header row — the channel's face, its name, its controls. */
function RecordPaneHeadGhost() {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
      <Skeleton className="h-7 w-7 rounded-full" />
      <SkeletonLine w={172} h={13} />
      <span className="flex-1" />
      <Skeleton className="h-7 w-7 rounded-md" />
      <Skeleton className="h-7 w-7 rounded-md" />
    </div>
  );
}
