import "server-only";
import type { SessionStateUpsert } from "./collab-dto";

/**
 * The session row's vocabulary for the reconcile. Every reported column must be in the SELECT, the
 * compare and `SessionStateUpsert`: missing from the SELECT, every push looks changed; missing from the
 * compare, the value freezes. `repository-sessions-columns.test.ts` pins all three from this source.
 */

/** Columns the reconcile compares; `id` / `created_at` / `updated_at` are deliberately absent. */
export const SESSION_DIFF_COLUMNS =
  "session_key, channel_id, task_id, name, state, channel_name, thread_title, " +
  "detail, tool_label, model, context_used, context_window, tokens_spent, " +
  "started_at, last_activity_at, identity_name, display_name, " +
  "turns, tokens_delta, stale, denied_calls, last_denied_tool, " +
  "last_wake_seq, last_wake_at, " +
  // Also the incumbent key for `session-colors.ts` rule 1 — missing, every push would reassign it.
  "color";

/**
 * Field by field, never `JSON.stringify` (key order differs by source). Numeric columns go through
 * `sameCount`: PostgREST may return a BIGINT as a string, and a stored NULL must never equal 0.
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
    stored.identity_name === reported.identity_name &&
    stored.display_name === reported.display_name &&
    stored.color === reported.color &&
    sameCount(stored.turns, reported.turns) &&
    sameCount(stored.tokens_delta, reported.tokens_delta) &&
    // `===`, not truthiness: `false` and `null` (nothing evaluated it) are different reports.
    stored.stale === reported.stale &&
    sameCount(stored.denied_calls, reported.denied_calls) &&
    stored.last_denied_tool === reported.last_denied_tool &&
    sameCount(stored.last_wake_seq, reported.last_wake_seq) &&
    stored.last_wake_at === reported.last_wake_at
  );
}
