import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * DATA ACCESS FOR `channel_launch_directives` — the launch-over-MCP mailbox.
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT**, and not for
 * convenience: the table REVOKEs INSERT/UPDATE/DELETE from `authenticated` and
 * `anon` and carries no write policy at all, so there is no other way to write
 * it. That makes the `operatorUserId` argument THE ENTIRE FENCE on every
 * function below, and it comes from the authenticated context in
 * `service-launch.ts`. ⚠ **Never read an operator id out of a payload.**
 *
 * ⚠ THE CLAIM IS A COMPARE-AND-SWAP, AND IT IS THE ONLY CORRECTNESS MECHANISM
 * FOR THE MULTI-MACHINE CASE. An operator may be signed in on several desktops;
 * all of them see the same INSERT frame and all of them try. `UPDATE … WHERE id
 * = $1 AND status = 'pending' RETURNING *` is atomic in Postgres, so exactly one
 * wins and the losers get zero rows — which they must read as "somebody else has
 * it", never as an error. See {@link claimLaunchDirective}.
 */

/** One directive row. Column names, because this is what the database stores. */
export type LaunchDirectiveRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  operator_user_id: string;
  goal: string | null;
  model: string | null;
  /**
   * The agent template this directive asks to run AS, resolved under the
   * ORCHESTRATOR's visibility at create time (2026-08-23).
   *
   * ⚠ `ON DELETE SET NULL` — read it BESIDE `template_name`, never alone. A null
   * id with a live name is a template that was DELETED after the directive was
   * filed, and the desktop must REFUSE (`no-template`) rather than launch a
   * blank agent; a null id with a null name is a directive that named none.
   * Spec E-4, and the column comment in
   * `20260823140000_channel_launch_directives_template.sql`.
   */
  template_id: string | null;
  /** The template's name, SNAPSHOTTED AT CREATE. ⚠ Never joined, never
   *  refreshed — it is the only signal that survives the FK's SET NULL. */
  template_name: string | null;
  status: string;
  refusal_reason: string | null;
  agent_id: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
};

/** What a create supplies. ⚠ `operator_user_id` is ABSENT ON PURPOSE — it is a
 *  separate argument so no caller can pass one inside an object it built from a
 *  request body. Same discipline as `SessionStateUpsert`. */
export type LaunchDirectiveInsert = {
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  goal: string | null;
  model: string | null;
  /**
   * ⚠ CALLER-SUPPLIED, UNLIKE `operator_user_id`, AND THE DIFFERENCE IS THE
   * WHOLE REASON ONE IS AN ARGUMENT AND THE OTHER IS A FIELD. An operator id
   * names WHOSE MACHINE runs the agent and is therefore the authorization story;
   * a template id names WHAT IT WEARS and grants nothing. It is still not raw
   * caller input: the service resolves the caller's `template` ref through the
   * agent-templates visibility matrix and puts the RESOLVED row's id here, so a
   * template the caller cannot see has no spelling that reaches this type.
   */
  template_id: string | null;
  /** The resolved row's name, snapshotted. ⚠ Written together with
   *  `template_id` or not at all — the pair is what makes a later deletion
   *  legible (E-4). */
  template_name: string | null;
  expires_at: string;
};

const TABLE = "channel_launch_directives";

export async function insertLaunchDirective(
  operatorUserId: string,
  input: LaunchDirectiveInsert
): Promise<LaunchDirectiveRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    // ⚠ THE STAMP, and it is written LAST so it cannot be shadowed by a key in
    // `input`. `LaunchDirectiveInsert` has no such field, so this is belt on top
    // of a type that already refuses one.
    .insert({ ...input, operator_user_id: operatorUserId })
    .select("*")
    .single();
  if (error) throw error;
  return data as LaunchDirectiveRow;
}

/**
 * One directive, scoped to its operator.
 *
 * ⚠ THE `operator_user_id` PREDICATE IS NOT DECORATION: without it this is an
 * id-probe primitive for every directive in the deployment. Another user's
 * directive must be INVISIBLE (null), not forbidden — the same rule a private
 * channel follows, so existence never leaks.
 */
export async function findLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * **THE CLAIM CAS.** Move `pending → claimed`, atomically, for THIS operator.
 *
 * ⚠ RETURNS `null` WHEN THE ROW WAS NOT CLAIMABLE, AND THE CALLER MUST NOT TREAT
 * THAT AS AN ERROR. Three different situations produce it and the desktop lane
 * handles all three the same way — stand down:
 *   • another of this operator's machines claimed it first (the case this
 *     function exists for);
 *   • it was already decided;
 *   • it does not exist, or belongs to someone else (the `operator_user_id`
 *     predicate makes those indistinguishable, deliberately).
 *
 * ⚠ **THE PREDICATE SET IS THE WHOLE THING. Do not "simplify" it.** Dropping
 * `status = 'pending'` turns a CAS into a last-writer-wins UPDATE and every
 * signed-in machine launches an agent for one request. Dropping
 * `operator_user_id` lets any device token claim any operator's directive.
 *
 * ⚠ AN EXPIRED-BUT-PENDING ROW IS STILL CLAIMABLE HERE, and that is deliberate:
 * expiry is LAZY (no cron), so `status` alone cannot be trusted to have caught
 * up. The freshness judgement belongs in the service, which knows `now`, and
 * which refuses to hand an expired directive to the desktop. Putting a
 * `expires_at > now()` predicate here as well would make the CAS's failure mode
 * ambiguous — "lost the race" and "too late" would both be `null`.
 */
export async function claimLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  claimedAt: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .update({ status: "claimed", claimed_at: claimedAt })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/** What a terminal decision writes. */
export type LaunchDecision = {
  status: "launched" | "refused";
  agent_id: string | null;
  refusal_reason: string | null;
  decided_at: string;
};

/**
 * Write the terminal outcome. ⚠ ALSO A CAS: only a row this operator owns and
 * that has not already been decided may move, so a desktop that lost the claim
 * race cannot overwrite the winner's result, and a retried decide is idempotent
 * in the only direction that matters (the second one returns `null` rather than
 * flipping a `launched` to a `refused`).
 *
 * ⚠ `claimed` OR `pending` are both acceptable starting points. A desktop that
 * decides without claiming is not the designed flow, but refusing it would mean
 * a machine that crashed between claim and decide could never report — and the
 * honest outcome of "I started nothing" is worth more than protocol purity.
 */
export async function decideLaunchDirective(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  decision: LaunchDecision
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .update(decision)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .in("status", ["pending", "claimed"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as LaunchDirectiveRow | null) ?? null;
}

/**
 * **THE BREAKER-OPEN BACKSTOP READ** — every directive of THIS operator's that
 * is still awaiting a decision in this workspace (F-273, 2026-08-22).
 *
 * ⚠ WHY IT EXISTS AT ALL, given that realtime is the delivery path: a desktop
 * that was asleep, reconnecting, or whose subscription went unhealthy never sees
 * the INSERT frame. Without this read the directive simply expires and the
 * orchestrator is told nothing happened — which is TRUE but avoidable, and the
 * desktop already has the poll loop; what it lacked was a route. Its backstop
 * self-disabled on the 404 and said so in one log line.
 *
 * ⚠ `pending` AND `claimed`, not just `pending`. A machine that claimed and then
 * crashed before deciding must be able to find its own row again on restart;
 * excluding `claimed` would strand exactly the case a backstop is for. ⚠ Safe
 * because re-actioning is impossible: the CAS only moves a row out of `pending`,
 * so a second machine finding a `claimed` row can do nothing with it.
 *
 * ⚠ **EXPIRY IS NOT FILTERED HERE.** It is LAZY and lives at the service's read
 * (`toDirective`), so a `WHERE expires_at > now()` in this statement would be a
 * SECOND expiry rule — and the two would answer differently the moment one moved.
 * The service drops expired rows from what it returns.
 *
 * ⚠ BOUNDED: a poll that silently truncated would make the backstop's own
 * failure invisible. The bound is far above any real fan-out (a directive lives
 * two minutes).
 */
const PENDING_DIRECTIVE_LIMIT = 100;

export async function listPendingLaunchDirectives(
  operatorUserId: string,
  workspaceId: string
): Promise<LaunchDirectiveRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    // ⚠ THE FENCE. Same predicate as every other function here, and for the same
    // reason: this runs on the admin client, so the argument IS the security.
    .eq("operator_user_id", operatorUserId)
    .in("status", ["pending", "claimed"])
    .order("created_at", { ascending: true })
    .limit(PENDING_DIRECTIVE_LIMIT);
  if (error) throw error;
  return (data ?? []) as LaunchDirectiveRow[];
}
