"use client";

/**
 * Channels — the right panel's THREADS tab: every thread of the open
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

import type { ReactNode } from "react";
import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { CARD_BUTTON, PANEL_CARD, TAB_ACTION, TAB_ACTION_LIGHT } from "./bits";
import { FadeSwap } from "./fade-swap";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { shortName, threadParties, type AuthorIndex } from "./view-model";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelThread } from "../types";

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

/**
 * THE FACE TOGGLE'S TWO LABELS — each one says where the press GOES, never where
 * you are (Samuel, 2026-09-16: *"the tab itself flips to say 'Threads' — acts as a
 * toggle back"*). Exported for the tests, so a label change cannot pass silently.
 */
export const ARTIFACTS_FACE_LABEL = "Artifacts";
export const THREADS_FACE_LABEL = "Threads";

export function ThreadsTab({
  threads,
  truncated,
  loading,
  index,
  openThreadId,
  onOpenThread,
  onNewThread,
  artifactsFace,
  onToggleFace,
  artifacts,
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
   * hop is unchanged — this nonces `use-channels-selection.ts ›
   * requestNewThread`, which the composer passes to
   * `new-thread-dialog.tsx › NewThreadDialog` — but the inline request panel is
   * no longer what opens. ⚠ **AND IT IS THE ONLY FORM SINCE 2026-09-08**: the
   * composer's own `MessageSquarePlus` glyph nonces the SAME dialog, and the
   * panel is deleted. ⚠ Optional, and absent means NO BUTTON: a host that cannot
   * reach the composer must not draw a control that does nothing.
   */
  onNewThread?: () => void;
  /**
   * WHICH FACE IS ON — `true` renders the channel's ARTIFACTS in place of the
   * thread list (Samuel, 2026-09-16).
   *
   * ⚠ **THE STATE IS THE PANEL'S, NOT THIS TAB'S, AND THAT IS THE HEADING'S
   * DOING**: the ruling flips the tab-row heading from "Threads" to "Artifacts"
   * too, and that row lives in `info-panel.tsx`. Owning the flag here would put
   * the label and the body under two owners, which is how they come to disagree.
   * ⚠ ABSENT IS THE THREAD LIST, byte for byte — every host that passes neither
   * this nor {@link onToggleFace} renders what it always did.
   */
  artifactsFace?: boolean;
  /** Flip the face. ⚠ ABSENT MEANS NO TOGGLE AT ALL — the capability is off on
   *  this host, and a control that cannot switch anything must not be drawn. */
  onToggleFace?: () => void;
  /** The artifacts face's own body, built by the panel (`artifacts-tab.tsx`).
   *  ⚠ INJECTED rather than mounted here: it opens READS, and a face nobody has
   *  switched to must not fetch — the Settings/Knowledge slot rule (INVARIANTS §5). */
  artifacts?: ReactNode;
}) {
  /* 🔒 **ONE LINE, TOGGLE LEFT, "New thread" RIGHT** (Samuel, 2026-09-16: the tab
     sits *"on the SAME LINE as the New Thread button, LEFT-aligned"*). The row was
     `justify-end` with one button in it; it is now a real row with a spacer, so the
     create keeps the corner every tab's action lives in and the face control reads
     as a switcher rather than as a second action.
     ⚠ **"New thread" IS ABSENT IN THE ARTIFACTS FACE (Samuel's approval of the
     coder's default, 2026-09-16)** — nothing on that face is creatable FROM here:
     an artifact is folded out of messages in the transcript (`op="artifact"`), so a
     live create button under a list it cannot add to buys a wrong click. It is the
     BUTTON that goes, not the callback: the host keeps passing it, and flipping back
     restores it without re-wiring anything. */
  const showNewThread = onNewThread !== undefined && artifactsFace !== true;
  const toggle = onToggleFace !== undefined && (
    <button
      type="button"
      onClick={onToggleFace}
      // 🔒 **THE WHITE ELEVATED BUTTON, BOLD, BESIDE "New thread"** (Samuel,
      // 2026-09-20: *"can we bold the text that says 'Artifacts'? When I switch
      // over the word for Threads also needs to be bolded … Change it into a
      // white elevated button and move it to the right. Put it directly to the
      // left of the New Thread button"*).
      //
      // ⚠ **IT IS `TAB_ACTION`, THE FACE ITS NEIGHBOUR ALREADY WEARS** — the same
      // constant "New thread" takes one line down (`bits.tsx`), so the pair cannot
      // drift in height, radius or elevation, and a palette change moves both.
      // 🔒 **IT WAS THE GRAY `--seg-fill` PILL UNTIL TODAY** — the /home switcher's
      // fill, chosen 2026-09-16 when this control sat at the LEFT end of the row and
      // read as a switcher. Moved next to the create, that gray read as the disabled
      // twin of the button beside it; the ruling above is what replaces it.
      // ⚠ **THE LABEL IS STILL THE FACE YOU ARE GOING TO**, unchanged: this is one
      // button, not a two-value control, so bolding is a WEIGHT change and never a
      // selected state.
      className={TAB_ACTION_LIGHT}
    >
      {artifactsFace ? THREADS_FACE_LABEL : ARTIFACTS_FACE_LABEL}
    </button>
  );

  if (artifactsFace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* ⚠ THE FACE'S TOP GAP LIVES ON THIS ROW, not on the body below it —
            `ArtifactsTab`'s root carries no `pt` for exactly that reason, or the
            two would stack into a gap twice the thread face's. */}
        {/* ⚠ RIGHT-ALIGNED, matching the thread face's row (2026-09-20). The
            spacer is the whole of it: this face has no create button, so the
            toggle lands exactly where "New thread" sits one face over and the
            control does not jump across the panel when you switch. */}
        <div className="flex items-center px-3.5 pb-3 pt-4">
          <span className="flex-1" />
          {toggle}
        </div>
        {/* **THE FACE SWAP FADES** (Samuel, 2026-09-20: *"when I switch between
            artifact and thread views, the inside panel should not switch so
            choppy. It should be fading out and fading in"*). ⚠ THE KEY IS THE
            FACE, so the body fades when you switch and never when a thread or an
            artifact arrives. ⚠ THE ROW ABOVE IS OUTSIDE IT: the control you just
            pressed must not fade under your cursor. */}
        <FadeSwap viewKey="artifacts" className="flex min-h-0 flex-1 flex-col">
          {artifacts}
        </FadeSwap>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {/* ⚠ **TOGGLE RIGHT, DIRECTLY LEFT OF THE CREATE** (Samuel, 2026-09-20),
          reversing the 2026-09-16 *"toggle LEFT"* placement: wearing the button
          face's white twin they read as one pair of actions in the corner every
          tab's action lives in, where a lone gray pill at the far left read as
          orphaned. The spacer leads now; the two buttons are the row's tail. */}
      {(toggle || showNewThread) && (
        <div className="mb-3 flex items-center gap-2">
          <span className="flex-1" />
          {toggle}
          {showNewThread && (
            <button type="button" onClick={onNewThread} className={TAB_ACTION}>
              New thread
            </button>
          )}
        </div>
      )}
      {/* ⚠ THE SAME FADE, THE OTHER FACE — one `viewKey` vocabulary across the
          pair ("threads" / "artifacts"), so switching either way is one motion.
          The toggle row above stays outside it for the same reason. */}
      <FadeSwap viewKey="threads">
      {truncated && (
        <p className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-secondary">
          {THREADS_CLIPPED_NOTE}
        </p>
      )}
      {loading && threads.length === 0 ? (
        <p role="status" aria-busy="true" className="sr-only">
          Loading threads
        </p>
      ) : (
        /* ⚠ ONE `RecencyWells`, NOT A FLAT COLUMN, SINCE 2026-09-13 — and the
           items are built in the SERVER'S ORDER, which the grouping preserves
           inside every well. ⚠ **NO `useMemo` HERE, AND IT BUYS NOTHING EITHER
           WAY — corrected 2026-09-14.** This comment used to say the grouping
           downstream was memoised for us; it is (`RecencyWells` keys on
           `[items, now]`), but this `map` mints a FRESH ARRAY every render, so
           that memo never hits and the grouping re-runs regardless. Memoising
           here would not change that either: `onOpenThread` is the parent's
           inline closure, so the deps move every render too. It is one pass over
           a CLIPPED list (`constants.ts › CHANNEL_THREAD_LIST_LIMIT`), so none of that
           matters — a memo whose deps always move is a cache that never hits and
           a claim in a comment that is not true.

           🔒 ⚠ **AND IT DRAWS WITH AN EMPTY LIST TOO, SINCE 2026-09-17 (Samuel,
           verbatim):** *"in the Threads and Agents view, i want to have the gray
           boxes kept there even if there's nothing in them. Same as the channel
           picker"* — an empty `threads` used to render the sentence INSTEAD of the
           wells, which is exactly the shape he named. The four boxes are this
           tab's structure; `recency-wells.tsx` carries the `showEmpty` that keeps
           the individually-empty ones. ⚠ **THE SENTENCE IS A SIBLING NOW, NOT A
           BRANCH — /home's channel column's shape exactly** (`relationship-list.tsx`,
           whose "No channels yet" has stood beside its empty wells since
           2026-09-15): four empty wells cannot say WHICH emptiness this is, and
           this is NOT the placeholder copy minimal-copy forbids INSIDE a well.
           ⚠ **THE LOADING BRANCH ABOVE IS UNTOUCHED** — an empty well is a claim
           that this span holds nothing, and a read still in flight has measured
           no such thing (§11: UNKNOWN is not EMPTY). */
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
      {!loading && threads.length === 0 && (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          No threads in this channel yet.
        </p>
      )}
      </FadeSwap>
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
