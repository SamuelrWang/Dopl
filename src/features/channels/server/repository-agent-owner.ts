import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";
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
/**
 * WHO REPORTED AN AGENT ID, AND WHEN. ⚠ The stamp is not decoration: no caller
 * may refuse on this row without bounding its age (see
 * {@link agentIsAnotherMembers}).
 */
export type AgentInstanceOwner = {
  userId: string;
  /** `null` on a row a PostgREST projection returned without the column. */
  updatedAt: string | null;
};

export async function agentInstanceOwner(
  workspaceId: string,
  agentId: string
): Promise<AgentInstanceOwner | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_sessions")
    // ⚠ `updated_at` JOINED THE SELECT ON 2026-09-02 (A9 / F-418). A projection
    // row is only evidence while it is RECENT: the desktop pushes on state
    // change and never on a timer, so an old row says an agent was seen, not
    // that it is there. Every caller applies a freshness bound to this stamp
    // before refusing anything — see {@link AgentInstanceOwner.updatedAt}.
    .select("user_id, updated_at")
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
  const row = (data ?? [])[0] as
    | { user_id?: string; updated_at?: string }
    | undefined;
  if (!row?.user_id) return null;
  return { userId: row.user_id, updatedAt: row.updated_at ?? null };
}

/**
 * **IS THIS AGENT SOMEBODY ELSE'S, ON EVIDENCE RECENT ENOUGH TO SAY SO?**
 * (2026-09-02, A9 — guardrail G3, finding F-418.)
 *
 * ⚠ **IT REFUSES ONLY ON A POSITIVE, FRESH FACT, AND BOTH WORDS ARE
 * LOAD-BEARING.** Absence proves nothing — `channel_sessions` is a projection,
 * so silence means nobody reported — and F-418 states the trap in as many words:
 * intersecting an agent id with this table converts a benign `no-session` answer
 * into a hard 400 for every legitimate call sent while the push is behind, which
 * is the ORDINARY state in the seconds after a launch. A STALE row is the same
 * kind of nothing: it says an agent was seen, not that it is there, and by then
 * an id may have been recycled onto another machine.
 *
 * ⚠ **SO IT IS AN ERROR-MESSAGE IMPROVEMENT, NOT A FENCE**, exactly as
 * `service-launch-agent.ts › refuseForeignTarget` says of the same read: the
 * fence is `operator_user_id`, and only the caller's own machines ever claim a
 * row. Deleting this degrades a sentence; it opens nothing.
 */
export async function agentIsAnotherMembers(
  workspaceId: string,
  agentId: string,
  userId: string,
  now = Date.now()
): Promise<boolean> {
  const owner = await agentInstanceOwner(workspaceId, agentId);
  if (owner === null || owner.userId === userId) return false;
  const at = owner.updatedAt ? Date.parse(owner.updatedAt) : NaN;
  // ⚠ AN UNPARSEABLE OR ABSENT STAMP IS STALE, never fresh — the direction that
  // refuses LESS, which is the safe one for a check that is not the fence.
  if (Number.isNaN(at)) return false;
  return now - at < SESSION_PROJECTION_FRESH_MS;
}
