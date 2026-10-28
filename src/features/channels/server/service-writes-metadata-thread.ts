import "server-only";
import { parseLegacyThreadSeq } from "../lib/legacy-thread-id";
import type { ChannelThreadRow } from "./dto";
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
 * WHOLE first-class write gate. Synchronous: the pair is the rule.
 */
export function isThreadParticipant(
  thread: ChannelThreadRow,
  userId: string
): boolean {
  return thread.created_by === userId || thread.target_user_id === userId;
}

/**
 * Whether `userId` is one of the two participants of a LEGACY
 * `thread-{channelId}-{seq}` exchange. A legacy session has no `channel_threads`
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
  threadId: string,
  userId: string
): Promise<boolean> {
  const seq = parseLegacyThreadSeq(threadId, channelId);
  // `parseLegacyThreadSeq` already pins the prefix to this channel and the tail
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
 * ⚠ `isThreadClosed` USED TO LIVE HERE (F6) — the one read of
 * `channel_threads.status` on the write path, which raised the `threadClosed`
 * notice on a post into a settled thread. DELETED with thread closing (wiring
 * plan Phase 4, 2026-08-18): nothing closes a thread, so the only rows it could
 * ever fire on are legacy ones, and the COLUMN is now legacy and unread
 * (INVARIANTS §5).
 *
 * The product call it embodied is worth keeping: **the post LANDED, so warn,
 * never refuse** — a 403 over a state the caller cannot change tells an agent to
 * do something it has no op for. If a thread-state warning ever returns, that is
 * still the shape.
 */
