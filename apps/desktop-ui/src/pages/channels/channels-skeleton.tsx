import { cn } from "@/shared/lib/utils";
import {
  Skeleton,
  SkeletonLine,
  TranscriptSkeleton,
} from "@/shared/ui/skeleton";
import { COMPOSER_BOTTOM } from "@/features/channels/components/channels-v2/composer-input";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/channels`'s loading shape — the surface's OWN two
 * columns, not the generic two-pane list ghost.
 *
 * ⚠ THE REAL SHAPE IS A 260px SIDEBAR + THE MESSAGE PANE, and the generic ghost
 * got both halves wrong: a 372px list of avatar rows over a 760px document
 * column, where this page is a narrow nav tree over a transcript with a card
 * composer at the bottom. Widths and heights here are the surface's own —
 * `sidebar.tsx`'s `w-[260px] … border-r border-border-default` and `h-[52px]`
 * head, `message-pane.tsx`'s `h-[56px]` header and `px-8 py-5` scroller.
 *
 * ⚠ THE INFO COLUMN IS NOT DRAWN. It is closed at mount
 * (`.channel-info-slide` at zero width until `data-open`), so a ghost third
 * column would resolve into a pane that then slid shut.
 *
 * ⚠ THE COMPOSER BLOCK WAS THE STALE HALF (re-measured 2026-08-30). It ghosted
 * an `px-8 pb-5` well holding a two-glyph toolbar and a round send dot; the real
 * one is `composer.tsx`'s `relative shrink-0 px-4 pt-1` + `COMPOSER_BOTTOM`
 * around a card that carries **no row gap of its own** (that file's own ⚠: "a
 * `gap-2` here once grew the card visibly"), a SIX-glyph toolbar and the 30px
 * squared `SendButton`. The offset is imported rather than retyped for the
 * reason the constant exists: the channel and agent composers align on it.
 */
export function ChannelsSkeleton({
  label = "Loading channels",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="page-float relative flex antialiased"
    >
      {/* THE SIDEBAR — search head, the hardcoded nav block, then the
          collapsible sections over their gap-px row lists. */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border-default">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
          <span className="flex-1" />
          {/* Search toggle — `icon-button.tsx`'s resting face, `h-7 w-7 rounded-[7px]`. */}
          <Skeleton className="h-7 w-7 rounded-[7px]" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-6">
          <div className="flex flex-col gap-px px-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <NavRowGhost key={i} />
            ))}
          </div>
          <SidebarSectionGhost rows={3} />
          <SidebarSectionGhost rows={5} />
        </div>
      </div>

      {/* THE MESSAGE PANE — header, transcript scroller, composer card. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ⚠ THE BOOKMARK SITS LEFT OF THE SPACER, beside the crumb it acts on,
            and the info toggle is `bare` (h-8, no box). `message-pane.tsx`. */}
        <div className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          <SkeletonLine w={148} h={13} />
          <Skeleton className="h-6 w-6 shrink-0 rounded-[7px]" />
          <span className="flex-1" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-[7px]" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
          <TranscriptSkeleton bubbles={5} />
        </div>
        {/* The composer is a RAISED CARD, not a bare input row — and the card
            takes no gap; the column INSIDE it does. */}
        <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
          <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
            <div className="flex flex-col gap-2">
              <SkeletonLine w="52%" h={11} />
              <div className="flex items-center gap-0.5">
                {/* Six `h-6 w-6` glyphs — new thread, mention, shortcuts,
                    emoji, attach, mic. The launch bot is bridge-gated and the
                    Discard button needs a draft, so neither is ghosted. */}
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-6 rounded-[7px]" />
                ))}
                <span className="flex-1" />
                {/* `shared/ui/send-button.tsx` — 30px, squared at 8px. */}
                <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-[8px]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/**
 * One nav / channel row.
 *
 * ⚠ THE HEIGHT IS THE ROW SHELL'S OWN 36px and the indent is its `DEPTH_PAD`
 * pair (`sidebar-rows.tsx`: `h-[36px] … pr-2`, `pl-2` / `pl-5`). It was
 * `px-2 py-1.5` — an ~28px row, so a full sidebar of ghosts stood eight rows
 * short of where the tree lands.
 */
function NavRowGhost({ indented = false }: { indented?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-[36px] items-center gap-2 pr-2",
        indented ? "pl-5" : "pl-2"
      )}
    >
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
      <SkeletonLine w={indented ? "56%" : "68%"} h={10} />
    </div>
  );
}

/** A collapsible section — its header strip over its rows (`bits.tsx › SectionHeader`). */
function SidebarSectionGhost({ rows }: { rows: number }) {
  return (
    <>
      <div className="flex items-center gap-1 px-3 pb-1 pt-3">
        <SkeletonLine w={92} h={9} />
        <span className="flex-1" />
        <Skeleton className="h-5 w-5 rounded" />
      </div>
      <div className="flex flex-col gap-px px-2">
        {Array.from({ length: rows }).map((_, i) => (
          <NavRowGhost key={i} indented={i % 3 === 2} />
        ))}
      </div>
    </>
  );
}
