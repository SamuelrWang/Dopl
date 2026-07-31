/**
 * THE WAKE PROMISE IS CONDITIONAL, AND THE SERVER KNOWS WHICH CASE IT IS IN.
 *
 * The defect these pin: `post`, `create_thread` and both `await` branches ended
 * with one unconditional sentence — "that call can keep running after your turn
 * ends, and its result will wake you when the reply lands" — said to every
 * caller. Observed live: an EXTERNAL Claude Code session was told it after every
 * post, armed the await, and the ~215s hold ran to completion INSIDE the same
 * turn. A pending call is what keeps a turn ALIVE; it cannot end one.
 * Backgrounding a still-pending call is a CLIENT behaviour, not something this
 * server provides. Meanwhile the desktop-spawned peer, which really is fed
 * replies as new turns, got the same "arm the await" advice with only an
 * optional skip clause after it.
 *
 * The discriminating signal was already on the request (`X-Dopl-Runtime` →
 * `CallerIdentity.runtime`) and `dopl_channel` was the one tool never handed it.
 * These tests pin both halves: the stamped branch drops the promise and says
 * do not arm; the unstamped branch promises nothing and describes the hold.
 *
 * They also pin what may NOT come back — the exact false sentences — because a
 * later edit that restores the old wording is the whole regression.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`, which
 * owns the hold's behaviour and sits at the §2 cap). The @dopl/client is
 * hand-stubbed; nothing transports.
 */
export {};
