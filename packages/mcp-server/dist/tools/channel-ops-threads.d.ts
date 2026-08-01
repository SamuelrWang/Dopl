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
/**
 * S2 — `as_agent` ON `create_thread` IS REFUSED, NOT DROPPED.
 *
 * The flat input schema declares `as_agent` for the whole tool, and the
 * registrar routed it to `post` alone: passing it here did nothing, said
 * nothing, and left the caller believing its opening request was attributed to
 * its agent when the row says the bare human wrote it. Silent divergence
 * between what the surface accepts and what the code does is the exact bug
 * class this round exists to close, so it is answered rather than ignored.
 *
 * REFUSE rather than wire it through, because the attribution is not the only
 * thing that would change. `TaskCreateSchema` carries no `authorAgentId`, so
 * wiring it is server work — and the receiving desktop classifies an
 * agent-authored message addressed to a PERSON with no addressed agent as
 * `agent-escalation`, a notification that deliberately spawns nothing
 * (dopl-desktop-app/main/targeting.js). An agent-attributed opening request
 * would therefore stop starting the responder's side, which is the one thing
 * create_thread exists to do. The refusal costs one retry; wiring it would cost
 * the op its purpose.
 */
export declare function asAgentNotOnCreateThread(): ToolResponse;
export declare function opCreateThread(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: ThreadMode, clientMsgId?: string, runtime?: string | null, 
/**
 * MULTIPLAYER — the EXTRA identities admitted to the thread, in the prefix
 * form `agent:<handle>` / `user:<email>` (see `channel-agent-refs.ts`).
 * Passing any of them is what makes this a BREAKOUT ROOM: the participant
 * set then decides who may post, instead of the creator/target pair. Last
 * positional on purpose — every existing call site keeps its shape.
 */
participants?: string[]): Promise<ToolResponse>;
/**
 * Close a thread — the write op the Q1 completeness review caught still raw.
 *
 * Closing is allowed to the thread's CREATOR **or its TARGET**, so the common
 * shape is: a peer opens a thread, titles it, addresses it to me; my agent does
 * the work and closes it; and the close echo renders the PEER's 200-character,
 * newline-tolerant title as our own narration. That is Q1-B/C's exact defect
 * class on a surface the first pass never enumerated, and it is not a read an
 * agent chose — it is the confirmation of an action it just took.
 *
 * Two changes, both of them the ones the read ops got:
 *   1. the title is one inline code span (it can be a value, never structure);
 *   2. the result carries {@link UNTRUSTED_THREAD_HEADER}, FIRST — framing that
 *      trails the content it frames is read after the injected line.
 */
export declare function opCloseThread(client: DoplClient, channelRef: string, threadId: string, outcome: ThreadOutcome, summary?: string): Promise<ToolResponse>;
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
