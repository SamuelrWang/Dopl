/** Split out of `repository.ts` (2026-09-14, 500-line cap): the `channel_members` table's data access, on `repository-workspace.ts`'s precedent — `repository.ts` re-exports every name here, so `import * as repo from "./repository"` is unchanged. */
import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMemberRow } from "./dto";
import { walkChannelMembers } from "./repository-collab";

/**
 * A `Map` of counts THAT SAYS WHETHER IT IS COMPLETE — {@link memberCounts}'s
 * return, and the honest marker half of the #2935 fix.
 *
 * ⚠ **THE MARKER RIDES THE `Map` RATHER THAN WRAPPING IT, AND THAT IS A
 * COMPATIBILITY CHOICE, NOT A STYLE ONE.** The clean shape is
 * `Clipped<Map<string, number>>`, and it would rewrite `service-list.ts` and the
 * five suites that mock this function — a blast radius the surrounding change does
 * not own. An optional property on the Map leaves every `.get()` caller and every
 * `mockResolvedValue(new Map(...))` compiling while making the clip REACHABLE,
 * which is the whole complaint. ⚠ When the grouped SQL aggregate lands (see below)
 * the count is exact and this type goes with the walk.
 *
 * ⚠ **AND IT IS NON-ENUMERABLE** ({@link clipMarker}), so `Object.keys`, a
 * `JSON.stringify` and a `toEqual` deep-compare see the Map they always saw.
 */
export type MemberCounts = Map<string, number> & { truncated?: boolean };

/** Attach a read's `truncated` to the collection it describes, invisibly to
 *  enumeration. ⚠ Its proper home is `shared/supabase/max-rows.ts` beside
 *  {@link readAllPages}; it is local until that module is opened. */
function clipMarker<T extends object>(value: T, truncated: boolean): T {
  Object.defineProperty(value, "truncated", {
    value: truncated,
    enumerable: false,
  });
  return value;
}

/**
 * All channels in the workspace the caller belongs to (ids + role + read).
 *
 * 🔒 **PAGED (Samuel #2935).** It was an UNLIMITED select clipped at 1,000 rows
 * server-side with no error, and the caller builds the user's WHOLE CHANNEL LIST
 * from it (`service-list.ts › listChannels`, `service-workspace-departure.ts`) —
 * so a member of more than a thousand channels simply did not see the rest, and a
 * departure sweep silently skipped them.
 *
 * ⚠ **THE ORDER IS NEW AND TOTAL.** `PRIMARY KEY (channel_id, user_id)` with
 * `user_id` pinned by the `eq` above leaves `channel_id` unique WITHIN this
 * result, which is exactly what a page walk needs; an unordered one may list one
 * membership twice and drop another.
 */
export async function listMyMemberships(
  workspaceId: string,
  userId: string
): Promise<ChannelMemberRow[]> {
  const { rows } = await walkChannelMembers<ChannelMemberRow>("*", (q) =>
    q.eq("workspace_id", workspaceId).eq("user_id", userId).order("channel_id", { ascending: true })
  );
  return rows;
}

/**
 * ONE CHANNEL'S WHOLE ROSTER, oldest member first.
 *
 * 🔒 **PAGED, AND RECIPIENT RESOLUTION IS WHY (Samuel #2935).** It was an
 * UNLIMITED `select("*")` clipped at 1,000 rows server-side with no error, and its
 * consumers include ADDRESSING — `service-writes-metadata-recipient.ts` resolves
 * an `@`-tag against this list, `service-writes-metadata.ts` fans notifications
 * over it — so on a channel past a thousand members a real member read as
 * "no such recipient" rather than as an error.
 * ⚠ **THE CODEBASE ALREADY SAYS SUCH ROSTERS ARE EXPECTED**: this very change
 * pages `channel_members` TWICE at a 10,000 ceiling ({@link memberCounts} here and
 * `repository-collab.ts › channelMemberUserIds`), so a 1,000-row roster read was
 * the odd one out, not the realistic one.
 *
 * ⚠ **`joined_at` IS NOT UNIQUE, SO IT IS TIE-BROKEN BY `user_id`.** Two members
 * added in one transaction share a `joined_at` default of `now()`, and paging a
 * non-unique ORDER BY lets Postgres return one row twice and skip another. The
 * tie-break is appended rather than substituted, so the DISPLAY order the roster
 * already had is unchanged; `(channel_id, user_id)` is the PRIMARY KEY and
 * `channel_id` is pinned by the `eq`, so `(joined_at, user_id)` is unique here.
 */
export async function listMembers(
  channelId: string
): Promise<ChannelMemberRow[]> {
  const { rows } = await walkChannelMembers<ChannelMemberRow>("*", (q) =>
    q
      .eq("channel_id", channelId)
      .order("joined_at", { ascending: true })
      .order("user_id", { ascending: true })
  );
  return rows;
}

export async function findMembership(
  channelId: string,
  userId: string
): Promise<ChannelMemberRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMemberRow | null) ?? null;
}

/**
 * **ONE MEMBER'S "unaddressed messages" SETTING** (2026-09-06, Samuel's ruling on items 10
 * and 11) — the raw column, uncoerced.
 *
 * ⚠ **NARROW ON PURPOSE, ON `hasMembership`'S PRECEDENT.** {@link findMembership} would answer
 * this from its `select("*")`, and reusing it would be one fewer function — but this runs on
 * the MESSAGE-POSTING path (`service-wake-verdict.ts`, the RR3 branch), and that is the one
 * place a whole-row read for a single `TEXT` column is worth avoiding. The recheck above made
 * the same trade for the same reason.
 *
 * ⚠ **IT COERCES NOTHING.** The caller owns that
 * (`lib/agent-mentions.ts › normalizeUnaddressedResponder`), because the fail-safe direction is
 * a RULING — an unreadable value must land on the default and never on `"none"` — and a
 * repository that quietly applied its own default would be a second place that decision lives.
 *
 * ⚠ **`supabaseAdmin()` (service_role), WHOSE COLUMN GRANTS ARE UNTOUCHED** by
 * `20260928130000`'s deliberate omission of `authenticated` / `anon`. Grants are per-role; this
 * read is exactly why the column can stay private and still be usable.
 *
 * ⚠ A MISSING ROW ANSWERS `null` rather than throwing — see the caller for why a race between
 * the write and the verdict must not fail a post that is already stored.
 */
export async function findUnaddressedResponder(
  channelId: string,
  userId: string
): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("unaddressed_responder")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { unaddressed_responder?: string | null } | null;
  return row?.unaddressed_responder ?? null;
}

/**
 * Membership EXISTENCE only — the await hold's per-tick recheck.
 * {@link findMembership} returns the whole row and the recheck reads none of it.
 * ⚠ `maybeSingle()` kept so a duplicate row still surfaces as an error.
 */
export async function hasMembership(
  channelId: string,
  userId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Member counts for a set of channels, grouped in JS.
 *
 * ⚠ BOUND STATED, NOT INHERITED (2026-08-20). PostgREST truncates an un-limited
 * select SILENTLY, and this feeds `Channel.memberCount` — a clipped page is a
 * wrong number on every channel row, not a crash anyone would see.
 *
 * ── 🔒 STATING THE BOUND DID NOT APPLY IT (Samuel #2935) ───────────────────
 *
 * 🔒 **THE ASK WAS `CHANNEL_MEMBER_ROWS_LIMIT` (10,000) AND THE ANSWER WAS 1,000,
 * SILENTLY.** `supabase/config.toml › max_rows` ({@link POSTGREST_MAX_ROWS})
 * clips a select server-side and raises nothing, so the paragraph above described
 * the exact failure it was written to prevent: past a thousand membership rows
 * across one page, `memberCount` was simply WRONG — short on the channels whose
 * rows sorted last, and ZERO on the ones that fell off entirely. No error, no
 * marker, and a count is the one value a reader cannot sanity-check by eye.
 *
 * ⚠ **THIS IS A COUNT-BY-GROUP, SO THE END SHAPE IS `count` PER CHANNEL IN SQL,
 * NOT THIS WALK.** A hauled-and-folded count is the shape
 * `shared/supabase/max-rows.ts` names as the weaker one: it moves N rows to
 * compute one integer each. The grouped aggregate belongs in a migration and the
 * migration is not this change's to write (§12), so the walk is the INTERIM —
 * it makes the number correct up to the ceiling that was already declared here,
 * which the old single statement never reached. ⚠ When the aggregate lands, this
 * whole body is replaced; the ceiling and the fence are what carry over.
 *
 * ⚠ **THE ORDER IS NEW AND TOTAL — `channel_id, user_id` IS THE PRIMARY KEY.**
 * This read had no `ORDER BY`, which one statement can afford and a page walk
 * cannot: an unordered page may repeat rows the previous page already counted,
 * and a double-counted membership row is an INFLATED member count — the same
 * wrong number from the opposite direction.
 *
 * ── 🔒 AND THE WALK'S OWN `truncated` WAS THROWN AWAY ──────────────────────
 *
 * 🔒 **AT THE 10,000 HARD CAP EVERY CHANNEL'S COUNT IS WRONG AGAIN**, for the
 * same reason as before and one order of magnitude later: the walk returns
 * `{ rows, truncated }` and this function kept only `rows`, so a count folded out
 * of a capped haul was reported as exact. {@link MemberCounts} carries the marker
 * now — see its own note for why it rides the `Map` rather than replacing it.
 */
export async function memberCounts(
  channelIds: string[]
): Promise<MemberCounts> {
  const counts = new Map<string, number>();
  if (channelIds.length === 0) return clipMarker(counts, false);
  // ⚠ STILL ONE COLUMN. `user_id` is ORDERED on and never selected — the precedent
  // `repository-token-spend.ts` set with `session_key`: ORDER BY reaches any column of the
  // relation, so a total order costs no bytes.
  const { rows, truncated } = await walkChannelMembers<{ channel_id: string }>("channel_id", (q) =>
    q
      .in("channel_id", channelIds)
      .order("channel_id", { ascending: true })
      .order("user_id", { ascending: true })
  );
  for (const row of rows) {
    counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
  }
  return clipMarker(counts, truncated);
}

type MemberInsert = {
  channel_id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  added_by: string | null;
};

export async function insertMember(
  row: MemberInsert
): Promise<ChannelMemberRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelMemberRow;
}

/**
 * Count of members with role='owner' — backs the last-owner-leave guard.
 *
 * 🔒 **COUNTED, NEVER HAULED-AND-FOLDED (Samuel #2935).** It was
 * `select("user_id") … .length` with NO bound at all, so `max_rows` would have
 * clipped it at 1,000 silently — and this number gates `service-writes-members.ts
 * › leaveChannel` (`countOwners(channel.id) <= 1`). An UNDER-count here is the one
 * direction that matters: it admits the last owner's departure and leaves an
 * ownerless channel. (A clip could only ever under-count, so the guard failed
 * OPEN.)
 *
 * ⚠ **`head: true` + `count: "exact"` IS IMMUNE TO THIS WHOLE CLASS OF BUG**:
 * `max_rows` bounds the response BODY and never the `Content-Range` total, so a
 * counted read carries no row to clip. The sanctioned shape — see
 * `analytics/server/health.ts › getMcpHealth` and
 * `home/server/repository-overview.ts › countMetricInWindow`, and
 * `shared/testing/postgrest-cap.ts`, whose fake deliberately leaves `count` exact
 * for exactly this reason.
 * ⚠ A `null` count is 0 rather than a throw-shaped surprise; the `error` arm still
 * throws, because an UNREADABLE owner list must not read as "no owners".
 */
export async function countOwners(channelId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("channel_members")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .eq("role", "owner");
  if (error) throw error;
  return count ?? 0;
}

export async function deleteMember(
  channelId: string,
  userId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Best-effort read-watermark bump. ⚠ Monotonic at the row level: a concurrent
 *  reader that already advanced past `at` makes this a no-op (no UPDATE, no WAL
 *  event, no realtime fan-out) — the guard that stops refetch loops feeding
 *  themselves. */
export async function updateLastRead(
  channelId: string,
  userId: string,
  at: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_members")
    .update({ last_read_at: at })
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .or(`last_read_at.is.null,last_read_at.lt.${at}`);
  if (error) throw error;
}

/**
 * Update a member's OWN per-channel preferences; returns the updated row.
 * The workspace-guard trigger fires only on UPDATE OF workspace_id/channel_id,
 * so this never trips it.
 *
 * ⚠ `favorited_at` is nullable and CLEARING it is a real patch value — the
 * un-favourite is `{ favorited_at: null }`, which is why the type is
 * `string | null` and not `string`. The service builds the patch by checking
 * `!== undefined`, never truthiness (INVARIANTS §8).
 */
export async function updateMemberPrefs(
  channelId: string,
  userId: string,
  patch: {
    notify_scope?: string;
    agent_tool_profile?: string;
    favorited_at?: string | null;
    /** ⚠ NOT nullable, unlike `favorited_at` above: the column is `NOT NULL DEFAULT
     *  'last_addressed'` and `'last_addressed'` IS the unconfigured answer, so there is no
     *  clear to express (`20260928130000`). Held to the closed set by the zod enum at the
     *  route and by `channel_members_unaddressed_responder_check` here. */
    unaddressed_responder?: string;
  }
): Promise<ChannelMemberRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .update(patch)
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelMemberRow;
}

