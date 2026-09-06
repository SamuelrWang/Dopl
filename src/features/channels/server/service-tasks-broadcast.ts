import "server-only";
import { createHash } from "node:crypto";
import type { TaskFanOutInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  TaskSelfTargetError,
} from "./errors";
import * as repo from "./repository";
import { createTask, type TaskCreateResult } from "./service-tasks";
import { requireMemberChannel, type ChannelContext } from "./service-shared";

/**
 * THE REQUEST BROADCAST — N addressees, N threads, ONE card.
 *
 * ⚠ **RENAMED FROM `service-tasks-fanout.ts` ON 2026-09-02 (v2 wave B slice B4,
 * finding C16), AND ONLY THE NAME MOVED.** "Fan-out" named THREE unrelated
 * mechanisms with no shared code — this module, the desktop's
 * `session-dispatch.js` feeding live sessions, and a room-wide read — so a
 * reader who found one had no way to know which one a sentence meant. The
 * messaging collapse is the point at which two of the three are renamed.
 *
 * ⚠ **"BROADCAST" HERE IS THE SEND SHAPE, NOT A MESSAGE KIND, AND INVARIANTS §5
 * IS UNCHANGED.** That rule — *"broadcast is not a shape this product has"* —
 * is about ADDRESSING: there is no way to reach a room without naming who you
 * mean, and this module does not add one. Every one of the N addressees is an
 * explicit pill the sender typed; what is broadcast is the REQUEST, into N
 * separately-addressed threads. A `to`-less send still reaches nobody.
 *
 * The "New agent thread" panel is the only surface that raises an agent
 * request, and each of its pills is an EXPLICIT addressee. Storage keeps a thread as ONE
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
 *    keeps the keys distinct, and `service-tasks-broadcast.test.ts` pins the count.
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
 * is rendered into stored metadata that every channel member can read.
 *
 * ⚠ **WHY THE SEPARATOR HOLDS, stated correctly.** An earlier version of this
 * docblock said a caller-authored base cannot contain a NUL because
 * `service-shared.ts › stripNulDeep` removes them — **which is false HERE**:
 * the strip runs inside `createTask`, and this hash is taken from the caller's
 * UNSTRIPPED `clientMsgId`, before any of that. What actually makes the two
 * halves unambiguous is the PREFIX: `createdBy` is `ctx.userId`, a
 * server-supplied fixed-format UUID with no NUL in it, so the split point is
 * fixed no matter what the base contains — a base that carried a NUL still
 * cannot make `(userA, base)` and `(userB, base')` concatenate to the same
 * string. **Do not "restore" the strip claim; check where the strip runs.**
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
 * REFUSE THE WHOLE SEND BEFORE ANY OF IT HAPPENS — every deterministic reason
 * `createTask` would reject an addressee, hoisted ahead of the loop.
 *
 * ⚠ **THIS IS THE ONLY THING STANDING BETWEEN "not atomic" AND "half a request
 * was raised against real people".** A refusal on addressee k used to leave
 * threads 1..k-1 created and their openers posted — which means k-1 desktops
 * had already raised a consent prompt and possibly launched an agent — while
 * the caller saw a 400 and, reasonably, treated the send as not having
 * happened. The refusals hoisted here are DETERMINISTIC: nothing about
 * self-target, channel membership or workspace membership can become true
 * between this check and the loop in a way that makes a re-run behave
 * differently, so checking them first turns a partial write into no write.
 *
 * ⚠ **NOT A REPLACEMENT FOR `createTask`'S OWN CHECKS, and must never become
 * one.** `createTask` is reachable directly (the single-target create, the MCP
 * lane, the desktop) and keeps all three checks as the authoritative gate; this
 * is a pre-flight over the same predicates. Two copies of a security check is
 * normally the smell — here the second one is the only one that runs on the
 * other three call paths, so the duplication is the point. If they ever
 * disagree, `createTask` wins and this one is the bug.
 *
 * ⚠ Ordered channel-first, exactly as `createTask` orders them, so the
 * workspace round-trip is only paid for an actual channel member.
 */
async function assertAddresseesAreReachable(
  ctx: ChannelContext,
  channelId: string,
  addressees: string[]
): Promise<void> {
  for (const toUserId of addressees) {
    // ⚠ Same reason as `createTask`: a thread addressed to its own creator is
    // dead on arrival, since only creator and target may post.
    if (toUserId === ctx.userId) throw new TaskSelfTargetError();
    if (
      !(
        (await repo.findMembership(channelId, toUserId)) &&
        (await repo.isActiveWorkspaceMember(ctx.workspaceId, toUserId))
      )
    ) {
      throw new ChannelAddresseeNotMemberError(toUserId);
    }
  }
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
 * ⚠ NOT ATOMIC, and now that is a statement about TRANSIENT failures only.
 * There is no transaction across N threads; a failure partway leaves the
 * threads already created standing, and the whole call is safe to RETRY with
 * the same base key — every landed thread converges, every missing one is
 * created, and all of them carry the same derived group. Wrapping this in a
 * transaction would buy all-or-nothing at the price of holding the channel's
 * advisory lock across N inserts.
 *   - ⚠ **That argument only held once
 *     {@link assertAddresseesAreReachable} existed.** A DETERMINISTIC refusal —
 *     a non-member pill, a departed teammate, the sender's own name — is not
 *     retryable: the retry refuses at the same addressee forever, so "safe to
 *     retry" described a call that could never be made whole. Pre-validating
 *     moves every such refusal ahead of the first insert, which is what makes
 *     the remaining non-atomicity genuinely transient (a network blip, a lock
 *     timeout) and therefore genuinely retryable.
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

  // ⚠ Resolves the ref ONCE and refuses the caller's own non-membership here,
  // so the pre-flight tests the same channel every `createTask` below will.
  const { channel } = await requireMemberChannel(
    ctx,
    ref,
    "create a task in this channel"
  );
  await assertAddresseesAreReachable(ctx, channel.id, addressees);

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
