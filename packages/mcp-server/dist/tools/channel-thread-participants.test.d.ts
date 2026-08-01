/**
 * THE THREAD PARTICIPANT SET — `op="create_thread"`'s `participants` seed, and
 * the set `op="get_thread"` renders back.
 *
 * What these pin, and why each one is worth a test:
 *
 *  - A SEED IS RESOLVED AGAINST THE ROSTER THE ROUTE CHECKS. `participants`
 *    arrives as `"agent:<handle>"` / `"user:<email>"` and must leave as
 *    `{kind, id}` refs resolved against the CHANNEL roster. Resolving against
 *    the WORKSPACE roster (as this used to) put a live, titled, empty,
 *    unanswerable thread in the channel and then reported "No thread was
 *    opened" — the B2 case.
 *  - A REFUSAL SAYS WHETHER A ROOM EXISTS. A pre-call refusal says nothing was
 *    created; a 400 that DOES get through may have left a thread behind, so it
 *    sends the caller to look rather than retry blind.
 *  - `as_agent` IS REFUSED HERE, not silently dropped. `TaskCreateSchema` has
 *    nowhere to put it, and an agent-attributed opening request classifies as
 *    `agent-escalation` on the receiving desktop — notify-only, spawning
 *    nothing, which is the one thing create_thread exists to do.
 *  - THE SET IS RENDERED BY BOTH NAMES — an agent by handle AND id, a person by
 *    member ref — an EMPTY set says pair-gated rather than saying nothing, and
 *    an unnameable agent still renders by id when the roster fetch fails.
 *
 * THE OTHER HALF: post-time addressing (`to_agent` / `as_agent` / `to_agents` /
 * `intent`) stays in `channel-agent-addressing.test.ts`, which this was split
 * out of at the §2 500-line cap — see that file's header for why the seam runs
 * here. Mutating a set AFTER the thread exists (`join_thread` / `leave_thread`)
 * is a third suite, `channel-ops-participants.test.ts`. The harness this shares
 * with the addressing half is `agent-addressing-fixtures.ts`.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
