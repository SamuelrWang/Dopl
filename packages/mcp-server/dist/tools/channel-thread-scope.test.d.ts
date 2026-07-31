/**
 * ONE THREAD'S CURSOR — the two ends of a scoped exchange.
 *
 *   1. `op="read"` with `thread=<id>` filters the transcript to one exchange,
 *      and must NOT hand back a wait that pretends to be filtered too: `await`
 *      is channel-wide and has no thread parameter at all. An agent told to
 *      "await this thread" arms a call that cannot exist.
 *   2. `op="close_thread"` reports the seq the close ECHO landed on. Live
 *      incident this pins: a requester closed a thread, GUESSED the echo's seq
 *      (last known + 1), armed the wait one past it, and silently skipped the
 *      peer's main deliverable, which was already below that guess. When the
 *      server reports no echo, the result says NOTHING about a seq — the whole
 *      point is that a number here is reported, never derived.
 *
 * Its own file rather than an addition to `channel-ops.test.ts`, which sits at
 * the §2 cap. The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
