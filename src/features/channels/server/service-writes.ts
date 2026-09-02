import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Channel, ChannelMessage, ChannelMessagePosted } from "../types";
import type {
  ChannelCreateInput,
  ChannelMessageCreateInput,
  ChannelUpdateInput,
} from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelChatAddressedError,
  ChannelForbiddenError,
  ChannelInfoCardTooLargeError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
  EscalationAlreadyAnsweredError,
} from "./errors";
import {
  INFO_CARD_MAX_BYTES,
  infoCardTextBytes,
} from "../info-card";
// Who may post a LIFECYCLE marker, and the server-internal options answering it.
import {
  assertLifecycleKindIsServerOwned,
  type PostMessageOptions,
} from "./service-writes-lifecycle";
import { mapMessageRow, type ChannelMessageRow } from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { getChannel } from "./service-reads";
import { createDirectChannel } from "./service-writes-direct";
import { resolvePostMetadata } from "./service-writes-metadata";
import { resolveToRecipient } from "./service-writes-metadata-recipient";
import { resolveWakeVerdict } from "./service-wake-verdict";
import {
  canManageChannel,
  loadVisibleChannel,
  profilesById,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * Write-side channels service: create (incl. direct), header update (incl.
 * archive), soft-delete, and post message / activity event. Every mutation
 * re-checks the channel-scoped gate (member to post, owner or workspace admin
 * to manage) — the route-level `minRole` is only the workspace floor.
 *
 * Siblings, each with its own reason to change: the membership lane is
 * `service-writes-members.ts`, the task lifecycle `service-tasks.ts`, and the
 * metadata folds a post goes through `service-writes-metadata.ts`.
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

export async function createChannel(
  ctx: ChannelContext,
  input: ChannelCreateInput
): Promise<Channel> {
  if (input.direct === true) {
    return createDirectChannel(ctx, input.memberUserId);
  }
  const clean = stripNulDeep(input);
  const taken = await repo.existingSlugs(ctx.workspaceId);
  const slug = slugify(clean.slug ?? clean.name, "channel", taken);

  let channel;
  try {
    channel = await repo.insertChannel({
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      slug,
      name: clean.name,
      topic: clean.topic ?? "",
      visibility: clean.visibility ?? "private",
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChannelSlugConflictError(slug);
    }
    throw err;
  }

  await repo.insertMember({
    channel_id: channel.id,
    user_id: ctx.userId,
    workspace_id: ctx.workspaceId,
    role: "owner",
    added_by: ctx.userId,
  });

  return getChannel(ctx, channel.id);
}

/**
 * ⚠ **THE DM LIFECYCLE — open, dedup, revive, self-heal — LIVES IN
 * `service-writes-direct.ts`** (§1 split, 2026-09-02, at the cap). The seam is
 * real: that file changes when the two-member DM contract changes (the
 * `direct_key` dedup, the soft-delete revive, the torn-roster self-heal), and
 * this one when a channel WRITE does. `createChannel` above still dispatches to
 * it, so there is no second door.
 */

/**
 * THE FOUR HEADER FIELDS `updateChannel` REQUIRES `canManageChannel` FOR.
 *
 * ⚠ IT IS A LIST OF WHAT IS MANAGED, NOT A LIST OF WHAT EXISTS — read it that
 * way and a fifth field added to `ChannelUpdateSchema` without a decision here
 * would be silently ungated. {@link updateChannel} therefore derives the loose
 * set by SUBTRACTION (`infoCard` and nothing else), so a new field lands in the
 * MANAGED half by default and the compiler carries the choice.
 */
const MANAGED_CHANNEL_FIELDS = [
  "name",
  "topic",
  "visibility",
  "archived",
  // ⚠ **THE POSTURE CEILING IS MANAGED, NOT MEMBER-GATED (2026-09-02, A9 —
  // G6/G7)**, which is the OPPOSITE call from `infoCard` one field along. The
  // card is a shared scratch surface about a relationship; this decides how much
  // room somebody else's agent gets in this room, and widening it is a
  // permission change. It is listed here rather than left to the subtraction
  // below because the default this list produces — MANAGED — is the one it
  // wants, and stating it is what keeps that from looking accidental.
  "agentPosture",
  // ⚠ **MANAGED FOR `agentPosture`'s REASON, ONE STEP SHARPER (2026-09-02, B4 —
  // ruling B6).** The ceiling decides how much room somebody else's agent gets
  // here; this decides WHOSE agent the room's unaddressed work lands on, which
  // is a statement about a machine the setter does not own. ⚠ **THE SERVER IS
  // THE GATE.** The Settings control is an affordance — a UI that hid the row
  // would change nothing about who may write the field.
  "defaultResponderAgentName",
] as const satisfies ReadonlyArray<keyof ChannelUpdateInput>;

export async function updateChannel(
  ctx: ChannelContext,
  ref: string,
  rawPatch: ChannelUpdateInput
): Promise<Channel> {
  const patch = stripNulDeep(rawPatch);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);

  // ⚠ TWO GATES ON ONE VERB, AND THE STRICTER ONE IS STILL THE DEFAULT
  // (2026-08-25). The header — name, topic, visibility, archived — stays
  // MANAGE-gated exactly as it was; nothing about it moved.
  //
  // `infoCard` is gated on MEMBERSHIP, and the reason is INVARIANTS §4A's own,
  // in Samuel's words: a home channel is "a relationship, not a tenancy" —
  // which is why ANY member of a container may mint its link rather than the
  // owner only. The card is that relationship's shared scratch surface: the
  // operator curates their side of a two-person channel, and a peer who cannot
  // correct their own phone number on a card ABOUT THEM is the failure. It
  // changes no visibility, no roster, no lifecycle and no fact — only what the
  // Info tab shows (`info-card.ts`).
  //
  // ⚠ A NON-MEMBER OF A PUBLIC CHANNEL IS STILL REFUSED. `loadVisibleChannel`
  // hands back `membership: null` for a public channel a workspace member can
  // merely SEE, and reading a room is not joining it.
  const managed = MANAGED_CHANNEL_FIELDS.some((f) => patch[f] !== undefined);
  if (managed ? !canManageChannel(ctx, membership) : membership === null) {
    throw new ChannelForbiddenError(
      managed ? "manage this channel" : "edit this channel's info card"
    );
  }
  // ⚠ A DM is always private (DB CHECK) — reject the visibility change here for
  // a clean 400 instead of a raw CHECK-constraint 500.
  if (channel.is_direct && patch.visibility !== undefined) {
    throw new DirectChannelImmutableError("visibility");
  }

  const dbPatch: Parameters<typeof repo.updateChannel>[2] = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.topic !== undefined) dbPatch.topic = patch.topic;
  if (patch.visibility !== undefined) dbPatch.visibility = patch.visibility;
  if (patch.archived !== undefined) {
    dbPatch.archived_at = patch.archived ? new Date().toISOString() : null;
  }
  // ⚠ WHOLE-CARD REPLACE, never a merge. The client read this card, edited it
  // and is sending it back — merging server-side would make "remove the last
  // custom row" unexpressible, since an empty `rows` would read as "no opinion".
  if (patch.infoCard !== undefined) {
    // ⚠ THE BYTE FENCE IN FRONT OF `channels_info_card_check`. The zod caps bound
    // each field but not the TOTAL, and a full CJK card measures well over the
    // 4 KiB floor once `::text` adds its separators — which would 500 as an
    // unclassifiable PostgREST constraint failure. Measure the same jsonb text
    // form here and raise a real 413 first.
    const bytes = infoCardTextBytes(patch.infoCard);
    if (bytes > INFO_CARD_MAX_BYTES) {
      throw new ChannelInfoCardTooLargeError(bytes, INFO_CARD_MAX_BYTES);
    }
    dbPatch.info_card = patch.infoCard;
  }
  // ⚠ **PER AXIS, AND `null` IS A VALUE.** Absent means "no opinion, leave it";
  // `null` means "this channel records no ceiling on that axis any more", which
  // is the only way a recorded ceiling can be removed. Collapsing the two —
  // `patch.agentPosture.tools ?? undefined` — would make a ceiling permanent.
  if (patch.agentPosture) {
    const p = patch.agentPosture;
    if (p.tools !== undefined) dbPatch.agent_tool_ceiling = p.tools;
    if (p.messages !== undefined) dbPatch.agent_message_ceiling = p.messages;
    if (p.chain !== undefined) dbPatch.agent_chain_allowed = p.chain;
  }
  // ⚠ **`null` IS A VALUE HERE TOO** — see the posture note above. `undefined`
  // leaves the nomination alone; `null` withdraws it.
  if (patch.defaultResponderAgentName !== undefined) {
    dbPatch.default_responder_agent_name = patch.defaultResponderAgentName;
  }

  await repo.updateChannel(ctx.workspaceId, channel.id, dbPatch);
  return getChannel(ctx, channel.id);
}

/**
 * ⚠ TWO DELETES BEHIND ONE VERB, branching on `is_direct`. Backwards, it
 * destroys data one way and strands it forever the other.
 *
 * **DM: SOFT, and not a trash.** `channels.deleted_at` on a direct channel is
 * the CLOSE half of close/reopen — either side's next open revives the same row
 * with its history (`reviveChannel` / `reopenDirectChannel`). Both members may
 * do it (a DM has no real manage hierarchy) and, since the roster is immutable,
 * it is the non-creator's ONLY exit. ⚠ Do not "finish the job" and hard-delete:
 * that lets one member destroy a shared transcript on a unilateral click.
 * ENGINEERING §7 and migration `20260807110000`'s header both say so.
 *
 * **Anything else: HARD, cascading, gone.** Owner / workspace-admin only.
 * Messages / members / threads cascade (`hardDeleteChannel` documents the FK
 * chain) and the slug becomes reusable.
 *
 * ⚠ No separate realtime doorbell is needed. `channels` stays at `REPLICA
 * IDENTITY DEFAULT`, so its DELETE frame carries only the PK and the
 * subscribers' `workspace_id=eq.…` filter drops it — but the cascade fires real
 * DELETEs on `channel_members`, which DOES carry `workspace_id`
 * (`20260807150000`) and rides the same refetch signal in both subscribers.
 * Adding an identity to `channels` would widen the WAL record of
 * `touchChannel`, which runs on EVERY message post.
 */
export async function deleteChannel(
  ctx: ChannelContext,
  ref: string
): Promise<void> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const allowed = channel.is_direct
    ? membership !== null
    : canManageChannel(ctx, membership);
  if (!allowed) {
    throw new ChannelForbiddenError("delete this channel");
  }
  if (channel.is_direct) {
    await repo.softDeleteChannel(ctx.workspaceId, channel.id);
    return;
  }
  await repo.hardDeleteChannel(ctx.workspaceId, channel.id);
}

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
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("post to this channel");
  }

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
    if (existing) return hydrateOne(existing);
  }

  // Addressing, the reserved-key anti-spoof fold and
  // task-key stamping all live in `service-writes-metadata.ts` — ONE place
  // decides what a caller may put in `metadata`.
  const { metadata } = await resolvePostMetadata(ctx, channel, input, {
    handoff: opts.handoff,
    fanoutGroupId: opts.fanoutGroupId,
  });

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
  const authorKind =
    input.authorKind ?? (ctx.source === "agent" ? "agent" : "user");

  const wake = await resolveWakeVerdict(ctx, channel, input, metadata, {
    authorKind,
    toAgentId,
  });

  let row;
  try {
    row = await repoMessages.insertMessage({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      author_user_id: ctx.userId,
      author_kind: authorKind,
      kind: input.kind ?? "message",
      body: input.body,
      metadata,
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
      if (raced) return hydrateOne(raced);
    }
    throw err;
  }

  await repo.touchChannel(ctx.workspaceId, channel.id);
  return hydrateOne(row);
}

async function hydrateOne(row: ChannelMessageRow): Promise<ChannelMessage> {
  if (!row.author_user_id) return mapMessageRow(row, undefined);
  const profiles = await profilesById([row.author_user_id]);
  return mapMessageRow(row, profiles.get(row.author_user_id));
}
