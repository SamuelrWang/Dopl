/**
 * WHAT TO DO ABOUT THE REPLY — ⚠ the ONE place that decides whether this tool
 * promises a wake, for every op that says anything about waiting.
 *
 * ⚠ **IT IS ONE LINE PER RESULT NOW (Samuel's ruling, 2026-09-03: "waiting is a
 * hold, not a poll" — taught ONCE, cheaply).** Every branch below used to close
 * with the mechanics of a pending call, the re-arm instruction and the stop
 * rule: 644 characters on a timed-out hold and 1,599 on one that returned
 * messages, paid PER HOLD, by the one caller who is already holding in a loop.
 * All of it is standing doctrine — true before the call and true after — so it
 * now lives once in `channel-doctrine.ts › waiting`, and what a result carries
 * is {@link waitingLine}: the CURSOR (the one thing only this call can say), the
 * exact re-arm call, and a pointer to the rule. Nothing semantic was deleted;
 * the stop rule, the ~3-empty-holds checkpoint and the addressee-scoped
 * liveness test are all IN that section, in fewer words.
 *
 * ⚠ NEVER promise unconditionally that "the call keeps running after your turn
 * ends and wakes you". A pending call KEEPS a turn alive; it cannot end one.
 * Backgrounding a still-pending call is a CLIENT behaviour (some Claude Code
 * clients background past ~2 min and deliver the result as a task notification)
 * and this server cannot see whether the caller's client does it. That is why
 * the doctrine's WITH-BACKGROUND-TASKS shape is stated as a CONDITIONAL the
 * caller resolves about its own harness, and why no line here asserts it.
 *
 * ⚠ All it can see is `CallerIdentity.runtime`, and only as an OBSERVATION
 * (`identity.ts` owns that discipline): `desktop-session` means the request
 * CARRIED the stamp; absence is `unstamped`, usually an external client but
 * also how a desktop spawn on an older build looks. Never "external".
 *   - stamped   → a session this product spawned, fed replies as new turns.
 *                 Holding is the wrong primitive, so the wake promise is
 *                 DROPPED and the caller is told not to arm.
 *   - unstamped → nothing promised: the cursor, the call, and the pointer.
 */
/**
 * ⚠ **THE WHOLE OF WHAT A READ OR A HOLD SAYS ABOUT WAITING**, and the budget
 * it is held to. Three parts, and each is there because the caller cannot
 * derive it:
 *   1. `cursor=<seq>` as a BARE TOKEN, first — the timeout is the hottest
 *      result on this surface and carries the least news, and the cursor is the
 *      one thing a caller must lift off it. Stated as a token so it can be
 *      lifted without parsing prose.
 *   2. THE EXACT CALL, spliced with this channel's own ref, so re-arming needs
 *      no lookup and no guess about the argument shape.
 *   3. THE POINTER, and nothing more. "Hold, never poll" is the one clause of
 *      the rule short enough to restate; the reason, the two client shapes and
 *      the stop condition are one resource read away.
 *
 * ⚠ **IT MAY NOT GROW BACK.** `channel-hold-budget.test`'s sibling
 * `channel-result-budget.test.ts` measures this against
 * {@link WAITING_LINE_MAX_CHARS} with a representative ref — a ratchet, because
 * this is exactly the string that grew to 1,599 one honest sentence at a time.
 */
export declare function waitingLine(call: string, cursor: number): string;
/**
 * ⚠ The budget for {@link waitingLine} at a representative channel ref. A ref
 * is caller-supplied and unbounded, so this is a cap on what the SERVER writes
 * around it, not a promise about the spliced value — the same distinction
 * `channel-facts.ts` draws between a bounded field and a bounded line.
 */
export declare const WAITING_LINE_MAX_CHARS = 160;
/** The re-arm call for ONE channel. ⚠ One spelling, shared by both results. */
export declare function channelHoldCall(ref: string, cursor: number): string;
/** The re-arm call for the WORKSPACE hold — no `channel`, and that is the op. */
export declare function workspaceHoldCall(cursor: number): string;
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
 *   - `hold=skip`        — a desktop-run session, fed the counterparty's
 *                           replies as new turns. Arming is simply wrong here.
 *   - `hold=since:<seq>` — everyone else: the cursor to arm from, pre-computed
 *                           off the seq this write just produced, so the next
 *                           call needs no read to find it.
 *   - absent (`-`)        — the write produced no seq to arm from. ⚠ `0` is NOT
 *                           a substitute: holding from 0 replays the channel.
 *
 * ⚠ IT STAYS AN OBSERVATION. An UNSTAMPED caller may still BE a desktop session
 * on an older build, which is why the unstamped branch offers a cursor rather
 * than an instruction, and why the doctrine states the wake as the client-side
 * conditional it is.
 */
export declare function holdFact(runtime: string | null, seq: number | null): string | undefined;
/**
 * THE HOLD CAME BACK EMPTY — ⚠ ONE LINE, cursor-first.
 *
 * ⚠ **THE TIMEOUT IS THE HOTTEST RESULT ON THIS SURFACE AND CARRIES THE LEAST
 * NEWS.** An external orchestrator holding on a quiet exchange reads this text
 * every ~45s and it is the same text every time, so the re-arm doctrine it used
 * to carry was paid per empty hold, forever, to say "nothing happened".
 *
 * ⚠ Desktop branch UNCHANGED — it is already one line, and it says the opposite
 * thing (do not re-arm at all).
 */
export declare function holdTimedOutLines(ref: string, since: number, runtime: string | null): string[];
/**
 * The same one line for the WORKSPACE hold's timeout. ⚠ A sibling call shape,
 * not a shared one: a workspace hold takes no `channel`, and a re-arm
 * instruction carrying one would be a call the caller cannot make. What used to
 * differ between the two — that ANY channel's traffic wakes a workspace hold,
 * so a wake is not evidence about the ONE exchange you are blocked on — is a
 * FACT about the scope and stays in `channel-ops-hold-workspace.ts`'s own
 * `scopeNote`, not in the waiting line.
 */
export declare function workspaceHoldTimedOutLines(since: number, runtime: string | null): string[];
/** The HOLD returned messages: advance the cursor, then re-arm — or don't. */
export declare function holdArrivedLines(ref: string, lastSeq: number, runtime: string | null): string[];
