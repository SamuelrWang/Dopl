import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import { isUuid } from "@/shared/lib/id/uuid";
import { CHANNEL_SEND_MAX_RECIPIENTS } from "../constants";
import {
  agentIdHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "../lib/agent-mentions";
import { mentionHandleOf } from "../lib/mentions";
// ⚠ ONE statement of the reserved handle and its stored key — see that file for
// why `@desktop` resolves to the CALLER'S own operator and reads no roster.
import {
  DESKTOP_GROUP_HANDLE,
  isDesktopGroupHandle,
} from "../lib/desktop-handle";
import type { ChannelRow } from "./dto";
import { ChannelRecipientUnresolvedError } from "./errors";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * **`to=` IS ONE OR MORE RECIPIENTS ACROSS TWO NAMESPACES** (2026-09-02, v2 wave
 * B slice B4 — Samuel's ruling B1; widened to a LIST on 2026-09-18 by his
 * multi-recipient ruling).
 *
 * ⚠ **THIS WIDENS A FENCE, WHICH IS THE OPPOSITE OF WHAT MOST OF THIS FAMILY
 * DOES, SO READ WHY.** Until now `to` was `z.string().uuid()` and an agent in it
 * was a 400: addressing an agent meant writing `@handle` in the BODY, which the
 * server could only guess at and every desktop re-parsed for itself. Wave B
 * narrows the fan-out to the ADDRESSED recipient, and a narrowing whose only
 * addressing channel is prose is a narrowing onto a guess. So `to` becomes a
 * UNION — a member or an agent — and the resolution happens once, here, at the
 * door.
 *
 * ⚠ **`metadata.to_user_id` IS STILL THE MEMBER STAMP AND NOTHING MOVED OFF
 * IT.** Consent cards key on it (`lib/message-receipt.ts`,
 * `repository-account.ts`'s indexed JSONB predicate), so a member recipient
 * resolved here is handed back to `resolvePostMetadata` as the validated
 * `toUserId` it has always been. An AGENT recipient stamps NO metadata key at
 * all: it rides `recipient_agent_ids`, the column A9 created for exactly this
 * and the one the desktop already reads. ⚠ Do NOT re-stamp `metadata.to_agent_id`
 * — that name is on the permanent strip list because an old row's attribution
 * must not become forgeable, and giving it a writer again is how that protection
 * ends.
 *
 * ⚠ **AN UNRESOLVED `@name` IS REFUSED, NEVER A SILENT `delivery=none`.** That
 * is the whole guardrail behind Samuel's *"conversations must not stall on a
 * forgotten @"*: a send that answers `ok` about a recipient nobody has is the
 * invisible-delivery failure, and it is worse here than anywhere because the
 * author believes they addressed somebody. The refusal LISTS the live handles
 * and the channel's members, so the next attempt is one edit away rather than a
 * second guess.
 */

/**
 * What one `to=` token resolved to.
 *
 * ⚠ **THERE IS NO `null` ARM AND THERE MUST NOT BE.** Every reachable outcome is
 * either one of these two or a throw; an "unresolved" value would be a
 * `delivery=none` wearing a different name, and the resolver exists to make that
 * unrepresentable.
 */
export type ResolvedRecipient =
  | { kind: "member"; userId: string }
  | { kind: "agent"; agentId: string }
  /**
   * **`@desktop` — the CALLER'S OWN operator's outside sessions** (2026-09-18).
   *
   * ⚠ **IT CARRIES THE OPERATOR ID EVEN THOUGH IT IS ALWAYS `ctx.userId`.** The
   * verdict and the stored key both need the id, and deriving it a second time
   * downstream is how "whose desktop" comes to have two answers in a room with
   * two members.
   */
  | { kind: "desktop"; operatorUserId: string };

/** `@handle` / `handle` → the bare handle, or null when the token is not one. */
function handleTokenOf(to: string): string | null {
  const trimmed = to.trim();
  if (trimmed.length === 0) return null;
  // ⚠ `mentionHandleOf` OWNS trailing punctuation and markup, and is given the
  // token WITH its `@` because that is the shape it parses. A bare `handle`
  // (no `@`) is accepted too — the MCP surface teaches `@name`, but a caller
  // that pasted a `channel_sessions.name` verbatim named a real thing and
  // refusing it would be pedantry with a 400 attached.
  return mentionHandleOf(trimmed.startsWith("@") ? trimmed : `@${trimmed}`);
}

/**
 * **THE LIVE AGENT HANDLES A CALLER MAY NAME**, and the ONE place the
 * same-account carve decides how wide that is.
 *
 * ⚠ **THE SCOPE IS THE CREDENTIAL'S, NOT THE ROOM'S, AND THAT IS SAMUEL'S
 * 2026-08-31 CARVE GETTING ENFORCED AT THE DOOR.**
 *   - a PERSON (`ctx.source !== "agent"`) may name any agent live in the room.
 *     That is not a widening: an unaddressed human post already reaches every
 *     machine's agents in the room today, each machine feeding its own, and the
 *     Agents tab already shows a member every peer card
 *     (`repository-sessions.ts › listChannelSessionStates`, channel-fenced on
 *     purpose).
 *   - an AGENT may name only its OWN OPERATOR'S agents. Every agent posts under
 *     its operator's account (INVARIANTS §11), so "sessions belonging to the
 *     author" is exactly the set the carve permits an agent-authored message to
 *     wake. ⚠ **STRUCTURAL, NOT A BRANCH ON THE VERDICT.** A peer's agent is not
 *     in the index, so it cannot be resolved, so no stored verdict can name it —
 *     which is a stronger statement than a test on the way out, and it is the
 *     same shape `service-wake-verdict.ts` uses for the body-parse door.
 *   ⚠ The REFUSAL lists the same set it resolved against, so an agent that
 *   reached for a peer's handle is told what it CAN reach rather than shown a
 *   list containing the name it was just refused.
 *
 * ⚠ **NO FRESHNESS FILTER, DELIBERATELY, AND IT IS THE SAFE DIRECTION.** F-418's
 * rule is that a fresh row is evidence enough to RESOLVE and a stale one is not
 * evidence of ABSENCE. This function's only two uses are resolving a name the
 * caller wrote and LISTING candidates in a refusal, and both get worse when a
 * quiet-but-running agent is dropped: the first turns a real address into a 400,
 * the second hides the handle the caller needed. Freshness gates the WAKE, in
 * `service-wake-verdict.ts`, where dropping a stale row costs nothing.
 */
export async function liveAgentHandles(
  ctx: ChannelContext,
  channelId: string
): Promise<{ handles: string[]; index: ReturnType<typeof buildAgentMentionIndex> }> {
  const rows =
    ctx.source === "agent"
      ? await repoSessions.listSessionStates(
          ctx.userId,
          ctx.workspaceId,
          channelId
        )
      : await repoSessions.listChannelSessionStates(ctx.workspaceId, channelId);
  const candidates = rows
    .map((row) => ({ agentId: row.name, displayName: row.display_name }))
    .filter((c) => c.agentId.length > 0);
  // 🔒 **`desktop` IS RESERVED HERE, AND THIS IS THE HALF THAT MATTERS**
  // (2026-09-18). `main/agent-name-unique.js` suffixing a new launch to
  // `desktop-1` is a courtesy on ONE machine; this line is what makes the token
  // unclaimable whatever any machine already stored, including a row written
  // before the rule existed and a PEER's agent whose name was minted elsewhere.
  // The agent keeps its `agent-<id>` form, the handle that never stops working.
  const index = buildAgentMentionIndex(candidates, [DESKTOP_GROUP_HANDLE]);
  // ⚠ THE `agent-<id>` FORM, which every agent claims and never loses. A custom
  // name is machine-local and may be contested by a second agent (the index
  // answers `null` for a slug two agents claim), so listing slugs in a refusal
  // could name a handle that resolves to nobody — a refusal that teaches a
  // second refusal.
  const handles = [...new Set(candidates.map((c) => agentIdHandle(c.agentId)))];
  handles.sort();
  // ⚠ **`@desktop` IS DELIBERATELY *NOT* IN THIS LIST.** It is rendered by the
  // refusal as its own clause instead (see {@link unresolved}). This array is
  // published under the words "Live agents:", and the built-in is not an agent
  // and is not live — putting it here told a caller that `@desktop` was one of
  // their running sessions, and turned an empty room's honest "Live agents:
  // none" into "Live agents: @desktop". A discoverability win is not worth a
  // false statement about what is running.
  return { handles, index };
}

/**
 * **`to=` NAMES ONE OR MORE RECIPIENTS, COMMA-SEPARATED** (2026-09-18, Samuel's
 * multi-recipient ruling).
 *
 * ⚠ **THE LIST LIVES INSIDE THE EXISTING STRING FIELD, AND THAT IS THE WHOLE OF
 * THE WIRE CHANGE.** A `string | string[]` union publishes as `anyOf` on every
 * MCP schema that carries the field, and a single-string `to` had to keep
 * working byte-for-byte on every installed caller; one separator no address in
 * either namespace can contain (a uuid, an email local/domain part and an agent
 * handle are all comma-free) costs nothing on the wire and nothing in the
 * published schema.
 *
 * ⚠ **EVERY TOKEN IS RESOLVED BY {@link resolveToRecipient}** — one resolver,
 * one refusal, so a list of one behaves exactly as `to` always did and a list
 * where ONE token misses is refused whole rather than partly delivered.
 *
 * ⚠ **ORDER IS PRESERVED AND DUPLICATES COLLAPSE.** The order is what the read's
 * `→` arrow prints, and naming the same agent twice is one address, not two
 * wakes.
 */
export interface ResolvedRecipients {
  memberUserIds: string[];
  agentIds: string[];
  /**
   * **THE OPERATORS WHOSE OUTSIDE SESSIONS WERE ADDRESSED** — `@desktop`
   * (2026-09-18). At most one today, because the handle always resolves to the
   * CALLER'S own operator, so a `to` naming it twice collapses to one.
   *
   * ⚠ **A LIST ANYWAY, FOR THE SAME REASON THE OTHER TWO ARE.** The shape is
   * what the verdict and the stored key read, and a scalar here would have to
   * become a list the day `@desktop` means anything but "mine" — which is
   * exactly the kind of one-to-many widening this file already absorbed once.
   */
  desktopOperatorIds: string[];
}

export async function resolveToRecipients(
  ctx: ChannelContext,
  channel: ChannelRow,
  to: string
): Promise<ResolvedRecipients> {
  const tokens = to
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  // ⚠ A `to` that trims to nothing is the caller's mistake, not "no recipient":
  // answering `{[], []}` here would post it as an unaddressed message.
  if (tokens.length === 0) throw await unresolved(ctx, channel, to);
  if (tokens.length > CHANNEL_SEND_MAX_RECIPIENTS) {
    throw new ChannelRecipientUnresolvedError(
      `${tokens.length} recipients`,
      [],
      [],
      `A send addresses at most ${CHANNEL_SEND_MAX_RECIPIENTS} recipients.`
    );
  }
  const memberUserIds: string[] = [];
  const agentIds: string[] = [];
  const desktopOperatorIds: string[] = [];
  for (const token of tokens) {
    const recipient = await resolveToRecipient(ctx, channel, token);
    if (recipient.kind === "member") {
      if (!memberUserIds.includes(recipient.userId)) {
        memberUserIds.push(recipient.userId);
      }
    } else if (recipient.kind === "desktop") {
      // ⚠ A THIRD NAMESPACE, NOT A MEMBER. Pushing this onto `memberUserIds`
      // would make `@desktop` notify the operator as a PERSON and put the id in
      // `recipient_user_ids`, which every machine routes on — the two things
      // this address exists NOT to do.
      if (!desktopOperatorIds.includes(recipient.operatorUserId)) {
        desktopOperatorIds.push(recipient.operatorUserId);
      }
    } else if (!agentIds.includes(recipient.agentId)) {
      agentIds.push(recipient.agentId);
    }
  }
  return { memberUserIds, agentIds, desktopOperatorIds };
}

/**
 * Resolve one `to=` token against this channel: a member (user id or email) or a
 * live agent (`@agent-<id>` or `@<handle>`).
 *
 * ORDER, AND WHY IT CANNOT COLLIDE:
 *   1. **a uuid** → a member id. Nothing else in either namespace is a uuid: an
 *      agent id is `[a-z][a-z0-9]{7}` and a handle is capped at 31 characters
 *      by `channel_sessions_name_check`.
 *   2. **contains `@` and is not a leading-`@` handle** → an email, matched
 *      case-insensitively against THIS CHANNEL'S roster. ⚠ Roster-scoped rather
 *      than workspace-scoped, so the resolver cannot be used to test whether an
 *      arbitrary address has an account here — the answer for a stranger and for
 *      a non-member is the same refusal.
 *   3. **anything else** → an agent handle.
 *
 * ⚠ **THE MEMBERSHIP CHECK STAYS WHERE IT IS.** A resolved member id is handed
 * back to `service-writes.ts`, which asks `findMembership` AND
 * `isActiveWorkspaceMember` about it exactly as it does for a caller-supplied
 * uuid — this function narrows the vocabulary, it does not take over the fence.
 */
export async function resolveToRecipient(
  ctx: ChannelContext,
  channel: ChannelRow,
  to: string
): Promise<ResolvedRecipient> {
  const raw = to.trim();
  if (isUuid(raw)) return { kind: "member", userId: raw };

  // **`@desktop` — RESOLVED BEFORE ANY READ, AND THAT IS DELIBERATE**
  // (2026-09-18). It is a BUILT-IN address rather than a row: it resolves in
  // every channel the operator is in, needs no setup, cannot go stale, and costs
  // ZERO round trips — which is also what makes it impossible for a live-agent
  // lookup to shadow it. ⚠ The operator is the CALLER'S own, never the room's:
  // `@desktop` from Diana's agent means Diana's outside sessions, so two members
  // in one room hold two of these and they never contest.
  if (isDesktopGroupHandle(handleTokenOf(raw))) {
    return { kind: "desktop", operatorUserId: ctx.userId };
  }

  const looksLikeEmail = raw.includes("@") && !raw.startsWith("@");
  if (looksLikeEmail) {
    const members = await repo.listMembers(channel.id);
    const profiles = await repo.fetchProfiles(members.map((m) => m.user_id));
    const wanted = raw.toLowerCase();
    const hit = profiles.find((p) => (p.email ?? "").toLowerCase() === wanted);
    if (hit) return { kind: "member", userId: hit.id };
    throw await unresolved(ctx, channel, raw);
  }

  const handle = handleTokenOf(raw);
  if (handle !== null) {
    const { index } = await liveAgentHandles(ctx, channel.id);
    const agentId = resolveAgentHandle(handle, index);
    if (agentId !== null) return { kind: "agent", agentId };
  }
  throw await unresolved(ctx, channel, raw);
}

/**
 * The refusal, with the two lists that make it actionable.
 *
 * ⚠ **BUILT ONLY ON THE FAILING PATH.** Both reads are a round trip each and the
 * happy path must not pay for a sentence nobody will read.
 *
 * 🔒 **EMAIL IS ENTITLEMENT-SCOPED, AND THIS LIST USED TO IGNORE THAT
 * (2026-09-02, F-588).** It rendered EVERY member's email, to any caller —
 * agent tokens included — from a single mistyped `to=`. That is the same
 * enumeration `channel-render.ts › formatMemberLine` refuses in as many words
 * (*"an agent can list every PUBLIC channel and `op='rooms' action='members'`
 * each, so email renders only for a workspace admin or the caller's own row"*),
 * reached through a door that never asked. **A refusal is a read**, and this
 * one was the cheapest roster dump on the surface: no membership needed beyond
 * the room, no rate limit, one call.
 *
 * The rule is the SAME rule, applied here: a display name, else — for an admin
 * or the caller's own row — the email, else the user id. It stays actionable
 * (`to=` takes a name, an email or an id) without handing an agent the roster's
 * addresses.
 */
async function unresolved(
  ctx: ChannelContext,
  channel: ChannelRow,
  to: string
): Promise<ChannelRecipientUnresolvedError> {
  const { handles } = await liveAgentHandles(ctx, channel.id);
  const members = await repo.listMembers(channel.id);
  const profiles = await repo.fetchProfiles(members.map((m) => m.user_id));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  // ⚠ `role` is the WORKSPACE role and may be null when the auth layer resolved
  // none — which reads as "not an admin", the restrictive answer.
  const adminReads = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  const labels = members
    .map((m) => {
      const profile = byId.get(m.user_id);
      const email = adminReads || m.user_id === ctx.userId ? profile?.email : null;
      return profile?.display_name || email || m.user_id;
    })
    .filter((label): label is string => label.length > 0)
    .sort();
  // ⚠ **THE BUILT-IN IS NAMED AS ITS OWN CLAUSE, NOT AS A LIVE AGENT**
  // (2026-09-18). A refusal is the one place a caller reliably reads a handle
  // list, so a built-in absent from it is a built-in nobody discovers — but it
  // may not be folded into "Live agents", which is a claim about what is
  // RUNNING. The whole message is composed here rather than in the error class
  // because only this function knows the two lists are the room's.
  const agents = handles.map((h) => `@${h}`).join(", ") || "none";
  return new ChannelRecipientUnresolvedError(
    to,
    handles,
    labels,
    `No recipient in this channel matches "${to}". ` +
      `Live agents: ${agents}. Members: ${labels.join(", ") || "none"}. ` +
      `@desktop always resolves — it addresses YOUR OWN outside sessions (a Claude Code, Codex or Cursor run on your device token) and wakes no agent.`
  );
}
