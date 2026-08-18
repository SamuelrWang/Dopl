/**
 * THE SELF-VERIFICATION LINE FOR A POST — did this land as a continuation of an
 * existing thread, or as a NEW request on the other side? ⚠ `channel-` filename
 * prefix required by the parity split-scan (parity.test.ts).
 *
 * ⚠ PEER-CONTROLLED TEXT HERE: thread TITLES. `mine` is "threads I created OR am
 * the target of", and one I am merely the target of was opened AND TITLED by the
 * peer — so an unthreaded post pulls up to five peer-typed titles into the
 * confirmation of my own write. Neutralized, and framed by
 * `UNTRUSTED_THREAD_HEADER` on the one branch that renders them.
 */
import type { ChannelMessage, DoplClient } from "@dopl/client";
/**
 * ⚠ `closedThreadNote()` USED TO LIVE HERE — the line a post spent
 * `threadClosed` on. It went with thread closing (wiring plan Phase 4,
 * 2026-08-18) and so did the server field behind it.
 *
 * Two rules it carried are worth not relearning. **WARNING, NOT A FAILURE**: the
 * post LANDED, and wording that reads as an error gets an agent to retry a
 * write that already succeeded. **Never claim a silence nothing enforces**: its
 * copy was scoped to the passive lane alone, because an updated desktop skipped
 * the passive wake off a status cache up to ~5 min stale while an older build
 * still woke, and an ADDRESSED post delivered either way.
 */
/**
 * ⚠ Answer is read back off the STORED message, not off the request:
 * `metadata.taskId` is what the receiving desktop routes on, so this reports
 * what actually LANDED rather than what was asked for.
 *
 * ⚠ The id alone is NOT proof of a real thread. A first-class id validates
 * against `channel_tasks`; a legacy `task-<uuid>-<seq>` id names no row and
 * survives the write only as the caller's OWN exchange in THIS channel.
 * `taskTitle` is the unfakeable half — server-stamped from the thread row,
 * caller copies stripped. A note that names a title is backed by a real row; a
 * bare id is the tell that it is not.
 *
 * Three shapes, descending urgency:
 *   1. asked for a thread and got none — the tag-drop signature;
 *   2. no thread but the caller has some — reads as a NEW request;
 *   3. threaded — name it so the sender can check.
 * No threads + unthreaded post says nothing; threads belonging only to OTHER
 * pairs says so without offering them.
 */
export declare function threadLinkageNote(client: DoplClient, channelId: string, 
/** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
safeChannelName: string, message: ChannelMessage, askedThread: string | undefined): Promise<string | null>;
