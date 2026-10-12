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
/** The projection {@link agentNameAndColor} reads, and the type that goes with it. ⚠ Keep the two
 *  in step; the pair travels to `sessionRowsWhere` together (`repository-sessions.ts ›
 *  AGENT_NAME_COLS` makes the same bargain). */
const AGENT_FACE_COLS = "name,display_name,color";
type AgentFaceRow = { name: string; display_name: string | null; color: string | null };

/**
 * **AN AGENT ID → ITS OPERATOR'S NAME FOR IT *AND* ITS IDENTITY COLOUR, IN ONE READ**
 * (2026-10-12 — the inbound banner's colour).
 *
 * ⚠ **ONE QUERY FOR THE PAIR, BECAUSE THE MESSAGE READ PATH NEEDS BOTH FOR EVERY ROW ON A PAGE.**
 * `hydrateMessages` resolves an author agent's name already (`service-shared.ts › agentNamesFor`);
 * asking a second time for the colour would put two reads of one table on every channel read and
 * two chances to disagree about one agent inside one rendered row — {@link agentFacets}' argument,
 * applied to the message page instead of the mentions inbox.
 *
 * ⚠ **IT IS PROJECTED, UNLIKE {@link agentFacets}, AND THAT IS DELIBERATE.** This runs on the hot
 * read (every page, every long-poll tick), so it reads three columns rather than whole session rows
 * — `repository-sessions.ts › agentDisplayNames`' 2026-10-10 lesson, which replaced a `*` over up
 * to 500 rows with the two columns it actually wanted.
 *
 * ⚠ **THE NAME RULE IS `agentDisplayNames`' EXACTLY, AND THE COLOUR RULE IS NOT.** A row with a
 * BLANK name is skipped for the name (so an older row that HAS one still answers — the behaviour
 * the read path has shipped with), while the colour takes newest-row-wins on its own. Keeping them
 * on one loop with one rule each is why this is not two functions: an agent renamed on one machine
 * and coloured on another must not lose either fact.
 *
 * ⚠ **THE COLOUR IS RETURNED AS THE RAW COLUMN, NEVER NARROWED HERE.** `lib/agent-colors.ts ›
 * agentColorOrNull` is the one membership test, and it runs at the DTO boundary: a seventeenth key
 * from a newer desktop must read as "no colour" at exactly one place.
 *
 * ⚠ **WORKSPACE-FENCED AND NEWEST-ROW-WINS**, {@link agentFacets}' reasons unchanged.
 */
export async function agentNameAndColor(
  workspaceIds: readonly string[],
  agentIds: readonly string[]
): Promise<{ names: Map<string, string>; colors: Map<string, string> }> {
  const names = new Map<string, string>();
  const colors = new Map<string, string>();
  if (workspaceIds.length === 0 || agentIds.length === 0) return { names, colors };
  const rows = await sessionRowsWhere<AgentFaceRow>(
    (q) => q.in("workspace_id", [...workspaceIds]).in("name", [...agentIds]),
    AGENT_FACE_COLS
  );
  for (const row of rows) {
    const name = row.display_name?.trim() ?? "";
    if (name.length > 0 && !names.has(row.name)) names.set(row.name, name);
    if (row.color && !colors.has(row.name)) colors.set(row.name, row.color);
  }
  return { names, colors };
}

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
