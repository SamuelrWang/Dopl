import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isMissingRelation } from "./repository-sessions";

/**
 * **WHO, IF ANYONE, IS REPORTING AN AGENT INSTANCE ID** — the cross-member fence
 * on the agent-management directive kinds (2026-09-01, Samuel's `end_agent` /
 * `rename_agent` ruling).
 *
 * ── ⚠ WHY THIS IS A SEPARATE FILE AND NOT A FUNCTION IN `repository-sessions.ts`
 *
 * Two reasons and each is sufficient. `repository-sessions.ts` measured 473 lines
 * on 2026-09-01 (§1's 500 cap), and — the real one — every read in that file is a
 * PROJECTION READ answering "what is this member running", bounded, ordered and
 * degrading to `[]`. This is an AUTHORIZATION READ answering one yes/no about one
 * id, and its degrade means the OPPOSITE thing (see below). Putting an
 * authorization predicate behind that file's shared `sessionRowsWhere` plumbing
 * would put two different stories behind one signature, which is the thing that
 * file's own header refuses to do with its two existing fences.
 *
 * ── ⚠ WHAT THIS CAN AND CANNOT PROVE, WHICH IS THE WHOLE DESIGN ──────────────
 *
 * `channel_sessions` is a ONE-WAY PROJECTION the desktop pushes
 * (`main/session-state-push.js`). A row's absence therefore means **nobody said
 * anything**, NOT that no such agent exists — `service-directions.ts ›
 * createAgentDirection` states the same limit at length and declines to validate
 * an agent id for exactly this reason. So:
 *
 *   • A row present and `user_id <> caller`  ⇒ **FOREIGN. Refuse.** This is a
 *     positive fact, and it is the one worth acting on: the caller named an id
 *     that somebody ELSE's machine is reporting.
 *   • A row present and `user_id = caller`   ⇒ own. Proceed.
 *   • NO ROW AT ALL                          ⇒ **PROCEED, deliberately.** The
 *     projection cannot say. The directive is filed against the CALLER'S OWN
 *     operator id — stamped from the authenticated context, never a parameter —
 *     so the only machine that will ever claim it is the caller's own, and that
 *     machine's registry holds only its own operator's sessions. An id that is
 *     not there is answered `no-session` by the one party that actually knows.
 *
 * ⚠ **THE STRUCTURAL FENCE IS `operator_user_id`, NOT THIS FUNCTION.** This is a
 * SECOND, EARLIER, FRIENDLIER refusal — it turns "your own machine says it has
 * never heard of that agent" into "that agent belongs to another member", which
 * is the sentence an orchestrator can act on. Deleting it would not open a hole;
 * it would degrade an error message. **Do not let a future reader mistake it for
 * the fence and relax the one that is.**
 *
 * ⚠ **IT IS NOT AN EXISTENCE ORACLE, AND THE `workspace_id` SCOPE IS WHY.** The
 * caller is already an authenticated member of this workspace and has already
 * proved membership of the CHANNEL the directive names (`service-launch.ts`'s
 * gate 1). Within that boundary the roster and `read_sessions` are readable
 * anyway, so "this id belongs to another member here" discloses nothing the
 * caller could not have read. A deployment-wide version of this query WOULD be an
 * oracle — hence the scope is a required argument rather than an option.
 */

/**
 * The owner of the most recently updated `channel_sessions` row reporting
 * `agentId` in this workspace, or `null` when nothing reports it.
 *
 * ⚠ **THE MISSING-RELATION DEGRADE ANSWERS `null`, AND THAT IS FAIL-OPEN ON
 * PURPOSE — the opposite direction from most degrades in this tree.** An absent
 * projection table is indistinguishable from a quiet one, and both mean "the
 * server cannot say". Failing CLOSED here would refuse every end and every rename
 * on any deployment where the projection is unavailable, i.e. it would break the
 * feature to enforce a check that was never the fence. Narrow as ever: one
 * PostgREST code; a permission error, a column mismatch, a dead connection and a
 * timeout all still THROW, because each means the answer is UNKNOWN in a way a
 * caller must hear about.
 *
 * ⚠ `name` IS THE AGENT ID COLUMN on this table — `channel-session-handle.ts ›
 * addressableHandle` tests the same `^[a-z][a-z0-9]{7}$` against it. It is not
 * the operator's DISPLAY name, which lives on one machine in
 * `main/agent-names.js` and reaches no server.
 */
export async function agentInstanceOwner(
  workspaceId: string,
  agentId: string
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_sessions")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("name", agentId)
    // ⚠ ORDERED AND LIMITED rather than `maybeSingle()`: one agent id can hold
    // rows for several threads over its life, and `maybeSingle` would THROW on
    // the perfectly ordinary case of two. The newest report is the current
    // owner, and every row for one instance id carries the same `user_id`
    // anyway — the ordering is what makes that assumption unnecessary.
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  const row = (data ?? [])[0] as { user_id?: string } | undefined;
  return row?.user_id ?? null;
}
