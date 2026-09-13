"use client";

/**
 * Channels v2 — the right panel's THREADS tab: every thread of the open
 * channel, as rectangle cards that drive the center pane.
 *
 * ⚠ NO STATUS FILTER (INVARIANTS §5). Threads never close and never leave the
 * list, so ACTIVITY ORDERING replaced it; `channel_tasks.status` is still stored
 * and this tab reads neither it nor the ordering it once drove.
 *
 * ⚠ THE ORDER IS THE SERVER'S AND IS NEVER RE-SORTED (INVARIANTS §5). The read is
 * bounded at `constants.ts › CHANNEL_THREAD_LIST_LIMIT` and clipped against that
 * order, so a page re-sorted here would be the wrong rows in a plausible one.
 *
 * ⚠ A CLIPPED PAGE SAYS SO (INVARIANTS §9), BESIDE the rows it clipped and never
 * in a footer a skimmer drops — a cap that renders identically to an exhausted
 * list is the bug.
 *
 * 🔒 **THE CARDS SIT IN THE AGENTS TAB'S FOUR GRAY WELLS, BUCKETED BY LAST
 * MESSAGE (Samuel, 2026-09-13, verbatim):** *"for the threads page/tab, I want you
 * to add the same gray backgrounds that we added to the Agents tab. Basically,
 * Recent, last 7 days, etc. This should be measured on activity (basically, last
 * message sent into the thread)."* The wells are `recency-wells.tsx` — the same
 * module the Agents tab reads, so the spans, the geometry, the animation and the
 * "unknown is Recent" direction are one recipe with two readers — and the stamp is
 * {@link threadActivityAt}.
 *
 * ⚠ **THE WELLS ADD NO SORT AND CHANGE NO ROW.** The server's activity order
 * survives inside each well (`recency-wells.tsx › RecencyWells` groups in one
 * forward pass), the card is the `PANEL_CARD` it already was, and the **New
 * thread** button and the clipped note stay ABOVE the wells: neither belongs to a
 * span, and a clip note inside **Recent** would read as a claim about 24 hours.
 */

import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { CARD_BUTTON, PANEL_CARD, TAB_ACTION } from "./bits";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { shortName, threadParties, type AuthorIndex } from "./view-model";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelThread } from "../../types";

/**
 * THIS TAB'S PERSISTED OPEN STATE — per device, and **NOT the Agents tab's
 * `dopl.agents.wells`**: collapsing **Earlier** over agents is not a statement
 * about threads.
 */
export const THREAD_WELLS_STORAGE_KEY = "dopl.threads.wells";

/**
 * WHEN THIS THREAD LAST SAW A MESSAGE — epoch ms, or `null` when this read did not
 * derive it.
 *
 * ⚠ **`lastActivityAt` IS SAMUEL'S "last message sent into the thread", AND
 * `updatedAt` IS NOT.** `types.ts › ChannelThread` carries both: `lastActivityAt`
 * is derived by the `channel_tasks_activity` view as *the newest message tagged
 * for the thread, or its own `createdAt`* — exactly the measurement he named — and
 * it is what the server ORDERS this very list by. `updatedAt`'s only writer is
 * `set_mode` (INVARIANTS §5, 2026-08-18, since close and reopen were removed), so
 * bucketing on it would file a busy thread under **Earlier** and move a silent one
 * into **Recent** the moment somebody flipped its mode. Both fields exist; the
 * wrong one is the one that reads plausible.
 *
 * ⚠ **ABSENT MEANS "NOT DERIVED", NEVER "NO ACTIVITY"** — only the LIST read
 * carries the field (a single-thread load does not), and an undated thread lands in
 * **Recent**, the one well open by default (`recency-wells.tsx › wellFor`), so a
 * read that stops deriving it cannot hide a live thread inside a collapsed well.
 * ⚠ **AN UNPARSEABLE STAMP IS ALSO UNKNOWN**, not old, for the same reason.
 */
export function threadActivityAt(thread: ChannelThread): number | null {
  if (!thread.lastActivityAt) return null;
  const ts = new Date(thread.lastActivityAt).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/**
 * THE web thread-list clip wording. Third surface in the family after
 * `ontology-clipped.ts › clippedNote` and `channel-render-threads.ts ›
 * threadsClippedNote`; its own because the REMEDY differs — this pane has no page
 * argument and no deeper read.
 *
 * ⚠ IT MAY NOT ASSERT IN EITHER DIRECTION. Not "this channel has no such thread"
 * (the clip is not an absence), and not "there is more than one page" — a page AT
 * the ceiling counts as clipped (INVARIANTS §9) precisely BECAUSE the reader
 * cannot tell a full page from an exhausted one. It states only what IS on
 * screen: the count, and that the order is activity.
 */
export const THREADS_CLIPPED_NOTE =
  "Showing the most recently active threads, up to this list's limit. Nothing here was closed or archived; anything not listed is simply below the cut.";

export function ThreadsTab({
  threads,
  truncated,
  loading,
  index,
  openThreadId,
  onOpenThread,
  onNewThread,
}: {
  threads: ChannelThread[];
  truncated: boolean;
  loading: boolean;
  index: AuthorIndex;
  openThreadId: string | null;
  onOpenThread: (id: string) => void;
  /**
   * Opens the composer's NEW-THREAD POPUP — the tab does not host a form of its
   * own (Samuel, 2026-08-24). ⚠ **THE FORM IT REACHES CHANGED ON 2026-09-08**
   * (Samuel: *"i want to make a pop up for the threads creation as well"*): the
   * hop is unchanged — this nonces `use-channels-v2-selection.ts ›
   * requestNewThread`, which the composer passes to
   * `new-thread-dialog.tsx › NewThreadDialog` — but the inline request panel is
   * no longer what opens. ⚠ **AND IT IS THE ONLY FORM SINCE 2026-09-08**: the
   * composer's own `MessageSquarePlus` glyph nonces the SAME dialog, and the
   * panel is deleted. ⚠ Optional, and absent means NO BUTTON: a host that cannot
   * reach the composer must not draw a control that does nothing.
   */
  onNewThread?: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {onNewThread && (
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={onNewThread} className={TAB_ACTION}>
            New thread
          </button>
        </div>
      )}
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
        /* ⚠ ONE `RecencyWells`, NOT A FLAT COLUMN, SINCE 2026-09-13 — and the
           items are built in the SERVER'S ORDER, which the grouping preserves
           inside every well. ⚠ NO `useMemo` HERE: the array is one map over the
           same `threads` identity the hook already memoises, and `RecencyWells`
           memoises the grouping it drives. */
        <RecencyWells
          storageKey={THREAD_WELLS_STORAGE_KEY}
          items={threads.map(
            (thread): RecencyWellItem => ({
              key: thread.id,
              at: threadActivityAt(thread),
              node: (
                <ThreadCard
                  thread={thread}
                  index={index}
                  viewing={thread.id === openThreadId}
                  onOpen={() => onOpenThread(thread.id)}
                />
              ),
            })
          )}
        />
      )}
    </div>
  );
}

/**
 * One thread rectangle.
 *
 * ⚠ NO "Requested" chip and NO muted/inactive face — both were mock statuses,
 * and the model has no closed thread. Every card here opens.
 *
 * The subline is `lastActivityAt` — the newest message tagged for the thread,
 * derived off `channel_messages` and NEVER `channel_tasks.updated_at`, whose only
 * writer is `set_mode` (INVARIANTS §5, 2026-08-18). Absent means this read did
 * not derive it, which `formatRelativeTime` renders as an em dash rather than as
 * "no activity".
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
      <span className="min-w-0 truncate text-body font-semibold text-text-primary">
        {thread.title}
      </span>

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

      {/* ⚠ THE ACTION IS THE LAST ROW, RIGHT-ALIGNED — the same corner the agent
          card puts it in (Samuel, 2026-08-24). It used to sit beside the title,
          where two cards side by side offered their button at two heights. */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          Updated {formatRelativeTime(thread.lastActivityAt)}
        </span>
        <button
          type="button"
          aria-current={viewing ? "true" : undefined}
          onClick={onOpen}
          className={CARD_BUTTON}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}
