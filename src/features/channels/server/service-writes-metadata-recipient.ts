import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import {
  agentIdHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "../lib/agent-mentions";
import { mentionHandleOf } from "../lib/mentions";
import type { ChannelRow } from "./dto";
import { ChannelRecipientUnresolvedError } from "./errors";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * **`to=` IS ONE RECIPIENT AND TWO NAMESPACES** (2026-09-02, v2 wave B slice B4
 * — Samuel's ruling B1).
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
  | { kind: "agent"; agentId: string };

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
  const index = buildAgentMentionIndex(candidates);
  // ⚠ THE `agent-<id>` FORM, which every agent claims and never loses. A custom
  // name is machine-local and may be contested by a second agent (the index
  // answers `null` for a slug two agents claim), so listing slugs in a refusal
  // could name a handle that resolves to nobody — a refusal that teaches a
  // second refusal.
  const handles = [...new Set(candidates.map((c) => agentIdHandle(c.agentId)))];
  handles.sort();
  return { handles, index };
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
 */
async function unresolved(
  ctx: ChannelContext,
  channel: ChannelRow,
  to: string
): Promise<ChannelRecipientUnresolvedError> {
  const { handles } = await liveAgentHandles(ctx, channel.id);
  const members = await repo.listMembers(channel.id);
  const profiles = await repo.fetchProfiles(members.map((m) => m.user_id));
  const emails = profiles
    .map((p) => p.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0)
    .sort();
  return new ChannelRecipientUnresolvedError(to, handles, emails);
}
