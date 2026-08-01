import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { MAX_ADDRESSED_AGENTS } from "../schema";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelAgentRow } from "./agents-dto";
import type { ChannelMessageRow } from "./dto";
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentForbiddenError,
  ChannelAgentNotInChannelError,
  ChannelChatAddressedError,
  ChannelTooManyAgentsError,
} from "./errors";
import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import type { ChannelContext } from "./service-shared";

/**
 * AGENT ADDRESSING on a post: who a message is FOR (`toAgent`) and who it is
 * FROM (`authorAgentId`). Split out of `service-writes-metadata.ts` because it
 * is its own reason to change — the metadata module decides what lands in
 * `metadata`, this one decides which agent identities a caller may name at all.
 *
 * THE IDENTITY LAW, stated once: an agent id SUPPLEMENTS an author, it never
 * REPLACES one. `channel_messages.author_user_id` stays `ctx.userId` on every
 * path; `metadata.author_agent_id` says which of that human's agents wrote it.
 * There is no anonymous agent authorship, and no way to attribute a message to
 * a human who did not make the request.
 *
 * The two fields fail DIFFERENTLY, on purpose:
 *  - `toAgent` names something the caller does not own and cannot be expected
 *    to know the id of, so it resolves by id OR handle and a miss is a **400**
 *    about the address (`CHANNEL_AGENT_NOT_IN_CHANNEL`), mirroring what an
 *    unaddressable human gets (`CHANNEL_ADDRESSEE_NOT_MEMBER`). An agent whose
 *    OWNER has left the channel is a 400 too — see the owner-bridge note in
 *    {@link resolveAgentAddressing}.
 *  - `authorAgentId` names something the caller must own, so a live agent
 *    belonging to someone else is a **403** (`CHANNEL_AGENT_FORBIDDEN`), not a
 *    400 and never a silent drop: a caller trying to post AS another member's
 *    agent is attempting to speak under an identity that is not theirs, and
 *    quietly stripping the claim would let them believe it worked.
 */

/** The validated agent identities a post may carry, all optional. */
export interface AgentAddressing {
  /**
   * `metadata.to_agent_ids` — EVERY addressed agent, in the order the caller
   * named them, deduped. This is the real address list; the two fields below
   * are derived from its head.
   */
  toAgentIds?: string[];
  /**
   * `metadata.to_agent_id` — the FIRST addressed agent, and a COMPAT MIRROR of
   * `toAgentIds[0]` rather than a field of its own. See
   * {@link resolveAgentAddressing} for the removal condition.
   */
  toAgentId?: string;
  /**
   * The FIRST addressed agent's OWNER. The v1 bridge to today's delivery path:
   * the desktop listener triggers on `metadata.to_user_id`, so addressing an
   * agent has to name the machine that agent runs on for anything to happen at
   * all. See {@link resolveAgentAddressing} for what the caller does with it.
   */
  toAgentOwnerUserId?: string;
  /** `metadata.author_agent_id` — which of the caller's agents wrote this. */
  authorAgentId?: string;
}

/**
 * Refuse a post that says `intent:"chat"` and then addresses a PERSON.
 *
 * The rule is about WHO, not about whether anything is addressed at all — and
 * the function name means "unaddressed BY A HUMAN ADDRESSEE", which is the only
 * half still refused:
 *
 *  - **A human `to` under chat is still a 400.** Addressing a person is what
 *    starts THAT PERSON'S agent on a subject they never agreed to; asking for
 *    someone else's machine is what REQUEST mode is for, and it carries the
 *    title their consent prompt renders. The two halves say opposite things
 *    (chat means "do not raise a prompt on anyone's machine", a human addressee
 *    means "raise one on exactly this machine") and reconciling either way is
 *    the invisible-delivery failure the addressing contract exists to prevent.
 *  - **`toAgent` / `toAgents` under chat are ALLOWED, and this is the primary
 *    way agents get work.** "@quartz @onyx work together on X" typed into the
 *    composer IS a chat message: a human talking in the room, naming the agents
 *    that should act. It was refused here until 2026-07-31, which meant the
 *    composer could not send the operator's core flow at all — the web side
 *    inserted the handle as plain text and addressed nobody, and the moment it
 *    started addressing the mentioned agents the server 400'd it. Neither agent
 *    acted, and nothing on either screen said why.
 *
 * What an agent-addressed chat message still does (see
 * `service-writes-metadata.ts`): stamps `to_agent_ids` + the `to_agent_id`
 * compat mirror, stamps the FIRST agent's owner as `to_user_id` (THE OWNER
 * BRIDGE — the listener triggers on the addressed user), and engages exactly
 * the addressed agents. What it does NOT do is fall back to the DM peer: the
 * peer is never resolved under chat, so a chat post in a DM reaches the named
 * agents' machines and nobody else's.
 *
 * Cheap and pure, so it runs in `postMessage` BESIDE the addressee-membership
 * check — i.e. BEFORE the idempotency short-circuit, exactly like that one. A
 * contradictory post must 400 on the retry too, not be answered with the stored
 * message from a request that never had the contradiction.
 */
export function assertChatIsUnaddressed(input: ChannelMessageCreateInput): void {
  if (input.intent !== "chat") return;
  if (input.toUserId) throw new ChannelChatAddressedError("toUserId");
}

/**
 * Resolve and authorize the agent identities on a post.
 *
 * MULTI-ADDRESS. `toAgents` is the N-agent form of `toAgent` — "@quartz @onyx
 * work together" — and `toAgent` is exactly a one-element `toAgents`, so the
 * two are merged into ONE ordered list before anything is resolved. Every entry
 * goes through the SAME single-agent resolution and the SAME owner-membership
 * check; a miss on ANY of them fails the whole post, naming the bad ref. Never
 * a partial address: silently dropping one of three named agents produces a
 * room where the caller believes three machines are working and two are.
 *
 * `toAgent` / each `toAgents` entry accepts an agent id OR a handle. A handle is
 * folded to lowercase by the repository (matching the `(channel_id, lower(name))`
 * unique index), so `@Quartz` and `@quartz` reach the same agent. Either way the
 * row must belong to THIS channel — an agent of another room has no listener
 * here, and a `to_agent_id` pointing at one would look delivered and route
 * nowhere.
 *
 * DEDUPE runs TWICE, on purpose: once on the raw refs (so a repeated `@quartz`
 * costs one lookup, not two) and once on the RESOLVED ids (so naming the same
 * agent by handle and by id is one address, not two). Order is the caller's,
 * because the head of the list is load-bearing — see the compat mirror below.
 *
 * THE CAP IS ENFORCED ON THE MERGE, and this is the only place it can be. The
 * post schema bounds `toAgents` alone, so `toAgent` + a full eight-entry
 * `toAgents` passed validation and addressed NINE — one over every other bound
 * in the system, including `MAX_DERIVED_AGENTS`
 * (`service-thread-handshake.ts`), which reads THIS SAME constant and would
 * truncate the ninth out of the derived participant set. The ninth agent was
 * therefore engaged, woken, converged on the handshake thread, and 403'd out of
 * it. Checked on the DEDUPED refs and BEFORE any resolution: a refusal must not
 * cost nine round-trips, and `@quartz @quartz` is one address, not two toward
 * the limit. Nine refs that would have collapsed to eight agents after
 * resolution are refused too — the bound is on what the caller NAMED, which is
 * what the schema's own `.max()` means and what the error tells them to change.
 *
 * Status is deliberately NOT checked: a `parked` or `dismissed` agent still
 * resolves. Whether addressing a retired agent should 400 (or wake it) is a
 * product call and is not made here; refusing it today would make a handle stop
 * working the instant its owner parked the session, which is exactly when a
 * teammate is most likely to ping it.
 */
export async function resolveAgentAddressing(
  ctx: ChannelContext,
  channelId: string,
  input: ChannelMessageCreateInput
): Promise<AgentAddressing> {
  const out: AgentAddressing = {};

  const refs = dedupeRefs([
    ...(input.toAgent ? [input.toAgent] : []),
    ...(input.toAgents ?? []),
  ]);
  if (refs.length > MAX_ADDRESSED_AGENTS) {
    throw new ChannelTooManyAgentsError(refs.length, MAX_ADDRESSED_AGENTS);
  }

  const addressed: ChannelAgentRow[] = [];
  for (const ref of refs) {
    const agent = await resolveChannelAgent(channelId, ref);
    // THE OWNER BRIDGE'S PRECONDITION, and it applies to EVERY addressed agent,
    // not just the one whose owner ends up in `to_user_id`. `toAgentOwnerUserId`
    // is stamped as `metadata.to_user_id` and TAKES PRECEDENCE over the caller's
    // validated `toUserId` (see `service-writes-metadata.ts`), so without this
    // check the bridge is a hole in the v1.1 "an addressee is an active member
    // of this channel" invariant that `postMessage` 400s on everywhere else:
    // `channel_agents` has no FK to `channel_members`, so an agent outlives its
    // owner's membership, and addressing it would stamp a non-member. Checking
    // only the head would let a non-member ride along in `to_agent_ids` — a
    // listener that reads the array (the desktops this is being built for) would
    // then route to a machine whose owner left the room.
    //
    // CHANNEL_ADDRESSEE_NOT_MEMBER, not the agent-not-in-channel 400: the agent
    // genuinely IS in this channel, and saying otherwise would send the caller
    // looking for a handle problem. What actually failed is the addressee the
    // bridge derived, which is exactly what this error names — and the caller
    // gets the same code they would get for naming that person directly.
    //
    // `findMembership`, not the cheaper `hasMembership` projection, precisely
    // BECAUSE it is the function `postMessage` runs on an explicit `toUserId`:
    // the two answers must never disagree about who is a member, and one
    // predicate is how that stays true.
    if (!(await repo.findMembership(channelId, agent.owner_user_id))) {
      throw new ChannelAddresseeNotMemberError(agent.owner_user_id);
    }
    if (!addressed.some((seen) => seen.id === agent.id)) addressed.push(agent);
  }

  if (addressed.length > 0) {
    out.toAgentIds = addressed.map((agent) => agent.id);
    // COMPAT MIRROR — `to_agent_id` and the owner bridge are the HEAD of the
    // list, restated as the scalars the field already speaks. Installed desktop
    // 1.7.17 reads only `metadata.to_agent_id` and `metadata.to_user_id`; it has
    // never seen `to_agent_ids` and would route a multi-address to nobody
    // without this. REMOVE BOTH LINES only once every desktop in the field reads
    // the array — at that point the head stops being special and a multi-address
    // stops collapsing to one machine on old builds.
    out.toAgentId = addressed[0].id;
    out.toAgentOwnerUserId = addressed[0].owner_user_id;
  }

  if (input.authorAgentId) {
    const agent = await repoAgents.findAgentById(input.authorAgentId);
    if (!agent || agent.channel_id !== channelId) {
      throw new ChannelAgentNotInChannelError(input.authorAgentId);
    }
    // An agent identity is not assumable. Membership in the channel is not
    // ownership of the agent, so a teammate — even one who can read every
    // handle in the room — cannot author under one.
    if (agent.owner_user_id !== ctx.userId) {
      throw new ChannelAgentForbiddenError("post as this agent");
    }
    out.authorAgentId = agent.id;
  }

  return out;
}

/** One agent of THIS channel, by id or handle, or a 400 about the address. */
async function resolveChannelAgent(
  channelId: string,
  ref: string
): Promise<ChannelAgentRow> {
  const agent = isUuid(ref)
    ? await repoAgents.findAgentById(ref)
    : await repoAgents.findAgentByName(channelId, ref);
  if (!agent || agent.channel_id !== channelId) {
    throw new ChannelAgentNotInChannelError(ref);
  }
  return agent;
}

/**
 * Collapse repeated refs, case-folded, keeping the caller's order. Folding
 * matches how a handle resolves (the `(channel_id, lower(name))` index), so
 * `@Quartz @quartz` is one address before it is one lookup. An id and a handle
 * naming the same agent survive this pass and are collapsed after resolution.
 */
function dedupeRefs(refs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * The stored facts an engagement decision is made from: a posted message's own
 * row. Engagement is a fact ABOUT A POST THAT HAPPENED, so it reads the post —
 * on the first attempt and on an idempotent replay alike, which is what lets
 * {@link recordAgentEngagement} be the repair for a lost engagement write
 * (`service-writes.ts`).
 */
export type EngageableMessage = Pick<
  ChannelMessageRow,
  "metadata" | "author_kind" | "author_user_id"
>;

/**
 * ENGAGEMENT — record that a human addressed these agents, so each one may act
 * on the UNTAGGED human messages that follow in that channel.
 *
 * THE LOOP BRAKE, and it is absolute: an AGENT-DRIVEN message engages NOBODY.
 * Without that, one agent tagging another would hand it a standing licence to
 * answer everything, and two agents tagging each other would arm a loop with no
 * human in it at any hop.
 *
 * **A CLAIM IS NOT A FACT, AND THE FACT DECIDES.** There are two different
 * things in this function that both sound like "who wrote this":
 *  - `authorKind` (and `author_agent_id`) are a DISPLAY / ROUTING CLAIM. Any
 *    caller may send `authorKind:"user"` — `PostableAuthorKindSchema` accepts
 *    it from anybody (§8) — so it says how a message should RENDER and route,
 *    never who authenticated.
 *  - `ctx.source` is the AUTHENTICATION FACT. It is derived from the credential
 *    (`buildChannelContext`: `auth.agentTokenId ? "agent" : "user"`) and there
 *    is no field a caller can set to change it.
 *
 * ENGAGEMENT KEYS ON THE FACT. It was keyed on the claim until 2026-07-31, and
 * that made the brake defeatable by one word: an agent-token caller posted
 * `{toAgent:"quartz", authorKind:"user"}`, quartz was engaged for 60 minutes,
 * and the agent then drove it with untagged lines carrying the same assertable
 * label — the desktop's only brake being that same column. Two agents could
 * sustain each other with no human at any hop, which is precisely the loop this
 * function exists to break. `ctx.source === "agent"` now returns before
 * anything else is read: **engagement requires a HUMAN CREDENTIAL, not a human
 * claim.**
 *
 * KNOCK-ON, AND IT IS THE POINT: MCP posts are agent-credentialed, so `to_agent`
 * over MCP addresses, wakes and routes exactly as before but no longer ENGAGES.
 * That is what the MCP lane already documents ("addressing engages is true of
 * humans only") and what the desktop's own brake already assumed.
 *
 * THE CLAIM CHECKS STAY, as defence in depth — they answer a different question
 * and catch a case the credential cannot:
 *  - `author_agent_id` present: the poster said one of its own agents wrote
 *    this. An operator's COOKIE session (`source: "user"`) posting on an agent's
 *    behalf is a human credential carrying agent authorship, and it must not
 *    engage either.
 *  - `author_kind === "agent"`: the label everything else in the product means
 *    by "agent-authored" — the desktop's `classify()` brake, the web transcript,
 *    the "agent for <name>" render. Installed desktop 1.7.17 posts its agent
 *    replies with exactly this label over the operator's cookie session and NO
 *    `author_agent_id` (agents are newer than it), so this is the check that
 *    holds for the build in the field.
 *
 * WHO IS RECORDED AS THE ENGAGER is the MESSAGE's author, not the caller. On a
 * first attempt those are the same value by construction (`insertMessage`
 * stamps `author_user_id: ctx.userId`); on a replay they are not, and the
 * engagement belongs to whoever actually addressed the agents.
 *
 * Reads the STAMPED metadata rather than the caller's input: every key it looks
 * at is reserved and server-written (`service-writes-metadata.ts`), so a
 * hand-written `metadata` cannot reach it.
 */
export async function recordAgentEngagement(
  ctx: ChannelContext,
  message: EngageableMessage
): Promise<void> {
  if (ctx.source === "agent") return;
  if (message.author_kind === "agent") return;
  const metadata = asRecord(message.metadata);
  if (metadata.author_agent_id) return;
  const ids = metadata.to_agent_ids;
  if (!Array.isArray(ids) || ids.length === 0) return;
  // A message with no author is server-emitted (`system`) and engages nobody:
  // there is no human for the agents to be listening FOR.
  const engagedBy = message.author_user_id;
  if (!engagedBy) return;
  await repoAgents.markAgentsEngaged(
    ids.filter((id): id is string => typeof id === "string"),
    engagedBy
  );
}

/** `metadata` is a jsonb column, so it is `unknown` until it is checked. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
