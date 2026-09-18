/** Split out of `service-writes.ts` (2026-09-14, 500-line cap): the CHANNEL HEADER lifecycle — create (incl. direct), update (incl. archive) and soft-delete — leaving `service-writes.ts` the message-post lane; every name here is re-exported from `service-writes.ts`, so no importer moved. */
import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Channel } from "../types";
import type { ChannelCreateInput, ChannelUpdateInput } from "../schema";
import {
  ChannelForbiddenError,
  ChannelInfoCardTooLargeError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
} from "./errors";
import { INFO_CARD_MAX_BYTES, infoCardTextBytes } from "../info-card";
import * as repo from "./repository";
import { getChannel } from "./service-list";
import { createDirectChannel } from "./service-writes-direct";
import {
  canManageChannel,
  loadVisibleChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

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
  // 🔴 **`archived` IS DELETED FROM THIS LIST AND FROM THE PRODUCT (Samuel's
  // ruling R-21, 2026-09-17):** *"a user can delete a channel; no point in
  // archives."* It is off `ChannelUpdateSchema` too, so it is unwritable rather
  // than merely ungated — and `channels.archived_at` has no writer at all now.
  // ⚠ **`agentPosture` IS DELETED FROM THIS LIST AND FROM THE PRODUCT (2026-09-06,
  // Samuel's rulings on items 12, 13 and 14).** It was MANAGED rather than
  // member-gated because it decided how much room somebody ELSE's agent got in
  // this room, which made widening it a permission change. That whole class of
  // control is gone: no room bounds a peer's agent on any axis now, so there is
  // no field here to gate. The argument is preserved in
  // `settings-channel-agents.tsx`, where the rows were, and in the migration.
  // ⚠ **`defaultResponderAgentName` IS DELETED FROM THIS LIST AND FROM THE PRODUCT
  // (2026-09-07, items 10 and 11).** It was MANAGED because it was a statement about a machine
  // the setter does not own — which agent the room's unaddressed work lands on. Its
  // replacement makes that gate unnecessary rather than merely moving it: a member may only
  // ever set their OWN row, so there is no longer a decision here that reaches anybody else.
  //
  // ⚠ WHAT THE MOVE DOES *NOT* LOSE, because it is the obvious thing to fear: the old field
  // was also `sessionOnly` at the route (an agent credential could otherwise nominate ITSELF
  // and route the room's unaddressed work to its own session). `PATCH /members` — where the
  // replacement is written — is `sessionOnly: true` for the WHOLE METHOD already, for
  // `agentToolProfile`'s containment reason. The protection is inherited, not dropped.
] as const satisfies ReadonlyArray<keyof ChannelUpdateInput>;

export async function updateChannel(
  ctx: ChannelContext,
  ref: string,
  rawPatch: ChannelUpdateInput
): Promise<Channel> {
  const patch = stripNulDeep(rawPatch);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);

  // ⚠ TWO GATES ON ONE VERB, AND THE STRICTER ONE IS STILL THE DEFAULT
  // (2026-08-25). The header — name, topic, visibility — stays MANAGE-gated
  // exactly as it was; nothing about it moved.
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
  // ⚠ **THE `archived_at` STAMP WAS WRITTEN HERE AND IS DELETED (R-21,
  // 2026-09-17).** `archived ? now : null` was the only writer of that column in
  // the codebase; nothing sets or clears it now.
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
  // ⚠ **THE `agentPosture` WRITE IS DELETED (2026-09-06, items 12, 13, 14)** along with the
  // three columns it fanned out to. Its per-axis rule — absent means "leave it", `null` means
  // "record no ceiling on that axis" — was the only way a recorded ceiling could be removed,
  // and it is preserved below for `defaultResponderAgentName`, which still needs it.
  // ⚠ **NOTHING MIGRATES THE OLD VALUES.** A channel whose row still carries a ceiling simply
  // has it read by nobody; the migration is non-destructive and the columns stay. Writing a
  // clearing UPDATE across every channel would be a destructive backfill nobody ruled, and it
  // would also be pointless — an unread column bounds nothing.
  // ⚠ **AND THE `defaultResponderAgentName` WRITE IS DELETED WITH IT (2026-09-07, items 10 and
  // 11).** It was the last field carrying the per-axis `null`-is-the-clear rule on this patch;
  // the rule is not lost, it simply has nothing left here to govern. `infoCard` above is a
  // whole-object replace and the other four are plain values.
  //
  // ⚠ **THE COLUMN IS NOT CLEARED, ONLY UNWRITTEN.** `20260928130000` retires
  // `channels.default_responder_agent_name` non-destructively; a room that still carries a
  // stored handle simply has it read by nobody. Writing a clearing UPDATE across every channel
  // would be a destructive backfill nobody ruled — the same call the ceiling made.

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
