"use client";

import { useMemo } from "react";
import { PanelRightClose } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ChannelThread } from "../types";

/**
 * The ROOMS SIDEBAR — the channel's threads as a persistent column.
 *
 * A "room" is just a THREAD. It used to be a thread with a PARTICIPANT SET, and
 * this column showed the set's size plus which named AGENTS were seated in it;
 * breakout rooms and named agents are gone (rollback §1) and so are both rows.
 * What is left is the thread list: title, whether it is still open, and
 * navigation.
 *
 * OPEN rooms sit above closed ones (a closed room is history; an open one is
 * where work is), and clicking a row scrolls to that thread's card through the
 * transcript's existing `session:<threadId>` anchor — the same navigation the
 * thread popover uses.
 *
 * ADDITIVE: the header's thread popover still works and is still the only place
 * a room is closed / reopened. Small channels never need a permanent column, so
 * the sidebar is collapsed by default and toggled from the header.
 */
export function RoomsSidebar({
  threads,
  threadsLoading,
  onSelectThread,
  onCollapse,
}: {
  threads: ChannelThread[];
  threadsLoading: boolean;
  onSelectThread: (threadId: string) => void;
  onCollapse: () => void;
}) {
  const rooms = useMemo(() => sortRoomThreads(threads), [threads]);

  return (
    <aside
      aria-label="Rooms"
      className="flex w-[220px] shrink-0 flex-col border-l border-border-default bg-card-surface-subtle"
    >
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Rooms
        </span>
        {rooms.length > 0 && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {rooms.length}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide rooms"
          title="Hide rooms"
          className="flex h-6 w-6 items-center justify-center rounded-[7px] text-text-muted transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {rooms.length === 0 ? (
        <p className="px-3 py-4 text-caption text-text-muted">
          {threadsLoading ? "Loading rooms…" : "No rooms yet."}
        </p>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto overscroll-contain">
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              onSelect={() => onSelectThread(room.id)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * Open rooms above closed ones, each group keeping the order it arrived in (the
 * server returns `created_at DESC`, so newest-first survives inside both
 * groups). A stable partition, not a re-sort: nothing else about the order is
 * this component's to decide.
 *
 * It lived in `lib/rooms.ts` beside the participant-set readers; those went with
 * breakout rooms and this was the only survivor, so it came here rather than
 * leaving a one-function module behind.
 */
export function sortRoomThreads(
  threads: readonly ChannelThread[]
): ChannelThread[] {
  const open: ChannelThread[] = [];
  const closed: ChannelThread[] = [];
  for (const thread of threads) {
    (thread.status === "open" ? open : closed).push(thread);
  }
  return [...open, ...closed];
}

/** One room row. Exported so its status rendering can be asserted directly. */
export function RoomRow({
  room,
  onSelect,
}: {
  room: ChannelThread;
  onSelect: () => void;
}) {
  const open = room.status === "open";
  const failed = room.status === "closed" && room.outcome === "failed";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-surface-raised-2"
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            open
              ? "bg-success"
              : failed
                ? "bg-danger"
                : "border border-text-disabled bg-transparent"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-small font-medium text-text-primary">
          {room.title}
        </span>
      </span>
      <span className="flex items-center gap-2 pl-3 text-micro text-text-muted">
        <span className={cn(failed && "text-danger")}>
          {open ? "Open" : failed ? "Failed" : "Closed"}
        </span>
      </span>
    </button>
  );
}
