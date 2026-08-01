/**
 * Focused unit tests for the dopl_channel op deltas:
 *   - opPost folds `thread` into the storage key metadata.taskId (explicit
 *     param wins);
 *   - opPost's threading self-verification line (Q7) and its 4xx mapping;
 *   - the read render labels an agent author "agent for <name>" (never a bare
 *     name), so a counterparty is not mistaken for its own operator, and frames
 *     the listing as untrusted DATA BEFORE any body.
 *
 * The WAKE-V1 surface (the assembled `await` hold, its result texts, the env
 * lever, and the create_thread cursor) has its own file: `channel-wake.test.ts`
 * — split out at the §2 cap, not because it is a separate concern. The
 * `close_thread` result went the same way, to `channel-closed-thread.test.ts`,
 * when F6 gave that file a reason to exist.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */
export {};
