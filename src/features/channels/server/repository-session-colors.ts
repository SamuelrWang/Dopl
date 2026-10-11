import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import { LAUNCH_DIRECTIVES_TABLE } from "./repository-launch";
import { selectTolerant } from "./color-shared-compat";
import { isMissingRelation } from "./repository-sessions";
import { liveColorClaim, resolveReportedColors } from "./session-colors";
import type { ChannelColorClaims, ForeignColorsByChannel } from "./session-colors";
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
type ColorRow = {
  channel_id: string;
  color: string | null;
  state: string;
  color_shared: boolean | null;
};

/** ⚠ The same bound `repository-sessions.ts › SESSION_ROWS_LIMIT` states and for the
 *  same reason: PostgREST truncates an unlimited select SILENTLY, and a truncated
 *  taken set would hand out a colour somebody already holds. Deliberately a SECOND
 *  constant rather than an import — this read spans channels and members, so its
 *  headroom is a different product (the agent ceiling × the roster × the channels one
 *  push touches) and tying the two numbers together would mean tuning one for the
 *  other's shape.
 *
 *  🔒 **AND IT WAS NEVER THE BOUND IN FORCE (Samuel #2935, the `max_rows` sweep).**
 *  `supabase/config.toml › max_rows` ({@link POSTGREST_MAX_ROWS}) clips every select
 *  server-side and raises NOTHING, so both reads below asked 2,000 and were answered
 *  1,000 — and the sentence above says exactly what that costs: **a truncated taken
 *  set hands out a colour somebody already holds.** Not a short list; a 23505 on the
 *  push that follows, or two members wearing one key. Both reads now reach this
 *  ceiling a page at a time ({@link readAllPages}) instead of asking for it in one
 *  statement the server declines. */
const COLOR_ROWS_LIMIT = 2000;

/**
 * 🔒 **A TAKEN SET THAT SAYS WHETHER IT IS THE WHOLE TAKEN SET.**
 *
 * ⚠ **PAGING MOVED THE CEILING 1,000 → 2,000; IT DID NOT CLOSE THE FAILURE THE
 * CONSTANT ABOVE DESCRIBES.** At the hard cap the walk still stops, and the cost
 * is the one already written down: *"a truncated taken set hands out a colour
 * somebody already holds"* — a 23505 on the push that follows, or two members
 * wearing one key. Both walks below computed `truncated` and DISCARDED it, so the
 * one consumer able to act on it could not see it.
 *
 * ⚠ **THE MARKER RIDES THE COLLECTION** rather than wrapping it, because
 * `service-launch-color.ts` and `session-colors.ts › ForeignColorsByChannel` are
 * outside this change's reach; an optional, NON-ENUMERABLE property leaves every
 * `.get()`/`.size` caller and every `mockResolvedValue(new Map())` untouched. Same
 * trade, same reasoning, as `repository-members.ts › MemberCounts`.
 */
export type ForeignColorsResult = ForeignColorsByChannel & {
  truncated?: boolean;
};

/** {@link pendingDirectiveColors}' rows, with the same clip marker riding them. */
export type DirectiveColors = Array<{
  color: string | null;
  expires_at: string;
}> & { truncated?: boolean };

/** Attach a walk's `truncated` to the collection it describes, invisibly to
 *  enumeration — so `Object.keys`, `JSON.stringify` and a `toEqual` deep-compare
 *  see the Map or the array they always saw. ⚠ Its proper home is
 *  `shared/supabase/max-rows.ts` beside {@link readAllPages}; local until that
 *  module is opened. */
function clipMarker<T extends object>(value: T, truncated: boolean): T {
  Object.defineProperty(value, "truncated", {
    value: truncated,
    enumerable: false,
  });
  return value;
}

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
): Promise<ForeignColorsResult> {
  const unique = [...new Set(channelIds.filter(Boolean))];
  // ⚠ NO QUERY FOR NO CHANNELS. `.in("channel_id", [])` is a legal statement that
  // matches nothing, so this is a round trip saved rather than a bug avoided — but
  // the push fires on every state change and an empty set is a real shape (a machine
  // reporting that it now runs nothing).
  // ⚠ COMPLETE, not merely empty: a machine reporting that it runs nothing has a
  // whole taken set of nothing, so the marker is `false` and the push lane below
  // is free to pick.
  if (unique.length === 0) return clipMarker(new Map(), false);

  // ⚠ **PAGED, NOT `.limit(COLOR_ROWS_LIMIT)` (Samuel #2935)** — see the constant. The
  // answer is a per-channel SET of keys, so nothing can be folded in SQL: the rows have
  // to arrive, and before this they arrived 1,000 at a time out of an ask for 2,000.
  // ⚠ **THE ORDER IS NEW AND TOTAL.** This read had NO `ORDER BY` — fine for one
  // statement whose result goes into a map, and the worst case for a page walk, which
  // PostgREST may answer in any permutation per page. `channel_sessions.id` is the
  // PRIMARY KEY, so it is a total order by itself; it is ORDERED ON AND NEVER SELECTED
  // (ORDER BY reaches any column of the relation), so the two-column projection this
  // module's header argues for is untouched.
  try {
    const { rows, truncated } = await readAllPages<ColorRow>(
      // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable; re-awaiting
      // one re-sends the first range and the walk spins on page 0.
      // ⚠ `selectTolerant` runs PER PAGE and that costs nothing: it remembers a missing
      // `color_shared` for RECHECK_MS, so only the first page of an old database pays
      // the failed round trip. Tolerates a database without the column: every row then
      // reads as exclusive, which is exactly what that database holds.
      async (from, toInclusive) => {
        const { data, error } = await selectTolerant(
          "channel_id, color, state, color_shared",
          "channel_id, color, state",
          (columns) => {
            let query = supabaseAdmin()
              .from("channel_sessions")
              .select(columns)
              .eq("workspace_id", workspaceId)
              .in("channel_id", unique)
              // ⚠ THE NULLS ARE FILTERED IN SQL, not in JS: an uncoloured session is the
              // ordinary row and there may be hundreds of them, none of which can take a key.
              .not("color", "is", null);
            if (exceptUserId !== null) query = query.neq("user_id", exceptUserId);
            return query.order("id", { ascending: true }).range(from, toInclusive);
          }
        );
        return { data: (data ?? []) as unknown as ColorRow[], error };
      },
      // ⚠ The page size is the SERVER's ceiling — that is what makes a short page proof
      // of exhaustion rather than proof of a clip.
      { hardCap: COLOR_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
    );

    const byChannel = new Map<string, ChannelColorClaims>();
    for (const row of rows) {
      // ⚠ `liveColorClaim` rather than a local `state !== 'ended'` test: "live" is stated once,
      // in `session-colors.ts`, in the index predicate's own wording.
      const claim = liveColorClaim(row);
      if (!claim) continue;
      const claims = byChannel.get(row.channel_id) ?? { holders: new Map(), exclusive: new Set() };
      claims.holders.set(claim.key, (claims.holders.get(claim.key) ?? 0) + 1);
      if (!claim.shared) claims.exclusive.add(claim.key);
      byChannel.set(row.channel_id, claims);
    }
    // 🔒 **THE WALK'S OWN ANSWER, NOT `rows.length >= COLOR_ROWS_LIMIT`.** Only
    // the page loop knows whether it stopped on a short page (exhausted) or on the
    // `hardCap` (clipped), and the discarded flag was the whole gap.
    return clipMarker(byChannel, truncated);
  } catch (error) {
    // ⚠ **A `catch` NOW, NOT AN `error` BRANCH**, because the walk THROWS what a page
    // answered. Same narrowness: only "there is no such relation" degrades, and every
    // other failure still reaches the caller — an empty taken set conjured out of a
    // network error hands two members the same key.
    // ⚠ `truncated: false` and that is the HONEST reading, not a convenient one:
    // the column that would collide does not exist in this database, so "nothing
    // is holding a colour" is COMPLETE rather than clipped.
    if (isMissingRelation(error)) return clipMarker(new Map(), false);
    throw error;
  }
}

/**
 * **A COLOUR A LAUNCH HAS ALREADY SPOKEN FOR BUT NO SESSION IS WEARING YET** (2026-09-14).
 *
 * ⚠ **THE GAP THIS CLOSES IS THE ORDINARY CASE, NOT A RACE BETWEEN MEMBERS.** A directive is
 * filed, the operator's machine claims it, spawns, and only THEN does a `channel_sessions` row
 * carrying the key exist — seconds later. Until then {@link foreignLiveColorsByChannel} reports
 * that key as free, so an operator launching two agents back to back was offered (and could
 * explicitly pick) the SAME key for both, got no 409, and had the second one silently
 * substituted by the push lane — on the one lane whose whole contract is that it REFUSES rather
 * than substitutes (`server/errors.ts › AgentColorTakenError`).
 *
 * ⚠ **THE PREDICATE IS THE CLAIM LANE'S, NOT A NEW ONE**: `status IN ('pending','claimed')`,
 * exactly what `repository-launch.ts › listPendingLaunchDirectives` calls "still awaiting a
 * decision". A `claimed` row is a machine that has said it will run this launch, so its key is
 * MORE spoken for than a pending one, not less.
 *
 * ⚠ **EXPIRY IS NOT FILTERED HERE, AND THAT IS THE STANDING RULE RATHER THAN AN OMISSION.** It
 * is LAZY and lives at the SERVICE (`repository-launch.ts › listPendingLaunchDirectives` states
 * it: a `WHERE expires_at > now()` in a statement would be a SECOND expiry rule and the two
 * would drift). So this hands back `expires_at` and `service-launch-color.ts` drops the dead
 * rows — otherwise a refused or abandoned launch would hold a key hostage for the TTL.
 *
 * ⚠ **CHANNEL-WIDE AND MEMBER-BLIND, like the live read above**: uniqueness is cross-member by
 * ruling, so an operator-fenced read here would reinstate exactly the bug. Two columns, and the
 * answer crosses no audience boundary — a set of colour keys says nothing about whose machine.
 */
export async function pendingDirectiveColors(
  workspaceId: string,
  channelId: string
): Promise<DirectiveColors> {
  type DirectiveColorRow = { color: string | null; expires_at: string };
  // ⚠ **PAGED, like the live read above and for the same reason (Samuel #2935)**: the ask
  // was `COLOR_ROWS_LIMIT` and `max_rows` answered 1,000, so a clipped spoken-for set
  // reports a key as FREE and the claim lane hands it out twice — the exact gap this
  // function exists to close, re-opened by the ceiling it declared.
  // ⚠ **THE ORDER IS NEW AND TOTAL**: `id` is the directives table's PRIMARY KEY, ordered
  // on and never selected, so the two-column projection is unchanged. There was no
  // `ORDER BY` here either, and an unordered page walk may repeat and skip rows.
  try {
    const { rows, truncated } = await readAllPages<DirectiveColorRow>(
      // ⚠ A FRESH QUERY PER PAGE — one-shot thenable.
      async (from, toInclusive) => {
        const { data, error } = await supabaseAdmin()
          .from(LAUNCH_DIRECTIVES_TABLE)
          .select("color, expires_at")
          .eq("workspace_id", workspaceId)
          .eq("channel_id", channelId)
          .in("status", ["pending", "claimed"])
          // ⚠ NULLS FILTERED IN SQL: a directive that named none is the ordinary row and can hold
          // nothing. (It is never "no colour" — the create resolves the pick before the insert.)
          .not("color", "is", null)
          .order("id", { ascending: true })
          .range(from, toInclusive);
        return { data: (data ?? []) as unknown as DirectiveColorRow[], error };
      },
      { hardCap: COLOR_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
    );
    // ⚠ REPORTED, for the reason the live read reports it: a clipped spoken-for
    // set says a key is FREE and the claim lane hands it out twice — the exact gap
    // this function exists to close. ⚠ The REFUSAL on this lane belongs to
    // `service-launch-color.ts`, which resolves the pick; see this change's notes.
    return clipMarker(rows, truncated);
  } catch (error) {
    // ⚠ `[]` ON A MISSING RELATION, on {@link foreignLiveColorsByChannel}'s own argument: before
    // the migration the honest answer is "nothing is spoken for". Every other failure throws —
    // an empty set conjured out of a network error hands two agents one key.
    // ⚠ A `catch` rather than an `error` branch: the walk throws what a page answered.
    if (isMissingRelation(error)) return clipMarker([], false);
    throw error;
  }
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
 *
 * 🔒 **AND IT REFUSES THE PICK WHEN THE TAKEN SET IS A FLOOR (Samuel #2935).** At
 * {@link COLOR_ROWS_LIMIT} the walk stops, so a key held by a clipped-off row reads
 * as FREE — and granting it is the collision
 * `channel_sessions_channel_color_live_key` answers with 23505, which is the one
 * failure this whole lane is built to avoid.
 *
 * ⚠ **AN INCUMBENT IS KEPT; ONLY A *NEW* ASSIGNMENT IS REFUSED.** Rule 1 reads the
 * caller's OWN stored rows, which no clip can hide, and a colour that moves under
 * a running agent is the churn `session-colors.ts` rule 1 exists to prevent — so
 * the refusal is scoped to rows the resolver would hand a key it cannot vouch for.
 *
 * ⚠ **AND IT NULLS RATHER THAN THROWING OR GUESSING**, on
 * {@link withoutClaimedColors}' own argument: `null` means "no colour assigned",
 * the transcript draws the neutral box, and the NEXT push (a state change seconds
 * away) re-reads the set and assigns properly. Throwing here would 500 the push
 * route and discard every live session for that machine over a decoration.
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
  const resolved = resolveReportedColors({
    reported,
    storedColors: new Map(
      [...stored].map(([key, row]) => [
        key,
        { color: row.color ?? null, shared: row.color_shared === true },
      ])
    ),
    foreignColors,
  });
  if (foreignColors.truncated !== true) return resolved;
  return resolved.map((row) => {
    // ⚠ The incumbent is compared by VALUE, so a row whose resolver answer equals
    // what it already held is rule 1's keep and survives; anything else is a pick
    // made against a set we know to be short.
    const held = stored.get(row.session_key)?.color ?? null;
    if (row.color !== null && row.color === held) return row;
    return { ...row, color: null, color_shared: false };
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
export function withoutClaimedColors<T extends { color?: unknown; color_shared?: unknown }>(
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
  return rows.map((row) => ({ ...row, color: null, color_shared: false }));
}
