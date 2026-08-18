"use client";

/**
 * Channels v2 — the right panel's THREADS tab: every thread of the open
 * channel, as rectangle cards that drive the center pane.
 *
 * ⚠ NO STATUS FILTER. The mock's Active/Inactive `SegmentedControl` does not
 * survive the port: threads never close and never leave the list, so
 * ACTIVITY ORDERING replaced the filter (MAPPING.md, third round; wiring plan
 * Phase 1). `channel_tasks.status` is still selected and still stored — only the
 * ORDERING stopped depending on it, and this tab reads neither.
 *
 * ⚠ THE ORDER IS THE SERVER'S AND IS NEVER RE-SORTED (INVARIANTS §5). The read
 * is bounded at `constants.ts › CHANNEL_THREAD_LIST_LIMIT` and clipped against
 * that order, so a page re-sorted here would be the wrong rows in a plausible
 * order.
 *
 * ⚠ A CLIPPED PAGE SAYS SO (INVARIANTS §9). A read at its ceiling counts as
 * clipped, and a cap that renders identically to an exhausted list is the bug.
 * The wording lives in this module, once, and is emitted BESIDE the rows it
 * clipped — never in a footer a skimmer drops.
 */

import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { PANEL_CARD } from "./bits";
import { shortName, threadParties, type AuthorIndex } from "./view-model";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelThread } from "../../types";

/**
 * THE web thread-list clip wording. Third surface in the family after
 * `ontology-clipped.ts › clippedNote` and
 * `channel-render-threads.ts › threadsClippedNote`; it is its own because the
 * REMEDY differs — this pane has no page argument and no deeper read, so what
 * it can honestly offer is "these are the most recently active" plus the
 * assurance that nothing left.
 *
 * ⚠ It may NOT let the clip pass as an absence: "this channel has no such
 * thread" is an assertion this read never established.
 */
export const THREADS_CLIPPED_NOTE =
  "Showing the most recently active threads — this channel holds more than one page. Nothing here was closed or archived; older exchanges are simply below the cut.";

export function ThreadsTab({
  threads,
  truncated,
  loading,
  index,
  openThreadId,
  onOpenThread,
}: {
  threads: ChannelThread[];
  truncated: boolean;
  loading: boolean;
  index: AuthorIndex;
  openThreadId: string | null;
  onOpenThread: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {truncated && (
        <p className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-secondary">
          {THREADS_CLIPPED_NOTE}
        </p>
      )}
      {loading && threads.length === 0 ? (
        <p role="status" aria-busy="true" className="sr-only">
          Loading threads
        </p>
      ) : threads.length === 0 ? (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          No threads in this channel yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              index={index}
              viewing={thread.id === openThreadId}
              onOpen={() => onOpenThread(thread.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One thread rectangle.
 *
 * ⚠ NO "Requested" chip and NO muted/inactive face. Both were mock statuses:
 * `requested` is a thread whose consent rows are still pending and nothing
 * projects it (Phase 3+), and `inactive` meant CLOSED, which the model no
 * longer has as a place you cannot walk into. Every card here opens.
 *
 * The subline is `lastActivityAt` — the newest message tagged for the thread,
 * derived off `channel_messages` and NEVER `channel_tasks.updated_at`, whose
 * only writer is `set_mode` since close and reopen were removed (INVARIANTS §5,
 * wiring plan Phase 4, 2026-08-18). Absent means this
 * read did not derive it, which `formatRelativeTime` renders as an em dash
 * rather than as "no activity".
 */
function ThreadCard({
  thread,
  index,
  viewing,
  onOpen,
}: {
  thread: ChannelThread;
  index: AuthorIndex;
  viewing: boolean;
  onOpen: () => void;
}) {
  const parties = threadParties(thread, index);

  return (
    <div className={cn(PANEL_CARD, viewing && "border-border-highlight")}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {thread.title}
        </span>
        <button
          type="button"
          aria-current={viewing ? "true" : undefined}
          onClick={onOpen}
          className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>

      {parties.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 -space-x-1.5">
            {parties.map((p) => (
              <Avatar
                key={p.userId}
                person={p}
                size="xs"
                className="h-[22px] w-[22px] text-micro"
              />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
            {parties.map((p) => shortName(p, index.currentUserId)).join(" · ")}
          </span>
        </div>
      )}

      <span className="text-caption text-text-muted">
        Updated {formatRelativeTime(thread.lastActivityAt)}
      </span>
    </div>
  );
}
