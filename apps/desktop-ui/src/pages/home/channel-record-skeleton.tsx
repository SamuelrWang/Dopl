import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { COMPOSER_BOTTOM } from "@/features/channels/components/composer-input";
import { channelPaneTabs } from "@/features/channels/components/info-panel";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * THE /home RECORD PANE'S LOADING SHAPE — the pinned channel surface's OWN two
 * columns (Samuel, 2026-09-13, over the pane while a channel loads: *"this is the
 * skeleton for the channel, it doesn't look accurate at all needs to be fixed"*).
 *
 * ⚠ **WHAT IT REPLACED, SO NOBODY REBUILDS IT.** The gate rendered the kit's two
 * GENERIC ghosts — `shared/ui/skeleton.tsx › DetailPaneSkeleton` (a 52px strip
 * with one bar and a 28px square) wrapped around `› TranscriptSkeleton` (four
 * ALTERNATING bordered bubbles, every other one indented `ml-12`). Neither is any
 * part of this surface: the real pane is a 56px breadcrumb header over a
 * left-aligned column of attribution-pill rows, a composer CARD pinned at the
 * bottom, the draggable divider, and the **Info / Threads / Agents / Settings**
 * column at `--info-w` — which is OPEN at mount here
 * (`use-channels-selection.ts` seeds `infoOpen` true), so a ghost that omitted
 * it resolved into a pane that then grew a 380px column under the reader.
 *
 * 🔑 **GEOMETRY BY REFERENCE, NEVER RESTATED (INVARIANTS §1A).** Every box below
 * is the real component's own class expression, byte-for-byte, and the two things
 * that CAN be imported are imported: `composer-input.tsx › COMPOSER_BOTTOM` (the
 * one bottom offset both composers sit at) and `info-panel.tsx ›
 * channelPaneTabs`, which is what makes the tab row's slot count the REAL row's —
 * /home passes no `knowledge` capability (F-340) and opens in channel view, so it
 * is four, and a fifth tab would move this ghost with it rather than leaving it
 * behind. The rest is pinned in `channel-record-skeleton.test.tsx`, bidirectionally.
 *
 * ⚠ **THE DIVIDERS ARE THE FRAME'S, NOT THIS FILE'S.** The info column's
 * `border-l border-border-default` and the header's `border-b` are the SAME
 * utility classes the real surface wears, so `pages/home/home.module.css ›
 * .frame` repaints them to the account palette (and widens the `border-l` to 2px)
 * for the ghost exactly as it does for the loaded pane. That is the whole reason
 * the class names are copied rather than "simplified".
 *
 * ⚠ **EVERY ROW IS LEFT-ALIGNED (Samuel, same review).** The real transcript puts
 * the viewer's own rows on the right (`authored-row.tsx`, off
 * `authorUserId === currentUserId`), but which rows those are is unknowable before
 * the read — and a ghost that guesses wrong moves the text the reader is already
 * aiming at. One side, and the side every channel has.
 *
 * 🚫 NO TEXT, NOTHING PRESSABLE — the `sr-only` label on `SkeletonSurface` is the
 * only string, and there is no `<button>`/`<a>` anywhere.
 */

/**
 * How many message groups stand in for the transcript. Four: enough that the
 * column reads as a conversation, few enough that none is cut off at the fold.
 */
const MESSAGE_GHOSTS = [
  { name: 96, lines: ["92%", "64%"] },
  { name: 124, lines: ["78%"] },
  { name: 88, lines: ["88%", "72%", "46%"] },
  { name: 110, lines: ["70%"] },
] as const;

/** The four tab labels' widths, in row order — Info, Threads, Agents, Settings. */
const TAB_WIDTHS = [26, 48, 44, 48] as const;

/** Rows the Info tab's card stands in for (`bits.tsx › MetaRow`, `h-9` each). */
const CARD_ROWS = 4;

export function ChannelRecordSkeleton({
  label = "Loading channel",
}: {
  label?: string;
}) {
  return (
    // ⚠ THE SURFACE ROOT'S OWN ROW (`channel-surface-standalone.tsx`) — no
    // `min-w-0`, deliberately, so the info ghost keeps its width when the window
    // narrows exactly as the real column does.
    <SkeletonSurface label={label} className="relative flex min-h-0 flex-1">
      <TranscriptColumnGhost />
      {/* THE DRAGGABLE DIVIDER — `info-resize-handle.tsx`'s ZERO-WIDTH sibling, so
          this row's box math is the real row's. The pill is the only thing it
          paints. */}
      <div className="relative z-[2] w-0 shrink-0">
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center">
          <Skeleton className="h-10 w-1 shrink-0 rounded-full" />
        </span>
      </div>
      <InfoColumnGhost />
    </SkeletonSurface>
  );
}

/** `message-pane.tsx › section` — header, scroller, composer card. */
function TranscriptColumnGhost() {
  return (
    <div className="flex min-w-0 flex-1 flex-col [contain:inline-size]">
      {/* ⚠ `message-pane-header.tsx`'s PAGE chrome (`gap-1`), not the pop-out
          window's (`gap-1.5`): the hash glyph, the channel name at
          `TEMPLATE_NAME_TEXT`'s size, the 24px bookmark, then the BARE 32px info
          toggle off the spacer. */}
      <div className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
        <SkeletonLine w={148} h={14} />
        <Skeleton className="h-6 w-6 shrink-0 rounded-[7px]" />
        <span className="flex-1" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-[7px]" />
      </div>
      {/* ⚠ THE SCROLLER OWNS THE GUTTER and nothing else may (`message-pane.tsx`:
          `px-8 py-5`). `overflow-hidden` rather than the real `overflow-y-auto` —
          there is nothing to scroll and a ghost must not flash a scrollbar. */}
      <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
        {/* `transcript.tsx`'s row list — 20px between GROUPS. */}
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
 * ONE MESSAGE GROUP — `authored-row.tsx › AuthoredRow` around
 * `attribution-pill.tsx › AttributionPill`.
 *
 * ⚠ THE PILL IS THE HEADER AND THE AVATAR IS INSIDE IT (Samuel, 2026-08-22) —
 * there is no `w-10` avatar GUTTER on this surface and there has not been one
 * since. The capsule is avatar + two stacked lines (name, then time); the message
 * blocks stack BELOW it at the column's width, capped at `MESSAGE_BLOCK`'s 92%.
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
      {/* ⚠ **THE RADIUS LEFT THE SHARED STRING ON 2026-09-15 AND IS NOW STATED
          SEPARATELY, EXACTLY AS THE REAL PILL STATES IT.** `AttributionPill` takes a
          `radius` override for Samuel's flush-corner experiment — an ACCENTED row
          squares the capsule on the bar side — so `rounded-full` moved out of the
          geometry literal into its own slot (`radius ?? "rounded-full"`). This ghost
          is never accented, so it keeps the capsule; it just has to spell it the same
          way, or the byte-share test below cannot match the two. */}
      <span className="bento inline-flex max-w-full items-center gap-2 py-1 pl-1 pr-3.5 rounded-full">
        {/* `avatar.tsx › SIZE.sm` — the size the pill asks for. */}
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

/**
 * THE COMPOSER, PINNED AT THE BOTTOM — a RAISED CARD, not a bare input row, and
 * the card takes no gap of its own (`composer.tsx`).
 *
 * ⚠ THE OFFSET IS IMPORTED (`COMPOSER_BOTTOM`) for the reason that constant
 * exists: the channel and agent composers sit side by side across the divider and
 * any difference reads as one floating higher than the other.
 */
function ComposerGhost() {
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
        <div className="flex flex-col gap-2">
          <SkeletonLine w="52%" h={11} />
          <div className="flex items-center gap-0.5">
            {/* Six 24px glyphs — new thread, mention, shortcuts, emoji, attach,
                mic. The launch bot is bridge-gated and Discard needs a draft, so
                neither is ghosted. */}
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
  );
}

/**
 * THE INFO COLUMN — `info-panel.tsx`'s `aside` at `--info-w` (380px until the
 * operator drags it), its 56px tab row, and the Info face's card rows.
 *
 * ⚠ THE TAB COUNT IS THE REAL ROW'S, ASKED RATHER THAN COUNTED:
 * `channelPaneTabs(false, false)` is channel view with no Knowledge capability,
 * which is exactly what /home mounts (`relationship-record.tsx`).
 * ⚠ THE ROW IS THE `underline` CONTROL'S (`segmented-control.tsx`): text only,
 * `gap-5` between options, each `h-9 px-1`. No pills, and no selected mark — a
 * ghost that underlined one tab would be claiming which face resolves.
 */
function InfoColumnGhost() {
  const tabs = channelPaneTabs(false, false);
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
      {/* The Info face's scroll body, its section heading and its card
          (`info-tab.tsx`, `person-info-tab.tsx`, `bits.tsx › MetaRow`). */}
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

/** Label / value widths down the card — a real one is `label … value`, not two
 *  equal bars. */
const CARD_LABELS = [40, 52, 64, 48] as const;
const CARD_VALUES = [116, 84, 96, 72] as const;
