/**
 * `dopl_channel` THREAD op handlers: create_thread / close_thread /
 * set_thread_mode. Split out of `channel-ops-write.ts` at the §2 500-line cap
 * when the Q1 neutralization swept the write side; that file already carried the
 * `─── Threads ───` divider these three sat under, so the seam was drawn where
 * the module had drawn it itself. The `channel-` filename prefix is required by
 * the parity split-scan (parity.test.ts).
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`.
 *
 * WHAT IS PEER-CONTROLLED HERE, since every string below is server NARRATION —
 * outside any untrusted-content framing, read by the model as the tool speaking:
 *
 *   - `ch.name` — typed by whoever created the channel, and `resolveChannelOr`
 *     resolves PUBLIC channels the caller was never invited to. `schema.ts`
 *     bounds it at 120 characters with NO charset rule, so it can carry
 *     newlines. Neutralized at every site.
 *   - `thread.title` — typed by whichever member OPENED the thread, up to 200
 *     characters with interior newlines allowed. In `opCloseThread` that member
 *     is frequently NOT the caller: closing is permitted to the thread's TARGET,
 *     so my agent closing a peer's thread renders the peer's title. This is
 *     Q1-B/C arriving on the write side, and it is why close_thread carries a
 *     header as well as a code span.
 *   - `member.label` — already render-safe when it gets here; `resolveMemberOr`
 *     neutralizes it at the source (see `memberLabel` in channel-shared.ts).
 */
import type { DoplClient, ThreadMode, ThreadOutcome } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opCreateThread(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: ThreadMode, clientMsgId?: string, runtime?: string | null, handoff?: boolean): Promise<ToolResponse>;
/**
 * DECISION 2 (Samuel, 2026-08-04) — `close_thread` IS NOT AN AGENT'S OP.
 *
 * THE INCIDENT'S OTHER HALF. Closing settles the SHARED thread for BOTH members,
 * and nothing linked the responder's "I am finished" to the requester's thread
 * anyway, so threads simply never closed (two are open forever in prod). The fix
 * is not to make the agent close harder: it is that "the work looks done" and "I
 * am finished with this exchange" are DIFFERENT judgments, and only the second
 * one closes anything. The human makes it.
 *
 * ANSWERED, NOT REMOVED. The op stays in the enum so this sentence is what an
 * agent trained on the old surface gets, instead of a zod "invalid enum value"
 * at the moment it most needs telling what to do instead. The gate is the
 * server's (`ThreadCloseIsHumanOnlyError`), not this.
 */
export declare function closeThreadIsHumansToMake(): ToolResponse;
/**
 * PROPOSE a close — the agent's terminal act on a thread, and the only one it
 * has (see {@link closeThreadIsHumansToMake}).
 *
 * It inherits the Q1 narration discipline the close had, for the same reason:
 * proposing is allowed to the thread's CREATOR **or its TARGET**, so the common
 * shape is a peer's thread, a peer's 200-character newline-tolerant TITLE, and
 * this result rendering it as our own narration. So:
 *   1. the title is one inline code span (it can be a value, never structure);
 *   2. the result carries {@link UNTRUSTED_THREAD_HEADER}, FIRST — framing that
 *      trails the content it frames is read after the injected line.
 */
export declare function opProposeClose(client: DoplClient, channelRef: string, threadId: string, outcome: ThreadOutcome, summary?: string): Promise<ToolResponse>;
/**
 * Set a thread's mode. The title renders here too, and it is neutralized on the
 * same rule as everywhere else — but this op gets NO untrusted header, on
 * purpose: the route allows `set_mode` to the thread's CREATOR only, so a
 * successful call means the caller typed the title itself. The span is kept
 * anyway (a tool must not depend on a remote authorization check for a LOCAL
 * rendering property), while the header would be framing a string against its
 * own author.
 */
export declare function opSetThreadMode(client: DoplClient, channelRef: string, threadId: string, mode: ThreadMode): Promise<ToolResponse>;
