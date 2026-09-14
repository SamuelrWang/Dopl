import "server-only";
import type { ChannelMessagePosted } from "../types";
import type { ChannelMessageCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelChatAddressedError,
  EscalationAlreadyAnsweredError,
} from "./errors";
// ⚠ The one key the insert may DROP and retry without — fold 11b's guess, never
// a pressed answer. See the 23505 branch in {@link postMessage}.
import { ESCALATION_ANSWER_METADATA_KEY } from "../escalation";
// Who may post a LIFECYCLE marker, and the server-internal options answering it.
import {
  assertLifecycleKindIsServerOwned,
  type PostMessageOptions,
} from "./service-writes-lifecycle";
import { hydrateOne, replayOf } from "./service-writes-ack";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { resolvePostMetadata } from "./service-writes-metadata";
import { resolveToRecipient } from "./service-writes-metadata-recipient";
import { resolveWakeVerdict } from "./service-wake-verdict";
import {
  requireMemberChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * Write-side channels service: post message / activity event. The mutation
 * re-checks the channel-scoped gate (member to post) — the route-level
 * `minRole` is only the workspace floor.
 *
 * Siblings, each with its own reason to change: the channel HEADER lifecycle
 * (create incl. direct, update incl. archive, soft-delete) is
 * `service-writes-channel.ts` and is re-exported from here, the membership lane
 * is `service-writes-members.ts`, the task lifecycle `service-tasks.ts`, and
 * the metadata folds a post goes through `service-writes-metadata.ts`.
 */

/**
 * Refuse a post that says `intent:"chat"` and then addresses a PERSON. The two
 * halves say opposite things, and reconciling either way is the
 * invisible-delivery failure the addressing contract exists to prevent — so 400,
 * never a silent pick.
 *
 * ⚠ Runs in {@link postMessage} BESIDE the addressee-membership check, i.e.
 * BEFORE the idempotency short-circuit: a contradictory post must 400 on the
 * retry too, not be answered with a stored message from a clean request.
 */
function assertChatIsUnaddressed(input: ChannelMessageCreateInput): void {
  if (input.intent !== "chat") return;
  if (input.toUserId) throw new ChannelChatAddressedError("toUserId");
  // ⚠ THE SECOND DOOR INTO THE SAME CONTRADICTION (2026-09-02, B4). `to` is the
  // union form of the same field, so a `chat` carrying one says the same two
  // opposite things — and leaving it out here would make "chat + addressed"
  // refusable through one spelling and silent through the other.
  if (input.to) throw new ChannelChatAddressedError("to");
}

/**
 * **ONE RECIPIENT, SO ONE FIELD** (2026-09-02, B4). `to` and `toUserId` are the
 * loose and the uuid form of the same thing; a post carrying both is a caller
 * that does not know which one it means, and picking either would be a guess
 * about who a message is for. 400, on `assertChatIsUnaddressed`'s terms and in
 * the same place, so it also refuses on the retry.
 */
function assertOneRecipientField(input: ChannelMessageCreateInput): void {
  if (input.to && input.toUserId) {
    throw new ChannelChatAddressedError("to + toUserId");
  }
}

// ─── Channel lifecycle ──────────────────────────────────────────────
// ⚠ EXTRACTED 2026-09-14 to `service-writes-channel.ts` — this file hit the
// cap. Re-exported so every caller of `createChannel` / `updateChannel` /
// `deleteChannel` keeps importing them from here (§1).
export {
  createChannel,
  deleteChannel,
  updateChannel,
} from "./service-writes-channel";

// ─── Messages ───────────────────────────────────────────────────────

/**
 * Post a message (or activity event) into a channel. ONE write — an idempotent
 * hit returns the stored row and writes nothing at all.
 *
 * ⚠ It used to carry one extra notice, `threadClosed`, about THIS CALL rather
 * than the message — deleted with thread closing (wiring plan Phase 4,
 * 2026-08-18). The return is now the stored message and nothing else.
 */
export async function postMessage(
  ctx: ChannelContext,
  ref: string,
  rawInput: ChannelMessageCreateInput,
  opts: PostMessageOptions = {}
): Promise<ChannelMessagePosted> {
  const raw = stripNulDeep(rawInput);
  const { channel } = await requireMemberChannel(ctx, ref, "post to this channel");

  // ⚠ Beside the membership check because both must precede the idempotency
  // short-circuit — a contradictory post has to fail on the retry too.
  assertChatIsUnaddressed(raw);
  assertOneRecipientField(raw);

  // **`to=` RESOLVED ONCE, HERE** (2026-09-02, B4 — ruling B1). A MEMBER becomes
  // the `toUserId` every fence below already knows how to check, so there is one
  // addressee path and not two; an AGENT rides `toAgentId` into the verdict and
  // stamps no metadata key (see `service-writes-metadata-recipient.ts`).
  //
  // ⚠ IT RUNS BEFORE THE IDEMPOTENCY SHORT-CIRCUIT for the same reason the two
  // asserts above do: `to` naming nobody is a REFUSAL (ruling B1), and a refusal
  // that a retry can replay out of storage is not one.
  let toAgentId: string | null = null;
  let input = raw;
  if (raw.to) {
    const recipient = await resolveToRecipient(ctx, channel, raw.to);
    if (recipient.kind === "member") {
      input = { ...raw, toUserId: recipient.userId };
    } else {
      toAgentId = recipient.agentId;
    }
  }
  // ⚠ Same placement rule, same reason. Takes no `opts` since 2026-08-20 — the
  // `internalLifecycle` exemption it used to read is deleted, so the credential
  // is the whole question.
  assertLifecycleKindIsServerOwned(ctx, input);

  // A `toUserId` must name an actual channel member, or the message targets a
  // listener that will never see it.
  //
  // ⚠ Channel membership is NOT enough: nothing sweeps `channel_members` on
  // workspace-leave, so a departed teammate stays a channel member — the post
  // lands, `openingSeq`/`await` arms, and nothing ever answers. Assert ACTIVE
  // workspace membership too. Channel check runs first, so the second round-trip
  // is only paid once a `toUserId` is a channel member.
  // ⚠ This cited "the same predicate `trust-service.isTrustedRequester` checks at
  // consumption" until 2026-08-22. That file is DELETED with the trust retirement
  // (INVARIANTS §6), so this is now the only place the rule is stated — it is not
  // a second copy of a check that lives elsewhere, and nothing re-asserts it later.
  if (
    input.toUserId &&
    !(
      (await repo.findMembership(channel.id, input.toUserId)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, input.toUserId))
    )
  ) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  // Re-sent client_msg_id returns the stored message and writes nothing.
  //
  // ⚠ AUTHOR-SCOPED, AND THAT IS A SECURITY BOUNDARY (2026-08-22). This probe was
  // `findMessageByClientId(channel.id, …)` — scoped to the CHANNEL — which made
  // idempotency a contract with the whole room rather than with the retrying
  // author. `client_msg_id`s are neither secret nor random on the one caller that
  // sets them at scale: the desktop stamps `agent-<agentId>-<n>`, `agentId` is
  // publicly readable off `channel_sessions.name`, and `n` counts from 1. So any
  // channel member could pre-claim another operator's agent's NEXT few keys and
  // have this line hand that agent back the attacker's row — `{ok}`, somebody
  // else's message id, nothing written, and the peer waiting on the thread never
  // told. See `repository-messages.ts › findOwnMessageByClientId`.
  if (input.clientMsgId) {
    const existing = await repoMessages.findOwnMessageByClientId(
      channel.id,
      ctx.userId,
      input.clientMsgId
    );
    if (existing) return replayOf(await hydrateOne(existing));
  }

  // Addressing, the reserved-key anti-spoof fold and
  // task-key stamping all live in `service-writes-metadata.ts` — ONE place
  // decides what a caller may put in `metadata`.
  const { metadata, memberHandles, typedEscalationAnswer } = await resolvePostMetadata(
    ctx,
    channel,
    input,
    {
      handoff: opts.handoff,
      fanoutGroupId: opts.fanoutGroupId,
    }
  );

  // ⚠ **WHO THIS IS FOR AND WHAT IT DID — DECIDED HERE, ONCE** (2026-09-02, A9).
  // It runs AFTER the metadata fold and reads that fold's output rather than the
  // caller's input, because `to_user_id` and `taskId` are only trustworthy once
  // the anti-spoof strip has re-stamped them from validated values.
  // ⚠ It comes AFTER the idempotency short-circuit too: a converged retry
  // returns the FIRST request's stored verdict, which is the whole point of the
  // key — a retry must not re-resolve against a world that has moved on.
  // `system` is server-reserved and rejected by the route schema, so a posted
  // message always ties to the acting user (agent posts included).
  //
  // ⚠ **IT IS RESOLVED BEFORE THE VERDICT NOW (2026-09-02, B4), BECAUSE THE
  // VERDICT BRANCHES ON IT.** RR2 and RR3 are the same situation — an
  // unaddressed post in the main room — split by whether an agent or a person
  // wrote it, and the credential is what answers that. Reading it after would
  // mean the resolver guessing from the body, which is the whole class of defect
  // this file's A9 note is about.
  //
  // ⚠ **THE CLAIM MAY ONLY ESCALATE, NEVER DOWNGRADE (2026-09-02, F-580).** It
  // was `input.authorKind ?? (ctx.source === "agent" ? …)` — a plain `??`, so an
  // AGENT CREDENTIAL could post `authorKind: "user"` and be routed as a person.
  // That is not a cosmetic label: the verdict splits RR2 from RR3 on it, and RR3
  // is the arm that reaches `liveChannelSessions` — CHANNEL-WIDE, every
  // operator's agents, the one door Samuel's same-account carve closes. That
  // file's own note says *"no path from an agent author reaches this function"*,
  // and the `??` was the path.
  //
  // So the two directions are NOT symmetric, and each has its own reason:
  //   - `ctx.source === "agent"` ⇒ `agent`, unconditionally. The credential is
  //     `auth.agentTokenId` (`service-shared.ts`), which nothing a caller sends
  //     can forge, and it is the stronger fact.
  //   - a COOKIE session may still CLAIM `agent`, and must: the desktop posts
  //     its agents' thread results over the operator's own Supabase session
  //     (`main/channel-post.js`), and that lane is the one this parameter exists
  //     for. Claiming `agent` only ever narrows the wake (RR2 over RR3), so it
  //     is safe in a way the reverse is not.
  const authorKind =
    ctx.source === "agent" || input.authorKind === "agent" ? "agent" : "user";

  const wake = await resolveWakeVerdict(ctx, channel, input, metadata, {
    authorKind,
    toAgentId,
    // ⚠ **MEMBERS OUTRANK AGENTS, AND THIS LINE IS THE WHOLE OF IT ON THE SERVER** (2026-09-07,
    // Samuel's suffix ruling). The handles are the metadata fold's own leftover — derived from
    // the roster and profiles it read for `mentionedUserIds`, on this same request — so the
    // agent index now mints `@diana-1` for an agent named after a member exactly as the
    // composer's line already predicted. Zero extra reads; the fold pays or nobody does.
    reservedHandles: memberHandles,
  });
  // ⚠ **WHY THIS AGENT, STORED BESIDE WHICH ONE** (2026-09-04). RR3 now CHOOSES
  // between several live agents when a person names nobody (Samuel's B1 — a
  // forgotten `@` must never stall), and a choice the author did not make has to
  // be sayable: the read renders `→ @<name> (most recent)` off it. Written HERE
  // rather than in the metadata fold because only the verdict knows it, which is
  // why that fold STRIPS it. ⚠ ABSENT, never `null`, on an address the author
  // wrote: a key on every row would make the pick unreadable.
  const stored = wake.reason ? { ...metadata, wake_reason: wake.reason } : metadata;

  // ⚠ THE INSERT, PARAMETERISED ON ITS METADATA FOR ONE REASON: the typed
  // escalation answer below has to be droppable and the row written anyway.
  // Nothing else about the write varies.
  const insertWith = (meta: Record<string, unknown>) =>
    repoMessages.insertMessage({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      author_user_id: ctx.userId,
      author_kind: authorKind,
      kind: input.kind ?? "message",
      body: input.body,
      metadata: meta,
      client_msg_id: input.clientMsgId ?? null,
      wake_verdict: wake.verdict,
      recipient_user_ids: wake.recipientUserIds,
      recipient_agent_ids: wake.recipientAgentIds,
      // ⚠ THE SERVER'S PREDICTION, WHICH THE MACHINE'S ACK OVERWRITES
      // (`service-writes-delivery.ts`). Stored rather than derived on read so a
      // later reader sees what was true AT THE TIME, not what the projection
      // says now.
      delivery: wake.delivery,
    });

  let row;
  try {
    row = await insertWith(stored);
  } catch (err) {
    // ⚠ Lost an idempotency race — the short-circuit reached a second way, so
    // it must answer identically, and therefore on the SAME scope. The unique
    // index is `(channel_id, client_msg_id, author_user_id)`, so a `23505` here
    // can only be this author's own concurrent retry; another member's row on
    // the same key no longer collides at all.
    // ⚠ THE ESCALATION INDEX IS THE SECOND WAY THIS TABLE CAN 23505, AND IT IS
    // CHECKED FIRST BECAUSE IT IS THE ONE WITH A NAME. `channel_messages` now
    // also carries a partial unique index over the answered escalation id, so a
    // second answer collides — and converging it onto the FIRST answer, the way
    // an idempotency retry converges, would report somebody else's decision back
    // as this caller's own. It is a 409 with a sentence instead.
    if (
      repo.pgErrorCode(err) === UNIQUE_VIOLATION &&
      input.escalationAnswer
    ) {
      throw new EscalationAlreadyAnsweredError(
        input.escalationAnswer.escalationMessageId
      );
    }
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoMessages.findOwnMessageByClientId(
        channel.id,
        ctx.userId,
        input.clientMsgId
      );
      // ⚠ THE SAME NOTICE ON BOTH DOORS. This IS the short-circuit, reached a
      // second way, so an ack that omitted `replayed` here would tell a caller
      // its concurrent retry had written a row.
      if (raced) return replayOf(await hydrateOne(raced));
    }
    // ⚠ **THE TYPED DOOR LOSES THE SAME RACE AND MUST NOT FAIL THE POST**
    // (2026-09-06). Fold 11b GUESSED this key off the body — the member typed a
    // sentence, not a decision — and its contract is that every near miss
    // leaves an ordinary message, silently. The open-card read cannot see a
    // press that commits after it, so the index refuses the stamp here; the
    // honest answer is the message WITHOUT it, which is what the member wrote.
    // Refusing instead would be the one outcome 11b exists to prevent, and
    // converging like an idempotency retry would report somebody else's
    // decision as this caller's.
    //
    // ⚠ **LAST OF THE THREE BRANCHES, AND THE ORDER IS LOAD-BEARING.** After the
    // pressed door, because only a GUESSED key may be dropped — a press that
    // lost the race is a decision that did not take, and it still 409s. After
    // the idempotency converge, because a `client_msg_id` collision is answered
    // by returning the stored row: retrying the insert on THAT one would only
    // hit the same index again and turn a clean replay into a throw.
    //
    // ⚠ **AND ONE PATH FALLS THROUGH THE CONVERGE INTO HERE**: `clientMsgId`
    // set, but the raced row NOT FOUND. That branch only returns when it reads
    // the row back, so control arrives here with the key still on `stored` — the
    // retry re-inserts the SAME `client_msg_id`, hits the SAME index, and the
    // un-caught second failure surfaces. That is the correct answer, not a hole:
    // a collision whose row cannot be read back a moment later is a real defect
    // (or a row deleted mid-flight), and reporting it is better than dropping the
    // caller's key to force the insert through.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && typedEscalationAnswer) {
      // ⚠ A COPY: `stored` may BE the fold's own object, and the retry must not
      // edit metadata anything else still holds.
      const plain = { ...stored };
      delete plain[ESCALATION_ANSWER_METADATA_KEY];
      // ⚠ ONE retry, un-caught: a second failure is a real defect, and it must
      // surface rather than loop.
      row = await insertWith(plain);
      await repo.touchChannel(ctx.workspaceId, channel.id);
      return hydrateOne(row);
    }
    throw err;
  }

  await repo.touchChannel(ctx.workspaceId, channel.id);
  return hydrateOne(row);
}
