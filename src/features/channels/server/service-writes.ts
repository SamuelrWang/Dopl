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
  ChannelInviteeNotMemberError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
} from "./errors";
// P0-2 — who may post a LIFECYCLE marker, and the server-internal options that
// answer it. Its own module (§2 cap) because it is its own reason to change: a
// question about the caller's standing, not about the write or what it stores.
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
 * Refuse a post that says `intent:"chat"` and then addresses a PERSON.
 *
 * The two halves say opposite things — chat means "do not raise a prompt on
 * anyone's machine", an addressee means "raise one on exactly this machine" —
 * and reconciling either way is the invisible-delivery failure the addressing
 * contract exists to prevent. So it is a 400, not a silent pick.
 *
 * It used to live in `service-writes-agents.ts` beside the named-agent
 * resolution, and its name meant "unaddressed BY A HUMAN ADDRESSEE" because a
 * `toAgent` under chat was allowed. With agent addressing gone (rollback §1)
 * there is only one kind of addressee left and the name is simply true.
 *
 * Cheap and pure, so it runs in {@link postMessage} BESIDE the addressee-
 * membership check — i.e. BEFORE the idempotency short-circuit, exactly like
 * that one. A contradictory post must 400 on the retry too, not be answered
 * with the stored message from a request that never had the contradiction.
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

  // The creator is the channel owner.
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
 * Open (or dedup-return) a direct (1:1) channel with `memberUserId`. The
 * `direct_key` is the two user-ids sorted and joined ':'; a lookup by
 * (workspace, direct_key) makes repeat opens idempotent ("open existing"). The
 * peer must be an active workspace member, a self-DM is refused, and exactly
 * two members are inserted (membership-of-2 lives here — a CHECK can't count).
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
  // Idempotent open. Look up INCLUDING soft-deleted rows: the partial unique
  // index counts a soft-deleted DM, so a fresh insert for a deleted pair would
  // 23505. A live row is returned as-is (dedup); a soft-deleted row is REVIVED
  // — un-hidden and its two member rows restored — so the same conversation
  // (and its history) reopens. A DM delete is "hide until reopened".
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
      // Stored but ignored by the DM UI (it renders the peer). NOT NULL / CHECK
      // still require a non-empty name.
      name: "Direct message",
      topic: "",
      visibility: "private",
      is_direct: true,
      direct_key: directKey,
    });
  } catch (err) {
    // A 23505 here is either the direct_key index (a concurrent open of the
    // SAME pair) or the workspace slug index (a concurrent create that took
    // the slug this call had already picked). Look the pair up INCLUDING
    // soft-deleted rows — the same reason the pre-insert lookup does — and
    // converge on it; a slug race resolves to nothing and surfaces as a clean
    // 409 instead of the raw 23505 becoming a generic 500 on "open direct
    // message".
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
 * Return an existing direct channel, reviving it first when it was
 * soft-deleted (un-hidden) so the same conversation — and its history —
 * reopens. A live row is returned as-is.
 *
 * The two member rows are re-asserted on EVERY open, not only on the revive
 * branch (Q2). A live DM with a torn roster is otherwise a dead end: the
 * missing side reads the channel as not-found (`getChannel` →
 * `loadVisibleChannel`), and the partial unique index on `direct_key` keeps
 * the live row reserving the pair, so a fresh DM can't be created either.
 * `removeMember` refuses to tear a DM at the MEMBER level — but that is no
 * longer the whole story: a WORKSPACE departure legitimately removes the
 * leaver's row after soft-closing the pair (`service-workspace-departure.ts`),
 * and pairs damaged before the member guard existed are unreachable by any
 * other repair path — re-asserting here makes them self-heal on the next
 * open, from EITHER side (a rejoined leaver included). Two membership
 * reads on a dedup path (not a hot one) is the whole cost.
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
 * Restore one member of a reopened direct channel. A soft-delete leaves the
 * `channel_members` rows in place, so this is normally a no-op: re-insert only
 * the row that went missing. The caller takes `owner` and the peer `member`,
 * so a pair healed from the evicted side still has someone who can manage it.
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

export async function updateChannel(
  ctx: ChannelContext,
  ref: string,
  rawPatch: ChannelUpdateInput
): Promise<Channel> {
  const patch = stripNulDeep(rawPatch);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!canManageChannel(ctx, membership)) {
    throw new ChannelForbiddenError("manage this channel");
  }
  // A DM is always private (DB CHECK). Reject a visibility change here so it
  // returns a clean 400 instead of surfacing the raw CHECK-constraint 500.
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

  await repo.updateChannel(ctx.workspaceId, channel.id, dbPatch);
  return getChannel(ctx, channel.id);
}

/**
 * TWO DELETES BEHIND ONE VERB, and the branch is `is_direct` (Samuel's
 * decision, 2026-08-08 — C-16, F-173). Getting the branch backwards destroys
 * data in one direction and strands it forever in the other, so it is stated
 * here rather than inferred at the repository.
 *
 * **A DM: SOFT, and that is not a trash.** `channels.deleted_at` on a direct
 * channel is the CLOSE half of close/reopen — either side's next open revives
 * the same row with its full history (`reviveChannel` / `reopenDirectChannel`).
 * Both members may do it: a DM has no real manage hierarchy (one side holds the
 * `owner` row only because they happened to open the conversation), and since a
 * DM's roster is immutable (`removeMember` refuses to tear the pair) this is the
 * ONLY exit the non-creator has. Hard-deleting a DM would let one member destroy
 * a shared transcript on a unilateral click, which is exactly what the
 * reversible design exists to prevent. ENGINEERING §7 and migration
 * `20260807110000`'s header both say so; do not "finish the job" here.
 *
 * **Anything else: HARD, cascading, gone.** Owner / workspace-admin only, as
 * before — the authorization is untouched, only the write at the end changed,
 * the same shape the rest of the app took in §2b. Before this, a non-DM delete
 * stamped `deleted_at` and produced a row that was unreachable in every
 * direction at once: no revive path (`reviveChannel`'s only caller is the DM
 * reopen), no restore route, no trash, deliberately excluded from the purge
 * sweep — and still holding its slug against a non-partial unique index, so
 * recreating the channel by its own name 409'd against something nobody could
 * see. "Permanently deletes" in the dialog was the only honest half of it.
 * Now the row is really gone, its messages / members / threads cascade with it
 * (`hardDeleteChannel` documents the FK chain), and the slug is reusable.
 *
 * NO SEPARATE REALTIME DOORBELL IS NEEDED, and this is the one non-obvious
 * consequence. `channels` stays at `REPLICA IDENTITY DEFAULT`, so its own DELETE
 * frame carries only the primary key and the subscribers' `workspace_id=eq.…`
 * filter drops it. It does not matter: the cascade fires real DELETEs on
 * `channel_members`, which DOES carry `workspace_id` in its replica identity
 * (`20260807150000`) and rides the SAME refetch signal in both subscribers
 * (`CHANNEL_TABLES`, `SYNC_TABLES`). One doorbell, already paid for. Putting an
 * identity on `channels` instead would widen the WAL record of `touchChannel`,
 * which runs on EVERY message post — the hottest update in the feature — to fix
 * a frame that already arrives.
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
 * Post a message (or an activity event) into a channel.
 *
 * ONE WRITE. It used to be two — the message insert plus an ENGAGEMENT stamp on
 * `channel_agents` — wrapped in a shared idempotency envelope so a lost stamp
 * could be repaired by a retry. Engagement is gone with the named agents it
 * described (rollback §1), so the second write, its replay repair and the
 * `replayStoredMessage` seam are gone with it: an idempotent hit now returns the
 * stored row and writes nothing at all.
 *
 * F6 — THE RETURN CARRIES ONE NOTICE, `threadClosed`, and it is a notice about
 * THIS CALL rather than a property of the message. A closed thread still ACCEPTS
 * the post (the decided behaviour — see `isThreadClosed`), so nothing about the
 * stored row changes; what changes is that the caller is told. It is set only on
 * the path that actually resolved the thread, which means an IDEMPOTENT REPLAY
 * does not carry it: a replay re-posts nothing and re-resolves nothing, and
 * inventing the flag there would mean re-reading a thread row to describe a
 * write that already happened.
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

  // `intent:"chat"` means "reach nobody's agent", so naming an addressee
  // contradicts it — 400 rather than silently picking a half. Beside the
  // membership check because both must precede the idempotency short-circuit:
  // a contradictory post has to fail on the retry too.
  assertChatIsUnaddressed(input);
  // P0-2 — and the same placement rule, for the same reason.
  assertLifecycleKindIsServerOwned(ctx, input, opts);

  // Addressing (v1.1): a `toUserId` must name an actual channel member —
  // otherwise the message would target a listener that will never see it.
  //
  // C-20: channel membership is NOT enough. Nothing sweeps `channel_members`
  // when someone leaves the workspace, so a departed teammate stays a channel
  // member here — the post lands, `openingSeq`/`await` arms, and nothing ever
  // answers. Assert ACTIVE workspace membership too, the same predicate (and for
  // the same reason) trust checks at consumption — see
  // `trust-service.isTrustedRequester`: "a rule outlives the teammate leaving".
  // Fail closed with the existing undeliverability error rather than accept an
  // address that can never be answered. The channel check runs first, so the
  // second round-trip is only paid once a `toUserId` is a channel member.
  if (
    input.toUserId &&
    !(
      (await repo.findMembership(channel.id, input.toUserId)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, input.toUserId))
    )
  ) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  // Idempotency: a re-sent client_msg_id returns the stored message and writes
  // nothing.
  if (input.clientMsgId) {
    const existing = await repoMessages.findMessageByClientId(channel.id, input.clientMsgId);
    if (existing) return hydrateOne(existing);
  }

  // Addressing (incl. the DM auto-address), the reserved-key anti-spoof fold
  // and the task-key stamping all live in `service-writes-metadata.ts` — one
  // place decides what a caller may put in `metadata` and what the server
  // stamps itself (jsonb, no schema change).
  const { metadata, threadClosed } = await resolvePostMetadata(
    ctx,
    channel,
    input,
    {
      closeProposal: opts.closeProposal,
      reopened: opts.reopened,
      handoff: opts.handoff,
    }
  );

  // `system` is server-reserved and rejected by the route schema, so a posted
  // message always ties to the acting user (agent posts included — the agent
  // acts on behalf of the token's owner).
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
    // Lost an idempotency race — converge on the stored winner: this is the
    // short-circuit reached a second way and must answer identically.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoMessages.findMessageByClientId(channel.id, input.clientMsgId);
      if (raced) return hydrateOne(raced);
    }
    throw err;
  }

  // Surface the channel as active (list sorts by updated_at).
  await repo.touchChannel(ctx.workspaceId, channel.id);
  const message = await hydrateOne(row);
  // F6: the flag is ADDED ONLY WHEN TRUE, so a post into an open thread (or no
  // thread at all) returns byte-for-byte the object it always did.
  return threadClosed ? { ...message, threadClosed: true } : message;
}

async function hydrateOne(row: ChannelMessageRow): Promise<ChannelMessage> {
  if (!row.author_user_id) return mapMessageRow(row, undefined);
  const profiles = await profilesById([row.author_user_id]);
  return mapMessageRow(row, profiles.get(row.author_user_id));
}
