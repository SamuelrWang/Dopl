import "server-only";
import type { ChannelThread, ThreadOutcome } from "../types";
import {
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
  ThreadCloseIsHumanOnlyError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import { mapTaskRow } from "./dto";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * THE THREAD'S STATUS TRANSITIONS — close and reopen, the matched pair.
 *
 * Split out of `service-tasks.ts` at the §2 500-line cap when the reopen echo and
 * the already-closed guard landed (C-26 / C-30, 2026-08-08), and the seam is the
 * pair itself rather than arithmetic: `service-tasks.ts` OPENS a thread and tunes
 * it, `service-tasks-propose.ts` ASKS for it to end, and these two are the only
 * writes that move `channel_tasks.status`. They now share a shape — guard the
 * transition atomically, then echo it into the transcript, then degrade honestly
 * if the echo is lost — and that shape is stated once, here.
 *
 * THE SERVER BOUNDARY: wire/storage name `task` == domain name `thread`. This
 * lane sits on the STORAGE side, so it keeps the `task` spelling throughout.
 *
 * ─── WHY EITHER OF THESE ECHOES AT ALL (C-26) ────────────────────────────────
 *
 * `channel_tasks` IS IN NEITHER REALTIME TABLE SET — not `constants.ts`
 * `CHANNEL_TABLES` (the web subscriber), not `main/ui-sync.js` `SYNC_TABLES` (the
 * desktop one). A change to the row therefore reaches nobody's screen by itself.
 * Close survived that only by accident of posting: its `task_finished` /
 * `task_failed` marker rings the `channel_messages` doorbell, every peer surface
 * refetches the threads query behind it, and the chip flips. Reopen posted
 * NOTHING, so the other member's ThreadPanel row, session-card chip and sidebar
 * dot kept reading "closed" until an unrelated message happened to land in that
 * channel, they switched channels, or a focus revalidation fired.
 *
 * **SAMUEL'S DECISION (2026-08-08): give reopen the echo, do NOT add the table to
 * the publication.** The publication had just been trimmed 24 -> 17 tables on cost
 * grounds (`20260807000000`, `20260807100000`), a published table with no
 * subscriber costs WAL decode plus a per-subscription RLS evaluation on every
 * write forever, and `channel_messages` is already subscribed by both clients —
 * so the doorbell that carries this news is already paid for. Do not "fix" this
 * later by publishing `channel_tasks`; the echo is the fix.
 */

/**
 * The ANCHOR a thread's lifecycle echoes are keyed on: the timestamp of the close
 * they are about. Falls back to `updated_at` for the shape that predates
 * `closed_at` being written (nothing in the field should have it, and a key that
 * silently collapses is worse than one derived from a second-best column).
 *
 * WHY A TIMESTAMP OFF THE ROW AND NOT A MESSAGE-ACTIVITY ANCHOR. The sibling
 * `closeProposalClientMsgId` keys on **(thread, outcome, latest non-proposal
 * seq)** because a proposal has no state of its own to point at — it mutates
 * nothing, so the only thing that can tell "a retry" from "a second, genuine
 * proposal" is whether the CONVERSATION moved. A close and a reopen do have state,
 * and it is timestamped: every close stamps exactly one `closed_at`, and a reopen
 * is always about exactly one close. Keying on it is the same principle applied to
 * a lane that has a better anchor available — the key moves when the situation
 * genuinely changes (close -> reopen -> close writes a new `closed_at`, so the
 * second close and the second reopen each get their own key) and does NOT move on
 * a retry.
 *
 * A message-seq anchor would actively fail here, and the failure is instructive:
 * the echo is itself the newest message in the thread the moment it lands, so a
 * retried close or reopen would read a MOVED anchor, compute a different key, and
 * post the second echo the key exists to prevent. Every candidate anchor would
 * have needed the echoes excluded from it, which is `latestThreadActivitySeq`'s
 * `closeProposed` carve-out grown a third arm. The row already knows.
 */
function closeAnchor(task: ChannelTaskRow): string {
  return task.closed_at ?? task.updated_at;
}

/**
 * The close echo's idempotency key — **(thread, the close's own `closed_at`)**.
 *
 * C-30, 2026-08-08. The close echo used to carry NO `client_msg_id` at all, which
 * is the mechanism the audit named for "both parties close, two echoes land in one
 * transcript". The guard in {@link closeTask} is what makes that rare; this is
 * what makes it impossible, and the two are deliberately belt AND braces — the
 * guard settles the ROW, the key settles the TRANSCRIPT, and a transcript with two
 * contradictory endings in it is its own kind of wrong even when the row is right.
 *
 * **THE OUTCOME IS NOT IN THE KEY, and that is the whole point of it.** The
 * situation being deduplicated is precisely the one where the two callers DISAGREE
 * — A closing `completed` while B closes `failed`. Keying on the outcome, the way
 * the close PROPOSAL legitimately does, would give the two racers different keys
 * and let both echoes through, which is the bug restated rather than fixed. One
 * close of a thread is one entry in its transcript, whatever the loser wanted it
 * to say.
 */
export function closeEchoClientMsgId(taskId: string, closedAt: string): string {
  return `thread-closed-${taskId}-${closedAt}`;
}

/**
 * The reopen echo's idempotency key — **(thread, the `closed_at` it is undoing)**.
 *
 * A reopen is defined by the close it reverses, so that close's timestamp names it
 * exactly once. Read BEFORE the update, because the update nulls the column: the
 * key has to be computed while the thing it names still exists.
 *
 * What it buys, in the order the failures actually happen:
 *  - a RETRIED reopen (a lost response, a double click) recomputes nothing — the
 *    row is already `open`, so {@link reopenTask} short-circuits before it ever
 *    gets here and writes nothing at all;
 *  - two reopens IN FLIGHT AT ONCE both read the same `closed_at`, so only one wins
 *    the conditional update and the loser looks the winner's echo up by this same
 *    key instead of posting a second one;
 *  - a genuine LATER reopen (close, reopen, work, close, reopen) is a different
 *    close and therefore a different key, so it posts, which is the half a
 *    "one-shot forever" key would have broken — the exact regression C-6 found in
 *    `propose_close`.
 */
export function reopenEchoClientMsgId(
  taskId: string,
  closedAt: string
): string {
  return `thread-reopened-${taskId}-${closedAt}`;
}

/**
 * The reopen echo's body. Deterministic, and it NAMES THE OUTCOME IT UNDID
 * because the reopen destroys that: `outcome` and `outcome_summary` are nulled off
 * the row to keep the `closed ⇔ outcome` CHECK satisfied, so without this line the
 * only record that the thread was ever "completed" is a `task_finished` further up
 * the transcript with nothing tying the two together.
 *
 * The close SUMMARY is deliberately not restated — it is already in the transcript
 * as the close echo's own body, one card entry above, and a generated line that
 * quotes a human's words back at them reads like the human said it twice.
 */
function reopenEchoBody(priorOutcome: ThreadOutcome | null): string {
  return priorOutcome
    ? `Thread reopened (was closed as ${priorOutcome}).`
    : "Thread reopened.";
}

/**
 * What `closeTask` hands back: the closed thread, plus the seq of the lifecycle
 * echo it posted — the mirror of `TaskCreateResult`'s `openingSeq`.
 *
 * WHY THE SEQ RIDES ALONG: a close writes a message into the transcript, so
 * every seq the requester knew is now one short. Live incident: a requester
 * closed a thread, GUESSED the echo's seq, armed `await` one past that guess,
 * and silently skipped the peer's actual deliverable — the reply was already
 * below the cursor, so the hold waited for something that had arrived. The
 * echo's seq is only known here; returning it removes the guess.
 *
 * `null` when no echo landed — the close itself succeeded but the marker post
 * did not (see {@link closeTask}). Never a fabricated number: a caller that
 * gets null must find its cursor another way rather than arm one on a guess,
 * which is the failure this field exists to prevent.
 */
export interface TaskCloseResult {
  thread: ChannelThread;
  echoSeq: number | null;
}

/**
 * What `reopenTask` hands back. Identical in shape to {@link TaskCloseResult} and
 * for the identical reason — a reopen now writes a message too, so it moves the
 * cursor the same way a close does, and a caller that has to guess where the
 * channel ends is the failure `echoSeq` was introduced to remove. It was
 * `ChannelThread` alone while reopen was silent (C-26).
 */
export interface TaskReopenResult {
  thread: ChannelThread;
  echoSeq: number | null;
}

/**
 * Close a task with an outcome. Permitted for the task's creator OR its target
 * (`created_by` / `target_user_id`) — and, since 2026-08-04, only on the HUMAN
 * lane: an agent-token caller is refused and told to propose instead (see
 * {@link ThreadCloseIsHumanOnlyError}). Posts a lifecycle marker so the other
 * member's thread updates live: completed -> `task_finished` (calm "done");
 * failed -> `task_failed` (a close with outcome=failed IS a genuine failure).
 *
 * ─── A SECOND CLOSE IS A NO-OP SUCCESS, NOT AN ERROR (C-30, 2026-08-08) ───────
 *
 * The update used to be unconditional, so BOTH parties could close one thread —
 * A as `completed`, B as `failed` — and the shared, permanent record of how the
 * exchange ended was whoever's write landed second, with two contradictory echoes
 * in the transcript to match. It is now `WHERE status = 'open'`
 * ({@link repoTasks.updateTaskIfStatus}), so the transition itself picks a winner:
 * FIRST CLOSE WINS.
 *
 * **The loser gets a 200 naming the stored outcome, and that is a deliberate
 * choice over a 409.** Four reasons, in descending order of how much they cost:
 *
 *  1. **The retry is DOCUMENTED behaviour on this exact path.** The echo may fail
 *     while the close succeeds, in which case the caller is handed
 *     `echoSeq: null` and has no cursor; retrying to obtain one is the sane
 *     response and this function's own comments have anticipated it since the
 *     `echoSeq` contract landed. An error would punish the caller for following
 *     the contract — and would report a close that DID happen as a failure, which
 *     is the precise thing the `echoSeq: null` degrade exists to avoid.
 *  2. **Two people agreeing that work is finished is not an error condition.**
 *     Close is reachable from the session card and the thread panel, on two
 *     machines, and the second click is nearly always the other party concurring.
 *     The honest report is "it is closed, here is how", not a red toast.
 *  3. **The client would lie about it.** `use-thread-writes.ts` renders any
 *     failure as "Couldn't close the thread" — shown over a thread that is,
 *     visibly, closed.
 *  4. **It is strictly more informative than the bug it replaces.** Last-write-
 *     wins silently discarded the first closer's outcome; this hands the second
 *     closer the outcome that stands, in the same `thread` field they already
 *     render from, so a disagreement surfaces instead of being overwritten.
 *
 * The no-op also returns the STORED echo's seq rather than `null`, looked up by
 * {@link closeEchoClientMsgId} — a retry that lost its response gets its cursor
 * back, which is reason (1) actually delivered rather than merely tolerated.
 */
export async function closeTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: ThreadOutcome,
  summary?: string
): Promise<TaskCloseResult> {
  // FIRST, ahead of every lookup: a refusal about WHO is asking needs nothing
  // else resolved, and refusing before the reads means an agent probing for
  // thread ids learns nothing from the shape of the error either.
  if (ctx.source === "agent") throw new ThreadCloseIsHumanOnlyError();
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("close a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("close this task");
  }

  // A caller-supplied `summary` (a one-line outcome) is persisted on the task
  // row AND becomes the lifecycle echo's body; absent (or blank), the echo
  // keeps its calm default. The kind (task_finished/task_failed) is unchanged.
  const updated = await repoTasks.updateTaskIfStatus(task.id, "open", {
    status: "closed",
    outcome,
    closed_at: new Date().toISOString(),
    // A blank/whitespace summary stores as null, not "" (render guards on null).
    outcome_summary: summary && summary.trim().length > 0 ? summary.trim() : null,
  });

  // Somebody closed it first (or this is our own retry). Nothing was written;
  // report what stands. See the docblock for why this is a 200.
  if (!updated) return alreadyClosed(channel.id, taskId);

  // THE CLOSE HAS ALREADY LANDED by the time the echo is written — the row is
  // closed whether or not the marker posts. Letting the echo's failure throw
  // would report a close that did not happen, and the caller's retry would
  // re-close an already-closed thread; the honest report is "closed, no echo",
  // which `echoSeq: null` says exactly. Every error the close ITSELF can raise
  // (not a member, not creator/target, unknown task) is untouched above.
  let echoSeq: number | null = null;
  try {
    const echo = await postMessage(
      ctx,
      channel.id,
      {
        body:
          (summary && summary.trim()) ||
          (outcome === "completed" ? "Task completed" : "Task failed"),
        kind: outcome === "completed" ? "task_finished" : "task_failed",
        summary: task.title,
        metadata: { taskId: task.id },
        // C-30 — keyed on the close this echo describes. See
        // {@link closeEchoClientMsgId} for why the OUTCOME is not in the key.
        clientMsgId: closeEchoClientMsgId(task.id, closeAnchor(updated)),
      },
      // P0-2 — THE ONE EXEMPTION, and it is stated at the call site rather than
      // inferred from identity. This echo is the SERVER speaking about a close
      // that just landed. It is documentary here rather than load-bearing (the
      // agent lane is refused above, so the guard would let this through anyway)
      // — `PostMessageOptions.internalLifecycle` owns that correction.
      { internalLifecycle: true }
    );
    echoSeq = echo.seq;
  } catch {
    // Marker lost. The thread is closed; the peer's panel catches up on its
    // next tasks refetch instead of on a realtime marker.
  }

  return { thread: mapTaskRow(updated), echoSeq };
}

/**
 * The no-op close: re-read the row that beat us and report IT, plus the seq of
 * the echo that close already posted.
 *
 * The re-read is not paranoia — the row we hold says `open`, which is now known
 * to be stale, and handing a caller a thread object that contradicts the database
 * is worse than the staleness this whole change is about. A re-read that comes
 * back empty means the thread was deleted between the two statements, and 404 is
 * the honest answer to "close this" for a thread that no longer exists.
 */
async function alreadyClosed(
  channelId: string,
  taskId: string
): Promise<TaskCloseResult> {
  const current = await repoTasks.findTaskByChannelAndId(channelId, taskId);
  if (!current) throw new TaskNotFoundError(taskId);
  const stored = await repoMessages.findMessageByClientId(
    channelId,
    closeEchoClientMsgId(taskId, closeAnchor(current))
  );
  return { thread: mapTaskRow(current), echoSeq: stored?.seq ?? null };
}

/**
 * Reopen a closed task. Permitted for the task's creator OR its target
 * (`created_by` / `target_user_id`), mirroring {@link closeTask}'s authorization.
 * Clears the closed state in a single update — `status` back to `open`, and
 * `outcome` / `closed_at` / `outcome_summary` all nulled — which keeps the
 * `closed ⇔ outcome` CHECK satisfied ((status='closed') = (outcome IS NOT NULL)).
 *
 * ─── IT POSTS AN ECHO NOW, AND WHY IT IS A `task_progress` (C-26) ─────────────
 *
 * It used to post NOTHING, on the reasoning that "the web overlay flips the card
 * back to `active` on the next tasks refetch". True for the reopener; false for
 * the other member, who gets no refetch because `channel_tasks` is in no realtime
 * table set (module docblock). So a reopen was invisible to the one person it most
 * concerns — the peer whose card still said the exchange was over.
 *
 * **THE KIND IS `task_progress`, NOT A LIFECYCLE KIND, and every part of that is
 * load-bearing:**
 *  - **No migration.** `channel_messages.kind` carries a CHECK constraint over
 *    `message | task_started | task_progress | task_finished | task_failed |
 *    system`, so a first-class `thread_reopened` kind is a schema change deployed
 *    ahead of every client that writes it — for a render hint. This is the same
 *    trade the five calm flags and the close proposal already made.
 *  - **It cannot be mistaken for an ending.** `groupThread` folds `task_finished`
 *    / `task_failed` into `draft.endEvent` and reads that as the exchange's
 *    outcome. A reopen is the opposite of an outcome, so it must never reach that
 *    slot — and a `task_progress` structurally cannot.
 *  - **`task_started` was rejected for two concrete regressions**, not on taste: it
 *    sets `draft.head`, so the card's header identity and author would become the
 *    reopener rather than whoever opened the thread; and it opens `groupThread`'s
 *    single fallback window, which would let a later untagged agent post fold into
 *    this thread's card. A reopen is not a session starting — nothing ran.
 *  - **Its body RENDERS with no client change.** `splitSessionEntries` routes
 *    `task_progress` into the milestones lane, so a build that knows nothing about
 *    the new marker still shows "Thread reopened (was closed as completed)." A
 *    marker whose fallback rendering is INVISIBLE would be worse than no marker;
 *    `system`, the other candidate, is exactly that (it lands in neither lane).
 *
 * ─── AGENT CALLERS (C-14) ────────────────────────────────────────────────────
 *
 * Reopen is agent-reachable — no `source` check here, and the PATCH route is not
 * `sessionOnly` — and Samuel's decision (2026-08-08) is that this stays as it is.
 * The echo is therefore built to be CORRECT on that lane rather than merely
 * tolerated on it: `task_progress` is not one of `LIFECYCLE_KINDS`, so an
 * agent-triggered reopen posts through the ordinary guard with no exemption, and
 * `postMessage` attributes it `authorKind: "agent"` off the caller's own ctx — the
 * transcript says an agent reopened it, because an agent did.
 *
 * ─── A SECOND REOPEN IS A NO-OP SUCCESS ──────────────────────────────────────
 *
 * Symmetric with {@link closeTask}'s guard and justified the same way, plus one
 * reason of its own: without it a retried reopen would compute its key from a
 * `closed_at` that is now `null`, get a DIFFERENT key, and post the second echo
 * the key exists to prevent. `echoSeq` is `null` on that path — honestly, since
 * the call wrote nothing — because the anchor naming the original echo has been
 * erased from the row by the reopen that already succeeded.
 */
export async function reopenTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<TaskReopenResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("reopen a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("reopen this task");
  }

  // Already open: write nothing, echo nothing, report the thread as it stands.
  if (task.status !== "closed") {
    return { thread: mapTaskRow(task), echoSeq: null };
  }

  // Captured BEFORE the update, because the update erases both: the anchor that
  // names this reopen, and the outcome its body reports.
  const anchor = closeAnchor(task);
  const priorOutcome = (task.outcome as ThreadOutcome | null) ?? null;

  const updated = await repoTasks.updateTaskIfStatus(task.id, "closed", {
    status: "open",
    outcome: null,
    closed_at: null,
    outcome_summary: null,
  });

  // Lost a concurrent reopen. Nothing to write — but we still hold the anchor the
  // winner keyed on, so their echo is findable and the caller gets a real cursor
  // rather than the `null` a bare no-op would hand back.
  if (!updated) {
    const current = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
    if (!current) throw new TaskNotFoundError(taskId);
    const stored = await repoMessages.findMessageByClientId(
      channel.id,
      reopenEchoClientMsgId(taskId, anchor)
    );
    return { thread: mapTaskRow(current), echoSeq: stored?.seq ?? null };
  }

  // THE REOPEN HAS ALREADY LANDED by the time the echo is written — the same
  // contract {@link closeTask} states and for the same reason. The row is open
  // whether or not the marker posts, so an echo failure degrades to
  // `echoSeq: null` and NEVER throws: throwing would report a reopen that did
  // happen as a failure, and the caller's retry would find an open thread and be
  // told nothing at all.
  let echoSeq: number | null = null;
  try {
    const echo = await postMessage(
      ctx,
      channel.id,
      {
        body: reopenEchoBody(priorOutcome),
        kind: "task_progress",
        summary: task.title,
        metadata: { taskId: task.id },
        clientMsgId: reopenEchoClientMsgId(task.id, anchor),
      },
      // The marker key is RESERVED — stripped from any caller's metadata and
      // re-stamped only from here, so nothing on the wire can paint somebody
      // else's settled thread as live again.
      { reopened: true }
    );
    echoSeq = echo.seq;
  } catch {
    // Marker lost. The thread is open; the peer's panel catches up on its next
    // tasks refetch — i.e. exactly the pre-C-26 behaviour, which is the right
    // floor to degrade to.
  }

  return { thread: mapTaskRow(updated), echoSeq };
}
