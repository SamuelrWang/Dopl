import "server-only";
import type { LaunchDirective, LaunchRefusalReason } from "../types";
import type { LaunchDirectiveRow } from "./repository-launch";

/**
 * THE DIRECTIVE LANE'S **ROW → DTO**, and the two closed values it reads.
 *
 * ⚠ **SPLIT OUT OF `service-launch.ts` ON 2026-09-01, AT THE §1 CAP AND ON A
 * REAL SEAM.** The agent-management kinds (`end` / `rename`, Samuel's ruling)
 * gave this mapper a SECOND service — `service-launch-agent.ts` — and a mapper
 * with two callers that lives inside one of them is the arrangement where the
 * other one grows a copy. There is exactly ONE statement of lazy expiry, of the
 * kind fallback and of the stale-cache field defaults, and every reader on this
 * lane goes through it.
 *
 * ⚠ WHAT DID **NOT** MOVE: every gate, every fence and every `operator_user_id`
 * argument. This file decides no authorization and reaches no database — it maps
 * a row somebody already proved they may read.
 */

/** The refusal contract, as a value. ⚠ ONE DECLARATION — the column's CHECK, the
 *  route schema and the MCP render all point at this.
 *  ⚠ SEVEN SINCE 2026-08-22: `no-template` is the agent-templates word — a directive
 *  named a template the OPERATOR's machine could not resolve (deleted, or invisible
 *  to them though visible to the orchestrator). ⚠ THE COLUMN CHECK CAUGHT UP ON
 *  2026-08-23 (`20260823140000_channel_launch_directives_template.sql`, WRITTEN —
 *  applied is a measurement, §12), in the same wave as the producer that makes the
 *  word reachable: `main/launch-directives.js › spawn` resolves the directive's
 *  template at CLAIM time. This list and that CHECK are back in agreement.
 *  ⚠ NINE SINCE 2026-09-01 (external end / rename — Samuel's ruling). `no-session`
 *  and `bad-name` are the words the in-process `dopl_agents` server already
 *  answers for these exact verbs, lifted onto the wire so the same fact reads the
 *  same way from outside. ⚠ THE COLUMN CHECK LANDS IN THE SAME WAVE this time
 *  (`20260907120000_channel_launch_directives_kind.sql`) — the 2026-08-22 window,
 *  where this list ran one word ahead of the CHECK and four files carried a
 *  standing "do not ship a producer yet", is exactly what that sequencing avoids. */
export const LAUNCH_REFUSAL_REASONS = [
  "cap",
  "busy",
  "no-sdk",
  "auth-hold",
  "no-bridge",
  "no-counterparty",
  "no-template",
  "no-session",
  "bad-name",
] as const;

/** ⚠ `done` JOINED 2026-09-01 — the non-launch kinds' success. Missing it here
 *  would make a completed end lazily REPORT as `expired` two minutes later, i.e.
 *  the one function that decides liveness would say an answered directive was
 *  never answered. */
export function isTerminal(status: string): boolean {
  return (
    status === "launched" ||
    status === "done" ||
    status === "refused" ||
    status === "expired"
  );
}

/**
 * ROW → DTO, **with lazy expiry applied**.
 *
 * ⚠ **THE STORED `status` AND THE REPORTED ONE MAY DISAGREE, ON PURPOSE.** There
 * is no cron sweeping this table (INVARIANTS §12's standing lesson: a scheduled
 * job is an environment fact nothing in the repo can observe, and this one would
 * exist purely to make a column cosmetically accurate). So a non-terminal row
 * past its TTL is REPORTED as `expired` at read time. Every reader goes through
 * this function, so there is one answer to "is it still live".
 * ⚠ The direction is fail-safe: expiry can only ever make a directive look LESS
 * live. It never resurrects one, and it never turns a decided row into anything.
 */
export function toDirective(
  row: LaunchDirectiveRow,
  now: number
): LaunchDirective {
  const expired = !isTerminal(row.status) && now > Date.parse(row.expires_at);
  return {
    id: row.id,
    // ⚠ COERCED, NOT CAST, AND THE FALLBACK IS `launch` (2026-09-01). A row
    // written by an OLDER SERVER build names no kind and the column's DEFAULT
    // already answers `launch` — but a row read back through an older PostgREST
    // schema cache can arrive with the field absent, and `undefined` reaching a
    // `switch` on this value is a directive nothing dispatches. §13's rule: an
    // older peer is supported, and the safe reading of "no kind stated" is the
    // one every pre-2026-09-01 row means.
    // ⚠ `set_agent_mode` JOINED THE LIST ON 2026-09-01 (T24's sibling). Omitting
    // it here would coerce a live re-posture row to `launch` — the fallback is
    // fail-SAFE for an UNKNOWN kind and is a silent mis-dispatch for a known one.
    kind: (row.kind === "end" ||
    row.kind === "rename" ||
    row.kind === "set_agent_mode"
      ? row.kind
      : "launch") as LaunchDirective["kind"],
    // ⚠ ON THE DTO ON PURPOSE, AND IT DISCLOSES NOTHING (F-284, 2026-08-23).
    // Every read that reaches this mapper is already fenced on
    // `operator_user_id = ctx.userId` (`repository-launch.ts`), so this can only
    // ever be the caller's own id. It is here because the DESKTOP re-checks
    // ownership locally before acting — `main/launch-directive-wire.js ›
    // directiveFrom` reads it and `main/launch-directives.js › handle` drops any
    // row that is not the signed-in operator's. Omitting it made every row the
    // breaker-open backstop polled compare against `''` and be discarded, i.e.
    // the F-273 recovery read returned rows nothing could ever action.
    operatorUserId: row.operator_user_id,
    channelId: row.channel_id,
    threadId: row.task_id,
    goal: row.goal,
    model: row.model,
    // ⚠ BOTH, ALWAYS, AND NEVER ONE. `template_id` is `ON DELETE SET NULL`, so a
    // null id ALONE cannot say whether no template was named or the named one was
    // deleted — and the desktop's answer to those two is opposite (launch blank
    // vs refuse `no-template`, spec E-4). Mapping only the id would make the DTO
    // the place the signal was lost, one layer above the wire narrowing that gets
    // blamed for it.
    templateId: row.template_id,
    templateName: row.template_name,
    // ⚠ THE INPUT PAIR, beside the template pair and never confused with
    // `agentId` below, which is the OUTPUT. `?? null` rather than a bare read for
    // the stale-cache reason the `kind` note above states: a cached payload from
    // an older schema can arrive without the field, and `undefined` would render
    // as the string "undefined" in a sentence naming the agent to be ended.
    targetAgentId: row.target_agent_id ?? null,
    targetName: row.target_name ?? null,
    // ── ⚠ THE EIGHT POSTURE COLUMNS (2026-09-01, T24 + `set_agent_mode`) ──────
    //
    // ⚠ **THEY MUST BE ON THE DTO OR THE DESKTOP NEVER SEES THEM.** The CLAIM's
    // answer IS this mapper's output, and `main/launch-directive-wire.js ›
    // directiveFrom` reads the camelCase spellings (`startToolMode`,
    // `targetToolMode`, `chain`) precisely because a claimed row arrives as this
    // DTO rather than as a raw realtime frame. Mapping only some of them would
    // ship a lane whose request half silently does nothing.
    //
    // ⚠ `?? null` RATHER THAN A BARE READ, on every one, for the stale-cache
    // reason the `kind` note above states: a payload cached against an older
    // PostgREST schema arrives without the field, and `undefined` on a posture
    // renders as the string "undefined" inside a sentence naming what an agent
    // was allowed to do.
    startToolMode: (row.start_tool_mode ??
      null) as LaunchDirective["startToolMode"],
    startMessageMode: (row.start_message_mode ??
      null) as LaunchDirective["startMessageMode"],
    chain: row.chain ?? null,
    targetToolMode: (row.target_tool_mode ??
      null) as LaunchDirective["targetToolMode"],
    targetMessageMode: (row.target_message_mode ??
      null) as LaunchDirective["targetMessageMode"],
    // ⚠ **THE ECHO. `null` MEANS "NOT REPORTED", NOT "UNCLAMPED", AND NEVER THE
    // REQUESTED VALUE.** No writer exists yet, so this is `null` on every live
    // row. ⚠ IT WOULD BE EASY AND WRONG TO DEFAULT THESE TO THE `start_*` /
    // `target_*` PAIR — the row would then assert that the machine applied
    // exactly what was asked, which is the one claim this lane cannot make about
    // a value it clamps. `channel-ops-launch.ts › postureLine` renders the null.
    appliedToolMode: (row.applied_tool_mode ??
      null) as LaunchDirective["appliedToolMode"],
    appliedMessageMode: (row.applied_message_mode ??
      null) as LaunchDirective["appliedMessageMode"],
    appliedChain: row.applied_chain ?? null,
    status: expired ? "expired" : (row.status as LaunchDirective["status"]),
    refusalReason: row.refusal_reason as LaunchRefusalReason | null,
    agentId: row.agent_id,
    claimedAt: row.claimed_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
