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

import { AWAIT_HOLD_EXTERNAL_DEFAULT_MS } from "./channel-await-budget";
// ⚠ ONE statement of the runtime comparison, in `identity.ts` — the hold's
// LENGTH branches on the same answer this file's CLAIMS do.
import { isDesktopRuntime } from "./identity";

/**
 * The default hold in whole seconds, so the sentences below can't drift.
 *
 * ⚠ THE **EXTERNAL** DEFAULT, and only because every sentence quoting it is on
 * an UNSTAMPED branch (T03). A desktop-stamped caller is told not to arm at all,
 * so no line here ever states the desktop hold — quoting the desktop's 215s to
 * the one population that cannot get it is how this number was wrong before.
 */
const HOLD_SECONDS = Math.round(AWAIT_HOLD_EXTERNAL_DEFAULT_MS / 1000);

/** The observation, said as an observation. Reused so it reads identically. */
const DESKTOP_OBSERVED = `This request carried the Dopl desktop's runtime stamp: a desktop-run session, which is fed the counterparty's replies as new turns.`;

/**
 * The wake an EXTERNAL session can build for itself — ⚠ one CONDITIONAL
 * sentence, no more. `await` returns inside the turn it was armed in, so being
 * woken depends on an unobservable client behaviour; a harness with background
 * shell tasks already delivers completion as a wake, so the poll can move OUT
 * of the MCP call. Promises nothing about THIS call, and names a script rather
 * than implying the server provides one.
 */
const BACKGROUND_TASK_HINT = `If your harness can run background shell tasks, a stronger pattern is to run the channel-wait poll there (scripts/dopl-channel-wait.sh in the Dopl repo, or any loop on the await route) and END your turn — the task's completion is a wake your client already delivers.`;

/**
 * What the hold ACTUALLY does for a caller whose client we cannot see. ⚠ Every
 * clause checkable: hold length is this server's, "returns inside your turn" is
 * what a pending tool call does everywhere, and the wake is stated as the
 * client-side conditional it is. {@link BACKGROUND_TASK_HINT} rides on the end
 * so every unstamped branch gets it from ONE place.
 */
const HOLD_FACT = `That call HOLDS until a reply arrives or ~${HOLD_SECONDS}s passes, and it RETURNS INSIDE your current turn — a pending call keeps a turn alive, it cannot end one. Some MCP clients background a call still pending past ~2 minutes and deliver its result as a wake: if yours does, an armed await can wake you later; if it does not, the await is a synchronous wait, so re-arm it while the exchange is alive. ${BACKGROUND_TASK_HINT}`;

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
export function awaitFact(
  runtime: string | null,
  seq: number | null,
): string | undefined {
  if (isDesktopRuntime(runtime)) return "skip";
  return seq === null ? undefined : `since:${seq}`;
}

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
export function awaitTimedOutLines(
  ref: string,
  since: number,
  runtime: string | null,
): string[] {
  if (isDesktopRuntime(runtime)) {
    return [
      `${DESKTOP_OBSERVED} Do NOT re-arm — end your reply here and the next message will be fed to you. If nothing ever arrives, report that to your operator rather than waiting again.`,
    ];
  }
  return [
    `cursor=${since} — if you are still expecting a reply, re-arm the wait NOW, before you end your turn: dopl_channel(op="await", channel="${ref}", since=${since}) with the SAME since. Every ~3 empty holds, check for signs of life first with dopl_channel(op="read", channel="${ref}", since=${since}) — a working agent posts task_progress milestones. Keep re-arming while something came from that member (the one you addressed, not the room) in roughly the last 30 minutes; STOP and report to your operator when nothing has for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so that silence is the only stop signal there is.`,
  ];
}

/**
 * The same compression for the WORKSPACE hold's timeout. ⚠ A sibling line, not
 * a shared one, for the reason `channel-ops-await-workspace.ts` gives in full:
 * the workspace stop rule is a DIFFERENT rule (any channel's traffic wakes you,
 * so a wake is not news), and collapsing the two would restate the per-channel
 * trap where the worse one applies.
 */
export function workspaceAwaitTimedOutLines(
  since: number,
  runtime: string | null,
): string[] {
  if (isDesktopRuntime(runtime)) {
    return [
      `${DESKTOP_OBSERVED} Do NOT re-arm — end your reply here and the next message will be fed to you. If nothing ever arrives, report that to your operator rather than waiting again.`,
    ];
  }
  return [
    `cursor=${since} — re-arm before you end your turn if you are still waiting: dopl_channel(op="await", since=${since}). A workspace hold wakes on ANY message in ANY channel you belong to, so check the ONE exchange you are blocked on with dopl_channel(op="read", channel=<that channel>, since=<your cursor>) rather than reading workspace activity as a sign of life. Keep re-arming while something came from the member or agent you are waiting on in roughly the last 30 minutes; STOP and report to your operator when nothing has for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so that silence is the only stop signal there is.`,
  ];
}

/** `await` returned messages: advance the cursor, then re-arm — or don't. */
export function awaitArrivedLines(
  ref: string,
  lastSeq: number,
  runtime: string | null,
  stopRule: string,
): string[] {
  if (isDesktopRuntime(runtime)) {
    return [
      `\nAdvance your cursor to seq ${lastSeq}. ${DESKTOP_OBSERVED} Do NOT re-arm — end your reply here and the next message will be fed to you.`,
    ];
  }
  return [
    `\nAdvance your cursor to seq ${lastSeq}. If the exchange is still open, re-arm before you end your turn: dopl_channel(op="await", channel="${ref}", since=${lastSeq}). ${HOLD_FACT}`,
    stopRule,
  ];
}
