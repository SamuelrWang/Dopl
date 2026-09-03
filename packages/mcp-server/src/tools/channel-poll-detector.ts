/**
 * 🔒 **THE POLL DETECTOR — "waiting is a hold, not a poll" ENFORCED IN CODE, not
 * only stated in doctrine** (Samuel's ruling, 2026-09-03: *"there should be a
 * Dopl actual guardrail in the code"*).
 *
 * ⚠ **WHY A RULE IN PROSE WAS NOT ENOUGH, AND IT IS THE SAME ARGUMENT
 * `channel-hold-budget.ts › DESKTOP_HOLD_REFUSAL` MAKES.** The rule was written
 * in `dopl://doctrine/channels`, restated on every hold result, and agents kept
 * polling anyway — a document is a thing an agent may simply not have pulled,
 * and a habit is not corrected by a paragraph it never read. What corrects it is
 * the surface refusing to be used that way, in the result it was already going
 * to read.
 *
 * ⚠ **WHAT IT COSTS THE CALLER TO GET THIS WRONG IS NOT A SERVER COST, WHICH IS
 * WHY THIS IS NOT A RATE LIMIT.** Every wake of an LLM session re-sends its
 * whole context. A hold pays that once, when a message lands; a timed re-read
 * pays it per tick, for pages that say nothing. The bill is the caller's own
 * context window, so no requests-per-minute ceiling can see it and no rate
 * limiter would ever fire. `src/shared/channels/caps.ts` states the constants
 * and the reasoning at length.
 *
 * ── THE FOUR THINGS IT REFUSES TO GUESS ────────────────────────────────────
 *
 * ⚠ **1. IT IS EXTERNAL-ONLY.** A desktop-run caller is already refused the
 * hold outright (T85, `channel.ts` on `isDesktopRun`), so counting its reads
 * would accuse it of not doing the one thing it may not do. {@link pollSubject}
 * returns `null` for that caller and every call site treats `null` as
 * "detector off".
 *
 * ⚠ **2. A HOLD IS NEVER COUNTED — IT RESETS.** `wait_ms` present is the caller
 * doing exactly what the rule asks. It clears the strikes rather than merely
 * not adding one, because a caller that holds once has demonstrably learned the
 * shape and the next empty page is a fresh observation, not strike four.
 *
 * ⚠ **3. ONLY AN EMPTY PAGE ON AN UNMOVED CURSOR COUNTS.** A read that returns
 * messages advances the caller's cursor, which changes the key; a read on a NEW
 * cursor is a different observation. What is left is the exact shape of a
 * timer: same credential, same scope, same `since`, nothing new, again.
 *
 * ⚠ **4. IT WITHHOLDS THE PAGE AND NEVER THE CURSOR.** The refusal replaces an
 * empty page — a result carrying no messages by definition — so nothing is
 * lost, and it hands the cursor back in the same line. A guardrail that could
 * drop a message would be worse than the habit it corrects.
 *
 * ── WHERE THE STATE LIVES, AND WHY IT IS NOT A TABLE ───────────────────────
 *
 * ⚠ **IN-PROCESS, PER SERVER INSTANCE, AND THAT IS A DELIBERATE FAIL-OPEN.**
 * `rate_limit_events` + `check_and_record_rate_limit_subject`
 * (`src/shared/auth/mcp-session.ts`) is this repo's generic subject counter and
 * would have been the natural home — but it is `server-only` app code behind a
 * fixed 60-second window, and `packages/mcp-server` reaches the app ONLY over
 * loopback HTTP through `@dopl/client` (its tsconfig `rootDir` is its own
 * `src`). Reaching it would mean a new API route and a new RPC for a counter
 * whose entire purpose is to nudge a caller in a result it is already reading.
 * ⚠ **THE ASYMMETRY IS WHAT MAKES THAT ACCEPTABLE:** a cold start LOSES
 * strikes, so the detector under-fires and a poller merely keeps polling. It
 * can never over-fire — no lost state can invent a strike — so the failure mode
 * is a missed nudge, never a withheld page. `touchMcpStatus` in the same app
 * takes the same trade for the same reason.
 *
 * ⚠ **BOUNDED BY CONSTRUCTION.** The key contains a caller-supplied cursor, so
 * an adversarial caller could otherwise mint one entry per call: expired rows
 * are swept on every write and {@link MAX_TRACKED_SUBJECTS} caps the map, with
 * the OLDEST-touched entries evicted first — evicting only ever loses strikes,
 * which is the safe direction (see above).
 */

import type { CallerIdentity } from "./identity";
import { isDesktopRun } from "./identity";

/**
 * ⚠ **HAND-COPIED FROM `src/shared/channels/caps.ts` — `packages/mcp-server`
 * cannot import the app's `src/`** (tsconfig `rootDir`). Drift is caught by
 * `src/shared/channels/caps.test.ts`, which reads BOTH sources and fails from
 * either side — the join `runtime-stamp-literals.test.mjs` established for the
 * desktop tree. Do not "fix" the duplication by deleting one; there is no
 * import that can replace it, and an un-pinned copy is the actual bug.
 */
export const POLL_STRIKE_LIMIT = 3;

/** @see POLL_STRIKE_LIMIT — hand-copied from the same file, pinned by the same test. */
export const POLL_STRIKE_WINDOW_MS = 10 * 60_000;

/**
 * ⚠ A ceiling on the tracker, not on the caller. Generous next to the number of
 * credentials one server instance sees in a ten-minute window, and small enough
 * that a caller cycling cursors cannot grow the process.
 */
export const MAX_TRACKED_SUBJECTS = 5_000;

/** The scope key a channel-less (account-wide) read is counted under.
 *  ⚠ Not a legal channel ref, so it can never collide with one. */
export const ACCOUNT_SCOPE = "*account";

/**
 * WHO IS BEING COUNTED — ⚠ the credential AS THIS SERVER CAN OBSERVE IT, and
 * `null` for anyone the detector must not judge.
 *
 * ⚠ **THERE IS NO TOKEN ID ON `CallerIdentity`**, so the subject is the triple
 * the boot handshake does resolve: the user id, how the credential was minted,
 * and its label. Two credentials of the same kind and label on one account are
 * indistinguishable from here and share a counter — which merges two pollers
 * into one, i.e. fires SOONER for a caller that is polling twice as hard, and
 * never accuses a caller that is not polling at all.
 *
 * ⚠ **A CALLER WITH NO RESOLVED USER ID IS NOT COUNTED.** Boot could not say
 * who it is, and a counter keyed on "unknown" would pool every such caller into
 * one subject and then accuse whichever of them read third.
 */
export function pollSubject(caller: CallerIdentity): string | null {
  if (isDesktopRun(caller)) return null;
  if (!caller.userId) return null;
  return `${caller.userId}|${caller.credentialKind ?? "?"}|${caller.credentialLabel ?? "?"}`;
}

/** One tracked (subject, scope, cursor) triple. */
interface Strikes {
  /** Timestamps of the empty, `wait_ms`-less reads still inside the window. */
  at: number[];
  /** Last touch, for eviction ordering. */
  seen: number;
}

const tracked = new Map<string, Strikes>();

/** ⚠ ONE spelling of the key, so a record and a reset cannot miss each other. */
function keyOf(subject: string, scope: string, since: number | undefined): string {
  return `${subject} ${scope} ${since ?? "-"}`;
}

/**
 * Drop what the window has aged out, then the oldest entries if the map is
 * still over its cap. ⚠ Runs on WRITES only — a read path that mutates on
 * every call would make the detector's own cost scale with the traffic it
 * exists to reduce.
 */
function sweep(now: number): void {
  for (const [k, v] of tracked) {
    if (now - v.seen > POLL_STRIKE_WINDOW_MS) tracked.delete(k);
  }
  if (tracked.size <= MAX_TRACKED_SUBJECTS) return;
  const oldest = [...tracked.entries()]
    .sort((a, b) => a[1].seen - b[1].seen)
    .slice(0, tracked.size - MAX_TRACKED_SUBJECTS);
  for (const [k] of oldest) tracked.delete(k);
}

/**
 * A `wait_ms` READ HAPPENED — ⚠ the caller did the right thing, so the strikes
 * for this scope are FORGOTTEN, not merely left alone.
 *
 * ⚠ Cursor-independent ON PURPOSE. A hold's whole point is that it returns on a
 * NEW cursor, so a reset keyed on the cursor it was armed at would clear
 * nothing the caller can be credited for. The scope is what was held on.
 */
export function noteHold(subject: string | null, scope: string): void {
  if (subject === null) return;
  const prefix = `${subject} ${scope} `;
  for (const k of tracked.keys()) {
    if (k.startsWith(prefix)) tracked.delete(k);
  }
}

/**
 * AN EMPTY, `wait_ms`-LESS READ HAPPENED — record it and answer whether this
 * caller is now polling.
 *
 * ⚠ Returns `false` for an untracked caller (`subject === null`), so a call
 * site needs no second runtime check.
 */
export function notePollingRead(
  subject: string | null,
  scope: string,
  since: number | undefined,
  now: number = Date.now(),
): boolean {
  if (subject === null) return false;
  sweep(now);
  const key = keyOf(subject, scope, since);
  const entry = tracked.get(key) ?? { at: [], seen: now };
  entry.at = entry.at.filter((t) => now - t < POLL_STRIKE_WINDOW_MS);
  entry.at.push(now);
  entry.seen = now;
  tracked.set(key, entry);
  return entry.at.length >= POLL_STRIKE_LIMIT;
}

/**
 * THE REFUSAL LINE — ⚠ it LEADS the result, and the shape is the surface's own
 * `reason=… · retry=…` vocabulary rather than new words, so a caller that
 * already parses refusals parses this one.
 *
 * ⚠ **IT NAMES THE CURSOR, WHICH IS WHY WITHHOLDING THE PAGE LOSES NOTHING.**
 * The page it replaces was empty; the cursor is the only thing that page
 * carried, and it is here.
 */
export function pollingDetectedLine(retry: string, cursor: number | undefined): string {
  return `reason=POLLING_DETECTED · use wait_ms · retry=${retry} · cursor=${cursor ?? 0}`;
}

/**
 * ⚠ **TEST SEAM, AND THE ONLY ONE.** Module-level state is shared by every test
 * in a file; without this, one case's strikes decide the next case's verdict.
 * Never called from a handler.
 */
export function resetPollDetectorForTests(): void {
  tracked.clear();
}
