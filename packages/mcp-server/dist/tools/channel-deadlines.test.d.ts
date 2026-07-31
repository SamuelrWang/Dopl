/**
 * THE DEADLINE CHAIN around `dopl_channel(op="await")` — the numbers in
 * `channel-await-budget.ts`, pinned against the layers they have to fit under.
 * Split out of `channel-wake.test.ts` at the §2 500-line cap.
 *
 * What is pinned here:
 *   - the DEFAULT hold clears the /api/mcp function ceiling with margin (Q9);
 *   - the mirrored route ceiling still matches the route's own maxDuration;
 *   - the env lever is a real ceiling, so `timeout_ms` cannot route around it,
 *     while an explicit ask can still reach the cap;
 *   - the CAP clears the route ceiling by the same margin the default does
 *     (FIX M3 — it did not, and only the default was ever asserted);
 *   - one inner poll answers before the client + route bounds beneath it.
 */
export {};
