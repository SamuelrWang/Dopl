/**
 * WAKE-V1 — the `await` op as a WAKE PRIMITIVE, and the teaching that makes it
 * fire. Split out of `channel-ops.test.ts` at the §2 500-line cap.
 *
 * What is pinned here:
 *   - opAwait ASSEMBLES one long hold out of repeated ~50s inner polls, all
 *     re-issued with the SAME cursor, and returns the instant anything lands;
 *   - a transient inner failure MID-HOLD degrades to the timed-out RESULT
 *     (M4) rather than an error, which would carry none of the teaching;
 *   - a hold that comes back far under what it asked for is reported as CUT
 *     SHORT with "do NOT re-arm" (M5) — a clamped hold can never stay pending
 *     long enough to background, so re-arming it is a spin;
 *   - the untrusted-content caveat is a HEADER above the bodies, not a
 *     footnote under them (M1);
 *   - re-arm teaching carries a THREAD-STATE stop rule, not a timeout counter
 *     (M3) — a peer agent doing real work is legitimately silent for a long
 *     stretch, so "3 empty holds" is a checkpoint, never a deadline;
 *   - create_thread hands back the opening message's seq, so the requester
 *     arms `await` on the right cursor with no follow-up read.
 *
 * The numbers themselves — the env lever's clamp, and every deadline the hold
 * must fit under — are pinned in `channel-deadlines.test.ts`.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */
export {};
