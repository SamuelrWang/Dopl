import "server-only";
import { pgErrorCode } from "./repository";
import { UNIQUE_VIOLATION } from "./service-shared";

/**
 * **A RETRY MAY NOT QUEUE A SECOND AGENT** — the race half of the idempotency
 * rule for the two AGENT MAILBOXES (2026-09-02, A10/G10).
 *
 * ⚠ **THE RULE IS TWO MECHANISMS AND NEITHER IS SUFFICIENT ALONE.** The PROBE —
 * a read for the caller's key before anything is filed — answers the ordinary
 * retry, seconds or minutes later with nothing racing. THIS function answers the
 * other half: two concurrent retries, where both probes miss and the partial
 * unique index refuses the second insert. Ship one without the other and the
 * failure is silent in opposite directions — a second agent, or a 500 on a call
 * that should have been a no-op.
 *
 * ⚠ **THE PROBE IS NOT IN HERE, AND THAT IS DELIBERATE.** Where it goes is a
 * per-lane contract rather than a detail: on both mailboxes it must sit ABOVE the
 * template, thread and presence gates, so a retry of a request that already
 * succeeded is never re-decided against today's world (a since-deleted template,
 * a laptop that has since closed). A helper that probed on the caller's behalf
 * would put that decision somewhere no reader of the create path can see it, and
 * would read the row twice on every keyed call. Each `createAgent*` states its
 * own ordering, in the gate list, where the argument belongs.
 *
 * ⚠ **NO KEY MEANS NO CONTRACT.** A caller that sends none gets today's
 * behaviour byte for byte: one insert, nothing caught. That is what keeps this
 * additive — `client_msg_id` is optional on both routes and absent from every
 * desktop-authored call.
 */
export type MailboxInsert<TRow> = {
  /** The caller's key, or absent. ⚠ `""` is not a key — both route schemas hold
   *  it to `.min(1)`, and treating a blank as one would make every keyless
   *  caller share a single contract. */
  clientMsgId: string | null | undefined;
  /** File the row. ⚠ Called exactly once. */
  insert: () => Promise<TRow>;
  /** Re-read the stored row for this key, own-scoped in the repository. ⚠ Called
   *  ONLY after a unique violation. */
  find: (clientMsgId: string) => Promise<TRow | null>;
};

/**
 * File the row; on a lost idempotency race, converge on the winner.
 *
 * ⚠ `existing: true` MEANS THIS CALL FILED NOTHING. Both lanes carry it out to
 * the MCP result as `retry=existing`, because a converged retry that looked like
 * a fresh launch would leave the caller guessing exactly what the key removed.
 */
export async function insertOrConverge<TRow>({
  clientMsgId,
  insert,
  find,
}: MailboxInsert<TRow>): Promise<{ row: TRow; existing: boolean }> {
  try {
    return { row: await insert(), existing: false };
  } catch (err) {
    // ⚠ A 23505 ON THIS INSERT IS NOT NECESSARILY *THIS* INDEX. Both tables carry
    // other unique objects (the replica-identity index, and whatever a later
    // migration adds), so the repair RE-READS and RETHROWS when the key is still
    // absent. Swallowing on the strength of the code alone would turn an
    // unrelated constraint violation into a silent success with no row.
    if (!clientMsgId || pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
    const raced = await find(clientMsgId);
    if (!raced) throw err;
    return { row: raced, existing: true };
  }
}
