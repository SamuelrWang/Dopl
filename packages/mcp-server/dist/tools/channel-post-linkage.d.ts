/**
 * THE SELF-VERIFICATION LINE FOR A POST — did this land as a continuation of an
 * existing thread, or as a NEW request on the other side?
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap when agent
 * addressing landed, along the seam that file had already drawn twice: every
 * other line of a post's result already lives in its own module
 * (`channel-addressing.ts` owns the unaddressed note, `channel-wake-guidance.ts`
 * the wake claims). This is the third, and the largest. The `channel-` filename
 * prefix is required by the parity split-scan (parity.test.ts).
 *
 * PEER-CONTROLLED TEXT HERE: thread TITLES. `mine` is "threads I created OR am
 * the target of", and a thread I am merely the target of was opened AND TITLED
 * by the peer — so an unthreaded post can pull up to five peer-typed titles into
 * the confirmation of my own write, a surface the agent never chose to read.
 * Neutralized, and framed by `UNTRUSTED_THREAD_HEADER` on the one branch that
 * renders them.
 */
import type { ChannelMessage, DoplClient } from "@dopl/client";
/**
 * F6 — THE POST LANDED IN A CLOSED THREAD, and until now nothing said so.
 *
 * The write path gated on thread MEMBERSHIP and never on thread STATUS, so a
 * thread closed at #355 accepted five further posts with no refusal and no
 * notice; the closer believed the exchange was over and the poster believed it
 * was still live. The server now reads the row's status on the post path and
 * hands the fact back (`threadClosed` on the post response); this is the
 * sentence that spends it.
 *
 * IT IS A WARNING, NOT A FAILURE, and the wording has to carry that or the agent
 * will retry a post that already landed. The post IS stored, it IS attributed,
 * and it IS inside the thread's card.
 *
 * WHAT A CLOSE ACTUALLY CHANGES IS THE PASSIVE LANE, and the copy is scoped to
 * exactly that. The first cut here said a closed thread "has stopped ROUTING:
 * nobody's session is being woken by it", which is more than any layer enforces:
 * an updated desktop skips the passive thread-lane wake for a closed thread (off
 * a status cache that lags by up to ~5 minutes), an older build still wakes on
 * it, an explicitly ADDRESSED post delivers either way, and the server accepts
 * the post regardless of status. So the sentence tells the agent the useful,
 * true thing — stop expecting an UNPROMPTED reply in there — instead of claiming
 * a silence nothing guarantees.
 *
 * REOPEN IS NAMED AS A HUMAN ACTION, deliberately. There is no `reopen` op on
 * this tool — the route exists (`PATCH /tasks/[id] {op:"reopen"}`) and the web
 * drives it, and the MCP surface deliberately has no counterpart — so telling an
 * agent to "reopen it" full stop would send it hunting for an op that does not
 * exist. Opening a NEW thread is the action it can actually take.
 */
export declare function closedThreadNote(channelId: string): string;
/**
 * Q7 — the SELF-VERIFICATION line for a post: did this land as a continuation
 * of an existing thread, or as a new request on the other side?
 *
 * Reported by the responder agent during live testing: it had no way to tell,
 * and neither did the requester (await/read rendered bodies only, so confirming
 * a thread tag meant raw SQL). The answer is read back off the STORED message,
 * not off the request: `metadata.taskId` is what the receiving desktop routes
 * on, so it reports what actually landed rather than what was asked for.
 *
 * FIX L3 — the id alone is NOT proof of a real thread. A first-class thread id
 * is validated against `channel_tasks`; a legacy `task-<uuid>-<seq>` id names no
 * row at all, and since F-083 it survives the write only when it is the caller's
 * OWN exchange in THIS channel. `taskTitle` is the half that cannot be faked:
 * the server stamps it from the thread row and strips any caller copy. So a
 * THREADED note that names a title is backed by a real row, and one that can
 * only show a bare id is the tell that it is not.
 *
 * Three shapes, in descending urgency:
 *   1. asked for a thread and got none  — the 1.7.14 tag-drop signature;
 *   2. no thread, but the caller has open ones — will read as a NEW request;
 *   3. threaded — name the thread so the sender can check it is the right one.
 * A channel with no open threads and an unthreaded post says nothing at all;
 * one whose only open threads belong to OTHER pairs says so without offering
 * them (Q13).
 */
export declare function threadLinkageNote(client: DoplClient, channelId: string, 
/** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
safeChannelName: string, message: ChannelMessage, askedThread: string | undefined): Promise<string | null>;
