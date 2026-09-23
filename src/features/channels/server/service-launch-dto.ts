import "server-only";
import type { LaunchDirective, LaunchRefusalReason } from "../types";
import type { LaunchDirectiveRow } from "./repository-launch";

/** The directive lane's one statement of lazy expiry, the kind fallback and the stale-cache
 *  defaults. It decides no authorization and reaches no database. */

/** `done` must be here, or a completed end would lazily report `expired`. */
export function isTerminal(status: string): boolean {
  return (
    status === "launched" ||
    status === "done" ||
    status === "refused" ||
    status === "expired"
  );
}

/** Expiry is applied lazily at read time (there is no cron): a non-terminal row past its TTL
 *  reports `expired`. It can only make a directive look less live, never resurrect one. */
export function toDirective(
  row: LaunchDirectiveRow,
  now: number
): LaunchDirective {
  const expired = !isTerminal(row.status) && now > Date.parse(row.expires_at);
  return {
    id: row.id,
    // An unknown or absent kind falls back to `launch` (the column DEFAULT).
    kind: (row.kind === "end" ||
    row.kind === "rename" ||
    row.kind === "set_agent_mode"
      ? row.kind
      : "launch") as LaunchDirective["kind"],
    // For the desktop's local ownership re-check (F-273, F-284); always the caller's own id.
    operatorUserId: row.operator_user_id,
    channelId: row.channel_id,
    threadId: row.task_id,
    goal: row.goal,
    model: row.model,
    // Every newer column is read `?? null`: a stale PostgREST cache may omit it. `null` runtime
    // means did not ask, never inferred from `model`.
    runtime: row.runtime ?? null,
    // Both, always: a null id alone cannot tell "none named" from "deleted" (`no-identity`).
    identityId: row.identity_id,
    identityName: row.identity_name,
    color: (row.color ?? null) as LaunchDirective["color"],
    agentName: row.agent_name ?? null,
    targetAgentId: row.target_agent_id ?? null,
    targetName: row.target_name ?? null,
    startToolMode: (row.start_tool_mode ??
      null) as LaunchDirective["startToolMode"],
    startMessageMode: (row.start_message_mode ??
      null) as LaunchDirective["startMessageMode"],
    chain: row.chain ?? null,
    targetToolMode: (row.target_tool_mode ??
      null) as LaunchDirective["targetToolMode"],
    targetMessageMode: (row.target_message_mode ??
      null) as LaunchDirective["targetMessageMode"],
    // The machine's report (written by the decide): `null` = not reported. Never default these
    // to the request columns.
    appliedToolMode: (row.applied_tool_mode ??
      null) as LaunchDirective["appliedToolMode"],
    appliedMessageMode: (row.applied_message_mode ??
      null) as LaunchDirective["appliedMessageMode"],
    appliedChain: row.applied_chain ?? null,
    appliedAgentName: row.applied_agent_name ?? null,
    appliedRuntime: row.applied_runtime ?? null,
    appliedModel: row.applied_model ?? null,
    // Retired: `null` on every new row; the desktop's `directiveFrom` falls back to `start*`.
    resolvedToolMode: (row.resolved_tool_mode ??
      null) as LaunchDirective["resolvedToolMode"],
    resolvedMessageMode: (row.resolved_message_mode ??
      null) as LaunchDirective["resolvedMessageMode"],
    resolvedChain: row.resolved_chain ?? null,
    resolvedModel: row.resolved_model ?? null,
    status: expired ? "expired" : (row.status as LaunchDirective["status"]),
    refusalReason: row.refusal_reason as LaunchRefusalReason | null,
    agentId: row.agent_id,
    claimedAt: row.claimed_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
