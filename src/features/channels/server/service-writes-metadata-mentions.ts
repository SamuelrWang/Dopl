import "server-only";
import {
  mentionTokensOf,
  resolveMentions,
  type MentionCandidate,
} from "../lib/mentions";
import type { ChannelMemberRow } from "./dto";
import { profilesById } from "./service-shared";

/**
 * SERVER-SIDE MENTION RESOLUTION, the half of `resolvePostMetadata` that turns
 * a body into the id set stamped on the reserved metadata key named once, in
 * code, as `lib/mentions.ts › MENTIONS_METADATA_KEY`.
 *
 * ⚠ THE MATCH RULE IS NOT HERE. It is `lib/mentions.ts`, ONE parser shared with
 * the transcript's highlight and aligned with the composer's autocomplete —
 * a second copy is how the two ends disagree about what counts as a tag. That
 * includes THE CODE RULE (a handle inside a code span or a fenced block tags
 * nobody): it is enforced inside `mentionTokensOf`, so nothing here has to know
 * about backticks, and nothing here may re-implement them.
 *
 * ⚠ SERVER-RESOLVED, NEVER CALLER-SUPPLIED. The caller's key is deleted
 * unconditionally in `resolvePostMetadata` and re-stamped only from what this
 * function returns, on `fanoutGroup`'s exact terms (INVARIANTS §5): the set
 * decides whose Tags inbox a message lands in, and Phase 7 gates NOTIFICATIONS
 * on it, so a settable value is a notification-forgery primitive. The
 * alternative shape — an explicit MCP argument — is worse on its own terms:
 * INVARIANTS §10 refuses an unknown tool argument BY NAME, so a mistyped one
 * narrates success over an invisible delivery failure.
 *
 * ⚠ IT DOES NOT ADDRESS ANYBODY. `metadata.to_user_id` still comes from the
 * validated `toUserId` and nowhere else, and an unaddressed post still triggers
 * NOBODY at any member count. A mention is an INBOX fact.
 */

/**
 * Every roster member `body` tags, in first-appearance order — the AUTHOR
 * included when an AGENT wrote it, excluded when a human did (see the self-tag
 * rule below).
 *
 * ⚠ THE ROSTER READ IS LAZY AND SHARED. `roster` is the same memoized loader
 * `resolveDirectPeer` takes, so a post that needs both pays ONE
 * `channel_members` read; a post whose body carries no `@` at all pays NONE
 * (the token scan is a string check and runs first). That ordering is the
 * whole reason this does not tax the hot write path (INVARIANTS §12) — the
 * common message is not a mention.
 *
 * ⚠ THE SECOND READ IS THE PROFILES, and it is unavoidable: handles come from
 * display names and email local parts, which live in `profiles`, not in
 * `channel_members`. `profilesById` is the cheapest existing one (the roster
 * read path uses the same pair; only presence is skipped here).
 *
 * ⚠ THE AUTHOR IS DROPPED FOR A HUMAN, KEPT FOR AN AGENT (2026-08-22, Samuel).
 * The two cases are not the same act and the account they share is a coincidence
 * of how an agent posts:
 *   - A HUMAN tagging themselves is talking about themselves. It is legal to
 *     WRITE and legal to RENDER — the transcript still tints your own name — but
 *     it is not an inbox item, and a self-mention that raised your own badge
 *     would make the count something you could inflate by typing your own name.
 *   - AN AGENT tagging its operator's handle is THE ESCALATION PATH. It posts on
 *     that operator's account (`author_kind` and `ctx.source` both derive from
 *     the agent token, `service-shared.ts`), so "the author" is the very person
 *     it is trying to reach — and dropping it meant the one tag an agent has for
 *     "my own human has to see this" was the one tag that silently did nothing.
 *     The Tags inbox is what an operator watches instead of reading every
 *     message (INVARIANTS §5), so an agent with no way into it is an agent that
 *     can only be blocked in a thread nobody opens.
 * ⚠ THE DISCRIMINATOR IS THE CREDENTIAL, NOT THE BODY. `authorIsAgent` comes
 * from `ctx.source === "agent"`, which is `auth.agentTokenId` and nothing a
 * caller can assert. A human's session credential cannot reach this branch, so
 * the human self-tag stays dropped exactly as before and the badge stays
 * un-inflatable.
 *
 * ⚠ IT IS STILL NOT AN ADDRESS. An agent tagging its operator puts a row in that
 * operator's Tags inbox; it starts no session, on that machine or any other.
 *
 * ⚠ SCOPED TO THE CHANNEL ROSTER, by construction: a name that is not in this
 * channel resolves to nobody, so a mention can never reach outside the room it
 * was written in.
 */
export async function resolveBodyMentions(
  body: string,
  authorUserId: string,
  roster: () => Promise<ChannelMemberRow[]>,
  authorIsAgent = false
): Promise<string[]> {
  if (mentionTokensOf(body).length === 0) return [];

  const members = await roster();
  if (members.length === 0) return [];
  const profiles = await profilesById(members.map((m) => m.user_id));
  const candidates: MentionCandidate[] = members.map((member) => {
    const profile = profiles.get(member.user_id);
    return {
      userId: member.user_id,
      displayName: profile?.display_name ?? null,
      email: profile?.email ?? null,
    };
  });

  const resolved = resolveMentions(body, candidates);
  return authorIsAgent
    ? resolved
    : resolved.filter((id) => id !== authorUserId);
}
