import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isMissingRelation } from "./repository-sessions";
import { resolveReportedColors, takenColorsFromRows } from "./session-colors";
import type { ForeignColorsByChannel } from "./session-colors";
import type { SessionStateUpsert } from "./collab-dto";

/**
 * **WHICH COLOURS ARE ALREADY OUT IN A CHANNEL** — the read half of agent colours
 * (2026-09-13; `20261005120000_agent_session_colors.sql`).
 *
 * ⚠ **ITS OWN MODULE ON §1's SEAM, NOT BECAUSE `repository-sessions.ts` IS FULL.**
 * That file answers *what does a session read RETURN* — the audience fences, the row
 * bound, the missing-relation degrade — and it hands back whole `SessionStateRow`s.
 * This answers a different question with a different shape: *which of sixteen keys
 * are spoken for*, projected to two columns, and fenced by CHANNEL rather than by
 * audience. It moves when the colour rule moves and never when a fence does.
 *
 * ⚠ **TWO COLUMNS, NEVER `select("*")`.** The taken set is consulted on the PUSH
 * lane, which runs on every state change of every session on a machine; pulling the
 * wide row (fifteen operator-only columns included) to count sixteen strings would
 * put the whole projection through the wire for a decoration. It is also the one
 * read in this feature whose result crosses NO audience boundary at all — a set of
 * colour keys says nothing about anybody's machine — which is why it may be
 * channel-wide with no mapper behind it.
 */
type ColorRow = { channel_id: string; color: string | null; state: string };

/** ⚠ The same bound `repository-sessions.ts › SESSION_ROWS_LIMIT` states and for the
 *  same reason: PostgREST truncates an unlimited select SILENTLY, and a truncated
 *  taken set would hand out a colour somebody already holds. Deliberately a SECOND
 *  constant rather than an import — this read spans channels and members, so its
 *  headroom is a different product (the agent ceiling × the roster × the channels one
 *  push touches) and tying the two numbers together would mean tuning one for the
 *  other's shape. */
const COLOR_ROWS_LIMIT = 2000;

/**
 * Every colour held by a LIVE session in these channels, EXCLUDING the rows belonging
 * to `exceptUserId`.
 *
 * ⚠ **THE EXCLUSION IS WHAT MAKES A COLOUR STABLE.** The caller is about to replace
 * its own whole live set, so its own current rows are not competitors — counting them
 * would make each of the operator's own sessions see its OWN colour as taken and
 * reassign it on every single push, which is the churn `session-colors.ts` rule 1
 * exists to prevent. Pass `null` to count everybody (what a READ-ONLY surface wants).
 *
 * ⚠ **`[]` ON A MISSING RELATION, LIKE EVERY OTHER READ ON THIS TABLE.** Before the
 * migration is applied the honest answer is "nothing is holding a colour", which
 * resolves every session to `agent-01` and collides with nothing, because the column
 * that would collide does not exist. ⚠ Every OTHER failure still throws: an empty
 * taken set silently conjured out of a network error would hand two members the same
 * key and then 23505 the push that follows.
 *
 * ⚠ **A `Map` KEYED BY CHANNEL, BECAUSE ONE PUSH SPANS CHANNELS.** The wire payload
 * is workspace-scoped (`POST /api/channels/sessions`), while the uniqueness rule is
 * per channel — so a single flat set would refuse `agent-01` in room B because room A
 * has it.
 */
export async function foreignLiveColorsByChannel(
  workspaceId: string,
  channelIds: readonly string[],
  exceptUserId: string | null
): Promise<ForeignColorsByChannel> {
  const unique = [...new Set(channelIds.filter(Boolean))];
  // ⚠ NO QUERY FOR NO CHANNELS. `.in("channel_id", [])` is a legal statement that
  // matches nothing, so this is a round trip saved rather than a bug avoided — but
  // the push fires on every state change and an empty set is a real shape (a machine
  // reporting that it now runs nothing).
  if (unique.length === 0) return new Map();

  let query = supabaseAdmin()
    .from("channel_sessions")
    .select("channel_id, color, state")
    .eq("workspace_id", workspaceId)
    .in("channel_id", unique)
    // ⚠ THE NULLS ARE FILTERED IN SQL, not in JS: an uncoloured session is the
    // ordinary row and there may be hundreds of them, none of which can take a key.
    .not("color", "is", null)
    .limit(COLOR_ROWS_LIMIT);
  if (exceptUserId !== null) query = query.neq("user_id", exceptUserId);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) return new Map();
    throw error;
  }

  const byChannel = new Map<string, Set<string>>();
  for (const row of (data ?? []) as unknown as ColorRow[]) {
    const existing = byChannel.get(row.channel_id);
    // ⚠ `takenColorsFromRows` PER ROW rather than a local `state !== 'ended'` test:
    // "live" is stated once, in `session-colors.ts`, and it is the index predicate's
    // own wording. A second spelling here is how the read starts predicting a
    // constraint it no longer matches.
    const keys = takenColorsFromRows([row]);
    if (keys.size === 0) continue;
    if (existing) for (const key of keys) existing.add(key);
    else byChannel.set(row.channel_id, keys);
  }
  return byChannel;
}

/**
 * **THE PUSH LANE'S WHOLE COLOUR STEP, IN ONE CALL** — the taken-set read plus the
 * policy, so `repository-sessions.ts › replaceSessionStates` gains one line rather
 * than a paragraph (§1's cap; that file measured 487 after this).
 *
 * ⚠ **THE INCUMBENT VALUES ARE THE RECONCILE'S OWN SELECT, PASSED IN** — no second
 * read of the caller's rows. `stored` is the map that reconcile already built, which
 * is why this takes it rather than fetching: `color` is in `SESSION_DIFF_COLUMNS`
 * precisely so rule 1 has an input.
 */
export async function resolveColorsForPush(
  userId: string,
  workspaceId: string,
  reported: readonly SessionStateUpsert[],
  stored: ReadonlyMap<string, SessionStateUpsert>
): Promise<SessionStateUpsert[]> {
  const foreignColors = await foreignLiveColorsByChannel(
    workspaceId,
    reported.map((r) => r.channel_id),
    userId
  );
  return resolveReportedColors({
    reported,
    storedColors: new Map(
      [...stored].map(([key, row]) => [key, row.color ?? null])
    ),
    foreignColors,
  });
}

/** Postgres' unique-violation code. ⚠ Matched on the CODE, never the message. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * **THE LAST-RESORT DEGRADE: DROP THE COLOURS, KEEP THE PROJECTION.**
 *
 * ⚠ **IT SHOULD BE UNREACHABLE, AND IT EXISTS BECAUSE "SHOULD" IS NOT A GUARANTEE.**
 * {@link resolveColorsForPush} reads the taken set and then writes, so two machines
 * pushing into the same channel inside that window can both pass the read and only
 * one can pass the index. The alternative to this function is the failure the whole
 * push lane is designed around: the upsert throws, the route answers 500, the digest
 * is never recorded, and `read_sessions` answers `[]` for that machine until
 * something else changes — every live session lost to a decoration.
 *
 * ⚠ **IT REFUSES TO GUESS.** Returns the rows UNTOUCHED unless the error is a unique
 * violation naming THIS index, so a genuinely different constraint still reaches the
 * caller as a failure. The same rule `repository-sessions.ts › healDeadThreadRefs`
 * follows, and the reason both exist rather than one blanket try/catch.
 *
 * ⚠ **NULLING IS HONEST, GUESSING ANOTHER KEY IS NOT.** With the read already stale
 * there is no key this process can be sure of; `null` means "no colour assigned",
 * which the transcript draws as the neutral box, and the NEXT push (a state change
 * seconds away) re-reads the taken set and assigns properly.
 */
export function withoutClaimedColors<T extends { color?: unknown }>(
  rows: T[],
  error: unknown
): T[] {
  if (typeof error !== "object" || error === null) return rows;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code !== PG_UNIQUE_VIOLATION) return rows;
  // ⚠ THE INDEX NAME IS THE NARROWING, and it is read off the message because that is
  // the only place PostgREST puts it. A unique violation on `(user_id, session_key)`
  // is a DIFFERENT bug and must not be answered by discarding colours.
  if (!String(e.message ?? "").includes("channel_sessions_channel_color_live_key")) {
    return rows;
  }
  return rows.map((row) => ({ ...row, color: null }));
}
