import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * DATA ACCESS FOR `channel_agent_directions` — the PRIVATE DIRECT LANE's mailbox.
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT**, and not for
 * convenience: the table REVOKEs INSERT/UPDATE/DELETE from `authenticated` and
 * `anon` and carries no write policy at all, so there is no other way to write
 * it. That makes the `operatorUserId` argument THE ENTIRE FENCE on every function
 * below, and it comes from the authenticated context in `service-directions.ts`.
 * ⚠ **Never read an operator id out of a payload.**
 *
 * ⚠ THE CLAIM IS A COMPARE-AND-SWAP, and it is the only correctness mechanism for
 * the multi-machine case: an operator may be signed in on several desktops, all
 * of them see the same INSERT frame, and all of them try. `UPDATE … WHERE id = $1
 * AND status = 'pending' RETURNING *` is atomic, so exactly one wins and the
 * losers get zero rows — which they must read as "somebody else has it", never as
 * an error.
 *
 * 🔒 **THE `reply` COLUMN MAKES THE FENCE MATTER MORE HERE THAN ON THE LAUNCH
 * MAILBOX.** A launch row leaks orchestration; a direction row carries a PRIVATE
 * TURN's answer. Every predicate below is what keeps it reaching one person.
 */

/** One direction row. Column names, because this is what the database stores. */
export type AgentDirectionRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  operator_user_id: string;
  /** ⚠ NOT NULL, unlike the launch mailbox's — a direction with no addressee
   *  would be a broadcast into somebody's private lane. */
  agent_id: string;
  /** ⚠ Nullable, and OPTIONAL on the type as well — a deployment where
   *  `20260904090000_direction_sender_agent.sql` has not replayed yet returns rows
   *  with no such key at all, and `toDirection`'s `?? null` is what makes that the
   *  same answer as "an external orchestrator sent it". */
  sender_agent_id?: string | null;
  body: string;
  status: string;
  refusal_reason: string | null;
  /** 🔒 The directed turn's FINAL TEXT and nothing else. `null` = not reported. */
  reply: string | null;
  claimed_at: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
};

/** What a create supplies. ⚠ `operator_user_id` is ABSENT ON PURPOSE — it is a
 *  separate argument so no caller can pass one inside an object it built from a
 *  request body. Same discipline as `LaunchDirectiveInsert`. */
export type AgentDirectionInsert = {
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  /** ⚠ CALLER-SUPPLIED, and it is an ADDRESS rather than an authorization: it
   *  names WHICH of the operator's own agents hears this, inside a machine the
   *  `operator_user_id` stamp has already fixed. A wrong id reaches nothing —
   *  the desktop resolves it against its own registry and answers `no-session`. */
  agent_id: string;
  /** ⚠ **UNVERIFIED ATTRIBUTION, AND IT IS NOT CALLER-SUPPLIED.** Which of the
   *  operator's own agent sessions filed this, derived by the SERVICE from the
   *  transport's `X-Dopl-Session-Id` — never from a request field, so the "no
   *  schema on this path accepts an identity" rule is intact. `null` for an
   *  external orchestrator, which has no session stamp. ⚠ NOTHING GATES ON IT
   *  (`types-direction.ts › AgentDirection.senderAgentId` carries the argument). */
  sender_agent_id: string | null;
  body: string;
  expires_at: string;
};

const TABLE = "channel_agent_directions";

export async function insertAgentDirection(
  operatorUserId: string,
  input: AgentDirectionInsert
): Promise<AgentDirectionRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    // ⚠ THE STAMP, written LAST so it cannot be shadowed by a key in `input`.
    // `AgentDirectionInsert` has no such field, so this is belt on top of a type
    // that already refuses one.
    .insert({ ...input, operator_user_id: operatorUserId })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentDirectionRow;
}

/**
 * One direction, scoped to its operator.
 *
 * ⚠ THE `operator_user_id` PREDICATE IS NOT DECORATION: without it this is an
 * id-probe primitive for every direction in the deployment — and here the probe
 * would return another operator's private turn text. Another user's direction
 * must be INVISIBLE (null), not forbidden, so existence never leaks.
 */
export async function findAgentDirection(
  operatorUserId: string,
  workspaceId: string,
  id: string
): Promise<AgentDirectionRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentDirectionRow | null) ?? null;
}

/**
 * **THE CLAIM CAS.** Move `pending → claimed`, atomically, for THIS operator.
 *
 * ⚠ RETURNS `null` WHEN THE ROW WAS NOT CLAIMABLE, AND THE CALLER MUST NOT TREAT
 * THAT AS AN ERROR — another of this operator's machines claimed it first, it was
 * already decided, or it does not exist / belongs to someone else (the
 * `operator_user_id` predicate makes those last two indistinguishable,
 * deliberately). The desktop lane handles all of them the same way: stand down.
 *
 * ⚠ **THE PREDICATE SET IS THE WHOLE THING. Do not "simplify" it.** Dropping
 * `status = 'pending'` turns a CAS into a last-writer-wins UPDATE and every
 * signed-in machine delivers the same direction into the same agent — which on
 * this lane means the agent is told the same thing N times and answers N times.
 * Dropping `operator_user_id` lets any device token claim any operator's
 * direction, and read its body.
 *
 * ⚠ AN EXPIRED-BUT-PENDING ROW IS STILL CLAIMABLE HERE, deliberately: expiry is
 * LAZY (no cron), so `status` alone cannot be trusted to have caught up. The
 * freshness judgement belongs in the service, which knows `now`. A
 * `expires_at > now()` predicate here would make the CAS's `null` ambiguous
 * between "lost the race" and "too late".
 */
export async function claimAgentDirection(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  claimedAt: string
): Promise<AgentDirectionRow | null> {
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
  return (data as AgentDirectionRow | null) ?? null;
}

/** What a terminal decision writes. */
export type AgentDirectionDecision = {
  status: "delivered" | "refused";
  refusal_reason: string | null;
  reply: string | null;
  decided_at: string;
};

/**
 * Write the terminal outcome. ⚠ ALSO A CAS: only a row this operator owns and
 * that has not already been decided may move, so a desktop that lost the claim
 * race cannot overwrite the winner's result, and a retried decide returns `null`
 * rather than flipping a `delivered` to a `refused`.
 *
 * ⚠ `claimed` OR `pending` are both acceptable starting points, for the launch
 * lane's reason: a machine that crashed between claim and decide must still be
 * able to report, and the honest outcome is worth more than protocol purity.
 *
 * 🔒 **THIS IS THE ONE WRITE THAT CARRIES PRIVATE TEXT.** `reply` is bounded and
 * charset-stripped on the DESKTOP before it is sent, and bounded again by the
 * column CHECK; neither this function nor the route may relax either, because the
 * whole justification for the column is that it carries exactly one turn's final
 * text and nothing else.
 */
export async function decideAgentDirection(
  operatorUserId: string,
  workspaceId: string,
  id: string,
  decision: AgentDirectionDecision
): Promise<AgentDirectionRow | null> {
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
  return (data as AgentDirectionRow | null) ?? null;
}

/**
 * **THE BREAKER-OPEN BACKSTOP READ** — every direction of THIS operator's that is
 * still awaiting a decision in this workspace.
 *
 * ⚠ `pending` AND `claimed`, not just `pending` — but READ THE NEXT SENTENCE BEFORE
 * RELYING ON IT. The launch lane returns both so a machine that claimed and then
 * crashed can find its own row again; **on THIS lane the desktop does not act on a
 * `claimed` row at all** (`main/agent-directions.js › handle` gate 2 refuses anything
 * not `pending`, on the realtime and poll paths alike), so the `claimed` arm is
 * currently dead here and such a row always lazy-expires.
 * ⚠ THAT IS THE HONEST OUTCOME RATHER THAN A GAP (adversarial review, 2026-08-31):
 * the turn's captured text died with the process, so a recovering machine has
 * nothing it could truthfully report. The wider arm is kept because the CAS makes
 * it harmless — only a row still `pending` can be claimed — and because a future
 * recovery path would want it. **It is not a promise the desktop keeps today.**
 *
 * ⚠ **EXPIRY IS NOT FILTERED HERE.** It is LAZY and lives at the service's read
 * (`toDirection`), so a `WHERE expires_at > now()` here would be a SECOND expiry
 * rule, and the two would answer differently the moment one moved.
 */
const PENDING_DIRECTION_LIMIT = 100;

export async function listPendingAgentDirections(
  operatorUserId: string,
  workspaceId: string
): Promise<AgentDirectionRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    // ⚠ THE FENCE. Same predicate as every other function here, same reason:
    // this runs on the admin client, so the argument IS the security.
    .eq("operator_user_id", operatorUserId)
    .in("status", ["pending", "claimed"])
    .order("created_at", { ascending: true })
    .limit(PENDING_DIRECTION_LIMIT);
  if (error) throw error;
  return (data ?? []) as AgentDirectionRow[];
}

/**
 * THE ORCHESTRATOR'S OWN RECENT DIRECTIONS — what `op="read_directions"` renders.
 *
 * ⚠ A DIFFERENT READ FROM THE BACKSTOP ABOVE, and not a widening of it: that one
 * answers "what does this MACHINE still owe an answer on" and is bounded to
 * non-terminal rows; this answers "what did I ask, and what came back", so it
 * must include the terminal ones — the `reply` is the whole point.
 * ⚠ SAME FENCE, unchanged. `channelId` and `agentId` are optional NARROWINGS on
 * top of it, never a way around it.
 */
const RECENT_DIRECTION_LIMIT = 50;

export async function listRecentAgentDirections(
  operatorUserId: string,
  workspaceId: string,
  filter: { channelId?: string; agentId?: string } = {}
): Promise<AgentDirectionRow[]> {
  const db = supabaseAdmin();
  let q = db
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("operator_user_id", operatorUserId);
  if (filter.channelId) q = q.eq("channel_id", filter.channelId);
  if (filter.agentId) q = q.eq("agent_id", filter.agentId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(RECENT_DIRECTION_LIMIT);
  if (error) throw error;
  return (data ?? []) as AgentDirectionRow[];
}
