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
  ChannelInviteeNotMemberError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
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
import { resolvePostMetadata } from "./service-writes-metadata";
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
 * Open (or dedup-return) a direct channel. `direct_key` is the two user-ids
 * sorted and joined ':'; lookup by (workspace, direct_key) makes repeat opens
 * idempotent. Peer must be an active workspace member, self-DM refused, exactly
 * two members inserted — ⚠ membership-of-2 lives here because a CHECK can't
 * count.
 */
async function createDirectChannel(
  ctx: ChannelContext,
  memberUserId: string
): Promise<Channel> {
  if (memberUserId === ctx.userId) {
    throw new DirectSelfTargetError();
  }
  if (!(await repo.isActiveWorkspaceMember(ctx.workspaceId, memberUserId))) {
    throw new ChannelInviteeNotMemberError(memberUserId);
  }

  const directKey = [ctx.userId, memberUserId].sort().join(":");
  // ⚠ Look up INCLUDING soft-deleted rows — the partial unique index counts a
  // soft-deleted DM, so a fresh insert for a deleted pair 23505s. Live row
  // returned as-is; soft-deleted row REVIVED with its member rows, so the same
  // conversation and history reopen. A DM delete is "hide until reopened".
  const existing = await repo.findDirectChannelAnyStatus(
    ctx.workspaceId,
    directKey
  );
  if (existing) return reopenDirectChannel(ctx, existing, memberUserId);

  const taken = await repo.existingSlugs(ctx.workspaceId);
  const slug = slugify("direct-message", "dm", taken);

  let channel;
  try {
    channel = await repo.insertChannel({
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      slug,
      // Ignored by the DM UI (it renders the peer), but NOT NULL / CHECK still
      // require a non-empty name.
      name: "Direct message",
      topic: "",
      visibility: "private",
      is_direct: true,
      direct_key: directKey,
    });
  } catch (err) {
    // 23505 = the direct_key index (concurrent open of the SAME pair) or the
    // workspace slug index (concurrent create took the slug). ⚠ Look the pair up
    // INCLUDING soft-deleted rows and converge; a slug race resolves to nothing
    // and surfaces as a clean 409 instead of a generic 500.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      const raced = await repo.findDirectChannelAnyStatus(
        ctx.workspaceId,
        directKey
      );
      if (raced) return reopenDirectChannel(ctx, raced, memberUserId);
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
  await repo.insertMember({
    channel_id: channel.id,
    user_id: memberUserId,
    workspace_id: ctx.workspaceId,
    role: "member",
    added_by: ctx.userId,
  });

  return getChannel(ctx, channel.id);
}

/**
 * Return an existing direct channel, reviving it first when soft-deleted so the
 * same conversation and history reopen. A live row is returned as-is.
 *
 * ⚠ Both member rows are re-asserted on EVERY open, not only the revive branch.
 * A live DM with a torn roster is otherwise a dead end: the missing side reads
 * the channel as not-found, and the partial unique index on `direct_key` keeps
 * the live row reserving the pair, so no fresh DM can be created either. A
 * WORKSPACE departure legitimately removes the leaver's row
 * (`service-workspace-departure.ts`), so re-asserting here is the only self-heal
 * — from EITHER side, a rejoined leaver included.
 */
async function reopenDirectChannel(
  ctx: ChannelContext,
  existing: { id: string; deleted_at: string | null },
  memberUserId: string
): Promise<Channel> {
  if (existing.deleted_at) {
    await repo.reviveChannel(ctx.workspaceId, existing.id);
  }
  await ensureDirectMember(ctx, existing.id, ctx.userId, "owner");
  await ensureDirectMember(ctx, existing.id, memberUserId, "member");
  return getChannel(ctx, existing.id);
}

/**
 * Restore one member of a reopened direct channel — normally a no-op, since a
 * soft-delete leaves `channel_members` in place. Caller takes `owner`, peer
 * `member`, so a pair healed from the evicted side still has a manager.
 */
async function ensureDirectMember(
  ctx: ChannelContext,
  channelId: string,
  userId: string,
  role: "owner" | "member"
): Promise<void> {
  if (await repo.findMembership(channelId, userId)) return;
  await repo.insertMember({
    channel_id: channelId,
    user_id: userId,
    workspace_id: ctx.workspaceId,
    role,
    added_by: ctx.userId,
  });
}

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
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("post to this channel");
  }

  // ⚠ Beside the membership check because both must precede the idempotency
  // short-circuit — a contradictory post has to fail on the retry too.
  assertChatIsUnaddressed(input);
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

  // `system` is server-reserved and rejected by the route schema, so a posted
  // message always ties to the acting user (agent posts included).
  const authorKind =
    input.authorKind ?? (ctx.source === "agent" ? "agent" : "user");

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
