/**
 * 🔒 **A TOOL CALL THAT WAS NOT CHARGED SAYS SO — ONCE IN THE LOG, AND ON THE
 * CALL ITSELF** (2026-09-14 review).
 *
 * ⚠ **THE FAILURE THIS EXISTS FOR IS A MIS-ORDERED DEPLOY, AND IT IS SILENT ON
 * BOTH SIDES.** `POST /api/mcp/credits/consume` FAILS OPEN by decision — a DB
 * blip must not brick every agent — and answers `{ allowed: true, degraded: true,
 * wallet: null, used: 0, limit: 0 }`. `registrar.ts › createCharger` reads
 * `allowed !== false`, returns `null`, and the call runs FREE. Ship the web
 * before the migration (a missing RPC signature is a `PGRST202`, not a 500) and
 * every MCP tool call in the estate is unmetered until somebody notices — and
 * nothing was built to notice.
 *
 * ⚠ **TWO CHANNELS, BECAUSE THE TWO AUDIENCES ARE DIFFERENT.**
 *   1. **The LOG, once per process per REASON.** The old line was a
 *      `console.error` per call: under a real outage that is one line per tool
 *      call per agent, which buries itself and every other line beside it. A
 *      deploy-ordering bug is a STATE, not an event — one line states it.
 *   2. **The `_dopl_status` FOOTER `note`, per call.** The established
 *      operator-visible channel on this surface (`status-footer.ts ›
 *      appendDoplStatus`, the slot `ignoredWorkspaceNote` already rides). The
 *      agent reads that footer on every result by instruction, so "this call was
 *      not charged" reaches the one reader who can escalate it.
 *
 * ⚠ **PER-CALL STATE IS AN `AsyncLocalStorage`, NOT A MODULE VARIABLE.** One
 * server process serves concurrent tool calls; a "last unmetered reason" global
 * would put one call's note on another call's footer, which is worse than no
 * note. The scope is opened by both registration helpers in `registrar.ts` and
 * encloses the handler AND the footer, so `dopl_search`'s PER-LEG charge — which
 * happens deep inside a handler and whose return value never reaches the footer —
 * is covered by the same mechanism as the other two call sites.
 *
 * ⚠ **IT NEVER REFUSES AND NEVER RETRIES.** Fail-open is the decision
 * (`registrar.ts › createCharger`, `route.ts › failOpen`); this module only makes
 * the consequence legible.
 */
/**
 * Why a call went unmetered. ⚠ A CLOSED SET, because it is the LOG DEDUPE KEY:
 * folding the server's message into the key would defeat the once-per-process
 * rule the moment a message carried an id or a timestamp.
 */
export type UnmeteredReason = 
/** The consume call threw — network, 5xx, or a `PGRST202` from a missing RPC. */
"consume_failed"
/** The consume call ANSWERED, and the answer said it measured nothing. */
 | "degraded";
/** Open a per-call scope. ⚠ Must enclose the handler AND the footer append. */
export declare function withUnmeteredScope<T>(run: () => Promise<T>): Promise<T>;
/**
 * Record that THIS call was not charged, and say so in the log the FIRST time
 * this process sees this reason.
 *
 * ⚠ **`detail` IS LOGGED, NEVER KEYED ON** — see {@link UnmeteredReason}.
 * ⚠ Safe outside a scope: the log half still fires. That is the shape a future
 * caller outside the two registration helpers needs, and a throw here would turn
 * a billing outage into a failed tool call.
 */
export declare function recordUnmetered(reason: UnmeteredReason, detail: string): void;
/** ⚠ The literal the footer opens with, and the string an operator greps for. */
export declare const NOTE_PREFIX = "unmetered:";
/**
 * The footer note for THIS call, or `null` when it was charged normally.
 *
 * ⚠ **BOTH REASONS RENDER IN A FIXED ORDER**, so the line is greppable rather
 * than dependent on which arm fired first in a multi-leg call.
 */
export declare function unmeteredNote(): string | null;
/** Join the footer's notes. ⚠ Both are optional and either may be the only one. */
export declare function joinNotes(...notes: Array<string | null | undefined>): string | null;
/** ⚠ TEST-ONLY. The once-per-process Set is the behaviour under test, so a suite
 *  that asserts it has to be able to put the process back. */
export declare function resetUnmeteredLogForTests(): void;
