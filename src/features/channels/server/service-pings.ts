import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelPing, PingKind, PingRecipientKind } from "../types-ping";
import type { PingCreateInput, PingListQuery } from "../schema-ping";
import {
  ChannelNotFoundError,
  PingRecipientNotMemberError,
  PingSelfTargetError,
} from "./errors";
import * as repo from "./repository";
import * as pingRepo from "./repository-pings";
import type { ChannelPingRow } from "./repository-pings";
import {
  listMemberChannelRefs,
  type MemberChannelRef,
} from "./repository-await-workspace";
import * as repoTasks from "./repository-tasks";
import { senderAgentIdFrom } from "./service-directions";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * THE "NEEDS YOU" SIGNAL — one agent telling exactly ONE recipient that it is
 * done, has a question, or is blocked (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **IT IS THE DIRECT LANE'S SIBLING, NOT ITS SUBTYPE**, and off
 * `channel_messages` for the direct lane's reasons plus its own: it must not fan
 * out, it must not end a channel `await`, and it needs its own cursor. None of
 * the post-path machinery applies to it and none of it should be reachable from
 * here.
 *
 * 🔒 **`sender_user_id` IS `ctx.userId` AND IS NEVER A PARAMETER.** No schema in
 * `schema-ping.ts` has such a field and none may ever get one — it is passed to
 * the repository as a SEPARATE positional argument, so nothing built from a
 * request body can reach it.
 *
 * 🔒 **AND THE SAME ABSENCE IS THE LOOP BRAKE ON THE RECIPIENT.** Two of the
 * three recipient forms — `toDesktop` and `agentId` — STAMP `ctx.userId` as the
 * recipient and take no operator argument at all. That is `direct_agent`'s
 * authorization story reused verbatim: **an agent can never ping another
 * member's agent**, because there is no request field with which to say so. The
 * `member` form is the one that names somebody else, and it is fenced the way a
 * post is — sender must be a MEMBER of the channel, recipient must be one too.
 */

/**
 * Row → DTO.
 *
 * ⚠ `?? null` ON EVERY OPTIONAL COLUMN, and it is the same rule
 * `service-directions.ts › toDirection` states: an ABSENT field maps to "not
 * reported", never to a substantive value. `senderAgentId` is the one that
 * matters — a deployment whose migration has not replayed, or an external
 * orchestrator with no session stamp, both produce `null`, and `null` means
 * UNKNOWN, never "a human sent it". `channelSlug` is `null` when the hydration
 * found no channel, which forces a render to fall back to the id.
 *
 * ⚠ NO LAZY EXPIRY HERE, unlike a direction: a ping has no TTL, no status and no
 * lifecycle. Rows are the record.
 */
function toPing(row: ChannelPingRow): ChannelPing {
  return {
    id: row.id,
    seq: row.seq,
    channelId: row.channel_id,
    channelSlug: row.channel_slug ?? null,
    threadId: row.task_id,
    senderUserId: row.sender_user_id,
    senderAgentId: row.sender_agent_id ?? null,
    recipientKind: row.recipient_kind as PingRecipientKind,
    recipientUserId: row.recipient_user_id,
    recipientAgentId: row.recipient_agent_id,
    kind: row.kind as PingKind,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** What one recipient form resolves to — exactly the three columns that carry it. */
type ResolvedRecipient = {
  recipient_kind: PingRecipientKind;
  recipient_user_id: string;
  recipient_agent_id: string | null;
};

/**
 * WHICH ARGUMENT THE CALLER USED → WHOSE INBOX THIS LANDS IN.
 *
 * 🔒 **THE TWO SELF-SCOPED ARMS STAMP `ctx.userId` AND READ NOTHING FROM THE
 * PAYLOAD BUT AN AGENT HANDLE.** `agentId` is an ADDRESS, not an authorization:
 * it names WHICH of the operator's own agents hears this, inside a machine the
 * `recipient_user_id` stamp has already fixed. A wrong handle reaches nothing —
 * the desktop resolves it against its own registry — and it can never name
 * another operator's machine, because the operator is not a field.
 *
 * ⚠ **THE `member` ARM IS THE ONLY ONE THAT NAMES SOMEBODY ELSE**, and it reuses
 * the exact membership pair `service-writes.ts › postMessage`,
 * `service-tasks.ts › createTask` and `service-tasks-broadcast.ts ›
 * assertAddresseesAreReachable` apply to a post's `to`: a `channel_members` row
 * AND an ACTIVE `workspace_members` row. It is called here rather than shared
 * because each of those sites raises its OWN domain error, and the fan-out
 * module already records why a second statement of one security check is
 * deliberate rather than a smell. ⚠ If they ever disagree, the post path wins
 * and this is the bug.
 *
 * ⚠ **A NON-UUID `to` IS REFUSED BEFORE IT CAN REACH A `uuid =` FILTER**, which
 * is `getAgentDirection`'s rule and the same 22P02-per-call it exists to avoid.
 * The REF → member resolution (an email, a display name) happens one layer up in
 * the MCP tool, exactly as it does for a post's `to`
 * (`packages/mcp-server/src/tools/channel-ops-write.ts` — "Resolve addressee
 * (email or user id) to a workspace member … the route then enforces channel
 * membership"); this layer is the enforcement half of that division, and a value
 * that never went through the resolver collapses onto the SAME refusal a
 * stranger's id gets.
 */
async function resolveRecipient(
  ctx: ChannelContext,
  channelId: string,
  input: PingCreateInput
): Promise<ResolvedRecipient> {
  if (input.agentId !== undefined) {
    return {
      recipient_kind: "agent",
      // 🔒 STAMPED. There is no argument that could say otherwise.
      recipient_user_id: ctx.userId,
      recipient_agent_id: input.agentId,
    };
  }
  if (input.toDesktop !== undefined) {
    return {
      recipient_kind: "desktop",
      // 🔒 STAMPED, same reason.
      recipient_user_id: ctx.userId,
      recipient_agent_id: null,
    };
  }
  // The schema's `superRefine` guarantees exactly one recipient field, so `to`
  // is present on this arm; the guard is what makes that legible to TypeScript.
  const to = input.to;
  if (to === undefined || !isUuid(to)) {
    throw new PingRecipientNotMemberError(to ?? "");
  }
  // ⚠ BEFORE the roster round-trip, exactly as `assertAddresseesAreReachable`
  // orders it. The sender is already a channel member (`createPing`'s gate 1),
  // so a self-`to` would PASS the roster check and be filed — the refusal is not
  // about reachability, it is about the instrument being the wrong one.
  if (to === ctx.userId) throw new PingSelfTargetError();
  if (
    !(
      (await repo.findMembership(channelId, to)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, to))
    )
  ) {
    throw new PingRecipientNotMemberError(to);
  }
  return {
    recipient_kind: "member",
    recipient_user_id: to,
    recipient_agent_id: null,
  };
}

/**
 * SEND A PING.
 *
 * Gate order, chosen so nothing is filed against a channel the caller cannot
 * reach:
 *  1. **MEMBERSHIP, NOT READABILITY.** `loadVisibleChannel` admits a non-member
 *     to a PUBLIC channel; a ping may only be sent by a MEMBER, because it is a
 *     signal about work in that room and its `member` form addresses that room's
 *     roster. A non-member gets the 404 — the same answer a private channel
 *     gives, so a public channel does not widen this by one caller.
 *  2. The thread, when one is named, must be in that channel.
 *  3. The recipient, resolved from WHICH argument the caller used.
 *
 * ⚠ **NO PRESENCE PRE-CHECK, UNLIKE A DIRECTION.** A direction files nothing for
 * a machine that is not reporting in, because an unclaimed row expires unseen
 * and tells the orchestrator nothing. A ping has no TTL and no claim: the row IS
 * the record, and it waits in the inbox for a laptop that opens tomorrow. Adding
 * an online gate here would drop exactly the signals that most needed keeping.
 */
export async function createPing(
  ctx: ChannelContext,
  input: PingCreateInput
): Promise<ChannelPing> {
  const { channel, membership } = await loadVisibleChannel(ctx, input.channel);
  if (membership === null) throw new ChannelNotFoundError(input.channel);

  if (input.threadId) {
    const task = await repoTasks.findTaskByChannelAndId(
      channel.id,
      input.threadId
    );
    // ⚠ The channel's own 404, so a thread id in another room is
    // indistinguishable from one that does not exist.
    if (!task) throw new ChannelNotFoundError(input.threadId);
  }

  const recipient = await resolveRecipient(ctx, channel.id, input);

  const row = await pingRepo.insertPing(ctx.userId, {
    workspace_id: ctx.workspaceId,
    channel_id: channel.id,
    task_id: input.threadId ?? null,
    // ⚠ STAMPED FROM THE TRANSPORT, NEVER FROM THE PAYLOAD, and it is a CAPTION
    // ONLY — nothing gates, routes, filters or authorizes on it. The rule and
    // the argument for it are `service-directions.ts › senderAgentIdFrom`'s;
    // this imports that function rather than restating the charset, so the two
    // lanes cannot drift on what counts as an agent handle.
    sender_agent_id: senderAgentIdFrom(ctx.sessionId),
    ...recipient,
    kind: input.kind,
    body: input.body,
  });
  // ⚠ The slug comes from the channel this write already resolved, so the create
  // pays no hydration read — and it cannot disagree with the one the reads
  // return, because it is the same row.
  return toPing({ ...row, channel_slug: channel.slug });
}

/**
 * THE INBOX CATCH-UP READ — what has been sent TO ME since `since`, in a room I
 * am STILL IN.
 *
 * 🔒 **BOTH FENCES, BECAUSE THE RLS POLICY IS BOTH FENCES** (R1, 2026-09-02).
 * `channel_pings_party_select` reads `is_channel_member(channel_id) AND (party)`,
 * and this lane runs on the RLS-bypassing admin client — so party alone here
 * would make the REST answer WIDER than the client answer for exactly one class
 * of caller: a member who was removed from the room. The membership proof is
 * `listMemberChannelRefs`, the same proof the workspace hold uses, and it is
 * also what makes a SOFT-DELETED channel disappear from this inbox.
 * ⚠ There is deliberately no `recipient` parameter and there must never be one:
 * a ping targets one person, and a read that could answer for somebody else
 * would make the table a worse `channel_messages`.
 *
 * ⚠ **THE PROOF DOUBLES AS THE SLUG SOURCE.** It already carries `name`/`slug`
 * per channel, so the repository does NO hydration read — one query saved per
 * page, and the label can never disagree with the fence that admitted the row.
 *
 * ⚠ `refs` IS AN OPTIONAL PRE-PROVEN SET, for the hold that re-proves on its own
 * cadence (`service-pings-await.ts`). ⚠ **Never build it from anything a caller
 * sent** — `listMemberChannelRefs` is the only legitimate source.
 *
 * ⚠ `since` IS A PING `seq`, NEVER A MESSAGE ONE — the two cursor spaces are
 * separate by construction, so a caller that crosses them reads a plausible,
 * wrong page rather than an error.
 */
export async function listPings(
  ctx: ChannelContext,
  query: PingListQuery,
  refs?: MemberChannelRef[]
): Promise<ChannelPing[]> {
  const proven =
    refs ?? (await listMemberChannelRefs(ctx.workspaceId, ctx.userId));
  const rows = await pingRepo.listPingsForRecipient(
    ctx.userId,
    ctx.workspaceId,
    proven.map((r) => r.id),
    { since: query.since, limit: query.limit }
  );
  const slugs = new Map(proven.map((r) => [r.id, r.slug]));
  // ⚠ `channel_slug` stays `undefined` when the proof somehow lacks the row
  // rather than becoming `""` — `toPing`'s `?? null` forces a render to fall
  // back to the id instead of printing a blank label.
  return rows.map((row) =>
    toPing({ ...row, channel_slug: slugs.get(row.channel_id) })
  );
}
