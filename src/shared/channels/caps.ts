/**
 * **CHANNEL CAPS THE SERVER AND THE MACHINE BOTH HAVE TO AGREE ON** — one
 * declaration, imported, never quoted (v2 wave B slice B4).
 *
 * ⚠ **THE WAVE-B SPEC NAMES THIS FILE AS "A7's MODULE" AND IT DID NOT EXIST AT
 * `523bfc92`.** Wave A shipped no `src/shared/channels/` at all; the only place
 * a 15-minute channel-scoped window was written down was
 * `dopl-desktop-app/main/launch-budget.js › WINDOW_MS`, which no web module can
 * import (INVARIANTS §13 — the desktop tree is not on the web tsconfig path).
 * So this file is CREATED here rather than extended, and F-490 records the
 * disagreement. Do not read its docblock as evidence that a slice before this
 * one wrote it.
 *
 * ⚠ **A NUMBER IS ASSERTED FROM HERE, NEVER RE-TYPED IN A TEST.** The Wave B row
 * for this slice says so in as many words, and the reason is the one
 * `launch-budget.js` records about its own pair: a bound quoted in a test stops
 * being a bound and becomes a second opinion, and the test then passes while the
 * behaviour moves.
 */

/**
 * **HOW LONG AN ADDRESS STAYS WARM** — the window RR2 looks back over when an
 * agent posts into the main room with nobody named.
 *
 * ⚠ **IT IS THE SAME 15 MINUTES `main/launch-budget.js › WINDOW_MS` USES, AND
 * THE SAMENESS IS DELIBERATE RATHER THAN DERIVED.** Both answer "how long does
 * one channel's recent past count for", and a reader who finds two different
 * spans for that question has to guess which one a behaviour follows. They are
 * NOT wired together: that module is a RATE bound on launches and this is a
 * RESOLUTION window on addressing, so tuning one must not silently move the
 * other — exactly the relationship `launch-budget.js` states about its own two
 * ceilings and refuses to express as arithmetic.
 *
 * ⚠ **SHORT ON PURPOSE.** It exists so a forgotten `@` does not stall a live
 * exchange, not so an agent can answer into a conversation that ended an hour
 * ago. Past the window the resilience arm does not fire and the send answers
 * `delivery=none` — a broadcast into the room, which is what an unaddressed post
 * with no recent counterparty actually is.
 */
export const RESILIENCE_WINDOW_MS = 15 * 60_000;
