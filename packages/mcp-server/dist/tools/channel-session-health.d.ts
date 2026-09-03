/**
 * THE HEALTH CLAUSES OF A SESSION LINE — "is this agent GETTING ANYWHERE",
 * rendered from the seven fields `dopl-desktop-app/main/session-health.js`
 * derives (2026-09-01, server migration `20260909120000`).
 *
 * ⚠ **SPLIT OUT OF `channel-session-render.ts` AT THE 500-LINE CAP** (§2; that
 * file measured 484 before this wave), and the seam is a real one:
 * `channel-session-render.ts` answers "what is this session and may I still call
 * it live" — identity, the staleness hedge, the presence witness — while this
 * answers "is it making progress, and what has been refused to it". They move on
 * different clocks, exactly as `session-metrics.js` and `session-health.js` do on
 * the desktop side. ⚠ `channel-` filename prefix required by the parity
 * split-scan.
 *
 * ── 🔒 THE ONE THING A READER OF THIS FILE MUST NOT CONFLATE ────────────────
 *
 * **THERE ARE TWO FACTS CALLED `stale` IN THIS FEATURE AND THEY ARE NOT THE SAME
 * FACT.**
 *
 *   `channel-session-render.ts › sessionIsStale` — derived HERE on the server
 *     from `updatedAt` against a 90s window. It is about the **REPORT**: nobody
 *     has said anything. The push is change-driven, so this fires on a live
 *     agent that is merely quiet, AND on a desktop that died mid-run. That is
 *     why its treatment is a hedge ("last reported working") and never a claim.
 *
 *   `ChannelSessionHealth.stale` — derived on the MACHINE, and it is about the
 *     **SESSION**: it is `working`, it has said nothing for ten minutes, and it
 *     is STILL SPENDING TOKENS. A live process getting nowhere.
 *
 * A live-but-quiet agent is the first without the second. A crashed machine is
 * the first without the second too — and a WEDGED one is the second WITHOUT the
 * first, because a wedged agent that is still dispatching tools keeps its row
 * perfectly fresh. **Merge them and the surface reports a live-but-quiet agent
 * as dead, or a hung agent as fine.**
 *
 * ⚠ **THE WIRE NAME IS THE DESKTOP'S AND IS NOT RENAMED ON OUR SIDE.** Renaming a
 * reported field is how two trees stop agreeing about what was reported. The
 * separation is carried by the RENDER instead: {@link sessionHealthClauses}
 * never uses the word "stale" — it says **WEDGED**, which is the desktop's own
 * noun for the thing (`session-health.js › isStale`'s docblock asks "IS THIS
 * SESSION WEDGED?") — and the freshness hedge keeps "stale" to itself.
 *
 * ── THE RULES, INHERITED VERBATIM FROM `channel-session-render.ts` ──────────
 *
 * ⚠ **`null` IS UNKNOWN, NEVER ZERO. THERE IS NO `?? 0` IN THIS FILE AND THERE
 * MUST NOT BE.** An absent field renders NOTHING. Printing "0 denied" for a
 * desktop that reported no number states that nothing has been refused to an
 * agent whose every shell call may be being refused silently — which is the
 * precise defect these columns were added to make visible.
 * ⚠ EVERY CLAUSE IS CONDITIONAL, so an older desktop's line is exactly the line
 * it rendered before this wave. No "unknown · unknown · unknown" filler.
 */
import type { ChannelSessionHealth } from "@dopl/client";
/**
 * THE PROGRESS COUNTERS — turns taken, and spend since this agent last SPOKE.
 *
 * ⚠ **RENDERED BESIDE `tokensSpent`, NOT WITH THE REST OF THE HEALTH SET, AND
 * THE POSITION IS THE POINT.** These two are counters of the same kind as the
 * lifetime spend: a reader comparing "41k tokens" with "+8.7k since it last
 * posted" is doing one piece of arithmetic, and splitting them across the line
 * makes it two. {@link sessionHealthClauses} carries the other five, at the END
 * of the line, for the opposite reason.
 *
 * ⚠ **`tokensDelta` IS "SINCE IT LAST POSTED", NOT "PER TURN", AND THE COPY SAYS
 * SO IN THOSE WORDS.** The baseline is the session's last own-channel post
 * (`main/session-health.js › tokensSinceLastPost`), which is the last thing an
 * orchestrator actually SAW from it — deliberately NOT the row push, which is
 * churn and would answer "tokens spent in the last few seconds". A clause
 * reading "per turn" would be a different number, and an orchestrator dividing
 * by `turns` to get one would be inventing it.
 *
 * ⚠ A MEASURED `0` IS RENDERED. `+0 since it last posted` means "measured, and it
 * has bought nothing since it spoke" — a real answer, and the one case where the
 * delta and the lifetime total visibly disagree. Only `null`/absent print
 * nothing.
 */
export declare function sessionProgressClauses(s: ChannelSessionHealth): string[];
/**
 * THE HEALTH SIGNALS, as clauses — empty array when the row carries none.
 *
 * ⚠ **ORDER IS DELIBERATE AND ENDS ON THE ALARMS.** The wake ack is a neutral
 * fact and goes first; the two things an orchestrator must ACT on close the
 * line, because the end of a `·`-joined line is the position a partial scan
 * still reaches. ⚠ Reached only from an own-scoped render — a peer row is a
 * `ChannelSessionState`, which has none of these fields, so a peer surface that
 * tried to call this would not compile.
 */
export declare function sessionHealthClauses(s: ChannelSessionHealth, now: number): string[];
