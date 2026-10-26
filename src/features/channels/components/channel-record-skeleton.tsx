import { cn } from "@/shared/lib/utils";
import {
  GHOST_FLAT_FACE,
  Skeleton,
  SkeletonBar,
  SkeletonLine,
} from "@/shared/ui/skeleton";
import { SkeletonSurface } from "@/shared/ui/skeleton-surface";
import { COMPOSER_BOTTOM } from "./composer-input";
import { channelPaneTabs } from "./info-panel";

/**
 * Loading ghost of `channel-surface.tsx`'s two columns; the info column is open at mount, so it is ghosted too.
 * Mirrors the real frame's geometry by reference (INVARIANTS §1A): boxes copy the real class expressions
 * byte-for-byte (so `[data-frame-skin]` repaints the dividers alike), `COMPOSER_BOTTOM` and `channelPaneTabs` are
 * imported, and `channel-record-skeleton.test.tsx` pins the pairs. Every row is left-aligned: which rows are the
 * viewer's is unknowable before the read.
 *
 * 🔒 FLAT, IN THE /home OVERVIEW GHOST'S LANGUAGE (Samuel, 2026-09-21: *"we basically just shouldn't have elevated
 * components"*; redone 2026-10-09). Shimmer blocks only, from the same kit atoms `home-skeleton.tsx` composes
 * (`Skeleton`, `SkeletonBar`, `SkeletonLine`, `GHOST_FLAT_FACE`). No container here wears a face — the attribution
 * pill and the composer card keep their GEOMETRY on an invisible border box, never the page's raised skin.
 */

const MESSAGE_GHOSTS = [
  { name: 96, lines: ["92%", "64%"] },
  { name: 124, lines: ["78%"] },
  { name: 88, lines: ["88%", "72%", "46%"] },
  { name: 110, lines: ["70%"] },
] as const;

/** Tab label widths in row order: Info, Threads, Agents, Settings. */
const TAB_WIDTHS = [26, 48, 44, 48] as const;

/** Info-card rows (`info-tab-card.tsx`: Name, Description, Creator, Created — `bits.tsx › MetaRow`, `h-9` each). */
const CARD_ROWS = 4;

/** Label / value widths down the card — a real row is `label … value`. */
const CARD_LABELS = [40, 72, 52, 52] as const;
const CARD_VALUES = [116, 84, 96, 72] as const;

/** Info-tab section headings in order (`info-tab.tsx`), sized from their titles. */
const SECTION_HEADINGS = {
  info: 84,
  activity: 112,
  mentions: 72,
  members: 68,
} as const;

/** Roster rows the Members section stands in for (`member-roster.tsx › MemberRow`). */
const MEMBER_ROWS = 2;

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
      {/* `message-pane-header.tsx`'s page chrome (`gap-1`), not the pop-out's (`gap-1.5`): the channel-name crumb,
          the pin (`h-6 w-6`), the spacer, then the bare Channel-info toggle (`icon-button.tsx`'s 32px bare box). */}
      <div className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
        <SkeletonLine w={148} h={14} />
        <SkeletonBar h={24} w={24} className="shrink-0 rounded-[7px]" />
        <span className="flex-1" />
        <SkeletonBar h={32} w={32} className="shrink-0 rounded-[8px]" />
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

/**
 * One message group: `authored-row.tsx › AuthoredRow` around `attribution-pill.tsx › AttributionPill`. The pill keeps
 * its geometry on `GHOST_FLAT_FACE`'s invisible border box, never the page's raised capsule.
 */
function MessageRowGhost({
  name,
  lines,
}: {
  name: number;
  lines: readonly string[];
}) {
  return (
    <div className="-mx-2 flex flex-col items-start gap-1.5 rounded-[10px] px-2 py-1">
      <span
        className={cn(
          GHOST_FLAT_FACE,
          "rounded-full",
          "inline-flex max-w-full items-center gap-2 pr-3.5",
          "py-1 pl-1"
        )}
      >
        {/* `avatar.tsx › SIZE.px36`. */}
        <Skeleton className="w-9 h-9 shrink-0 rounded-full" />
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

/**
 * The composer card (`composer.tsx`), at the shared `COMPOSER_BOTTOM` offset. The card's radius and padding ride
 * `GHOST_FLAT_FACE`; the loaded card's raised face does not.
 */
function ComposerGhost() {
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      <div className={cn(GHOST_FLAT_FACE, "flex flex-col rounded-[20px] px-3 py-2.5")}>
        <div className="flex flex-col gap-2">
          <SkeletonLine w="52%" h={11} />
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-6 rounded-[7px]" />
            ))}
            <span className="flex-1" />
            {/* `shared/ui/send-button.tsx`. */}
            <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `info-panel.tsx`'s `aside` at `--info-w`: the `underline` tab row for channel view (what /home mounts) and the
 * Info face's four sections in `info-tab.tsx`'s order — Channel info, Channel activity, Mentions, Members. No
 * selected tab — a ghost must not claim which face resolves.
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
      {/* `info-tab.tsx`'s body; `overflow-hidden`, not the real `overflow-y-auto`, for the scrollbar reason. */}
      <div className="min-h-0 flex-1 overflow-hidden pb-6">
        <HeadingGhost w={SECTION_HEADINGS.info} />
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

        {/* `thread-activity.tsx › ActivityCells`' strip, as one block over its `px-3.5 pt-1` box. */}
        <HeadingGhost w={SECTION_HEADINGS.activity} />
        <div className="px-3.5 pt-1">
          <Skeleton className="h-8 w-full rounded-[8px]" />
        </div>

        {/* `mentions-list.tsx` on `inset="flush"`: one line stands in for the list or its caption. */}
        <HeadingGhost w={SECTION_HEADINGS.mentions} />
        <div className="px-2">
          <div className="px-2 pb-2 pt-1">
            <SkeletonLine w="64%" h={9} />
          </div>
        </div>

        {/* `member-roster.tsx`: `MemberRow`s (`h-[46px]`, avatar `px36`, name over email). */}
        <HeadingGhost w={SECTION_HEADINGS.members} />
        <div className="flex flex-col gap-px px-2">
          {Array.from({ length: MEMBER_ROWS }).map((_, i) => (
            <div key={i} className="flex h-[46px] items-center gap-2.5 rounded-[8px] px-2">
              <Skeleton className="w-9 h-9 shrink-0 rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <SkeletonLine w={i === 0 ? 96 : 120} h={10} />
                <SkeletonLine w={i === 0 ? 140 : 112} h={8} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** `bits.tsx › PanelHeading`'s box (`pt-6`: section spacing is the heading's own top padding), with a bar. */
function HeadingGhost({ w }: { w: number }) {
  return (
    <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-6">
      <SkeletonLine w={w} h={11} />
    </div>
  );
}
