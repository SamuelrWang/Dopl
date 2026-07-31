/**
 * OWN POSTS MUST NOT POP YOUR OWN HOLD. Observed live twice: an agent armed
 * `op="await"` and then its own close-echo (and, on the other occasion, a
 * sibling session on the same account) returned the hold instantly. Any agent
 * that posts a `task_progress` milestone after arming killed its own wake —
 * which is precisely the multi-step work the wake primitive exists for.
 *
 * The fix is opt-in at every other layer and ALWAYS-ON here: an MCP await
 * waits for a COUNTERPARTY by definition, so `opAwait` passes the caller's own
 * id as `excludeAuthor` whenever the boot handshake named it. When it did not
 * (`selfUserId === null`) nothing is passed and the poll is the pre-fix one.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`, which
 * owns the rest of the hold's behaviour) at the §2 500-line cap. The
 * @dopl/client is hand-stubbed; nothing transports.
 */
export {};
