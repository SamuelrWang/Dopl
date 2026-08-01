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
 * is validated against `channel_tasks`, but a legacy `task-<uuid>-<seq>` id is
 * still caller-settable with no participation check (F-083). `taskTitle` is the
 * half that cannot be faked: the server stamps it from the thread row and
 * strips any caller copy. So a THREADED note that names a title is backed by a
 * real row, and one that can only show a bare id is the tell that it is not.
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
