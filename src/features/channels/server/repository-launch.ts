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
  /** ⚠ `launch` on every row written before 2026-09-01 and on every row that
   *  names no kind — the column's DEFAULT, which is what made the widening a
   *  no-backfill change. */
  kind: string;
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
  /**
   * WHICH AGENT an `end` / `rename` acts on — an INPUT (2026-09-01).
   *
   * ⚠ **NOT `agent_id`, WHICH IS THE OUTPUT A LAUNCH PRODUCED.** They are two
   * columns because they answer two questions — what this row aimed at, and what
   * it created — and a table that exists to be read back as a record of what was
   * asked cannot afford to lose the difference.
   */
  target_agent_id: string | null;
  /** The rename's new display name. ⚠ Non-null iff `kind = 'rename'`, and `''`
   *  is LEGAL there: it means CLEAR, back to `Agent #<id>`. */
  target_name: string | null;
  /**
   * THE POSTURE COLUMNS (2026-09-01, T24 and `set_agent_mode`).
   *
   * ⚠ **`start_*` / `chain` BELONG TO A LAUNCH, `target_*` TO A
   * `set_agent_mode`, AND THE COLUMN CHECK KEEPS THEM APART.** One names the
   * posture a NEW session starts on, the other the posture a RUNNING one moves
   * to; a row carrying both would be answered by whichever lane read it first.
   * ⚠ **EVERY ONE OF THEM IS A REQUEST AND NONE IS A GRANT.** The machine clamps
   * to the operator's own stored ceiling; nothing in this repository enforces
   * that and nothing can.
   * ⚠ `?` ON THE READ SIDE TOO — a payload cached against an older PostgREST
   * schema arrives without them, which is why the mapper defaults rather than
   * reads (INVARIANTS: the stale-cache field rule).
   */
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  chain?: boolean | null;
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  /**
   * **THE ECHO TRIO — what the machine SAYS it applied, after its clamp.**
   *
   * ⚠ **THE WRITER IS THE DECIDE AND NOTHING ELSE** (2026-09-01, T24's second
   * half): `main/launch-directive-wire.js › decideBody` puts the three values on
   * the `launched` body and `service-launch.ts › decideLaunchDirective` maps them
   * onto these columns. {@link LaunchDirectiveInsert} still has no field for
   * them, deliberately — see there.
   * ⚠ **NULL MEANS "NOT REPORTED".** Not "unclamped", and never the requested
   * value echoed back. It is the live value on every row written before this wave
   * AND on every row decided by a desktop older than it (INVARIANTS §13 — an
   * older peer is supported), which is why the render must keep saying `not
   * reported` rather than guessing (`channel-ops-launch.ts › postureFacts`).
   */
  applied_tool_mode?: string | null;
  applied_message_mode?: string | null;
  applied_chain?: boolean | null;
  /**
   * **THE SERVER'S RESOLVED POSTURE — the request clamped to the channel's
   * stored ceiling, decided at CREATION** (2026-09-02, A9 — G6/G7/G8).
   *
   * ⚠ **THREE GROUPS ON ONE TABLE AND THEY ARE NOT INTERCHANGEABLE**:
   * `start_*`/`chain` is what was ASKED, `applied_*` is what the MACHINE says it
   * did, and this is what the SERVER permitted. Reading one as another is the
   * defect the migration's section 3 exists to prevent.
   * ⚠ `?` for the same stale-cache reason as the two groups above.
   * ⚠ `resolved_model` is `null` for a model this server does not recognise, and
   * that is NOT a refusal — the requested value is carried to the machine
   * unchanged. See `lib/agent-models.ts › resolveAgentModelId`.
   */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  status: string;
  refusal_reason: string | null;
  agent_id: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
  /**
   * THE CALLER'S IDEMPOTENCY KEY (2026-09-02, A10/G10).
   *
   * ⚠ `?` LIKE THE POSTURE COLUMNS ABOVE — a payload cached against an older
   * PostgREST schema arrives without the key at all, so every reader defaults
   * rather than reads (INVARIANTS: the stale-cache field rule).
   * ⚠ NOT ON THE DTO. It is the CALLER'S OWN string, echoed back to nobody: the
   * result reports WHETHER the row was already there (`existing`), which is the
   * fact a retry needs, not the key it just sent.
   */
  client_msg_id?: string | null;
};

/** What a create supplies. ⚠ `operator_user_id` is ABSENT ON PURPOSE — it is a
 *  separate argument so no caller can pass one inside an object it built from a
 *  request body. Same discipline as `SessionStateUpsert`. */
export type LaunchDirectiveInsert = {
  /** ⚠ OMITTED MEANS `launch`, by the column's DEFAULT — so the launch path did
   *  not have to learn a new field when the agent-management kinds landed. */
  kind?: "launch" | "end" | "rename" | "set_agent_mode";
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
  /**
   * ⚠ CALLER-SUPPLIED, LIKE `template_id` AND FOR THE SAME REASON THAT IS SAFE:
   * it names WHAT the verb acts on, never WHOSE MACHINE acts. The authorization
   * story is `operator_user_id`, which is a separate ARGUMENT precisely so no
   * caller can pass one inside an object built from a request body.
   * ⚠ Absent on a launch. The column CHECK requires it on every other kind, so
   * an end filed without one is refused AT REST rather than claimed and left
   * unanswerable.
   */
  target_agent_id?: string | null;
  /** The rename's new display name. ⚠ `''` is legal and means CLEAR; absent on
   *  every kind but `rename`, which the column CHECK enforces both ways. */
  target_name?: string | null;
  /**
   * THE POSTURE A LAUNCH **ASKS** ITS NEW SESSION TO START ON, and whether it may
   * launch workers (2026-09-01, T24).
   *
   * ⚠ CALLER-SUPPLIED, like `template_id` and safe for the same reason: they name
   * HOW MUCH ROOM the work gets, never WHOSE MACHINE runs it. The authorization
   * story is `operator_user_id`, which is a separate ARGUMENT precisely so no
   * caller can pass one inside an object built from a request body.
   * ⚠ **AND NEITHER GRANTS ANYTHING.** The operator's machine clamps both axes to
   * that operator's own stored ceiling and REFUSES a chain the channel forbids.
   * ⚠ Absent on every kind but `launch`; the column CHECK enforces that at rest.
   */
  start_tool_mode?: string | null;
  start_message_mode?: string | null;
  /**
   * ⚠ **A TRUE TRI-STATE, AND ALL THREE VALUES ARE HONOURED** (fixed
   * 2026-09-01). `true` ASKS IT ON and is REFUSED where the channel forbids it;
   * `false` ASKS IT OFF, is always granted, and WINS over a channel set to ON;
   * ABSENT/`null` did not ask and inherits the channel setting.
   * ⚠ This said `false` was indistinguishable from `null` on the desktop, which
   * was true while `main/launch-directive-wire.js › directiveFrom` flattened it.
   * It no longer does — see `types-launch.ts › LaunchDirective.chain`.
   */
  chain?: boolean | null;
  /**
   * THE POSTURE A `set_agent_mode` ASKS A **RUNNING** AGENT TO MOVE TO.
   *
   * ⚠ AT LEAST ONE OF THE TWO IS REQUIRED ON THAT KIND — the column CHECK, so a
   * directive asking for nothing is refused AT REST rather than claimed and left
   * unanswerable — and BOTH are absent on every other kind.
   * ⚠ **NOT MERGED WITH `start_*`.** A `set_agent_mode` answered by a launch's
   * fields is the confusion two column pairs exist to make impossible.
   */
  target_tool_mode?: string | null;
  target_message_mode?: string | null;
  expires_at: string;
  /**
   * THE CALLER'S IDEMPOTENCY KEY, VERBATIM (2026-09-02, A10/G10).
   *
   * ⚠ CALLER-SUPPLIED, like `template_id`, and safe for the same reason: it names
   * WHICH GESTURE this row is, never WHOSE MACHINE runs it. The authorization
   * story is `operator_user_id`, a separate ARGUMENT precisely so no caller can
   * pass one inside an object built from a request body — and that column is also
   * the SCOPE of the unique index, so one member's key cannot pre-claim another's
   * (`20260911120000_launch_direction_client_msg_id.sql`).
   * ⚠ ABSENT IS THE ORDINARY CASE and dedupes nothing: the index is partial.
   */
  client_msg_id?: string | null;
  /**
   * **THE SERVER'S RESOLVED POSTURE** (2026-09-02, A9 — G6/G7/G8), and it is the
   * one posture group on this table the CREATE writes.
   *
   * ⚠ **NOT CALLER-SUPPLIED, unlike `start_*` beside it.** `service-launch.ts`
   * computes these from the request AND `channels.agent_*_ceiling`; a caller that
   * could pass one would be writing its own clamp. The type cannot enforce that
   * (the object is built in one place), so the rule is stated where it is
   * computed and pinned by `service-launch-posture.test.ts`.
   * ⚠ **AND THEY ARE NOT `applied_*`.** That trio is the MACHINE's report and
   * still has no writer; this is what the SERVER permitted. See
   * `20260912120000_channel_delivery_verdict.sql` section 3, which states all
   * three groups together.
   */
  resolved_tool_mode?: string | null;
  resolved_message_mode?: string | null;
  resolved_chain?: boolean | null;
  resolved_model?: string | null;
  /**
   * ⚠ **THE ECHO TRIO IS DELIBERATELY NOT WRITABLE FROM HERE.** It is the
   * MACHINE's report of what it applied, so its writer is the DECIDE, not the
   * CREATE ({@link LaunchDecision} carries the three fields as of 2026-09-01). A
   * create that could stamp `applied_*` would let the requester write its own
   * confirmation, which is the one value on this row that must not come from the
   * asking side.
   */
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
 * **THE IDEMPOTENCY PROBE** — the directive this operator already filed in this
 * channel under this key, or `null` (2026-09-02, A10/G10).
 *
 * ⚠ **THE PREDICATE SET IS THE INDEX**, `(channel_id, operator_user_id,
 * client_msg_id)`, and the three must stay together. Dropping
 * `operator_user_id` would answer with another member's row — the
 * `20260822120000` attack, where a guessable key let one member pre-claim
 * another's write; dropping `channel_id` would let a key minted for one room
 * converge onto a directive filed in a different one.
 *
 * ⚠ NO `status` FILTER, DELIBERATELY. A retry must converge on the stored row
 * whatever became of it — pending, launched, refused or long expired. Filtering
 * to live rows would let a retry file a SECOND directive the moment the first
 * one lapsed, which is the exact outcome the key exists to make impossible.
 */
export async function findLaunchDirectiveByClientMsgId(
  operatorUserId: string,
  channelId: string,
  clientMsgId: string
): Promise<LaunchDirectiveRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("channel_id", channelId)
    .eq("operator_user_id", operatorUserId)
    .eq("client_msg_id", clientMsgId)
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
  /** ⚠ `done` IS THE NON-LAUNCH KINDS' SUCCESS (2026-09-01) and carries no agent
   *  id: an end and a rename already NAME their target in the row. See
   *  `types-launch.ts › LaunchDirective.status` for why it is not `launched`. */
  status: "launched" | "done" | "refused";
  agent_id: string | null;
  refusal_reason: string | null;
  /**
   * **THE ECHO TRIO, AND THE DECIDE IS ITS ONLY WRITER** (2026-09-01).
   *
   * ⚠ **DELIBERATELY ABSENT FROM {@link LaunchDirectiveInsert} AND IT MUST STAY
   * SO.** These are the MACHINE's report of what it applied after its clamp, so
   * the writer is the DECIDE. A create that could stamp them would let the
   * requester write its own confirmation — the one value on this row that must
   * not come from the asking side.
   * ⚠ **`null` IS "NOT REPORTED", NOT "UNCLAMPED", AND NEVER THE REQUESTED VALUE
   * ECHOED BACK.** An older desktop sends no such fields
   * (`main/launch-directive-wire.js › decideBody` omits them), the service maps
   * absent to `null`, and the render says `not reported`.
   */
  applied_tool_mode: string | null;
  applied_message_mode: string | null;
  applied_chain: boolean | null;
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
