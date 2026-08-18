/**
 * WHAT TO DO ABOUT THE REPLY — ⚠ the ONE place that decides whether this tool
 * promises a wake, for every op that says anything about waiting.
 *
 * ⚠ NEVER promise unconditionally that "the call keeps running after your turn
 * ends and wakes you". A pending call KEEPS a turn alive; it cannot end one.
 * Backgrounding a still-pending call is a CLIENT behaviour (some Claude Code
 * clients background past ~2 min and deliver the result as a task notification)
 * and this server cannot see whether the caller's client does it.
 *
 * ⚠ All it can see is `CallerIdentity.runtime`, and only as an OBSERVATION
 * (`identity.ts` owns that discipline): `desktop-session` means the request
 * CARRIED the stamp; absence is `unstamped`, usually an external client but
 * also how a desktop spawn on an older build looks. Never "external".
 *   - stamped   → a session this product spawned, fed replies as new turns.
 *                 Awaiting is the wrong primitive, so the wake promise is
 *                 DROPPED and the caller is told not to arm.
 *   - unstamped → nothing promised. The hold is described as what it provably
 *                 is — a synchronous wait returning in this turn — plus the
 *                 CONDITIONAL wake, stated as a client property.
 *
 * ⚠ Stop conditions are NOT owned here: "re-arm" with no exit is an unbounded
 * loop over an abandoned exchange, and that rule is the caller's own text
 * (`rearmStopRule` and siblings), dropped only where nobody is told to re-arm.
 */
/** After a successful `post`: how to be there when the answer lands. */
export declare function postReplyLines(channelId: string, seq: number, runtime: string | null, stopRule: string): string[];
/**
 * After `create_thread`: same decision with the addressee named. `cursor` is
 * the pre-built await call (the opening seq rides back on the create, so no
 * follow-up read); `who` is the ALREADY-neutralized member label.
 */
export declare function createThreadReplyLines(cursor: string, who: string, runtime: string | null, stopRule: string): string[];
/** `await` came back empty: re-arm, or stop, depending on who is asking. */
export declare function awaitTimedOutLines(ref: string, since: number, runtime: string | null, stopRule: string): string[];
/** `await` returned messages: advance the cursor, then re-arm — or don't. */
export declare function awaitArrivedLines(ref: string, lastSeq: number, runtime: string | null, stopRule: string): string[];
