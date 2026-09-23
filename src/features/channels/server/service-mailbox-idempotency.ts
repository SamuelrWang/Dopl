import "server-only";
import { pgErrorCode } from "./repository";
import { UNIQUE_VIOLATION } from "./service-shared";

/** The race half of the agent mailboxes' idempotency rule: two concurrent retries both miss the probe
 *  and the partial unique index refuses the second insert. The probe stays in each create, above its
 *  identity/thread/presence gates, so a filed request is never re-decided. No key = a plain insert. */
export type MailboxInsert<TRow> = {
  /** Absent or `""` = no key (both route schemas hold it to `.min(1)`). */
  clientMsgId: string | null | undefined;
  /** Called exactly once. */
  insert: () => Promise<TRow>;
  /** Own-scoped re-read; called only after a unique violation. */
  find: (clientMsgId: string) => Promise<TRow | null>;
};

/** File the row; on a lost race, converge on the winner (`existing: true` = this call filed nothing). */
export async function insertOrConverge<TRow>({
  clientMsgId,
  insert,
  find,
}: MailboxInsert<TRow>): Promise<{ row: TRow; existing: boolean }> {
  try {
    return { row: await insert(), existing: false };
  } catch (err) {
    // A 23505 may come from another unique index, so re-read and rethrow if the key is still absent.
    if (!clientMsgId || pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
    const raced = await find(clientMsgId);
    if (!raced) throw err;
    return { row: raced, existing: true };
  }
}
