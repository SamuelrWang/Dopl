/**
 * ONE SESSION, AS A LINE — shared by `read_sessions` and by the `sessions`
 * block an `await` now returns with its messages.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * TWO RULES GOVERN EVERYTHING IN HERE, AND BOTH ARE ABOUT NOT ASSERTING THINGS.
 *
 *  1. **A ROW IS A REPORT, NOT AN OBSERVATION.** `channel_sessions` is a
 *     PROJECTION the operator's desktop PUSHES, on state change and never on a
 *     timer. Nothing on the server watches the machine. So a row whose
 *     `updatedAt` has gone quiet does not mean the agent is quiet — it means
 *     NOBODY HAS SAID ANYTHING, which is a different fact and includes the case
 *     the whole desktop died. {@link formatSessionLine} therefore stops saying
 *     "working" past {@link SESSION_STALE_WINDOW_MS} and starts saying "last
 *     reported working". ⚠ A crashed desktop used to read as `working` FOREVER.
 *  2. **`null` IS UNKNOWN, NEVER ZERO.** Every telemetry field is nullable and
 *     an absent one is simply not rendered. There is no `?? 0` in this file and
 *     there must not be: printing `0 tokens` for a desktop that reported no
 *     number is a measurement nobody took, stated as fact, in the surface an
 *     orchestrator uses to decide whether to keep an agent alive.
 *
 * ⚠ **AND SINCE 2026-08-23 THE FIRST RULE HAS A SECOND WITNESS** (F-294). A quiet
 * row alone cannot tell "idle but alive" from "the desktop is gone", so the hedge
 * said the more alarming of the two about an agent that was merely between turns.
 * `agent_presence` DOES beat on a timer, unconditionally, and the caller's OWN
 * presence freshness now rides in as {@link SessionRenderOpts.operatorOnline}: a
 * quiet row under a LIVE heartbeat renders "quiet Xm" (unchanged), and only a
 * quiet row under a quiet machine keeps "may be offline". ⚠ Absent = UNKNOWN and
 * keeps the old hedge — an older server sends no such key, and this must not read
 * a missing fact as evidence of life.
 */
import type { ChannelSessionState, ChannelSessionStateOwn } from "@dopl/client";
/**
 * PAST THIS, A ROW STOPS ASSERTING A LIVE STATE.
 *
 * ⚠ A DELIBERATE DUPLICATE of `src/features/channels/constants.ts ›
 * PRESENCE_ONLINE_WINDOW_MS`, pinned by `channel-session-staleness.test.ts`
 * against that file's TEXT — this package cannot import across the tree
 * boundary, and the precedent for the duplicate-plus-pin is
 * `channel-addressing.ts › GROUP_CHANNEL_MIN_MEMBERS`.
 *
 * ⚠ **IT IS THE PRESENCE WINDOW ON PURPOSE, AND THE REUSE IS THE POINT**: a
 * second staleness number would let one surface call a member's machine offline
 * while another still reports their agent as busily working. The web's peer
 * cards already reuse it (`components/channels-v2/agents-model.ts ›
 * peerRowStale`), and this is the third reader of the same rule.
 *
 * ⚠ **WHAT IT IS NOT: A HEARTBEAT.** `updatedAt` moves on a projection CHANGE,
 * so a genuinely-alive agent that has been idle for ten minutes crosses this
 * line. That is why the treatment is a HEDGE ("last reported idle") and never a
 * removal or a claim that the agent stopped — the same conclusion the web's
 * cards reached when a wall-clock filter made live agents vanish mid-run.
 */
export declare const SESSION_STALE_WINDOW_MS = 90000;
/**
 * IS THIS ROW STILL SPEAKING FOR ITSELF?
 *
 * ⚠ AN ABSENT OR UNPARSEABLE `updatedAt` READS AS STALE — the fail-safe
 * direction, and the same one `peerRowStale` picks. A row that cannot say when
 * it was written may not assert a present tense.
 */
export declare function sessionIsStale(session: Pick<ChannelSessionState, "updatedAt">, now?: number, windowMs?: number): boolean;
/**
 * A model id, shortened for a glance.
 *
 * ⚠ COSMETIC ONLY, and it never invents a name: it drops a leading vendor
 * prefix and a trailing dated build stamp, both of which are noise in a line an
 * orchestrator skims. If the strip would leave nothing, the ORIGINAL is
 * rendered — an id this build has never seen renders AS ITSELF rather than as a
 * blank, which is the same rule the web's model chip follows (a newer desktop
 * may run a model this build has not heard of, and a blank would report that as
 * "no model").
 * ⚠ Still passed through `inlineOr` by the caller — it is a value in a line WE
 * wrote, and the desktop is not a trusted formatter.
 *
 * ⚠ **AND THE RESULT IS ONE TOKEN, ALWAYS — F-293, A LIVE DEFECT.** The bundled
 * CLI ships explicit long-context ids spelled with a bracket suffix
 * (`claude-opus-5[1m]`, `claude-sonnet-4-6[1m]`; `main/session-model.js ›
 * contextWindowFor` reads that suffix as the window), and `narration.ts ›
 * neutralizeInline` turns `[` and `]` into SPACES because they are markdown
 * structure. So the model clause rendered `` `opus-5 1m` `` — a bare `1m` sitting
 * in the one segment {@link SESSION_TELEMETRY_NOTE} promises holds bare NAMES,
 * one clause away from `started 12m ago` and `stale, 10m ago`. A relative time is
 * exactly what `coarseAge` emits, so an operator reads a time shard as a template
 * or a model. **Whatever the neutralizer would blank into a space is joined with
 * a HYPHEN here instead**, so no desktop-supplied id can ever split the model slot
 * into two bare names.
 */
export declare function shortModelLabel(model: string): string;
/**
 * WHAT THE RENDER KNOWS BEYOND THE ROW ITSELF.
 *
 * ⚠ `operatorOnline` IS THE CALLER'S OWN MACHINE, NOT THIS SESSION'S. It is
 * `agent_presence` for (caller, workspace), derived server-side against
 * `PRESENCE_ONLINE_WINDOW_MS` — the same number as {@link SESSION_STALE_WINDOW_MS}
 * and deliberately so. It says a listener of this operator's heartbeat recently;
 * it does not say WHICH machine, and on a multi-machine operator it can be a
 * different one. That is why it only ever softens a hedge into "unchanged" and
 * never hardens anything into a claim.
 * ⚠ **THREE STATES, AND `undefined` IS THE THIRD.** `true` = heartbeating,
 * `false` = no fresh beat, `undefined` = NOT REPORTED (an older server, or the
 * presence read failed behind an already-earned payload). Absent takes the same
 * branch as `false`, because a fact nobody reported is not evidence of life.
 */
export interface SessionRenderOpts {
    telemetry?: boolean;
    now?: number;
    operatorOnline?: boolean;
    /**
     * Render the row's ADDRESSABLE HANDLE (2026-08-31).
     *
     * ⚠ **OWN ROWS ONLY, AND IT IS ITS OWN FLAG RATHER THAN A READ OF
     * {@link SessionRenderOpts.telemetry}.** An agent id is a WAKE TOKEN on the
     * operator's machine — tier 1 is "at any roster size" and a peer HUMAN who
     * knows the id can wake my agent with it (INVARIANTS §11) — so which handles a
     * result publishes is an AUDIENCE decision, not a verbosity one. Overloading
     * the telemetry flag would tie the two together, and the next caller that
     * wants a compact own-row page would silently withdraw the handle. Both
     * production call sites are own-scoped and pass it explicitly.
     */
    handle?: boolean;
}
/**
 * ONE session row, all peer-influenced text neutralized.
 *
 * `telemetry` decides whether the operator-only clauses are rendered at all —
 * ⚠ and it is a SEPARATE decision from the type, deliberately: a caller with an
 * own-scoped row may still want the short line (the `await` block keeps it
 * compact when there are many sessions). Passing `undefined` renders coarse.
 */
export declare function formatSessionLine(s: ChannelSessionState | ChannelSessionStateOwn, opts?: SessionRenderOpts): string;
/**
 * THE LEGEND under a set of session lines. One sentence per thing a reader
 * could get wrong, and no more.
 *
 * ⚠ IT NAMES THE STALE CASE EXPLICITLY. A model that sees "last reported
 * working" without being told what that means will round it back to "working" —
 * the reading this whole file exists to prevent.
 *
 * ⚠ **AND SINCE F-294 THERE ARE TWO QUIET-ROW READINGS, SO THE LEGEND BRANCHES
 * ON THE SAME FACT THE LINES DID.** Explaining "may be offline" over a page whose
 * lines all say "quiet" teaches the wrong caveat, which is worse than none.
 */
export declare function sessionLegend(anyStale: boolean, operatorOnline?: boolean): string;
/**
 * THE SESSION BLOCK AN `await` RETURNS WITH ITS RESULT — the caller's own agents
 * as of the moment the hold came back.
 *
 * ⚠ **`undefined` AND `[]` ARE DIFFERENT ANSWERS AND MUST RENDER DIFFERENTLY.**
 * `undefined` = the server did not report (an older deployment, or the read
 * failed) — say nothing at all, because a heading with no rows under it reads as
 * "you have none". `[]` = the server looked and this machine is reporting
 * nothing, which IS worth one line: it is the shape a crashed or signed-out
 * desktop produces, and an orchestrator waiting on an agent needs to see it.
 *
 * ⚠ **IT IS A BLOCK UNDER THE MESSAGES, NEVER INTERLEAVED WITH THEM.** The
 * messages above it are counterparty-authored under their own framing header;
 * splicing server narration between them would let a body's last line be read as
 * the start of this section.
 *
 * ⚠ COMPACT ON PURPOSE. This rides on EVERY returned hold, including every
 * timeout, so it is one line per session and one legend — never the full
 * `read_sessions` preamble.
 */
export declare function sessionBlockLines(sessions: readonly ChannelSessionStateOwn[] | undefined, now?: number, operatorOnline?: boolean): string[];
/**
 * TELEMETRY IS THE CALLER'S OWN, AND THE RESULT SAYS SO ONCE.
 * ⚠ Stated because an orchestrator that sees model/tokens on its own lines will
 * otherwise assume it can see a PEER'S, ask for them, and be silently answered
 * with a coarse row it reads as "that agent is running no model".
 */
export declare const SESSION_TELEMETRY_NOTE = "Template, model, context, tokens, current tool and start time are reported for YOUR OWN sessions only \u2014 a peer's agent is visible to you as a handle and a state, never as a template or a cost. Where a line carries two bare names, the first is the agent TEMPLATE it was launched from and the second is the model; the MODEL is always ONE unbroken token, so a name containing a space is a template and never a model. A template name is what the session was launched as and is never updated afterwards, so it may name a template that has since been renamed or deleted. A field that is absent was NOT REPORTED by the machine running that session; it is not a zero, and no template named is not a template hidden.";
