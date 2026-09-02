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
/**
 * `await` CAME BACK EMPTY — ⚠ ONE LINE, cursor-first (T03).
 *
 * ⚠ **THE TIMEOUT IS THE HOTTEST RESULT ON THIS SURFACE AND CARRIES THE LEAST
 * NEWS.** An external orchestrator polling a quiet exchange reads this text
 * every ~45s and it is the same text every time, so the ~1.4k of re-arm
 * doctrine it used to carry ({@link HOLD_FACT} plus the full stop rule) was
 * paid per empty hold, forever, to say "nothing happened". The one thing the
 * caller actually needs back is the CURSOR — stated as a bare `cursor=<seq>`
 * token as well as inside the call, so it can be lifted without parsing prose.
 *
 * ⚠ **NOTHING SEMANTIC WAS DROPPED, ONLY ITS LENGTH.** Every clause INVARIANTS
 * §10 requires of a re-arm instruction is still here: the re-arm call with the
 * SAME cursor, the ~3-empty-holds checkpoint, the addressee-scoped liveness
 * test, the 30-minute exit, and the ABSENCE of a finished state to wait for —
 * an agent trained on a surface that had one waits for it forever. What is gone
 * is the restatement of what a pending call does, which does not change between
 * two consecutive empty holds. The FULL rule is still taught where it is new
 * information: on the hold that RETURNS messages, and on the one that FAILS.
 *
 * ⚠ Desktop branch UNCHANGED — it is already one line, and it says the opposite
 * thing (do not re-arm at all).
 */
export declare function awaitTimedOutLines(ref: string, since: number, runtime: string | null): string[];
/**
 * The same compression for the WORKSPACE hold's timeout. ⚠ A sibling line, not
 * a shared one, for the reason `channel-ops-await-workspace.ts` gives in full:
 * the workspace stop rule is a DIFFERENT rule (any channel's traffic wakes you,
 * so a wake is not news), and collapsing the two would restate the per-channel
 * trap where the worse one applies.
 */
export declare function workspaceAwaitTimedOutLines(since: number, runtime: string | null): string[];
/** `await` returned messages: advance the cursor, then re-arm — or don't. */
export declare function awaitArrivedLines(ref: string, lastSeq: number, runtime: string | null, stopRule: string): string[];
