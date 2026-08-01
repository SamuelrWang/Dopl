"use client";

import { useState } from "react";
import { ListTodo } from "lucide-react";
import { Popover } from "@/shared/ui/popover-menu";
import type { ChannelMember, ChannelMessage, ChannelThread } from "../types";
import { ThreadPanel } from "./thread-panel";

/**
 * The channel header's thread popover trigger. Extracted from `channel-pane`
 * (unchanged behavior) so the pane's file has room for the multiplayer
 * surfaces; the popover REMAINS the thread list's home even now that the rooms
 * sidebar exists — the sidebar is additive, and closing / reopening a thread
 * still happens here.
 */
export function ThreadsButton({
  threads,
  threadsLoading,
  members,
  memberNames,
  latestMilestone,
  currentUserId,
  onSelectThread,
  onCloseThread,
  onReopenThread,
}: {
  threads: ChannelThread[];
  threadsLoading: boolean;
  members: ChannelMember[];
  memberNames: Map<string, string>;
  latestMilestone: Map<string, ChannelMessage>;
  currentUserId: string;
  onSelectThread: (threadId: string) => void;
  onCloseThread: (
    threadId: string,
    outcome: "completed" | "failed",
    summary?: string
  ) => Promise<void>;
  onReopenThread: (threadId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Threads"
        title="Threads"
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        <ListTodo size={16} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-80"
      >
        <ThreadPanel
          threads={threads}
          threadsLoading={threadsLoading}
          members={members}
          memberNames={memberNames}
          latestMilestone={latestMilestone}
          onSelectThread={(threadId) => {
            setOpen(false);
            onSelectThread(threadId);
          }}
          currentUserId={currentUserId}
          onCloseThread={onCloseThread}
          onReopenThread={onReopenThread}
        />
      </Popover>
    </div>
  );
}
