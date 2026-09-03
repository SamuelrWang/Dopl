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

/**
 * **HOW MANY EMPTY, CURSOR-IDENTICAL, `wait_ms`-LESS READS COUNT AS A POLL** —
 * the strike count and the window the POLL DETECTOR judges over
 * (`packages/mcp-server/src/tools/channel-poll-detector.ts`).
 *
 * ⚠ **A POLL IS NOT A RATE PROBLEM, WHICH IS WHY THIS IS NOT A RATE LIMIT.** An
 * external session that re-reads a quiet channel every 30s is nowhere near any
 * rate ceiling; what it spends is the CALLER'S OWN CONTEXT — every wake of an
 * LLM session re-sends the whole of it — so the cost is paid off-server and no
 * request-per-minute bound can see it. What the server CAN see is the shape:
 * the same credential, the same channel, the SAME cursor, no `wait_ms`, and
 * nothing new to report. Three of those inside ten minutes is not a read
 * pattern, it is a timer.
 *
 * ⚠ **THREE, AND THE THIRD IS THE ONE THAT TRIPS** — two empty reads on one
 * cursor are an ordinary check-in (read, do something, check again), and
 * refusing those would break the legitimate use of the page. The bound is on
 * the LOOP, not on the second look.
 *
 * ⚠ **TEN MINUTES IS DELIBERATELY NOT {@link RESILIENCE_WINDOW_MS}, AND THEY
 * ARE NOT TO BE WIRED TOGETHER.** That one asks how long an ADDRESS stays warm;
 * this one asks how long ago a read still counts as part of the same loop. Same
 * neighbourhood, different question — exactly the relationship that module
 * records about `launch-budget.js`, and the reason both are typed out rather
 * than derived from each other.
 *
 * ⚠ **HAND-COPIED INTO `packages/mcp-server`, WHICH CANNOT IMPORT THIS FILE**
 * (its tsconfig `rootDir` is its own `src`). `src/shared/channels/caps.test.ts`
 * reads both sources and fails from either side — the join
 * `runtime-stamp-literals.test.mjs` established for the desktop tree.
 */
export const POLL_STRIKE_LIMIT = 3;

/** @see POLL_STRIKE_LIMIT — the window those strikes have to land inside. */
export const POLL_STRIKE_WINDOW_MS = 10 * 60_000;
