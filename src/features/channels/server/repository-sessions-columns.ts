import "server-only";
import type { SessionStateUpsert } from "./collab-dto";

/**
 * WHAT A SESSION ROW **IS**, for the reconcile — the columns it SELECTs and the
 * comparison it makes. Two declarations, one statement.
 *
 * ⚠ **SPLIT OUT OF `repository-sessions.ts` ON 2026-09-01, AT THE 500-LINE CAP**
 * (§1). That file measured 489 when the seven HEALTH columns
 * (`20260909120000`) had to join both lists, and the seam is real rather than
 * arithmetic: `repository-sessions.ts` is about ACCESS — which client, which
 * fence, which errors degrade and which throw — and this is about the row's
 * VOCABULARY, which moves whenever a column is added and never when a fence
 * moves. Its pin already lived in its own file
 * (`repository-sessions-columns.test.ts`); this is the subject that test names.
 *
 * ⚠ **THEY ARE `export`ED FOR THE REPOSITORY, NOT FOR THE TEST.** That
 * distinction matters because the test's own docblock states the opposite rule —
 * "exporting a private constant to test it makes the constant part of a public
 * surface" — and it still holds: the pin reads both declarations out of this
 * file's SOURCE TEXT and never imports them. The export exists because the
 * reconcile lives in another module now.
 *
 * ⚠ **EVERY REPORTED COLUMN MUST BE IN BOTH.** The reconcile writes only rows
 * that DIFFER, so:
 *   - **in the type but not the SELECT** → the stored value reads back as
 *     `undefined`, compares unequal against every reported value, and makes EVERY
 *     row look changed on EVERY push. `updated_at` is the read's ORDER BY and the
 *     MCP result's "last reported" stamp, so the ordering goes arbitrary while
 *     still looking plausible.
 *   - **in the type but not the COMPARE** → a push carrying nothing but that
 *     column is discarded as a no-op, and the value FREEZES at whatever it was on
 *     the row's first write while the row keeps claiming to be current.
 * {@link SessionStateUpsert}'s own keys are the third statement, and
 * `repository-sessions-columns.test.ts` pins all three against each other.
 */

/**
 * Columns the reconcile compares. ⚠ `id` / `created_at` / `updated_at` are
 * deliberately absent — identity and history, neither reported by the desktop
 * nor something the diff should look at.
 */
export const SESSION_DIFF_COLUMNS =
  "session_key, channel_id, task_id, name, state, channel_name, thread_title, " +
  "detail, tool_label, model, context_used, context_window, tokens_spent, " +
  "started_at, last_activity_at, template_name, display_name, " +
  // ⚠ THE HEALTH SEVEN (2026-09-01). They are the fields that move MOST OFTEN —
  // `turns` on every turn, `tokens_delta` on every quantizer step — so leaving
  // any of them out of the SELECT is the loudest version of the first failure
  // above, and leaving one out of the compare below the quietest version of the
  // second.
  "turns, tokens_delta, stale, denied_calls, last_denied_tool, " +
  "last_wake_seq, last_wake_at";

/**
 * ⚠ Field by field, NEVER JSON.stringify: key ORDER differs between a
 * PostgREST row and a service-built object, so a string compare reports every
 * row as changed — touching every `updated_at` on every push and destroying
 * the read's ordering.
 *
 * ⚠ The BIGINT columns compare with `!==` against a value PostgREST may hand
 * back as a STRING. {@link sameCount} is applied to both sides for every
 * numeric column, and `null` is compared as `null` — never coerced, because
 * `Number(null)` is 0 and a stored NULL would then read as equal to a reported
 * 0. ⚠ It covers the two INT4 health counters as well as the INT8s: the
 * width is not what the helper is protecting, the `null` is.
 */
export function sessionRowMatches(
  stored: SessionStateUpsert,
  reported: SessionStateUpsert
): boolean {
  const sameCount = (
    a: number | string | null | undefined,
    b: number | null
  ): boolean => {
    if (a === null || a === undefined) return b === null;
    if (b === null) return false;
    return Number(a) === b;
  };
  return (
    stored.channel_id === reported.channel_id &&
    stored.task_id === reported.task_id &&
    stored.name === reported.name &&
    stored.state === reported.state &&
    stored.channel_name === reported.channel_name &&
    stored.thread_title === reported.thread_title &&
    stored.detail === reported.detail &&
    stored.tool_label === reported.tool_label &&
    stored.model === reported.model &&
    sameCount(stored.context_used, reported.context_used) &&
    sameCount(stored.context_window, reported.context_window) &&
    sameCount(stored.tokens_spent, reported.tokens_spent) &&
    stored.started_at === reported.started_at &&
    stored.last_activity_at === reported.last_activity_at &&
    // ⚠ In practice this never moves for a live session — a template is captured
    // at spawn and a session cannot change identity mid-run. It is compared
    // anyway because the rule above admits no exceptions: a column in the SELECT
    // but not in this compare reads back as a difference nobody made on the
    // FIRST push after the field ships, and a column in neither freezes at its
    // first value while the row keeps claiming to be current.
    stored.template_name === reported.template_name &&
    // 2026-08-31: a RENAME is exactly the change this diff must see — it is how
    // the peer-visible name propagates on the next push with nothing else moving.
    stored.display_name === reported.display_name &&
    // ── HEALTH (2026-09-01) ────────────────────────────────────────────────
    sameCount(stored.turns, reported.turns) &&
    sameCount(stored.tokens_delta, reported.tokens_delta) &&
    // ⚠ `===` AND NOT A TRUTHINESS TEST. Three values are legal here — `true`,
    // `false` and `null` ("nothing evaluated it") — and `!stored.stale` would
    // collapse the last two, so a desktop that STARTED reporting `false` would
    // look like it had reported nothing and its first honest "not wedged" would
    // never be written.
    stored.stale === reported.stale &&
    sameCount(stored.denied_calls, reported.denied_calls) &&
    stored.last_denied_tool === reported.last_denied_tool &&
    sameCount(stored.last_wake_seq, reported.last_wake_seq) &&
    // ⚠ A WAKE ACK IS THE ONE FIELD AN ORCHESTRATOR POLLS FOR A CHANGE. Left out
    // of this compare, a push whose only news was "your redirect reached the
    // machine" would be discarded as a no-op and the ack would never arrive.
    stored.last_wake_at === reported.last_wake_at
  );
}
