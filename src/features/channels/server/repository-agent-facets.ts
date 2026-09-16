import "server-only";
import { sessionRowsWhere } from "./repository-sessions";

/**
 * ONE AGENT ID → WHAT IT LOOKS LIKE RIGHT NOW.
 *
 * ⚠ **ITS OWN FILE BECAUSE `repository-sessions.ts` IS AT THE 500-LINE CAP**, the
 * same split `repository-session-colors.ts` already made out of it. It is a leaf:
 * it borrows that file's ONE fenced, ordered, bounded read
 * (`sessionRowsWhere`) rather than opening a second query shape against
 * `channel_sessions`, so the workspace fence and the `updated_at DESC` order are
 * stated once and inherited here.
 */

/**
 * **WHAT AN AGENT ID LOOKS LIKE RIGHT NOW** — its operator's name for it, its
 * identity colour, and whether it is still LIVE (2026-09-15, the Mentions row).
 *
 * ⚠ **ONE QUERY FOR THREE FACTS, BECAUSE THE ROW NEEDS ALL THREE AT ONCE.** The
 * inbox names the agent, tints its dot with that agent's colour, and drops rows
 * whose agent has ended — three reads of one table would be three chances to
 * disagree about one agent within a single rendered row.
 *
 * ⚠ **ABSENCE IS THE ENDING, AND THAT IS THE TABLE'S OWN DESIGN.**
 * `channel_sessions` is a projection of live desktop registries —
 * `main/session-state-push.js › liveForWire` DROPS ended rows before they are
 * sent — so an agent that has ended has no row here at all. A `state` of
 * `"ended"` on a row that has not yet been swept means the same thing, so both
 * answer `live: false`. ⚠ It follows that "no row" cannot distinguish an ENDED
 * agent from one that never reported; the caller must only act on this for an id
 * it has already established IS an agent (INVARIANTS §11 — unknown is not empty).
 *
 * ⚠ **WORKSPACE-FENCED AND NEWEST-ROW-WINS**, both for {@link agentDisplayNames}'
 * reasons: an unfenced read over `name` would answer from tenancies the caller
 * never proved, and an agent id is a per-machine mint rather than a database key.
 */
export async function agentFacets(
  workspaceIds: readonly string[],
  agentIds: readonly string[]
): Promise<Map<string, { displayName: string | null; color: string | null; live: boolean }>> {
  const out = new Map<string, { displayName: string | null; color: string | null; live: boolean }>();
  if (workspaceIds.length === 0 || agentIds.length === 0) return out;
  const rows = await sessionRowsWhere((q) =>
    q.in("workspace_id", [...workspaceIds]).in("name", [...agentIds])
  );
  for (const row of rows) {
    if (out.has(row.name)) continue; // newest wins; `sessionRowsWhere` orders updated_at DESC
    const name = row.display_name?.trim() ?? "";
    out.set(row.name, {
      displayName: name.length === 0 ? null : name,
      color: row.color ?? null,
      live: row.state !== "ended",
    });
  }
  return out;
}
