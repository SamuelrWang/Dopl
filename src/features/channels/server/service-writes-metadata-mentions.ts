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
 * a second copy is how the two ends disagree about what counts as a tag.
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
 * Every roster member `body` tags, author excluded, in first-appearance order.
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
 * ⚠ THE AUTHOR IS DROPPED. Tagging yourself is legal to WRITE and legal to
 * RENDER — the transcript still tints your own name — but it is not an inbox
 * item, and a self-mention that raised your own badge would make the count
 * something you could inflate by talking about yourself.
 *
 * ⚠ SCOPED TO THE CHANNEL ROSTER, by construction: a name that is not in this
 * channel resolves to nobody, so a mention can never reach outside the room it
 * was written in.
 */
export async function resolveBodyMentions(
  body: string,
  authorUserId: string,
  roster: () => Promise<ChannelMemberRow[]>
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

  return resolveMentions(body, candidates).filter((id) => id !== authorUserId);
}
