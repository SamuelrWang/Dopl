import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { SessionStateRow } from "./collab-dto";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * **CAN THE DESKTOP THAT RUNS AN ADDRESSED AGENT ACTUALLY HAND IT THIS POST?**
 * (2026-10-29, Thread Mention Reach Fix, step 1 — KB orchestration-guidelines ›
 * Audits/Thread Mention Reach Audit.)
 *
 * ⚠ **THE TWO SCOPES DISAGREED, AND THE SENDER WAS TOLD IT WORKED.** `to=` resolves
 * CHANNEL-wide (`service-writes-metadata-recipient.ts › liveAgentHandles`), but an
 * installed desktop feeds THREAD-scoped (`main/session-dispatch.js › feedLiveSession`
 * keys on `<channel>:<thread>:`). An agent standing by in the main room, or bound to
 * another thread, was resolved, stored on `recipient_agent_ids`, reported
 * `delivery: "woken"` — and never fed.
 *
 * ⚠ **IT IS A PREDICTION, LIKE EVERY OTHER `delivery` WORD.** The machine's receipt
 * (`service-writes-delivery.ts`) still strengthens it: `unreachable` is rank 1, so a
 * desktop that DID feed the agent upgrades the row to `woken(confirmed)`.
 *
 * ⚠ **ONLY POSITIVE EVIDENCE MAKES AN AGENT UNREACHABLE.** No row for the agent, an
 * unreadable projection or a non-array answer all mean UNKNOWN and keep today's
 * prediction — F-418's asymmetry: presence licenses resolution, absence of a match
 * licenses nothing. An agent is unreachable only when it HAS rows and every one of
 * them is on a different scope.
 *
 * ⚠ **A ROW COUNTS ON A SCOPE IF EITHER COLUMN NAMES IT.** `thread_id` is the
 * column; `session_key` is the desktop's own key (`<channel>:<thread>:<agent>`, the
 * middle segment empty in the main room), which is exactly what `liveOnThread`
 * compares. They agree on every live row; a healed row (F-241, `thread_id` nulled
 * under a deleted thread) still keys its dead thread, and nobody can post there.
 *
 * ⚠ **THE POST'S SCOPE IS THE DESKTOP'S `firstClassThreadId`**: a uuid thread id, or
 * the main room. A legacy `thread-<channel>-<seq>` tag is the main room on the
 * machine, so it is the main room here.
 */

/**
 * `true` since step 2 (2026-10-29): the desktop wakes a `to=` addressee on any scope
 * (`main/session-dispatch-scope.js`), so an off-scope addressee is reachable and the
 * prediction is `woken` again, confirmed by the machine's receipt.
 * ⚠ **DEPLOY THIS COMMIT ONLY AFTER THAT DESKTOP IS THE INSTALLED BASE.** Before it, an
 * older desktop drops the addressee and `woken(predicted)` is never confirmed — the
 * pre-fix lie. KB Audits/Thread Mention Reach Fix › Rollout.
 * Left as a switch, not deleted, so the rule and its test survive a revert.
 */
export const CROSS_SCOPE_WAKE = true;

/** The scope a post lands in, as the desktop computes it: a uuid thread or `""`. */
export function postScope(metadata: Record<string, unknown>): string {
  const t = typeof metadata.threadId === "string" ? metadata.threadId : "";
  return isUuid(t) ? t : "";
}

/** TRUE iff this row is a session working `scope` in `channelId`. */
export function rowOnScope(
  row: SessionStateRow,
  channelId: string,
  scope: string
): boolean {
  const key = typeof row.session_key === "string" ? row.session_key : "";
  if (key.startsWith(`${channelId}:${scope}:`)) return true;
  return (row.thread_id ?? "") === scope;
}

/**
 * The addressed agent ids that HAVE session rows in this channel and NONE of them on
 * the post's scope. `[]` whenever the read cannot say (see the module note).
 */
export function offScopeAgentIds(
  rows: readonly SessionStateRow[] | null | undefined,
  agentIds: readonly string[],
  channelId: string,
  scope: string,
  crossScopeWake: boolean = CROSS_SCOPE_WAKE
): string[] {
  if (crossScopeWake || !Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const id of agentIds) {
    const mine = rows.filter((row) => row && row.name === id);
    if (mine.length === 0) continue; // unknown, not absent
    if (mine.some((row) => rowOnScope(row, channelId, scope))) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The read + the rule. Channel-fenced (the ids were already resolved through the
 * credential's own fence, and this answers one boolean per id, nothing else). A
 * failed read is UNKNOWN, never a refusal: the post has already been accepted.
 */
export async function unreachableAddressees(
  ctx: ChannelContext,
  channelId: string,
  metadata: Record<string, unknown>,
  agentIds: readonly string[]
): Promise<string[]> {
  if (CROSS_SCOPE_WAKE || agentIds.length === 0) return [];
  let rows: SessionStateRow[] | null = null;
  try {
    rows = await repoSessions.listChannelSessionStates(ctx.workspaceId, channelId);
  } catch {
    return [];
  }
  return offScopeAgentIds(rows, agentIds, channelId, postScope(metadata));
}
