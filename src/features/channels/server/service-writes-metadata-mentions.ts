import "server-only";
import {
  buildMentionIndex,
  insertableHandle,
  memberHandlesOf,
  mentionTokensOf,
  resolveMentions,
  type MentionCandidate,
} from "../lib/mentions";
import { ChannelAddresseeUntaggedError } from "./errors-recipient";
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
interface BodyMentions {
  /** The stamped set — every roster member this body tags. */
  userIds: string[];
  /**
   * **EVERY HANDLE THE MEMBER NAMESPACE OCCUPIES IN THIS ROOM** — handed on so the AGENT
   * namespace can mint around it (2026-09-07, Samuel's suffix ruling: members outrank agents).
   *
   * ⚠ **IT IS RETURNED RATHER THAN RE-DERIVED BECAUSE THE READS ARE ALREADY PAID FOR HERE.**
   * The handles come off the display names and email local parts this function has just loaded
   * for its own resolution; the agent door (`service-wake-verdict-handles.ts ›
   * resolveAgentRecipients`) runs later on the SAME request and had no roster at all, which is
   * why the server's precedence disagreed with the client's. Threading the derived set down
   * costs zero extra queries — asking for it at the agent door would have cost two on the hot
   * write path (INVARIANTS §12), and that would have been a different decision.
   *
   * ⚠ **EMPTY WHENEVER THE ROSTER WAS NOT READ, WHICH IS EXACTLY WHEN NOTHING NEEDS IT.** Both
   * doors gate on `mentionTokensOf`, so a body with no tag reserves nothing and resolves no
   * agent handle either. Empty reads as "no member namespace to respect" downstream, which is
   * the pre-2026-09-07 behaviour rather than a new hazard.
   */
  memberHandles: string[];
}

/** ⚠ ONE FROZEN VALUE FOR BOTH CHEAP EXITS — a body nobody tags and a room with no roster are
 *  the same answer, and two object literals would invite them to drift apart. */
const NO_MENTIONS: BodyMentions = Object.freeze({
  // ⚠ **THE ELEMENT TYPE IS ANNOTATED, NOT INFERRED, AND WITHOUT IT THIS DOES NOT COMPILE.**
  // A bare `Object.freeze([])` is `readonly never[]`, which `as string[]` cannot assert away
  // (TS2352 — the two types do not sufficiently overlap); annotating the literal first makes it
  // `readonly string[]`, and only THAT is a legal assertion back to the mutable field type.
  userIds: Object.freeze([] as string[]) as string[],
  memberHandles: Object.freeze([] as string[]) as string[],
});

export async function resolveBodyMentions(
  body: string,
  authorUserId: string,
  roster: () => Promise<ChannelMemberRow[]>,
  authorIsAgent = false
): Promise<BodyMentions> {
  if (mentionTokensOf(body).length === 0) return NO_MENTIONS;

  const members = await roster();
  if (members.length === 0) return NO_MENTIONS;
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
  return {
    userIds: authorIsAgent
      ? resolved
      : resolved.filter((id) => id !== authorUserId),
    // ⚠ THE WHOLE SET, NOT THE RESOLVED ONE, AND NOT THE AUTHOR-FILTERED ONE. It answers "which
    // spellings belong to people", which is true of every member's every handle whether or not
    // this body used one — including the author's own, and including handles two members contest
    // (`memberHandlesOf` says why the contested ones are still theirs).
    memberHandles: memberHandlesOf(candidates),
  };
}

/**
 * THE STAMPED MENTION SET: the body's tags, then every member the post ADDRESSES, deduped in that
 * order (Samuel, 2026-10-08 — the recipient pill is gone, so addressing a person must reach their
 * Tags inbox on its own). `addressed` is `postMessage`'s membership-checked `addressees` (`to=`
 * members, else `toUserId`): derived from the address DATA, so it holds whatever an agent's prose
 * does, and a new addressing shape cannot deliver without passing through it.
 * ⚠ Same author rule as the body parse: an agent addressing its own operator notifies them, a
 * human addressing themselves does not. ⚠ Never resilience-repaired recipients, never inherited
 * thread `to_user_id` (an in-thread reply passes no addressee), never agent ids.
 */
export function mentionStampOf(
  bodyUserIds: readonly string[],
  addressed: readonly string[] | undefined,
  authorUserId: string,
  authorIsAgent: boolean
): string[] {
  const fromAddress = (addressed ?? []).filter((id) => authorIsAgent || id !== authorUserId);
  return [...new Set([...bodyUserIds, ...fromAddress])];
}

/**
 * **AN AGENT'S ADDRESSED MESSAGE MUST NAME EVERY PERSON IT IS FOR** (Samuel, 2026-10-08). No pill
 * renders `to=` any more, so if the body skips a recipient no reader can tell who it was for —
 * and an agent forgetting is exactly what prompt text cannot rule out. So the server checks the
 * DATA: every member in `required` must be among the body's resolved tags (`bodyUserIds`, the
 * same parse that stamps the inbox, so every handle form the resolver accepts counts). Missing ⇒
 * refuse before insert, naming the exact handles to add. The body is never edited.
 * ⚠ A member with no unambiguous insertable handle cannot be satisfied by any body, so they are
 * not required: a refusal the caller cannot fix would just be a lost message.
 */
export async function assertAddresseesTagged(
  required: readonly string[],
  body: string,
  bodyUserIds: readonly string[],
  roster: () => Promise<ChannelMemberRow[]>
): Promise<void> {
  // Fast path off the stamp's own parse; it may have dropped the AUTHOR (a cookie-lane agent
  // tagging its own operator), so a miss is re-checked below against the unfiltered parse.
  const fast = new Set(bodyUserIds);
  if (required.every((id) => fast.has(id))) return;
  const members = await roster();
  const profiles = await profilesById(members.map((m) => m.user_id));
  const candidates: MentionCandidate[] = members.map((member) => ({
    userId: member.user_id,
    displayName: profiles.get(member.user_id)?.display_name ?? null,
    email: profiles.get(member.user_id)?.email ?? null,
  }));
  const tagged = new Set(resolveMentions(body, candidates));
  const missing = [...new Set(required)].filter((id) => !tagged.has(id));
  if (missing.length === 0) return;
  const index = buildMentionIndex(candidates);
  const handles = missing
    .map((id) => candidates.find((c) => c.userId === id))
    .map((c) => (c ? insertableHandle(c, index) : null))
    .filter((h): h is string => h !== null);
  if (handles.length > 0) throw new ChannelAddresseeUntaggedError(handles);
}

/** Both 2026-10-08 rules in the order the fold needs them: refuse an agent message that skips a
 *  required tag, else stamp body tags ∪ addressees. */
export async function addressedMentionStamp(
  body: string,
  bodyUserIds: readonly string[],
  opts: { addressedUserIds?: readonly string[]; mustTagUserIds?: readonly string[] },
  author: { userId: string; source?: string | null },
  roster: () => Promise<ChannelMemberRow[]>
): Promise<string[]> {
  await assertAddresseesTagged(opts.mustTagUserIds ?? [], body, bodyUserIds, roster);
  return mentionStampOf(bodyUserIds, opts.addressedUserIds, author.userId, author.source === "agent");
}
