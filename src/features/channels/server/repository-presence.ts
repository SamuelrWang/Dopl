/**
 * Split out of `repository-collab.ts` (2026-10-11, 500-line cap) on
 * `repository-members.ts`' precedent: the `agent_presence` table's data access.
 * ⚠ `repository-collab.ts` RE-EXPORTS every name here, so the fourteen modules
 * doing `import * as collab from "./repository-collab"` are unchanged — and so is
 * `repository-presence.test.ts`, which already imported these from there.
 *
 * The cap was reached by the `max_rows` sweep (Samuel #2935): both scans below
 * stated a 5,000-row bound that `supabase/config.toml › max_rows` answered with
 * 1,000, silently, so each grew the paging walk and the argument for it.
 */
import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import { HttpError } from "@/shared/lib/http-error";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { AgentPresenceStatus, PresencePosture } from "../types";
import type { MemberPresence } from "./dto";
import type { PresenceRow } from "./collab-dto";

/**
 * ⚠ An explicit row ceiling. PostgREST truncates an un-limited select SILENTLY
 * against its own `max-rows`, so every read here states its bound.
 *
 * 🔒 **AND STATING ONE WAS NEVER ENOUGH (Samuel #2935).**
 * `supabase/config.toml › max_rows` ({@link POSTGREST_MAX_ROWS}) clips every
 * select SERVER-SIDE and raises nothing, so a `.limit()` ABOVE it is not a bound
 * at all — it is a request the server silently declines. Both scans below asked
 * 5,000 and were answered 1,000, with no error and no marker: a member of a big
 * workspace read as OFFLINE because their row fell past the clip. The ceiling
 * stays (it bounds a runaway walk and is still reported), but it is now reached a
 * page at a time through {@link readAllPages} rather than asked for in one
 * hopeful statement.
 */
const PRESENCE_ROWS_LIMIT = 5_000;

export async function upsertPresence(
  userId: string,
  workspaceId: string,
  status: AgentPresenceStatus
): Promise<PresenceRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .upsert(
      {
        user_id: userId,
        workspace_id: workspaceId,
        last_seen_at: new Date().toISOString(),
        status,
      },
      { onConflict: "user_id,workspace_id" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as PresenceRow;
}

/**
 * ⚠ `DerivedPresence` GONE 2026-08-20 — it was `dto.ts › MemberPresence`
 * declared a second time under another name.
 */
export type { MemberPresence } from "./dto";

/**
 * THE ONLINE RULE, IN ONE PLACE — fresh enough AND not explicitly away.
 *
 * ⚠ **`status !== "away"`, NEVER `status === "active"`** (2026-09-08). Older
 * desktops still send `'listening'`, so an allow-list would take every
 * pre-posture machine offline on deploy day; an unheard-of status reads as
 * PRESENT-if-fresh.
 *
 * ⚠ An unparseable or absent stamp reads OFFLINE — the fail-safe direction every
 * presence reader in this tree picks.
 */
function derivePresence(
  lastSeenAt: string | null | undefined,
  status: string | null | undefined,
  now: number = Date.now()
): MemberPresence {
  if (!lastSeenAt) return { online: false, lastSeenAt: null };
  const seenAt = Date.parse(lastSeenAt);
  if (Number.isNaN(seenAt)) return { online: false, lastSeenAt };
  const fresh = now - seenAt < PRESENCE_ONLINE_WINDOW_MS;
  return { online: fresh && status !== "away", lastSeenAt };
}

/**
 * The three columns both presence scans project. ⚠ Declared once so the two page
 * walks below cannot drift to different shapes off one table.
 */
type PresenceScanRow = {
  user_id: string;
  last_seen_at: string;
  status: string | null;
};

/**
 * Presence for every workspace member, keyed by user id, `online` derived
 * against PRESENCE_ONLINE_WINDOW_MS. One indexed query for the whole page.
 *
 * ⚠ **THE SERVER IS THE ONLY THING THAT DECIDES `online` SINCE 2026-09-08** — a
 * client cannot see `status`, so one re-deriving the boolean from `lastSeenAt`
 * alone cannot agree. `view-model.ts › isPresent` now returns THIS flag.
 *
 * ── 🔒 PAGED, BECAUSE THE ANSWER IS THE MAP ────────────────────────────────
 *
 * 🔒 **ONE INDEXED QUERY WAS A WRONG ANSWER PAST 1,000 MEMBERS, NOT A SLOW ONE
 * (Samuel #2935).** The ask was `.limit(PRESENCE_ROWS_LIMIT)` — 5,000 — and the
 * server answered 1,000, silently; every member whose row fell past the clip was
 * ABSENT from this map, and an absent key reads OFFLINE at every caller
 * (`view-model.ts › isPresent`). Nothing is summed here, so no aggregate helps:
 * the answer IS the per-member map, which is {@link readAllPages}'s case.
 *
 * ⚠ **THE ORDER IS NEW AND IT IS LOAD-BEARING.** This read had NO `ORDER BY` at
 * all, which was harmless for one statement (the rows go into a map) and is the
 * WORST case for a page walk: PostgREST promises no row order, so an unordered
 * second page may repeat page one's rows and never return the rest. `PRIMARY KEY
 * (user_id, workspace_id)` with `workspace_id` pinned by the `.eq` below leaves
 * `user_id` UNIQUE within this read, so it is a total order on its own.
 */
export async function presenceForWorkspace(
  workspaceId: string
): Promise<Map<string, MemberPresence>> {
  const db = supabaseAdmin();
  const { rows } = await readAllPages<PresenceScanRow>(
    // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
    // re-awaiting one re-sends the first range and the walk spins on page 0.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("agent_presence")
        .select("user_id, last_seen_at, status")
        .eq("workspace_id", workspaceId)
        .order("user_id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as PresenceScanRow[], error };
    },
    // ⚠ The page size is the SERVER's ceiling, which is what makes a short page
    // proof of exhaustion rather than proof of a clip.
    { hardCap: PRESENCE_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  const now = Date.now();
  const out = new Map<string, MemberPresence>();
  for (const row of rows) {
    out.set(row.user_id, derivePresence(row.last_seen_at, row.status, now));
  }
  return out;
}

/**
 * Presence across MANY containers in ONE statement — what `scope=account` needs,
 * since that read spans every container the caller belongs to (Wave 3, R-26).
 *
 * ⚠ **ONE `.in()`, NEVER A LOOP OVER `presenceForWorkspace`.** A per-container fan
 * is the shape §9 forbids, and the per-workspace heartbeat loop below is the
 * worked example of what it costs at 13+ containers.
 *
 * ⚠ **KEYED BY USER ID, so a member of N containers collapses to ONE entry** —
 * which is right: presence is a property of the PERSON's machine, not of a room.
 *
 * 🔒 ⚠ **THE FRESHEST STAMP WINS, AND "LAST ROW READ" WOULD NOT DO.** The rows
 * agree only while `upsertPresenceEverywhere` is the writer; the per-workspace
 * FALLBACK loop it replaced stamps them one at a time and is exactly what let tail
 * rows age past the online window. PostgREST promises no row order, so picking by
 * arrival would flip a member between online and offline across two identical
 * reads. `last_seen_at` is the only total order here, and taking its maximum is
 * also the honest one: the machine was up at the latest instant anything saw it.
 *
 * ── 🔒 PAGED, AND THIS READ MULTIPLIES ROWS BY CONTAINERS ──────────────────
 *
 * 🔒 **IT ASKED 5,000 AND WAS ANSWERED 1,000, SILENTLY (Samuel #2935).** One row
 * per (member × container) is the widest presence read in the tree — the very
 * shape `scope=account` exists for — so it reaches the clip FIRST, and reaching
 * it drops members out of the map entirely, where an absent key reads OFFLINE.
 * ⚠ Worse than the per-workspace read: a member present in container 13 but
 * clipped out of the page was reported offline *while their machine was awake*,
 * which is the same symptom the heartbeat fan-out below was rewritten to end.
 *
 * ⚠ **THE ORDER IS TOTAL ONLY WITH `workspace_id`, AND THAT IS THE WHOLE POINT
 * HERE.** `user_id` ALONE IS NOT UNIQUE in this read — a member of N containers
 * has N rows, which is exactly why the freshest-wins fold below exists. Ordering
 * by `user_id` and stopping there would let one member's rows straddle a page
 * boundary in an undefined order, so a page could repeat one of them and SKIP
 * another — and a skipped row is a lost maximum, which flips the member offline.
 * The tie-break runs down to `PRIMARY KEY (user_id, workspace_id)`.
 * ⚠ The order is NOT `last_seen_at`: the maximum is taken in JS, and paging on a
 * non-unique timestamp is the trap this paragraph describes.
 */
export async function presenceForWorkspaces(
  workspaceIds: string[]
): Promise<Map<string, MemberPresence>> {
  const out = new Map<string, MemberPresence>();
  if (workspaceIds.length === 0) return out;
  const db = supabaseAdmin();
  const { rows } = await readAllPages<PresenceScanRow>(
    // ⚠ A FRESH QUERY PER PAGE — the one-shot-thenable rule above.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("agent_presence")
        .select("user_id, last_seen_at, status")
        .in("workspace_id", workspaceIds)
        .order("user_id", { ascending: true })
        .order("workspace_id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as PresenceScanRow[], error };
    },
    { hardCap: PRESENCE_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  const now = Date.now();
  const freshest = new Map<string, { last_seen_at: string; status: string | null }>();
  for (const row of rows) {
    const held = freshest.get(row.user_id);
    if (
      held === undefined ||
      Date.parse(row.last_seen_at) > Date.parse(held.last_seen_at)
    ) {
      freshest.set(row.user_id, row);
    }
  }
  for (const [userId, row] of freshest) {
    out.set(userId, derivePresence(row.last_seen_at, row.status, now));
  }
  return out;
}

/**
 * ONE STATEMENT, EVERY CONTAINER — the user-scoped heartbeat (2026-09-08).
 *
 * ⚠ **THE PER-WORKSPACE LOOP DID NOT SCALE WITH MEMBERSHIP COUNT — the reported
 * bug.** Serial posts, 12 s timeout each, on a 30 s interval: an operator in 13+
 * containers overran the interval, the next tick was SKIPPED, and tail rows aged
 * past the online window while the machine was awake.
 *
 * ⚠ **THE RPC IS `SECURITY DEFINER` OVER A CALLER-SUPPLIED SUBJECT AND IS
 * SERVICE-ROLE-ONLY** (`20260930140000_presence_heartbeat_all.sql`). Reached
 * from here and nowhere else; `userId` is server-resolved by `withUserAuth`.
 *
 * ⚠ **A MISSING FUNCTION IS A 404, NOT A 500.** The migration is written-not-
 * applied (§12), and `main/presence-core.js` drops to the per-workspace loop on
 * 404 and on nothing else. The message check belts a PostgREST that ever stops
 * setting `PGRST202`.
 *
 * @returns the workspace ids stamped (possibly empty — an operator in zero
 *   containers is an ANSWER, not a failure).
 */
export async function upsertPresenceEverywhere(
  userId: string,
  status: PresencePosture
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("presence_heartbeat_all", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) {
    if (
      error.code === "PGRST202" ||
      /could not find the function/i.test(error.message ?? "")
    ) {
      throw new HttpError(
        404,
        "PRESENCE_HEARTBEAT_ALL_UNAVAILABLE",
        "presence_heartbeat_all is not deployed on this database"
      );
    }
    throw error;
  }
  return ((data ?? []) as Array<{ workspace_id: string }>).map(
    (row) => row.workspace_id
  );
}

/**
 * ONE MEMBER'S PRESENCE — the PK lookup, for the caller's OWN row.
 *
 * ⚠ **A SIBLING OF {@link presenceForWorkspace}, NOT A DUPLICATE, AND THE REASON
 * IS THE HOT PATH** (2026-08-23, F-294). The session render joins the CALLER'S
 * own presence on every returned `await` hold, so pulling `PRESENCE_ROWS_LIMIT`
 * rows to look at one of them is the wrong shape; this is the PRIMARY KEY.
 * ⚠ `service-launch.ts › operatorIsOnline` still reads the whole workspace — it
 * runs once per `launch_agent`, and re-pointing it needs its own measurement.
 *
 * ⚠ **THE WINDOW IS THE SAME CONSTANT.** A second liveness number would let the
 * roster call a member offline while the session surface said the machine was up.
 * ⚠ NO ROW, NO STAMP, OR AN UNREADABLE STAMP ALL READ AS OFFLINE. `null` here is
 * not "unknown" — UNKNOWN is the caller never calling this, read off an ABSENT key.
 */
export async function presenceForUser(
  userId: string,
  workspaceId: string
): Promise<MemberPresence | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("last_seen_at, status")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { last_seen_at: string; status: string | null } | null;
  if (!row?.last_seen_at) return null;
  // ⚠ THE SAME `derivePresence` THE WORKSPACE READ USES — a second copy of the
  // rule would let the two surfaces disagree about one machine (2026-09-08).
  return derivePresence(row.last_seen_at, row.status);
}
