import "server-only";
import type { ChannelThread, ThreadMode } from "../types";
import type { ThreadCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelChatAddressedError,
  ThreadForbiddenError,
  ThreadNotFoundError,
  ThreadSelfTargetError,
} from "./errors";
import type { ChannelThreadRow } from "./dto";
import { mapThreadRow } from "./dto";
import * as repo from "./repository";
import * as repoThreads from "./repository-threads";
import { postMessage } from "./service-writes";
import {
  requireMemberChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * First-class channel threads: CREATE and SET MODE. Transcript rides on
 * `postMessage`.
 */

/**
 * The initiating request's idempotency key, derived from the thread id. ⚠ The thread
 * row and its opening message are two writes with NO transaction around them, so
 * this key is what makes the PAIR converge — whichever attempt gets there posts,
 * every later one dedups on `channel_messages_client_msg_author_key`
 * (`20260822120000`, which widened that index to include the author).
 *
 * ⚠ THE WIDENING IS INVISIBLE TO THIS KEY AND THAT IS NOT LUCK. Only the thread's
 * CREATOR ever reaches this post — the thread probe is author-scoped too
 * (`repository-threads.ts › findOwnThreadByClientId`, 2026-09-02), so every writer of
 * `thread-open-<threadId>` for a given thread is the same user by construction and the
 * message dedup still fires.
 */
function openingMessageClientId(threadId: string): string {
  return `thread-open-${threadId}`;
}

/**
 * Post (or re-post) a thread's initiating request — EXACTLY ONCE per thread, on
 * every path that returns that thread.
 *
 * ⚠ Insert-then-post as separate unguarded steps loses the request permanently:
 * if the insert lands and the post throws, the retry hits the `client_msg_id`
 * short-circuit, returns the stored thread and NEVER posts, leaving a thread in
 * the panel with no message for the responder's desktop to route.
 *
 * ⚠ Both writes stay in the SAME idempotency envelope rather than moving into
 * one RPC — `postMessage` owns the addressee check, the reserved-key strip and
 * the thread-key stamping, and forking that into PL/pgSQL gives the metadata
 * contract two homes. So the message gets its own deterministic key and the post
 * is re-driven on every create path.
 *
 * ⚠ Fields come from the STORED thread row, never the retry's input, so a re-send
 * cannot rewrite the title or re-address the request.
 */
async function postOpeningMessage(
  ctx: ChannelContext,
  channelId: string,
  thread: { id: string; title: string; target_user_id: string | null },
  // `handoff`: the opener carries the reserved `metadata.handoff` stamp so the
  // OPERATOR'S desktop opens the requester session. `intent:"chat"` makes it a
  // record. ⚠ Neither is stored on the thread row, so a retry re-sends them.
  { body, handoff, intent }: Pick<ThreadCreateInput, "body" | "handoff" | "intent">,
  // Request fan-out: the opener carries the reserved `metadata.fanoutGroup`
  // stamp so the N threads of ONE request render as ONE card. ⚠ Server-internal
  // only — {@link ThreadCreateOptions}.
  fanoutGroupId?: string
): Promise<number> {
  const message = await postMessage(
    ctx,
    channelId,
    {
      body,
      kind: "message",
      intent,
      toUserId: thread.target_user_id ?? undefined,
      summary: thread.title,
      metadata: { threadId: thread.id },
      clientMsgId: openingMessageClientId(thread.id),
    },
    { handoff, fanoutGroupId }
  );
  // ⚠ Seq travels back out — it is the requester's `await` cursor and is only
  // known here. Every return path is idempotent, so a dedup'd re-post yields the
  // STORED message and the same seq, never a new one.
  return message.seq;
}

/**
 * What `createThread` hands back: the thread plus the seq of its opening message —
 * the cursor a requester passes straight to `dopl_channel(op="await")`.
 *
 * ⚠ Without it the requester must `read limit=1` to learn where to start
 * watching: an extra round-trip AND a race, since a peer answering between the
 * create and that read makes the "newest message" its reply, so the await starts
 * one message too late and waits forever for something already delivered.
 *
 * ⚠ `null` is kept on the type for the WIRE, not for this service: the route's
 * field is additive and an older deployment omits it
 * (`packages/dopl-client/src/channel.ts › createChannelThread`), so every reader
 * already handles the absence.
 */
export interface ThreadCreateResult {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * Finish a create that landed on an EXISTING thread — the `client_msg_id`
 * short-circuit and the lost-insert race, the same situation reached two ways,
 * so they must answer IDENTICALLY.
 *
 * The caller always gets the STORED thread: not an error, not a second row, and
 * it re-drives the opening post (the repair for a create that half-landed).
 *
 * ⚠ THE THREAD IS ALWAYS THIS CALLER'S OWN, AND THAT IS ENFORCED, NOT ASSUMED —
 * `findOwnThreadByClientId` narrows by `created_by` and the unique index behind it
 * says the same (`20260913120000_channel_tasks_author_scoped_idempotency.sql`).
 * A colliding key from another member now yields a SEPARATE thread rather than
 * converging here, which is why this function no longer has a
 * somebody-else's-thread arm to take.
 */
async function convergeOnThread(
  ctx: ChannelContext,
  channelId: string,
  thread: ChannelThreadRow,
  input: ThreadCreateInput,
  opts: ThreadCreateOptions
): Promise<ThreadCreateResult> {
  const openingSeq = await postOpeningMessage(
    ctx,
    channelId,
    thread,
    input,
    opts.fanoutGroupId
  );
  return { thread: mapThreadRow(thread), openingSeq };
}

/**
 * SERVER-INTERNAL create options — not fields of {@link ThreadCreateInput}, not
 * parsed by any route, and therefore unreachable from an HTTP caller. Same
 * device as `service-writes-metadata.ts › PostMetadataOptions`.
 *
 * ⚠ This parameter is ADDITIVE and changes nothing `createThread` decides: the
 * authorization, the addressee checks, the self-target refusal and the
 * idempotency short-circuit are untouched, and a thread is still ONE requester
 * plus ONE target (INVARIANTS §5). It exists so the fan-out — which is a
 * CALLER of `createThread`, never a second create path — can put its group id on
 * the opening message through the one function that posts it.
 */
interface ThreadCreateOptions {
  /** Stamped as reserved `metadata.fanoutGroup` on the opening message. */
  fanoutGroupId?: string;
}

/**
 * Create a first-class thread. Caller must be a channel member; `toUserId` must be
 * a member of THAT channel AND an ACTIVE workspace member (a departed teammate
 * stays in `channel_members` but can never answer). `body` posts as the thread's
 * first message, tagged `metadata.threadId`.
 *
 * ⚠ A thread is between its CREATOR and its TARGET, and that pair is the whole
 * write gate (`service-writes-metadata-thread.ts`).
 */
export async function createThread(
  ctx: ChannelContext,
  ref: string,
  rawInput: ThreadCreateInput,
  opts: ThreadCreateOptions = {}
): Promise<ThreadCreateResult> {
  const input = stripNulDeep(rawInput);
  const { channel } = await requireMemberChannel(
    ctx,
    ref,
    "create a thread in this channel"
  );
  const target = input.toUserId;
  // ⚠ Refused BEFORE the insert: `postMessage` refuses the same contradiction,
  // but only after the row exists, which would leave a thread with no opener.
  if (target && input.intent === "chat") {
    throw new ChannelChatAddressedError("toUserId");
  }
  // ⚠ A TARGETLESS thread (no `toUserId`) skips both checks below: its opener is
  // its only party, and its opening post wakes nobody.
  // ⚠ Target must be a channel member AND an ACTIVE workspace member.
  // `channel_members` is never swept on workspace-leave, so a departed teammate
  // stays addressable: create succeeds, the opener posts, `openingSeq` returns,
  // the requester arms `await`, and nothing ever answers. Channel check first,
  // so the workspace round-trip is only paid for an actual channel member.
  if (
    target &&
    !(
      (await repo.findMembership(channel.id, target)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, target))
    )
  ) {
    throw new ChannelAddresseeNotMemberError(target);
  }
  // ⚠ A thread addressed to its own creator is DEAD ON ARRIVAL — only creator
  // and target may post, and here they are one person. Closes the AGENT path
  // (`to` is whatever user id the model resolved); the web composer already
  // filters the caller out of its addressee list
  // (`channels/components/composer.tsx`, off `indexMembers`).
  //
  // ⚠ SITS BEFORE THE IDEMPOTENCY SHORT-CIRCUIT ON PURPOSE. Behind it, a retry
  // with the same `client_msg_id` finds the stored dead thread and returns it as
  // a success — the caller is told it is fine exactly once it is unfixable.
  if (target === ctx.userId) {
    throw new ThreadSelfTargetError();
  }

  // A re-sent client_msg_id returns the caller's OWN already-created thread WITHOUT
  // a second row — {@link convergeOnThread}, also the 23505 branch's answer so the
  // two ways of losing a race cannot drift apart. ⚠ The probe is author-scoped:
  // another member's row under the same key is not a hit here and never was
  // supposed to be.
  if (input.clientMsgId) {
    const existing = await repoThreads.findOwnThreadByClientId(
      channel.id,
      ctx.userId,
      input.clientMsgId
    );
    if (existing) return convergeOnThread(ctx, channel.id, existing, input, opts);
  }

  let thread;
  try {
    thread = await repoThreads.insertThread({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      title: input.title,
      mode: input.mode ?? "interactive",
      created_by: ctx.userId,
      target_user_id: target ?? null,
      client_msg_id: input.clientMsgId ?? null,
    });
  } catch (err) {
    // Lost an idempotency race — converge on the stored winner. Re-driving the
    // post is safe (same derived key, so at most one message lands) and covers
    // the winner having crashed before posting.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoThreads.findOwnThreadByClientId(
        channel.id,
        ctx.userId,
        input.clientMsgId
      );
      if (raced) return convergeOnThread(ctx, channel.id, raced, input, opts);
    }
    throw err;
  }

  const openingSeq = await postOpeningMessage(
    ctx,
    channel.id,
    thread,
    input,
    opts.fanoutGroupId
  );

  return { thread: mapThreadRow(thread), openingSeq };
}

/**
 * Change a thread's mode. CREATOR ONLY — mode governs the creator's own machine.
 * ⚠ Posts NO message: deliberately realtime-invisible, since a mode is the
 * creator's machine's business, not a fact about the shared exchange.
 */
export async function setThreadMode(
  ctx: ChannelContext,
  ref: string,
  threadId: string,
  mode: ThreadMode
): Promise<ChannelThread> {
  const { channel } = await requireMemberChannel(
    ctx,
    ref,
    "change a thread's mode in this channel"
  );
  const thread = await repoThreads.findThreadByChannelAndId(channel.id, threadId);
  if (!thread) throw new ThreadNotFoundError(threadId);
  if (thread.created_by !== ctx.userId) {
    throw new ThreadForbiddenError("set the mode of this thread");
  }

  const updated = await repoThreads.updateThread(thread.id, { mode });
  return mapThreadRow(updated);
}
