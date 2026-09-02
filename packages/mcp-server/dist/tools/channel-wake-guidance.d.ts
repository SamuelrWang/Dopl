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
/**
 * WHAT A WRITE RESULT SAYS ABOUT WAITING — ⚠ ONE TOKEN, and it is the only thing
 * on this decision that is a FACT about the call rather than standing doctrine
 * (T10/T12, 2026-09-02).
 *
 * `post` and `create_thread` used to close with three paragraphs each: the hold
 * mechanics, the stop rule, and the skip clause. All three are true of every
 * call and now live once in `channel-doctrine.ts`. What is NOT derivable by the
 * caller is the branch below — whether THIS request carried the desktop's
 * runtime stamp — so that survives:
 *   - `await=skip`        — a desktop-run session, fed the counterparty's
 *                           replies as new turns. Arming is simply wrong here.
 *   - `await=since:<seq>` — everyone else: the cursor to arm from, pre-computed
 *                           off the seq this write just produced, so the next
 *                           call needs no read to find it.
 *   - absent (`-`)        — the write produced no seq to arm from. ⚠ `0` is NOT
 *                           a substitute: awaiting from 0 replays the channel.
 *
 * ⚠ IT STAYS AN OBSERVATION. An UNSTAMPED caller may still BE a desktop session
 * on an older build, which is why the unstamped branch offers a cursor rather
 * than an instruction, and why the doctrine states the wake as the client-side
 * conditional it is.
 */
export declare function awaitFact(runtime: string | null, seq: number | null): string | undefined;
/** `await` came back empty: re-arm, or stop, depending on who is asking. */
export declare function awaitTimedOutLines(ref: string, since: number, runtime: string | null, stopRule: string): string[];
/** `await` returned messages: advance the cursor, then re-arm — or don't. */
export declare function awaitArrivedLines(ref: string, lastSeq: number, runtime: string | null, stopRule: string): string[];
