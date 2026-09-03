import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * **THE DELIVERY COLUMN'S TWO STATEMENTS** — the ack lane's whole I/O surface
 * (`service-writes-delivery.ts › recordDeliveryAcks` is the only caller of
 * either).
 *
 * ⚠ SPLIT OUT OF `repository-messages.ts` ON 2026-09-02 at the 500-line cap,
 * and on a real seam: that file writes and reads MESSAGES, and these two answer
 * questions about one column of one row — what a machine reported, and who the
 * server said the message was for. They arrived together (A9's keystone and the
 * F-593 fence) and they retire together.
 */

/**
 * **STAMP ONE MACHINE'S DELIVERY RECEIPT ON ONE MESSAGE** (2026-09-02, A9).
 *
 * ⚠ **THE `weakerOrEqual` FENCE IS THE WHOLE STATEMENT AND IT IS IN THE SQL, NOT
 * IN A READ-THEN-WRITE.** Several machines may legitimately observe one message —
 * two operators, each with agents on the thread — and a plain last-write-wins
 * would let a machine that fed nothing overwrite another's `woken` with
 * `refused`. Ranking in the `WHERE` makes the update MONOTONIC without a
 * round-trip and without a lock: a receipt lands only over a weaker one.
 *
 * ⚠ **`delivery IS NULL` IS EXPLICITLY UNIONED IN BECAUSE `IN` DOES NOT MATCH
 * NULL.** A row written before `20260912120000` carries NULL, and that is the
 * weakest state of all — it must accept any receipt.
 *
 * ⚠ SCOPED BY `(channel_id, seq)`, never by seq alone. `seq` is a TABLE-wide
 * identity (INVARIANTS §5), so it is globally unique and the channel term buys no
 * correctness — it buys the FENCE: the caller proved membership of THAT channel,
 * and a mismatched pair must update nothing rather than reach a room the caller
 * is not in.
 *
 * Returns whether a row moved, so the service can report what it actually wrote.
 */
export async function stampDelivery(
  // ⚠ THE TENANT TERM IS IN THE STATEMENT, not merely in the caller's context.
  // `channel_messages.workspace_id` is denormalized for exactly this
  // (`20260725120000`), every other write on this table carries it, and a fence
  // that lives only in the service is one refactor away from being nowhere.
  workspaceId: string,
  channelId: string,
  seq: number,
  delivery: string,
  weakerOrEqual: readonly string[]
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .update({ delivery, delivery_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("seq", seq)
    .or(`delivery.is.null,delivery.in.(${weakerOrEqual.join(",")})`)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * The RECIPIENT AGENT SET the server stored on one message, for the delivery
 * ack's third fence (`service-writes-delivery.ts`).
 *
 * ⚠ **THREE ANSWERS, AND THE CALLER MUST TELL THEM APART.** `null` = the server
 * did not resolve the agent half (an unresolvable handle, or a kind that cannot
 * reach a session) and the machine's own parse decided; `[]` = it resolved to
 * nobody; a list = these agents and no others. Collapsing `null` into `[]` here
 * would turn "you decide" into "nobody", which is the distinction
 * `service-wake-verdict.ts` is built around.
 *
 * ⚠ NO ROW ⇒ `undefined`, which is not the same as a row with a NULL column: a
 * receipt for a seq that does not exist is a receipt for nothing.
 */
export async function findRecipientAgentIds(
  workspaceId: string,
  channelId: string,
  seq: number
): Promise<string[] | null | undefined> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("recipient_agent_ids")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", channelId)
    .eq("seq", seq)
    .maybeSingle();
  if (error) throw error;
  return (data as { recipient_agent_ids: string[] | null } | null)?.recipient_agent_ids;
}
