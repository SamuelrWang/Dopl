import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { SkeletonSurface } from "@/shared/ui/skeleton-surface";
import { COMPOSER_BOTTOM } from "./composer-input";
import { channelPaneTabs } from "./info-panel";

/**
 * Loading ghost of `channel-surface.tsx`'s two columns; the info column is open at mount, so it is ghosted too.
 * Mirrors the real frame's geometry by reference (INVARIANTS §1A): boxes copy the real class expressions
 * byte-for-byte (so `[data-frame-skin]` repaints the dividers alike), `COMPOSER_BOTTOM` and `channelPaneTabs` are
 * imported, and `channel-record-skeleton.test.tsx` pins the pairs. Every row is left-aligned: which rows are the
 * viewer's is unknowable before the read.
 */

const MESSAGE_GHOSTS = [
  { name: 96, lines: ["92%", "64%"] },
  { name: 124, lines: ["78%"] },
  { name: 88, lines: ["88%", "72%", "46%"] },
  { name: 110, lines: ["70%"] },
] as const;

/** Tab label widths in row order: Info, Threads, Agents, Settings. */
const TAB_WIDTHS = [26, 48, 44, 48] as const;

/** Info-card rows (`bits.tsx › MetaRow`, `h-9` each). */
const CARD_ROWS = 4;

export function ChannelRecordSkeleton({
  label = "Loading channel",
}: {
  label?: string;
}) {
  return (
    // The surface root's row (`channel-surface-standalone.tsx`); no `min-w-0`, so the info ghost keeps its width.
    <SkeletonSurface label={label} className="relative flex min-h-0 flex-1">
      <TranscriptColumnGhost />
      {/* `info-resize-handle.tsx`'s zero-width sibling, so the row's box math is the real row's. */}
      <div className="relative z-[2] w-0 shrink-0">
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center">
          <Skeleton className="h-10 w-1 shrink-0 rounded-full" />
        </span>
      </div>
      <InfoColumnGhost />
    </SkeletonSurface>
  );
}

/** `message-pane.tsx`'s `<section>`: header, scroller, composer card. */
function TranscriptColumnGhost() {
  return (
    <div className="flex min-w-0 flex-1 flex-col [contain:inline-size]">
      {/* `message-pane-header.tsx`'s page chrome (`gap-1`), not the pop-out's (`gap-1.5`). */}
      <div className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
        <SkeletonLine w={148} h={14} />
        <Skeleton className="h-6 w-6 shrink-0 rounded-[7px]" />
        <span className="flex-1" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-[7px]" />
      </div>
      {/* `overflow-hidden`, not the real `overflow-y-auto`: a ghost must not flash a scrollbar. */}
      <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
        <div className="flex flex-col gap-5">
          {MESSAGE_GHOSTS.map((row, i) => (
            <MessageRowGhost key={i} name={row.name} lines={row.lines} />
          ))}
        </div>
      </div>
      <ComposerGhost />
    </div>
  );
}

/** One message group: `authored-row.tsx › AuthoredRow` around `attribution-pill.tsx › AttributionPill`. */
function MessageRowGhost({
  name,
  lines,
}: {
  name: number;
  lines: readonly string[];
}) {
  return (
    <div className="-mx-2 flex flex-col items-start gap-1.5 rounded-[10px] px-2 py-1">
      {/* `bento` and `rounded-full` are spelled as the real pill's own slots so the byte-share test matches;
          this ghost is never accented or framed. */}
      <span className="bento inline-flex max-w-full items-center gap-2 py-1 pl-1 pr-3.5 rounded-full">
        {/* `avatar.tsx › SIZE.sm`. */}
        <Skeleton className="w-8 h-8 shrink-0 rounded-full" />
        <span className="flex min-w-0 flex-col gap-1">
          <SkeletonLine w={name} h={10} />
          <SkeletonLine w={40} h={7} />
        </span>
      </span>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="wrap-anywhere max-w-[92%] space-y-2">
          {lines.map((w, i) => (
            <SkeletonLine key={i} w={w} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The composer card (`composer.tsx`), at the shared `COMPOSER_BOTTOM` offset. */
function ComposerGhost() {
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
        <div className="flex flex-col gap-2">
          <SkeletonLine w="52%" h={11} />
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-6 rounded-[7px]" />
            ))}
            <span className="flex-1" />
            {/* `shared/ui/send-button.tsx`. */}
            <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-[8px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `info-panel.tsx`'s `aside` at `--info-w`: the `underline` tab row for channel view (what /home mounts) and the
 * Info face's card. No selected tab — a ghost must not claim which face resolves.
 */
function InfoColumnGhost() {
  const tabs = channelPaneTabs(false);
  return (
    <aside className="flex w-[var(--info-w,380px)] shrink-0 flex-col border-l border-border-default">
      <div className="flex h-[56px] shrink-0 items-center px-3">
        <div className="flex items-center gap-5">
          {tabs.map((tab, i) => (
            <span key={tab.key} className="flex h-9 items-center px-1">
              <SkeletonLine w={TAB_WIDTHS[i] ?? 44} h={10} />
            </span>
          ))}
        </div>
      </div>
      {/* `info-tab.tsx` / `info-tab-card.tsx` body. */}
      <div className="min-h-0 flex-1 overflow-hidden pb-6">
        <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-4">
          <SkeletonLine w={84} h={11} />
        </div>
        <div className="px-2">
          {Array.from({ length: CARD_ROWS }).map((_, i) => (
            <div key={i}>
              {i > 0 && (
                <div aria-hidden className="mx-2 border-t border-border-subtle" />
              )}
              <div className="flex h-9 items-center gap-2 rounded-[8px] px-2">
                <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                <SkeletonLine w={CARD_LABELS[i] ?? 64} h={9} />
                <span className="flex-1" />
                <SkeletonLine w={CARD_VALUES[i] ?? 96} h={9} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** Label / value widths down the card — a real row is `label … value`. */
const CARD_LABELS = [40, 52, 64, 48] as const;
const CARD_VALUES = [116, 84, 96, 72] as const;
