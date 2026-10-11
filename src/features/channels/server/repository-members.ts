/** Split out of `repository.ts` (2026-09-14, 500-line cap): the `channel_members` table's data access, on `repository-workspace.ts`'s precedent — `repository.ts` re-exports every name here, so `import * as repo from "./repository"` is unchanged. */
import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
import type { ChannelMemberRow } from "./dto";
import { CHANNEL_MEMBER_ROWS_LIMIT } from "./repository-collab";

/** All channels in the workspace the caller belongs to (ids + role + read). */
export async function listMyMemberships(
  workspaceId: string,
  userId: string
): Promise<ChannelMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as ChannelMemberRow[];
}

export async function listMembers(
  channelId: string
): Promise<ChannelMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("*")
    .eq("channel_id", channelId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChannelMemberRow[];
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
 */
export async function memberCounts(
  channelIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (channelIds.length === 0) return counts;
  const db = supabaseAdmin();
  const { rows } = await readAllPages<{ channel_id: string }>(
    // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
    // re-awaiting one re-sends the first range and the walk spins on page 0.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("channel_members")
        // ⚠ STILL ONE COLUMN. `user_id` is ORDERED on and never selected — the
        // precedent `repository-token-spend.ts` set with `session_key`: ORDER BY
        // reaches any column of the relation, so a total order costs no bytes.
        .select("channel_id")
        .in("channel_id", channelIds)
        .order("channel_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, toInclusive);
      return { data: (data ?? []) as unknown as Array<{ channel_id: string }>, error };
    },
    // ⚠ The page size is the SERVER's ceiling — that is what makes a short page
    // proof of exhaustion rather than proof of a clip.
    { hardCap: CHANNEL_MEMBER_ROWS_LIMIT, pageSize: POSTGREST_MAX_ROWS }
  );
  for (const row of rows) {
    counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
  }
  return counts;
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

/** Count of members with role='owner' — backs the last-owner-leave guard. */
export async function countOwners(channelId: string): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_members")
    .select("user_id")
    .eq("channel_id", channelId)
    .eq("role", "owner");
  if (error) throw error;
  return (data ?? []).length;
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

