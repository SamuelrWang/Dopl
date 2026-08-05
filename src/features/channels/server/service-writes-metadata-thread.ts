import "server-only";
import { parseLegacyTaskSeq } from "../lib/group-thread";
import type { ChannelTaskRow } from "./dto";
import * as repoMessages from "./repository-messages";

/**
 * MAY THIS POST WRITE INTO THIS THREAD — the participation gate, both id
 * shapes, plus the CLOSED-status read the post path now does.
 *
 * Split out of `service-writes-metadata.ts` at the §2 500-line cap (F2 + F6
 * pushed it over). The seam is a real reason-to-change and not arithmetic: that
 * file answers "what may a caller put in metadata, and what does the server
 * stamp itself", while this one answers the one question the fold delegates —
 * whether a thread tag BELONGS to the poster, and what the thread's own row says
 * about accepting the post. It is imported by exactly one module and imports
 * nothing back; the test file `service-writes-metadata-thread.test.ts` (which
 * predates the split and drives through `postMessage`) already carried the name.
 */

/**
 * The two people a first-class thread belongs to (creator + addressee), and the
 * WHOLE first-class write gate.
 *
 * It was briefly wrapped by an async `mayWriteThread` that consulted
 * `channel_task_participants`: a thread with rows in that table was a BREAKOUT
 * ROOM whose SET decided who may post, with the original pair staying valid.
 * Breakout rooms are gone (rollback §1) — no route seeds a set, no op joins one
 * — so consulting the table would be a query per threaded post against rows
 * nothing can add to. The pair is the rule again, and it is synchronous.
 *
 * Rows written before the rollback are LEFT IN PLACE and simply stop being
 * consulted; a later cleanup migration may drop the table.
 */
export function isThreadParticipant(
  task: ChannelTaskRow,
  userId: string
): boolean {
  return task.created_by === userId || task.target_user_id === userId;
}

/**
 * Whether `userId` is one of the two participants of a LEGACY
 * `task-{channelId}-{seq}` exchange. A legacy session has no `channel_tasks`
 * row, so the only server-side record of who it belongs to is its opening
 * request: the message at that seq, whose author is the requester and whose
 * `metadata.to_user_id` is the responder — exactly the pair `groupThread`
 * joins on.
 *
 * This is the ONE legacy resolver: the thread-write gate and the calm-flag
 * stamp both go through it (the flags ride on whether the TAG survived, so
 * there is exactly one lookup per post, not one per concern). Fails CLOSED at
 * every step — an id that does not name THIS channel, a seq that is not a
 * positive integer, a missing opener, or an unaddressed opener whose author is
 * someone else, all answer "not a participant".
 */
export async function isLegacyThreadParticipant(
  channelId: string,
  taskId: string,
  userId: string
): Promise<boolean> {
  const seq = parseLegacyTaskSeq(taskId, channelId);
  // `parseLegacyTaskSeq` already pins the prefix to this channel and the tail
  // to digits; seqs start at 1, and a digit run long enough to lose precision
  // is not a seq either.
  if (seq === null || seq < 1 || !Number.isSafeInteger(seq)) return false;
  const opener = await repoMessages.findMessageBySeq(channelId, seq);
  if (!opener) return false;
  if (opener.author_user_id === userId) return true;
  const meta = (opener.metadata ?? {}) as Record<string, unknown>;
  return meta.to_user_id === userId;
}

/**
 * F6 — IS THIS THREAD CLOSED? The post path resolved the thread row and then
 * read only its participation columns, so a thread closed at #355 accepted five
 * more posts with no refusal and no notice. `status` / `closed_at` were written
 * on close (`service-tasks.ts`) and cleared on reopen, and read NOWHERE on the
 * write path.
 *
 * WARN, DO NOT REFUSE, and that is a decided product call rather than a first
 * cut. A hard 403 would break the legitimate "one last word after the close
 * echo" pattern — an agent that closes a thread and then answers a question
 * about it is behaving correctly — and the remedy a refusal would point at
 * (`reopen`) has no MCP counterpart at all, so the agent would be told to do
 * something it cannot do. So the post LANDS, and the caller is told what it
 * landed in; `postMessage` carries the flag out and the MCP `post` result says
 * it in words.
 *
 * `!== "open"` rather than `=== "closed"`: a status this predicate does not
 * recognize is not evidence the thread is accepting work, and warning on it
 * costs one line while missing it costs the silence this fix exists to end.
 *
 * A LEGACY id has no `channel_tasks` row and therefore no status — it can never
 * be "closed" in this sense, which is one more reason it is not a thread.
 */
export function isThreadClosed(task: ChannelTaskRow | null): boolean {
  return task !== null && task.status !== "open";
}
