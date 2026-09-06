import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { ESCALATION_ANSWER_METADATA_KEY, ESCALATION_METADATA_KEY } from "../escalation";
import type { ChannelMessageRow } from "./dto";

/**
 * THE TYPED-ANSWER CANDIDATE READS (2026-09-05, task 13b).
 *
 * ⚠ ITS OWN FILE ON `repository-messages.ts`'s OWN PRECEDENT — the
 * `repository-messages-recent.ts` split at the 500-line cap, whose rule is
 * "split, do not squeeze". The seam is real rather than arithmetic: everything
 * in the parent is "read or write A message", and these two exist only to answer
 * ONE question — "which open decision card, if any, is this typist about to
 * answer in prose". They are re-exported from `repository-messages.ts`, so
 * callers keep the single `repoMessages.*` namespace and every existing
 * `vi.mock("./repository-messages")` keeps covering them.
 *
 * ⚠ SERVICE-ROLE ADMIN CLIENT (RLS-bypassing) like the rest of the repository
 * layer: the caller has already been proved a member of this channel, and the
 * ANSWERABILITY question — whose card is it — is the service layer's, in
 * `service-writes-metadata-escalation.ts › escalationAnswerers`. Nothing here
 * decides who may answer anything.
 */

/**
 * How far back a typed answer will look for an open card.
 *
 * ⚠ A BOUND, AND IT FAILS IN THE SILENT DIRECTION. A card older than this many
 * escalations in the room is simply not found, and the typed message stays
 * ordinary prose — which is exactly what every other near-miss in this feature
 * does (#1085: "anything else is ordinary prose, silently"). The alternative, an
 * unbounded scan of every card a channel ever carried, buys correctness for a
 * case nobody has — the operator answers the card in front of them — at the cost
 * of an unbounded read on the POST path, which every message pays.
 */
export const ESCALATION_SCAN_LIMIT = 25;

/**
 * The channel's most recent escalation CARDS, newest first.
 *
 * ⚠ `seq` DESC IS THE ORDER, matching `findLastRoomAddressToAgent`'s reason:
 * `seq` is unique per channel and the advisory-locked insert RPC makes commit
 * order monotonic, so "the most recent" is TOTAL — no tie is representable.
 * `created_at` would reintroduce a tie-break to get wrong.
 *
 * ⚠ `select("*")` because the service needs METADATA (the payload and the
 * server-stamped mentions that decide who may answer), the AUTHOR (the fallback
 * answerer) and `client_msg_id` (one of the two doors the derived `agentId`
 * comes from) — the same three columns `findMessageById` names its reason for.
 */
export async function listRecentEscalations(
  channelId: string,
  limit: number = ESCALATION_SCAN_LIMIT
): Promise<ChannelMessageRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .not(`metadata->${ESCALATION_METADATA_KEY}`, "is", null)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelMessageRow[];
}

/**
 * Which of those cards are already ANSWERED — the "open" half of "most recent
 * open card".
 *
 * ⚠ IT ASKS THE STORED ANSWER, never a body or a render: the same
 * `metadata->escalationAnswer->>escalationMessageId` expression the partial
 * unique index is built on, so "answered" means here what it means at rest.
 *
 * ⚠ IT IS NOT A RACE GUARD AND MUST NOT BE READ AS ONE. One answer per
 * escalation is enforced by that index (23505 for the service layer); this read
 * exists so a typed message does not press a button on a card that visibly
 * already has a verdict. A card answered between this read and the insert is the
 * index's problem, exactly as it is for the button path.
 */
export async function listAnsweredEscalationIds(
  channelId: string,
  escalationIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (escalationIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("metadata")
    .eq("channel_id", channelId)
    .in(
      `metadata->${ESCALATION_ANSWER_METADATA_KEY}->>escalationMessageId`,
      escalationIds
    );
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    metadata: Record<string, unknown> | null;
  }>) {
    const answer = (row.metadata ?? {})[ESCALATION_ANSWER_METADATA_KEY];
    if (!answer || typeof answer !== "object") continue;
    const id = (answer as Record<string, unknown>).escalationMessageId;
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}
