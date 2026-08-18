"use client";

import { useMemo } from "react";
import { ArrowRight, Check, ListTodo } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelThread,
  ThreadMode,
} from "../types";
import { isThreadParty, ReadOnlyThreadBadge } from "./thread-party";

/** The three rendered thread states, mirroring `channel-transcript.tsx threadOverlayFrom`. */
type ThreadDisplayStatus = "active" | "done" | "failed";

const STATUS_LABEL: Record<ThreadDisplayStatus, string> = {
  active: "Thread active",
  done: "Thread complete",
  failed: "Thread failed",
};

/**
 * Active, unless this is a LEGACY row closed before thread closing was removed
 * (wiring plan Phase 4, 2026-08-18). ⚠ `status` / `outcome` are legacy and no
 * longer written (INVARIANTS §5); this is the one surviving READ of them, and it
 * is here so an old transcript still explains itself rather than showing every
 * settled exchange as live. Nothing branches on it — the row renders the same
 * either way and there are no controls behind it.
 */
function displayStatus(thread: ChannelThread): ThreadDisplayStatus {
  if (thread.status === "open") return "active";
  return thread.outcome === "failed" ? "failed" : "done";
}

interface Props {
  /** ⚠ Newest-first from the server (`created_at DESC`) — do not re-sort. */
  threads: ChannelThread[];
  /** True while the first threads read is still resolving. */
  threadsLoading: boolean;
  /** Channel roster, for resolving creator / target avatars. */
  members: ChannelMember[];
  /** userId -> display name, for the creator / target labels. */
  memberNames: Map<string, string>;
  /** Latest `task_progress` per thread id, derived from loaded messages, shown
   *  as a one-liner under the title. Absent map / entry renders nothing. */
  latestMilestone?: Map<string, ChannelMessage>;
  /** Navigate to the thread's grouped card (scroll + transient highlight). */
  onSelectThread: (threadId: string) => void;
  /** ⚠ Decides the read-only marker on a thread the viewer is not a party to.
   *  Absent means "unknown viewer", which claims nothing. */
  currentUserId?: string;
}

/**
 * The channel's thread list, shown in a header popover. Each row carries the
 * title, status chip, mode badge, the pair as small avatars, and created (plus
 * closed) time. Clicking scrolls the grouped card into view and rings it.
 *
 * ⚠ A channel holds MANY threads, and from three members up they run between
 * DIFFERENT pairs, so every row states WHOSE exchange it is: the viewer reads as
 * "You" wherever they appear, a thread with no addressee says so rather than
 * rendering a lone creator, and a non-party thread carries a read-only marker.
 * Reads are channel-transparent by design, but the server refuses that member's
 * writes ({@link isThreadParty}).
 *
 * ⚠ THE PER-ROW CLOSE / REOPEN STRIP (`ThreadRowActions`) WAS DELETED HERE with
 * thread closing (wiring plan Phase 4, 2026-08-18) — with it the `onCloseThread`
 * / `onReopenThread` props and the summary well. Threads do not close; the
 * operator pauses or ends an AGENT.
 */
export function ThreadPanel({
  threads,
  threadsLoading,
  members,
  memberNames,
  latestMilestone,
  onSelectThread,
  currentUserId,
}: Props) {
  const memberById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members]
  );

  const personFor = (userId: string): AvatarPerson => {
    const member = memberById.get(userId);
    return {
      userId,
      email: member?.email ?? null,
      displayName: member?.displayName ?? memberNames.get(userId) ?? null,
      avatarUrl: member?.avatarUrl ?? null,
    };
  };
  // The viewer reads as "You" wherever they appear in a pair — the fastest way
  // to tell which rows are yours, and the only place the panel speaks about
  // a specific person, so it never says "the peer" or "them".
  const nameFor = (userId: string) => {
    if (userId === currentUserId) return "You";
    return (
      memberById.get(userId)?.displayName ?? memberNames.get(userId) ?? "teammate"
    );
  };

  return (
    <div className="flex max-h-96 flex-col">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-1">
        <ListTodo size={13} className="shrink-0 text-text-secondary" />
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Threads
        </span>
        {threads.length > 0 && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {threads.length}
          </span>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="px-3 py-6">
          {threadsLoading ? (
            <p className="text-center text-caption text-text-muted">
              Loading threads…
            </p>
          ) : (
            <EmptyState icon={ListTodo} title="No threads yet." />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto overscroll-contain border-t border-border-subtle">
          {threads.map((thread) => {
            const status = displayStatus(thread);
            const milestone = latestMilestone?.get(thread.id);
            // The thread's two parties are its creator and its addressee — the
            // same pair the server's write gate enforces. A viewer outside that
            // pair may read this row (reads are channel-transparent) and may not
            // post into it. ⚠ "Not a party" is only sayable when we know who is
            // looking; an absent `currentUserId` means unknown, and claims
            // nothing.
            const showReadOnly =
              !!currentUserId && !isThreadParty(thread, currentUserId);
            return (
              <div key={thread.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => onSelectThread(thread.id)}
                  className="flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface-raised-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-small font-medium text-text-primary">
                      {thread.title}
                    </span>
                    <StatusChip status={status} />
                  </div>

                  {milestone && (
                    <div className="flex items-center gap-1 text-micro text-text-muted">
                      <Check size={11} className="shrink-0 text-success" />
                      <span className="min-w-0 truncate">{milestone.body}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-text-muted">
                    <ModeBadge mode={thread.mode} />
                    <span className="flex items-center gap-1">
                      <Avatar person={personFor(thread.createdBy)} size="xs" />
                      <span className="truncate">
                        {nameFor(thread.createdBy)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowRight size={11} className="shrink-0" />
                      {thread.targetUserId ? (
                        <>
                          <Avatar
                            person={personFor(thread.targetUserId)}
                            size="xs"
                          />
                          <span className="truncate">
                            {nameFor(thread.targetUserId)}
                          </span>
                        </>
                      ) : (
                        // A thread always opens addressed; the addressee goes
                        // null only when that account is deleted (the column is
                        // ON DELETE SET NULL). Say so rather than render a lone
                        // creator, which reads as a solo note.
                        <span className="truncate">no addressee</span>
                      )}
                    </span>
                    {showReadOnly && <ReadOnlyThreadBadge />}
                  </div>

                  <span className="text-micro text-text-muted">
                    {formatChannelTimestamp(thread.createdAt)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The thread's mode as a quiet pill (mirrors the session-card badge). */
function ModeBadge({ mode }: { mode: ThreadMode }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
      {mode === "interactive" ? "Interactive" : "Autonomous"}
    </span>
  );
}

/** Compact status chip: danger ink for a failure, success for active/complete. */
function StatusChip({ status }: { status: ThreadDisplayStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium",
        status === "failed"
          ? "text-danger"
          : status === "active"
            ? "text-success"
            : "text-text-secondary"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "failed" ? "bg-danger" : "bg-success"
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
