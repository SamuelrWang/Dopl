/**
 * WHAT TO DO ABOUT THE REPLY — the ONE place that decides whether this tool
 * promises a wake, for every op that says anything about waiting.
 *
 * WHY IT EXISTS. `post`, `create_thread` and both `await` branches each ended
 * with the same unconditional sentence — "that call can keep running after your
 * turn ends, and its result will wake you when the reply lands" — said to every
 * caller. It is true of one kind of caller and it was told to all of them.
 * Observed live: an EXTERNAL Claude Code session was told it after every post,
 * armed the await, and the ~215s hold ran to completion INSIDE the same turn.
 * A pending call is what keeps a turn ALIVE; it cannot end one. Backgrounding a
 * still-pending call is a CLIENT behaviour (§8, WAKE-V1 — some Claude Code
 * clients background a call pending past ~2 minutes and deliver its result as a
 * task notification, which wakes an idle session), and this server cannot see
 * whether the caller's client does it. So it must not claim it does.
 *
 * WHAT IT CAN SEE is `CallerIdentity.runtime`, and only as an OBSERVATION —
 * `identity.ts` owns that discipline and it is copied here rather than eroded:
 * `desktop-session` means the request CARRIED the Dopl desktop's stamp;
 * absence is `unstamped`, which is usually an external client but is also how a
 * desktop spawn on an older build looks. Never "external". So:
 *
 *   - stamped   → a session this product spawned, which is fed the
 *                 counterparty's replies as new turns (§8 v1.9). Awaiting is
 *                 the wrong primitive there, so the wake promise is not
 *                 softened, it is DROPPED, and the caller is told not to arm.
 *   - unstamped → nothing is promised. The hold is described as what it
 *                 provably is — a synchronous wait that returns in this turn —
 *                 plus the CONDITIONAL wake, stated as a property of the
 *                 client rather than of this call.
 *
 * WHAT THIS MODULE DOES NOT OWN: the stop conditions. "Re-arm" with no exit is
 * an unbounded loop over an abandoned exchange, and that rule is the caller's
 * own text (`rearmStopRule` and its siblings) — it rides in beside these lines
 * unchanged, and is dropped only where we are no longer telling anyone to
 * re-arm at all.
 */
/**
 * Did the request carry the desktop's runtime stamp? An observation, and the
 * only thing that branches the text below. Nothing here gates access — the
 * header grants nothing (`src/shared/auth/runtime-header.ts`).
 */
export declare function isDesktopRuntime(runtime: string | null | undefined): boolean;
/** After a successful `post`: how to be there when the answer lands. */
export declare function postReplyLines(channelId: string, seq: number, runtime: string | null, stopRule: string): string[];
/**
 * After `create_thread`: the same decision, with the addressee named — the
 * requester's own session is the one that has to come back for the answer.
 * `cursor` is the pre-built await call (the opening seq rides back on the
 * create, so there is no follow-up read); `who` is the already-neutralized
 * member label.
 */
export declare function createThreadReplyLines(cursor: string, who: string, runtime: string | null, stopRule: string): string[];
/** `await` came back empty: re-arm, or stop, depending on who is asking. */
export declare function awaitTimedOutLines(ref: string, since: number, runtime: string | null, stopRule: string): string[];
/** `await` returned messages: advance the cursor, then re-arm — or don't. */
export declare function awaitArrivedLines(ref: string, lastSeq: number, runtime: string | null, stopRule: string): string[];
