"use client";

import { useMemo } from "react";
import { PanelRightClose, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ChannelThread } from "../types";
import {
  participantCountLabel,
  readThreadParticipants,
  sortRoomThreads,
} from "../lib/rooms";

/**
 * The ROOMS SIDEBAR — the channel's threads as a persistent column.
 *
 * A breakout room is a THREAD with a participant set, so the room list is the
 * thread list: title, whether it is still open, and how many participants it
 * has once the server serves them. OPEN rooms sit above closed ones (a closed
 * room is history; an open one is where work is), and clicking a row scrolls to
 * that thread's card through the transcript's existing `session:<threadId>`
 * anchor — the same navigation the thread popover uses.
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

function RoomRow({
  room,
  onSelect,
}: {
  room: ChannelThread;
  onSelect: () => void;
}) {
  const open = room.status === "open";
  const failed = room.status === "closed" && room.outcome === "failed";
  const participants = participantCountLabel(readThreadParticipants(room).length);

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
        {participants && (
          <span className="flex items-center gap-1">
            <Users size={10} className="shrink-0" />
            {participants}
          </span>
        )}
      </span>
    </button>
  );
}
