/**
 * Words no shipped string may say (`channel-law.test.ts`, `law-scan.test.ts` and other suites
 * scan with it). The filename is load-bearing: this rule book contains the
 * banned words, so it stays out of the `channel-*` tool group and `law-scan.test.ts` skips it by name.
 * A plain module, not a `.test.ts`: importing one test file from another registers it twice.
 */
export declare const REMOVED_VOCABULARY: ReadonlyArray<[string, RegExp]>;
/**
 * Exact-string exemption (matched whole, never `includes`) for `channel-hold-budget.ts ›
 * DESKTOP_HOLD_REFUSAL`, which quotes the desktop's `session-permissions.js › AWAIT_DENY_MESSAGE`
 * verbatim; rewording both halves to say "the hold" is an open decision.
 */
export declare const VERBATIM_QUOTES: ReadonlySet<string>;
/**
 * Retired `dopl_channel` op names, refused by schema validation (`channel-vocab.ts › unknownOpRefusal`).
 * Separate from {@link REMOVED_VOCABULARY} because these are ordinary words elsewhere, so
 * `law-scan.test.ts` matches them only in an op position. `read` survived and is absent.
 */
export declare const RETIRED_CHANNEL_OPS: readonly string[];
