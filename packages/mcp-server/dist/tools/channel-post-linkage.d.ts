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
 * THE POST LANDED IN A CLOSED THREAD. Spends `threadClosed` off the post response.
 *
 * ⚠ WARNING, NOT A FAILURE — wording must carry that or the agent retries a post
 * that already landed (it IS stored, attributed, and on the thread's card).
 *
 * ⚠ Copy is scoped to the PASSIVE lane only, because that is all any layer
 * enforces: an updated desktop skips the passive thread-lane wake off a status
 * cache lagging up to ~5 min, an older build still wakes, an ADDRESSED post
 * delivers either way, and the server accepts the post regardless of status.
 * Never claim a silence nothing guarantees.
 *
 * ⚠ Reopen is named as a HUMAN action: the route exists
 * (`PATCH /tasks/[id] {op:"reopen"}`) and the web drives it, but this tool has
 * no `reopen` op — "reopen it" sends the agent hunting for an op that does not
 * exist. ⚠ Address a PERSON only; naming an agent-addressing param here teaches
 * an argument the schema refuses with -32602.
 */
export declare function closedThreadNote(channelId: string): string;
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
 *   2. no thread but caller has open ones — reads as a NEW request;
 *   3. threaded — name it so the sender can check.
 * No open threads + unthreaded post says nothing; open threads belonging only to
 * OTHER pairs says so without offering them.
 */
export declare function threadLinkageNote(client: DoplClient, channelId: string, 
/** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
safeChannelName: string, message: ChannelMessage, askedThread: string | undefined): Promise<string | null>;
