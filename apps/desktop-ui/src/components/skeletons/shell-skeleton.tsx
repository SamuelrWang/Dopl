import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { NAV } from "@/shared/layout/app-shell/app-sidebar-core";
import rail from "#/components/app-shell/account-rail.module.css";
import { SkeletonChrome } from "./skeleton-surface";

/**
 * THE WORKSPACE SHELL'S OWN LOADING SHAPE — the state a WORKSPACE SWITCH paints
 * (Samuel, 2026-09-10: *"the loading skeleton for when i first open the app/when
 * i switch workspaces doesnt look at all like the actual UI"*).
 *
 * ⚠ WHAT IT REPLACES. `components/app-shell/app-shell.tsx`'s `isPending` gate
 * rendered `PageLoading` inside a bare `flex h-screen w-screen flex-col`: a
 * white 52px top bar over a centred `max-w-[960px]` column, with NO account
 * rail, NO dark frame, NO sidebar and NO page card. Every one of those four
 * survives a workspace switch on screen — the rail is even still CLICKABLE —
 * so the ghost was tearing down the whole app frame and building a different
 * one, then tearing THAT down when the boot answer landed. Three re-layouts for
 * one read.
 *
 * ⚠ THE CHROME IS THE SHELL'S OWN MODULE, CLASS FOR CLASS (§1A, geometry by
 * reference): `.root` / `.body` / `.surface` / `cn("page-float", .panel)` /
 * `.sidebar` / `.pageCard` are the SAME SIX boxes `app-shell.tsx` composes, in
 * the same nesting, so the paint-over is a fade of the sidebar's and the card's
 * CONTENTS and nothing moves. A re-tune of the frame moves this with it.
 * ⚠ **SIX, NOT FIVE** — `docs/INVARIANTS.md` §1A says "five" and lists five
 * because it omits `.sidebar`, which this ghost draws and `frame-skeletons.test.tsx`
 * pins. Count the boxes below, not the adjective.
 *
 * ⚠ THE RAIL IS RENDERED FOR REAL WHEN IT CAN BE. `GET /api/workspaces` is
 * cached and IndexedDB-persisted, so on a switch the tile strip is already known
 * — the caller passes the live `AccountRail` and the operator keeps a working
 * rail (and the tile they just clicked, lit) while the boot read is in flight.
 * `AccountRailSkeleton` is the COLD case only.
 */
export function ShellChromeSkeleton({
  rail: railNode,
  children,
}: {
  /** The live `AccountRail` when the workspace list is cached; else its ghost. */
  rail?: ReactNode;
  /** The routed page's own skeleton — it brings the `role="status"`. */
  children: ReactNode;
}) {
  return (
    <div className={shell.root}>
      <div className={shell.body}>
        {railNode ?? <AccountRailSkeleton />}
        <div className={shell.surface}>
          <div className={cn("page-float", shell.panel)}>
            <ShellSidebarSkeleton />
            <div className={shell.pageCard}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The account rail with ghost tiles — `account-rail.module.css`'s OWN `.rail`,
 * `.tile` and `.workspaces`, so the width, the `calc()` top pad that lands the
 * first tile flush with the panel, the 7px gutter and the 4px account/container
 * break are all inherited rather than re-typed. The 2026-08-28 ghost restated
 * `pt-[7px]` and drifted off the rail's `calc(--shell-gap-top + --page-float-gap-top)`
 * the day 2026-09-09 fixed that alignment; this cannot.
 *
 * ⚠ THE FILL IS `.homeMark`'s NUMBERS (36px / 11px radius) rather than the
 * `.tile > span` rule, because `Skeleton` renders a `<div>` and that rule is
 * `> span`. One place, stated once, and it is the value both real children wear.
 */
export function AccountRailSkeleton({ tiles = 3 }: { tiles?: number }) {
  return (
    <SkeletonChrome className={rail.rail}>
      <RailTileGhost />
      <div className={rail.workspaces}>
        {Array.from({ length: tiles }).map((_, i) => (
          <RailTileGhost key={i} />
        ))}
      </div>
      <RailTileGhost />
    </SkeletonChrome>
  );
}

function RailTileGhost() {
  return (
    <div className={rail.tile}>
      <Skeleton className="h-9 w-9 rounded-[11px]" />
    </div>
  );
}

/**
 * The sidebar region — `app-sidebar-core.tsx`'s four blocks in its order: brand
 * pill, nav column, Pro card, settings foot.
 *
 * ⚠ ONE ROW PER `NAV` ENTRY, SIZED FROM THAT ENTRY'S OWN LABEL (`ch` off the
 * label's length). The count is the real nav's count by construction — adding a
 * ninth section moves this ghost with it — and the rows land at the real
 * `.nav-chip` height and gutter because the ghost WEARS `.nav-chip`.
 *
 * ⚠ `<div>`, NEVER the `Link` the real row is (§1A: nothing pressable), and no
 * label text: the sr-only status line on the page skeleton beside it is the only
 * string this surface may contain.
 */
function ShellSidebarSkeleton() {
  return (
    <SkeletonChrome className={shell.sidebar}>
      <div className={shell.brand}>
        <div className={shell.brandPill}>
          <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-[6px]" />
          <div className={shell.brandPillText}>
            <SkeletonLine w={96} h={10} />
            <SkeletonLine w={52} h={8} />
          </div>
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />
        </div>
      </div>

      <div className={shell.nav}>
        {NAV.map(({ section, label }) => (
          <div key={section} className="nav-chip">
            <Skeleton className="h-5 w-5 shrink-0 rounded-[5px]" />
            <SkeletonLine w={`${label.length}ch`} h={10} />
          </div>
        ))}
      </div>

      {/* The Pro upsell — the card's own class, so its margin, fill, 1px line
          and 18px pad are the sidebar's, not this file's. */}
      <div className={shell.wordsCard}>
        <SkeletonLine w={128} h={14} className="mb-[9px]" />
        <div className="mb-4 space-y-2">
          <SkeletonLine w="100%" h={9} />
          <SkeletonLine w="76%" h={9} />
        </div>
        <Skeleton className="h-[35px] w-full rounded-lg" />
      </div>

      <div className={shell.foot}>
        <div className="nav-chip">
          <Skeleton className="h-5 w-5 shrink-0 rounded-[5px]" />
          <SkeletonLine w="8ch" h={10} />
        </div>
      </div>
    </SkeletonChrome>
  );
}
