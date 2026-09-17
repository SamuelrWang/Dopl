import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { AccountRailSkeleton } from "#/components/skeletons/shell-skeleton";
import { PLOT_HEIGHT_CLASS } from "#/components/charts/bar-series";
import { HOME_CARD_FACE } from "./channel-row-marks";
import { HOME_TABS } from "./home-tabs";
import home from "./home.module.css";
import { TEMPLATE_GRID } from "@/features/agent-templates/components/template-section";

/**
 * /home's LOADING SHAPES — the page frame, and one per face of the record pane.
 *
 * ⚠ THE GEOMETRY IS THE PAGE'S OWN CLASSES, READ BY REFERENCE (R3). The list
 * column and the header's leading CELL are both `w-[var(--home-list-w)]` — the
 * SAME var, the same two places `home.module.css › .page` says are load-bearing,
 * so the ghost selector starts on the ghost record pane's left edge exactly as
 * the real one does. The Knowledge face's grid is
 * `home.kbCards` itself, not a re-typed `repeat(3, …)` / `224px`: the card size,
 * the gap and the 1080px step-down cannot drift from the loaded pane, and a
 * re-tune of that grid moves the ghost with it.
 *
 * ⚠ THE FACE SELECTOR IS GHOSTED, NEVER FAKE-INTERACTIVE — one inert pill per
 * `home-tabs.ts › HOME_TABS` entry, in the `plain` control's own trackless row.
 * No `<button>`, no labels: a skeleton that offered a pressable tab would be
 * offering a face the page has not loaded. ⚠ The `.seg-track` this ghost wore
 * until 2026-09-10 left the page on 2026-09-08 (Samuel: plain pills, no track).
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
                  // The record pane's own frame, verbatim from `index.tsx` —
                  // a COLUMN of the surface, bounded by the account palette's
                  // 2px line rather than by an elevation. ⚠ NO `flex-col`: the
                  // real pane is a ROW holding one `Crossfade` that fills it,
                  // and the ghost carried a column for as long as it drew a
                  // 52px header the landing face does not have.
                  "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card",
                  // `home.frame` carries that colour and weight INTO the
                  // hairlines below, so the ghost's panel lines are the account
                  // palette's, like the real pane's.
                  home.frame
                )}
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
 * flat sections, over the templates' own four-column grid.
 *
 * ⚠ NOT THE KNOWLEDGE GRID. The two faces really do differ here: Knowledge is
 * `home.kbCards` (3 fixed columns, 224px rows), Agents is
 * `template-section.tsx › TEMPLATE_GRID` (FOUR fixed columns since 2026-09-13 —
 * Samuel's ruling; it was `auto-fill` at a 196px minimum) over `min-h-[92px]`
 * cards. A skeleton that shared one grid would resolve into the wrong one on
 * whichever face it did not come from.
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
  /**
   * The header-right create button's ghost width. ⚠ OMITTED = NO BUTTON, and
   * that is the Overview face: its two `SectionPanel`s take a `label` and no
   * `action`, so a bar there would ghost an affordance the panel never grows.
   */
  actionWidth?: number;
  caption?: boolean;
}) {
  return (
    <div data-section-panel className={cn("rounded-[14px] p-3", ground)}>
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <SkeletonLine w={148} h={10} />
        {actionWidth !== undefined && (
          <SkeletonBar h={28} w={actionWidth} className="rounded-lg" />
        )}
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

/** ⚠ `TemplateGrid`'s grid class **BY IMPORT** — `TEMPLATE_GRID`, exported when
 *  the grid became a fixed four columns (2026-09-13). The source scan in
 *  `components/skeletons/page-skeletons.test.tsx` pins the import, so the count
 *  and the gap cannot move on one surface only. It was a copied string while the
 *  value was an un-exported Tailwind arbitrary. */
function TemplateCardsGhost() {
  return (
    <div className={TEMPLATE_GRID}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-[14px]" />
      ))}
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
 * One channel row. ⚠ THE RAISED FACE IS THE ROW'S OWN CONSTANT
 * (`channel-row-marks.tsx › HOME_CARD_FACE` + the row's box), so the swap to real
 * rows is a content change and not a change of surface — but it is a `<div>`, not
 * a `<button>`: a skeleton offers nothing to press.
 *
 * 🔒 **REDRAWN 2026-09-13 AND IT WAS TWO RULINGS BEHIND.** It drew a 32px LEADING
 * AVATAR — deleted from the real row on 2026-09-01 with the roster-derived
 * identity — and THREE stacked text lines, the second and third being the
 * last-message preview Samuel removed on 2026-09-13. So the ghost resolved into a
 * row of a different height with a face in a slot that no longer exists, which is
 * the "way off" defect §1A exists to refuse. It is now the real row's own two
 * lines: title + time, then the 20px peer stack.
 *
 * ⚠ **THE HEIGHTS ARE THE ROW'S, STATED AS THE ROW STATES THEM** — two `h-5`
 * lines (a `text-body` title's box, and `AvatarStack`'s `2xs` face) with the row's
 * own `mt-0.5` between, inside its `py-2.5`. A ghost one text line off shifts the
 * content the operator is already reading toward.
 *
 * ⚠ **NO GHOST FOR THE UNREAD MARKS, deliberately.** A dot or an `@ N` pill is
 * present on SOME rows, so ghosting one would promise a notification that the
 * loaded row usually does not have — the same argument `overview-panels.tsx` makes
 * for having no Activity ghost.
 */
function HomeRowGhost() {
  return (
    <div
      aria-hidden
      className={cn(
        HOME_CARD_FACE,
        "flex w-full items-start gap-2.5 px-2.5 py-2.5"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center justify-between gap-2">
          <SkeletonLine w="58%" h={11} />
          <SkeletonLine w={30} h={8} />
        </div>
        <div className="mt-0.5 flex h-5 items-center gap-1.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * THE HEADER STRIP — `home-header.tsx`'s OWN three boxes, in its nesting.
 *
 * ⚠ THE CELL HOLDS "New channel" (2026-09-15) — see the ghost itself.
 *
 * ⚠ THE LIST-WIDTH PAD IS A CELL, NOT A `pl-`. That strip stopped being
 * `pl-[var(--home-list-w)]` on 2026-08-30, when the operator's face moved INTO
 * that column: it is a `w-[var(--home-list-w)] px-3` cell holding the settings
 * control, grouped with the selector so `justify-between` sees two children and
 * not three. The ghost held the old pad, so its selector started one `px-3`
 * short of where the real one does and the avatar's slot was empty.
 *
 * ⚠ ONE PILL PER `HOME_TABS` ENTRY, SIZED FROM THAT ENTRY'S LABEL — FIVE since
 * the Ontology face (2026-09-09), and it was still drawing four. Reading the
 * table is what stops a sixth face from leaving this behind again. The row is
 * the `plain` `SegmentedControl` at `size="lg"`, i.e. `flex items-center gap-1.5`
 * over `h-9` hug-width pills, NOT the `.seg-track` this ghost still wore: that
 * form left the page on 2026-09-08.
 */
function HomeHeaderGhost() {
  return (
    <div className="flex items-center justify-between gap-3 py-3 pr-5">
      <div className="flex min-w-0 items-center">
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          {/* 🔒 **THE CELL IS THE "New channel" PILL SINCE 2026-09-15** (Samuel:
              "move the new channel button to be where the search bar now is. It
              will be left aligned basically"). It ghosted a `HOME_CARD_FACE` bar
              with an avatar in it, then the search field for one revision — three
              shapes in one cell, which is why this ghost is the first thing to
              re-check when the strip moves.
              ⚠ **HUG-WIDTH AND LEFT-ALIGNED, NOT `w-full`.** The real pill is
              `PAGE_ACTION_BTN`'s `px-[15px]` around its label, so a full-width
              block here would collapse to a short button the instant the read
              lands. 112px is the same number the right group's ghost used for this
              button when it lived there — one label, one width. */}
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
        {/* THE SEARCH PILL AT ITS OPEN WIDTH, then the "Profile" pill — that
            order since 2026-09-15 (Samuel: "move the search bar back … turn the
            profile button to be black, and have it say Profile"). ⚠ **260px IS
            `kit.css › .search-expand[data-open="true"]`'s OWN NUMBER** — /home
            renders the pill open, so the ghost reserves what the real box
            reserves; a 36px circle here was the CLOSED pill's ghost and left 224px
            of the row unaccounted for. ⚠ The Profile pill is TEXT ONLY since
            Samuel dropped its glyph the same day ("remove the profile icon"), so
            it is the page's narrowest `PAGE_ACTION_BTN`: `px-[15px]` around one
            short word. */}
        <Skeleton className="h-9 w-[260px] rounded-full" />
        <Skeleton className="h-9 w-[72px] rounded-full" />
      </div>
    </div>
  );
}

/**
 * THE RECORD PANE ON THE FACE THE PAGE ACTUALLY OPENS ON —
 * `home-tabs.ts › HOME_DEFAULT_TAB` is `"overview"` (Samuel, 2026-09-01: opening
 * Dopl should answer *"what needs me / what is happening / what is running"*),
 * so this is what a cold launch resolves into.
 *
 * ⚠ IT WAS THE CHANNELS FACE — a 52px pane header over `TranscriptSkeleton` —
 * which is the face the page STOPPED landing on nine days after the ghost was
 * written. A skeleton for a face the page does not open on is the "way off"
 * defect in its purest form: correct geometry, wrong pane.
 *
 * ⚠ TWO PANELS AND NOT FOUR. `overview-panels.tsx` renders Activity and Token
 * spend ONLY when their rows exist — both fold away entirely — so ghosting them
 * would flash a box and then remove it for every operator with nothing running,
 * which is the argument that file's own docblock makes for having no Activity
 * ghost. Usage and All channels always render.
 *
 * ⚠ THE COLUMN, THE CARDS AND THE PLOT ARE THE PAGE'S. `p-3` / `gap-3`, the
 * `.bento` recipe `RailCard` and the TWO Usage cards share, the `grid-cols-2 gap-3`
 * rails at `h-40` (`overview-panels.tsx › RailsGhost`'s own size), and the plot
 * IMPORTED from `bar-series.tsx › PLOT_HEIGHT_CLASS` the way the Overview page's
 * ghost takes it, never re-typed.
 */
function OverviewFaceGhost() {
  return (
    // ⚠ NO `data-overview-face` ANY MORE (2026-09-17). It existed for ONE
    // reason — the kit scoped a deeper `--shadow-card` to
    // `[data-overview-face] .bento` — and Samuel reverted that elevation
    // (*"I want to revert it to the old amount of shadow"*), so the hook and the
    // token are both deleted. The ghost and the page now wear the SAME `.bento`
    // resting shadow by construction, which is what the hook was buying.
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* USAGE — ONE well holding TWO `.bento` cards, `gap-3` between them:
            the capacity bar, then the plot (Samuel, 2026-09-13). ⚠ **NO
            `ground` OVERRIDE**: the 2026-09-08 white trial passed
            `!bg-home-card` here to mirror the page, and BOTH are reverted — the
            ghost's ground is /home's own `.frame [data-section-panel]` rule, the
            same as the rails panel below. */}
        <PanelGhost>
          <div className="flex flex-col gap-3">
            <div className="bento p-3.5">
              <Skeleton className="h-[46px] w-full rounded-[10px]" />
            </div>
            <div className="bento flex flex-col p-3.5">
              <Skeleton
                className={cn(PLOT_HEIGHT_CLASS, "w-full rounded-[10px]")}
              />
            </div>
          </div>
        </PanelGhost>

        {/* ALL CHANNELS — the two rows of two rails. */}
        <PanelGhost>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-[14px]" />
            ))}
          </div>
        </PanelGhost>
      </div>
    </div>
  );
}
