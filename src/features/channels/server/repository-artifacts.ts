import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelArtifactRow, ChannelMessageRow } from "./dto";

/**
 * Pure data access for `channel_artifacts` and for the ONE column that carries
 * membership, `channel_messages.artifact_id` (migration `20260926120000`,
 * design #1220 accepted at #1222).
 *
 * ⚠ ITS OWN FILE, on the precedent `repository-messages-escalations.ts` and
 * `repository-messages-recent.ts` set: `repository-messages.ts` is at 476 lines
 * and §1's rule is "split, do not squeeze". The seam is real rather than
 * arithmetic — everything here is about a GROUPING over messages, and the
 * membership statements live beside the artifact they belong to instead of
 * being a fourth concern in the message repository.
 *
 * ⚠ Service-role admin client (RLS-bypassing) throughout; visibility and authz
 * live in the SERVICE layer, exactly as every other channels repository states.
 */

/**
 * The members-of-one-artifact read's ceiling, and the fold aggregate's.
 *
 * ⚠ A BOUND, NOT A GUESS. Nothing stops a caller folding a thousand messages,
 * and `op=read, artifact=<id>` would otherwise materialize every body in one
 * response. At the ceiling counts as clipped (INVARIANTS §9) and the service
 * says so — a clipped list that renders like an exhausted one is the bug.
 */
export const ARTIFACT_MEMBER_LIMIT = 200;

type ArtifactInsert = {
  channel_id: string;
  workspace_id: string;
  name: string;
  summary: string;
  created_by: string;
  created_by_agent: string | null;
  client_msg_id: string | null;
};

export async function insertArtifact(
  row: ArtifactInsert
): Promise<ChannelArtifactRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelArtifactRow;
}

/**
 * THE IDEMPOTENCY PROBE — (channel, CREATOR, client_msg_id).
 *
 * ⚠ AUTHOR-SCOPED, and the reason is a vulnerability rather than a preference:
 * channel-scoped, idempotency is a contract with the whole ROOM, so a member
 * who reused a key another member's agent was about to use would be handed back
 * THEIR artifact. Same shape, same fix, same column order as
 * `repository-messages.ts › findOwnMessageByClientId` and
 * `repository-tasks.ts › findOwnTaskByClientId`.
 *
 * ⚠ THE DATABASE AGREES WITH THIS FUNCTION and it has to — the partial unique
 * index is `(channel_id, client_msg_id, created_by) WHERE client_msg_id IS NOT
 * NULL`. Scoping only the read turns the convergence into a 23505 the caller
 * sees as a 500. Change one, change both.
 */
export async function findOwnArtifactByClientId(
  channelId: string,
  createdBy: string,
  clientMsgId: string
): Promise<ChannelArtifactRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .eq("created_by", createdBy)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelArtifactRow | null) ?? null;
}

/**
 * One artifact, SCOPED TO ITS CHANNEL.
 *
 * ⚠ **THE `channel_id` PREDICATE IS THE FENCE, NOT A NARROWING** — `id` is a
 * uuid and unique on its own, so the extra `eq` is the whole authorization: the
 * caller has already been proved able to read THIS channel, and without it an
 * artifact id could be probed across rooms. Same argument, verbatim, as
 * `repository-messages.ts › findMessageById`.
 */
export async function findArtifactByChannelAndId(
  channelId: string,
  artifactId: string
): Promise<ChannelArtifactRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .select("*")
    .eq("channel_id", channelId)
    .eq("id", artifactId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelArtifactRow | null) ?? null;
}

/**
 * The artifacts named by a PAGE of messages, fetched by id.
 *
 * ⚠ BOUNDED BY THE PAGE, not by the channel: the caller passes the distinct
 * `artifact_id`s it actually saw, so a room with ten thousand artifacts costs
 * exactly as much as one with three. An empty input does NO read — `.in()` with
 * `[]` is a query that returns nothing at the price of a round trip.
 */
export async function listArtifactsByIds(
  channelId: string,
  ids: string[]
): Promise<ChannelArtifactRow[]> {
  if (ids.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .select("*")
    .eq("channel_id", channelId)
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as ChannelArtifactRow[];
}

/**
 * EVERY LIVE ARTIFACT IN ONE CHANNEL, newest first — the Artifacts face's list
 * (Samuel, 2026-09-16: *"list shows this channel's artifacts"*).
 *
 * ⚠ **BOUNDED BY THE CHANNEL, WHICH IS EXACTLY WHAT {@link listArtifactsByIds} IS
 * NOT**, and the two are kept apart rather than merged: that one is priced by the
 * PAGE (the ids a transcript read actually saw, so a room with ten thousand cards
 * costs the same as one with three) and this one is priced by the ROOM. A caller
 * that wants the page's cards must keep using the by-ids read — passing `[]` here
 * would quietly buy the whole room.
 *
 * ⚠ **DISSOLVED CARDS ARE EXCLUDED, AND THAT IS NOT THE SAME AS DELETED.** Dissolve
 * un-folds every member BEFORE it retires the row (`service-artifacts.ts ›
 * dissolveArtifact`, in that order), so a dissolved artifact holds nothing and has
 * nothing to open — a row in this list would be a card standing in for no messages.
 * It still RESOLVES by id (`findArtifactByChannelAndId` has no such predicate), so an
 * old citation keeps its honest answer; it is only the BROWSE list it leaves.
 *
 * ⚠ **THE CALLER ASKS FOR ONE MORE THAN IT WILL SHOW.** The clip signal is the
 * service's (INVARIANTS §9), and `limit` is passed through verbatim so the two ends
 * cannot disagree about where the ceiling sits.
 */
export async function listArtifactsByChannel(
  channelId: string,
  limit: number
): Promise<ChannelArtifactRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .select("*")
    .eq("channel_id", channelId)
    .is("dissolved_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelArtifactRow[];
}

/**
 * COUNT AND SEQ SPAN PER ARTIFACT — the numbers the folded card carries
 * (design §4: "artifact id, name, summary, message COUNT, and the seq SPAN it
 * covers").
 *
 * ⚠ **THE AGGREGATE IS OVER THE WHOLE ARTIFACT, NEVER OVER THE PAGE**, and that
 * is the entire reason this read exists instead of counting the rows already in
 * hand. The card's value to somebody holding an old citation is "which box does
 * #1119 live in" — a count that silently meant "of the members that happen to
 * be on this page" would answer a different question every time the page moved.
 *
 * 🔒 **POSTGRES DOES THE ARITHMETIC, AND THAT IS A CORRECTNESS FIX RATHER THAN A
 * SPEED ONE (F-712).** This used to `select("artifact_id, seq")` over
 * `channel_messages` and fold the rows in JS. **The select was unbounded and
 * PostgREST is not** — `supabase/config.toml › max_rows = 1000` clips the
 * response and raises nothing — so in a busy room every number was computed over
 * whatever survived the clip: a clipped `lastSeq` points a reader at the WRONG
 * artifact and a clipped `count` under-reports it, silently, and differently each
 * time the page moves. One row per artifact moves the ceiling onto a set the
 * CALLER already bounds ({@link listArtifactsByChannel}'s limit, or a page's
 * distinct ids). ⚠ **Never "fix" this with a larger `max_rows` or a page loop**:
 * the first moves the number and keeps the silence, the second hauls the same
 * rows across the wire to do arithmetic Postgres does once, indexed.
 *
 * ⚠ **THE MIGRATION IS A HARD DEPENDENCY, UNLIKE THE SEARCH INDEX'S.**
 * `supabase/migrations/20261008120000_artifact_spans_rpc.sql` ships **WRITTEN,
 * NOT APPLIED** (INVARIANTS §12) and this call answers `PGRST202` until it is
 * applied BY NAME (`artifact_spans_rpc`). That is deliberate and it is stated
 * rather than degraded: the fallback would be the JS fold, and the JS fold is the
 * bug — a read that is quietly WRONG is worse than one that is loudly absent.
 * `20261007120000_search_fulltext_indexes.sql` could ship unapplied precisely
 * because its unapplied form was SLOW, NEVER WRONG; this one has no such form.
 *
 * ⚠ **`channelId` IS THE FENCE, NOT A NARROWING** — the same sentence
 * {@link findArtifactByChannelAndId} carries, and the reason the RPC takes it as
 * an argument instead of trusting that its ids were fenced upstream: the caller
 * has been proved able to read THIS channel, so a member row that somehow carried
 * a foreign artifact id still cannot be counted out of another room. The function
 * is `SECURITY INVOKER` with `EXECUTE` granted to `service_role` alone, so the
 * only way to reach it is the admin client this file already uses.
 *
 * ⚠ Served by `channel_messages_artifact_idx` on `(artifact_id, seq) WHERE
 * artifact_id IS NOT NULL`, which is the grouping's own shape; the migration's
 * `DO $$` RAISEs if it is missing rather than trusting it.
 */
export interface ArtifactSpan {
  count: number;
  firstSeq: number;
  lastSeq: number;
}

interface ArtifactSpanRow {
  artifact_id: string;
  count: number | string;
  first_seq: number | string;
  last_seq: number | string;
}

export async function artifactSpans(
  channelId: string,
  artifactIds: string[]
): Promise<Map<string, ArtifactSpan>> {
  const out = new Map<string, ArtifactSpan>();
  // ⚠ NO ROUND TRIP FOR AN EMPTY SET, as before: `ANY('{}')` matches nothing at
  // the price of a call, and every caller that has no artifacts on its page
  // reaches this line.
  if (artifactIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channel_artifact_spans", {
    p_channel_id: channelId,
    p_artifact_ids: artifactIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as ArtifactSpanRow[]) {
    // ⚠ `Number(...)` ON ALL THREE: `count(*)`, `min(seq)` and `max(seq)` are
    // `bigint`, which PostgREST may render as a STRING. The old fold coerced
    // `seq` for exactly this reason and dropping the coercion here would make
    // `firstSeq` a string that renders plausibly and compares wrongly.
    out.set(row.artifact_id, {
      count: Number(row.count),
      firstSeq: Number(row.first_seq),
      lastSeq: Number(row.last_seq),
    });
  }
  return out;
}

/**
 * The members of ONE artifact, in seq order — what `op=read, artifact=<id>`
 * returns (design §4, "the members verbatim, in seq order, unfolded, with their
 * own seqs visible").
 *
 * ⚠ `channel_id` IS AGAIN THE FENCE, not a narrowing: the artifact was already
 * resolved inside this channel, and repeating the predicate means a member row
 * that somehow carried a foreign artifact id still cannot be read out of
 * another room.
 * ⚠ BOUNDED, and the service reports when the bound bit.
 */
export async function listMessagesByArtifact(
  channelId: string,
  artifactId: string
): Promise<ChannelMessageRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("artifact_id", artifactId)
    .order("seq", { ascending: true })
    .limit(ARTIFACT_MEMBER_LIMIT);
  if (error) throw error;
  return (data ?? []) as ChannelMessageRow[];
}

/**
 * FOLD: stamp `artifact_id` onto the named seqs, and answer WHICH ONES ACTUALLY
 * WENT IN.
 *
 * ⚠ **`artifact_id IS NULL` IN THE PREDICATE IS THE "ONE ARTIFACT PER MESSAGE"
 * RULE BEING ENFORCED BY THE STATEMENT ITSELF**, not by a check the service
 * runs first. A message already folded elsewhere simply does not match, so a
 * concurrent create cannot steal a message out of an artifact that already
 * holds it, and the returning list is the honest answer to "what did I get".
 * Checking-then-writing would be the same race with extra steps.
 *
 * ⚠ **IT RETURNS FEWER THAN ASKED, ON PURPOSE, AND THE CALLER MUST SAY SO** —
 * design §5: create "answers the artifact id and what it actually folded, which
 * may be fewer than asked". Seqs from another channel, seqs that do not exist,
 * and seqs already folded all simply fail to match.
 */
export async function foldMessagesIntoArtifact(
  channelId: string,
  artifactId: string,
  seqs: number[]
): Promise<number[]> {
  if (seqs.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .update({ artifact_id: artifactId })
    .eq("channel_id", channelId)
    .in("seq", seqs)
    .is("artifact_id", null)
    .select("seq");
  if (error) throw error;
  return ((data ?? []) as Array<{ seq: number }>).map((r) => Number(r.seq));
}

/**
 * UN-BOX ONE MESSAGE — `action="remove"`.
 *
 * ⚠ THE `artifact_id` PREDICATE MAKES IT SPECIFIC RATHER THAN DESTRUCTIVE: it
 * clears the column only if the message is in THE artifact the caller named, so
 * a stale id cannot quietly un-box a message that has since moved. No match
 * returns `[]` and the service reads that as "nothing to do", never as an error
 * — un-boxing something already un-boxed is the caller's desired end state.
 */
export async function unfoldMessage(
  channelId: string,
  artifactId: string,
  seq: number
): Promise<number[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .update({ artifact_id: null })
    .eq("channel_id", channelId)
    .eq("seq", seq)
    .eq("artifact_id", artifactId)
    .select("seq");
  if (error) throw error;
  return ((data ?? []) as Array<{ seq: number }>).map((r) => Number(r.seq));
}

/**
 * DISSOLVE, half one: clear `artifact_id` from every member.
 *
 * ⚠ **NOTHING IS DELETED, WHICH IS WHAT MAKES DISSOLVE SAFE TO OFFER AT ALL**
 * (design §5) — it is the same non-destructive shape as every other op on this
 * tool. The messages return to rendering normally, with their bodies, authors
 * and seqs untouched, because they were never moved.
 */
export async function unfoldAllForArtifact(
  channelId: string,
  artifactId: string
): Promise<number[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .update({ artifact_id: null })
    .eq("channel_id", channelId)
    .eq("artifact_id", artifactId)
    .select("seq");
  if (error) throw error;
  return ((data ?? []) as Array<{ seq: number }>).map((r) => Number(r.seq));
}

/**
 * DISSOLVE, half two: RETIRE the artifact row.
 *
 * ⚠ A STAMP, NOT A DELETE, and the reason is the citation property the whole
 * design protects: an id somebody quoted yesterday still resolves to a name and
 * a summary saying "this was dissolved", instead of 404-ing. It is also why
 * `dissolved_at` is a column rather than the row's absence.
 *
 * ⚠ IDEMPOTENT BY PREDICATE — `is("dissolved_at", null)` means a second
 * dissolve matches nothing and keeps the FIRST timestamp, so a retry cannot
 * rewrite when it happened.
 */
export async function markArtifactDissolved(
  channelId: string,
  artifactId: string
): Promise<ChannelArtifactRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_artifacts")
    .update({ dissolved_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("id", artifactId)
    .is("dissolved_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelArtifactRow | null) ?? null;
}
