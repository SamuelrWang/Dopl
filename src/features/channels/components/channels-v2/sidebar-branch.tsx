"use client";

/**
 * ONE BRANCH OF THE SIDEBAR TREE — a channel row, the threads nested under it,
 * and the disclosure that retracts them.
 *
 * ⚠ ITS OWN FILE since 2026-08-20, on the seam `sidebar-rows.tsx`'s header
 * already names. That file said the column is "a LIST OF SECTIONS and a SET OF
 * ROW FACES", which change for different reasons. A BRANCH turned out to be a
 * third reason: it composes a face with its children and now owns an
 * interaction (the disclosure) and a signal (the ask badge) that belong to
 * neither the section layout nor the row face. It went from eight lines to a
 * hundred in two days, which is what made the third reason visible.
 */

import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ChannelRow, ThreadRow } from "./sidebar-rows";
import type { channelDisplayPeerPerson } from "../../lib/channel-display";
import type { Channel, ChannelThread } from "../../types";

/**
 * One tree row plus the active threads nested under it — with a DISCLOSURE the
 * operator can retract (Samuel, 2026-08-20).
 *
 * ⚠ WHY IT EARNED ONE. The nested rows are the OPEN channel's threads, windowed
 * to "active in the last 24h OR requested" — a window that is bounded but not
 * SMALL: a busy DM puts eight rows under one channel and pushes every other
 * channel below the fold, in the one column that has to stay scannable. The
 * window is the right rule and the crowding is real; a disclosure resolves both
 * without narrowing what the sidebar considers active.
 *
 * ⚠ DEFAULT EXPANDED, AND SESSION-LOCAL. Expanded is what makes the nesting
 * discoverable at all, and a collapse is a glance-management gesture rather than
 * a preference — persisting it would mean an operator who tidied once comes back
 * to a channel whose threads are hidden and no longer remembers why. Same
 * `Set`-of-collapsed-keys idiom as the section headers above, for the same
 * reason: absent = open, so a channel this session has never seen needs no entry.
 *
 * ⚠ THE TOGGLE IS A SIBLING OF THE ROW, NOT A CHILD OF IT. `ChannelRow` is a
 * `<button>`; nesting a second one inside it is invalid HTML and gives a screen
 * reader one target where there are two actions. It is absolutely positioned
 * over space the row reserves (`reserveTrailing`), which is also what stops a
 * long channel name colliding with it.
 *
 * ⚠ IT REPLACES THE UNREAD DOT'S CORNER, and that is the one real cost. A
 * channel with threads open shows the chevron where the dot would sit — but the
 * dot only ever appears on a channel that is NOT selected, and threads only nest
 * under the one that IS, so the two cannot want that corner at the same time.
 */
export function ChannelBranch({
  channel,
  label,
  person,
  selected,
  threads,
  requestedThreads,
  askCount,
  openThreadId,
  collapsed,
  onToggleThreads,
  onSelectChannel,
  onOpenThread,
}: {
  channel: Channel;
  label: string;
  person: ReturnType<typeof channelDisplayPeerPerson>;
  selected: boolean;
  threads: ChannelThread[];
  requestedThreads: ReadonlySet<string>;
  /** Threads here awaiting this viewer's answer. ⚠ It rides the CHANNEL row, so
   *  it survives the collapse below — a retracted branch still says somebody is
   *  waiting, which is the case the signal matters most in. */
  askCount: number;
  openThreadId: string | null;
  /** This channel's threads are retracted. */
  collapsed: boolean;
  onToggleThreads: (channelId: string) => void;
  onSelectChannel: (id: string) => void;
  onOpenThread: (id: string) => void;
}) {
  // No threads, no disclosure: a control that toggles nothing is furniture, and
  // this column is the one that has to stay scannable.
  const canCollapse = threads.length > 0;
  const hidden = canCollapse && collapsed;

  return (
    <>
      <div className="relative">
        <ChannelRow
          label={label}
          person={person}
          selected={selected}
          unread={channel.unread}
          askCount={askCount}
          reserveTrailing={canCollapse}
          onSelect={() => onSelectChannel(channel.id)}
        />
        {canCollapse && (
          <button
            type="button"
            aria-expanded={!hidden}
            aria-label={
              hidden
                ? `Show ${threads.length} threads in ${label}`
                : `Hide threads in ${label}`
            }
            onClick={() => onToggleThreads(channel.id)}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-text-muted transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <ChevronDown
              size={13}
              aria-hidden
              className={cn(
                "transition-transform duration-150 motion-reduce:transition-none",
                hidden && "-rotate-90"
              )}
            />
          </button>
        )}
      </div>
      {!hidden &&
        threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            selected={thread.id === openThreadId}
            requested={requestedThreads.has(thread.id)}
            onOpen={() => onOpenThread(thread.id)}
          />
        ))}
    </>
  );
}

