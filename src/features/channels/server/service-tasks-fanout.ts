import "server-only";
import { createHash } from "node:crypto";
import type { TaskFanOutInput } from "../schema";
import { createTask, type TaskCreateResult } from "./service-tasks";
import type { ChannelContext } from "./service-shared";

/**
 * THE REQUEST FAN-OUT — N addressees, N threads, ONE card.
 *
 * The "New agent thread" panel is the only surface that raises an agent
 * request, and each of its pills is an EXPLICIT addressee (INVARIANTS §5:
 * "broadcast" is not a shape this product has). Storage keeps a thread as ONE
 * requester + ONE target, so a three-pill send is three `channel_tasks` rows —
 * this module is the CALLER that makes those three calls, and
 * `service-tasks.ts › createTask` is unchanged by it.
 *
 * ⚠ TWO THINGS MAKE OR BREAK THIS, AND BOTH ARE ABOUT KEYS.
 *
 * 1. **The per-addressee idempotency key.** `channel_tasks` carries a partial
 *    unique index on `(channel_id, client_msg_id)`
 *    (`20260729032037_channel_tasks_client_msg_id.sql`), so ONE key shared
 *    across N addressees makes rows 2..N converge on row 1 through
 *    `createTask`'s short-circuit — the caller is told all N succeeded and the
 *    request silently reached one person. {@link addresseeClientMsgId} is what
 *    keeps the keys distinct, and `service-tasks-fanout.test.ts` pins the count.
 * 2. **The group id is DERIVED, never minted per attempt.** A `randomUUID()` per
 *    call would split a retried fan-out across two cards: the threads that
 *    landed on attempt 1 keep the old group (their opening messages dedup on
 *    their own derived key and are never re-stamped) while the ones that did not
 *    get the new one. {@link fanoutGroupId} is a pure function of the channel,
 *    the creator and the caller's base key, so every attempt agrees.
 */

/**
 * The idempotency key for ONE addressee of a fan-out.
 *
 * ⚠ `${base}:${toUserId}` — the base alone is the trap described above. Both
 * halves are needed: the base makes a RETRY converge, the suffix keeps the N
 * members of one attempt apart.
 */
export function addresseeClientMsgId(base: string, toUserId: string): string {
  return `${base}:${toUserId}`;
}

/**
 * The id every thread of one fan-out shares, so the transcript can render them
 * as one card.
 *
 * ⚠ DERIVED SERVER-SIDE AND UNFORGEABLE ACROSS USERS. `ctx.userId` is mixed in
 * before hashing, so a member who copies somebody else's base key cannot
 * reproduce their group id and splice a thread into their card. It is stamped
 * through the reserved-metadata seam on top of that
 * (`service-writes-metadata.ts › resolvePostMetadata`) — belt and braces, the
 * same treatment `taskTitle` / `taskTarget` get.
 *
 * ⚠ A HASH, not the key itself: the base is caller-authored text and this value
 * is rendered into stored metadata that every channel member can read. The NUL
 * separator is what keeps the two halves unambiguous — a caller-authored base
 * cannot contain one (`service-shared.ts › stripNulDeep` removes them from
 * every string that reaches a write).
 *
 * ⚠ THE CHANNEL IS DELIBERATELY NOT AN INPUT. A create names its channel by a
 * REF — id or slug — and hashing whichever spelling a retry happened to use
 * would split one request across TWO cards, the exact failure this derivation
 * exists to prevent. Nothing is lost: the transcript only ever groups within one
 * channel's own messages, so a group id colliding across channels renders
 * nothing.
 */
export function fanoutGroupId(createdBy: string, base: string): string {
  return createHash("sha256")
    .update(createdBy + "\u0000" + base)
    .digest("hex")
    .slice(0, 32);
}

/** What one fan-out hands back — the threads in addressee order, plus the
 *  group id the card is drawn from. */
export interface TaskFanOutResult {
  threads: TaskCreateResult[];
  groupId: string;
}

/**
 * Raise ONE request against N addressees.
 *
 * ⚠ SEQUENTIAL, not `Promise.all`. Every `createTask` posts through the
 * `channel_message_insert` RPC, which takes a per-channel advisory lock before
 * its insert (INVARIANTS §5), so concurrent members of one fan-out would queue
 * on that lock anyway — and running them in order makes the opening messages
 * land in addressee order, which is the order the card's pills are read back in.
 *
 * ⚠ NOT ATOMIC, and deliberately so. There is no transaction across N threads;
 * a failure partway leaves the threads already created standing, and the whole
 * call is safe to RETRY with the same base key — every landed thread converges,
 * every missing one is created, and all of them carry the same derived group.
 * Wrapping this in a transaction would buy all-or-nothing at the price of
 * holding the channel's advisory lock across N inserts.
 *
 * Duplicate addressees collapse before the loop: two pills for one person is a
 * UI accident, and left alone it would make the second create converge on the
 * first and report a thread twice.
 */
export async function createTaskFanOut(
  ctx: ChannelContext,
  ref: string,
  input: TaskFanOutInput
): Promise<TaskFanOutResult> {
  const addressees = [...new Set(input.toUserIds)];
  const threads: TaskCreateResult[] = [];
const groupId = fanoutGroupId(ctx.userId, input.clientMsgId);

  for (const toUserId of addressees) {
    threads.push(
      await createTask(
        ctx,
        ref,
        {
          title: input.title,
          body: input.body,
          mode: input.mode,
          toUserId,
          clientMsgId: addresseeClientMsgId(input.clientMsgId, toUserId),
        },
        { fanoutGroupId: groupId }
      )
    );
  }

  return { threads, groupId };
}
