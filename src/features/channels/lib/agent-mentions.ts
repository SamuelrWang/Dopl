/**
 * THE AGENT SIDE OF THE @-MENTION CONVENTION (2026-08-27, Samuel's ruling).
 *
 * ⚠ IT IS A DIFFERENT NAMESPACE FROM THE ROSTER'S, AND THAT IS THE POINT. `lib/mentions.ts`
 * resolves a token to a USER ID against the channel roster, and the server stamps that set into
 * `metadata.mentionedUserIds`. **An agent is not a member**, that resolver correctly answers
 * "nobody", and it must go on doing so — a caller-settable mention set is a notification-forgery
 * primitive. So this module answers a strictly separate question ("does this token name one of MY
 * agents") and the answer decides **tint only**: nothing here grants, addresses, triggers or
 * consents to anything.
 *
 * ⚠ THE ROUTING VERDICT IS MAIN'S AND STAYS MAIN'S. `dopl-desktop-app/main/session-dispatch.js ›
 * mentionedAgentIds` parses the same shapes against the ids actually LIVE on the thread, on the
 * machine that owns them. This module cannot reach that and does not try — it renders a tint over
 * what the local sessions feed already reports. Two readers, one convention, and the convention is
 * written down in both places because neither tree can import the other.
 *
 * ── THE HANDLE, IN FULL ─────────────────────────────────────────────────────
 * An agent answers to TWO handles, in this order:
 *
 *   1. its SLUGGED CUSTOM NAME, when the operator has renamed it (`main/agent-names.js`) —
 *      "Research Bot" → `@research-bot`;
 *   2. `agent-<id>` always — `@agent-k3v7d2mq`.
 *
 * ⚠ THE ID FORM IS ALWAYS CLAIMED, EVEN WHEN A NAME EXISTS, and that is deliberate: a name is
 * machine-local, mutable and may collide, while the id is minted once and never recycled. It is
 * the handle that cannot stop working, so it is never withdrawn — a rename must not silently break
 * an address somebody already wrote down.
 *
 * ⚠ THE SLUGGER IS `lib/mentions.ts › mentionSlug`, IMPORTED AND NOT RESTATED. One convention
 * across both namespaces (Samuel: same convention as the roster's); a second `.replace(/\s+/g,
 * "-")` here is how the two come to spell one name two ways.
 *
 * ⚠ AMBIGUITY FAILS CLOSED, exactly as rule 5 does for members. Two agents an operator has given
 * the same name both claim one slug, and a slug two agents claim resolves to NEITHER. The id form
 * is unambiguous by construction and is what still reaches each of them.
 */

import { mentionSlug } from "./mentions";

/** An agent reduced to what the handle rule reads — satisfied by the desktop's session summary
 *  without this module importing the bridge type. */
export interface AgentMentionCandidate {
  agentId: string;
  /** The operator's own name for it (`main/agent-names.js`), or null when never renamed. */
  displayName?: string | null;
}

/** The `agent-<id>` form, which every agent claims and never loses. */
export function agentIdHandle(agentId: string): string {
  return `agent-${agentId.trim().toLowerCase()}`;
}

/**
 * THE HANDLE A PICKER SHOULD INSERT, and the one a surface should SHOW: the slugged custom name
 * when there is one, else `agent-<id>`.
 *
 * ⚠ IT IS THE PREFERRED handle, not the only one — see {@link buildAgentMentionIndex}, which
 * claims both. A caller that renders this and a resolver that accepts only this would make a
 * renamed agent unreachable by the id its operator has been quoting.
 */
export function agentMentionHandle(candidate: AgentMentionCandidate): string {
  const named = mentionSlug(candidate.displayName ?? "");
  return named.length > 0 ? named : agentIdHandle(candidate.agentId);
}

/** Handle -> the agent id it names, or `null` when two agents claim it (ambiguity fails closed,
 *  the same answer `lib/mentions.ts › buildMentionIndex` gives for members). */
export type AgentMentionIndex = ReadonlyMap<string, string | null>;

/**
 * Live agents -> handle index. ⚠ BUILT FROM THE MACHINE'S OWN FEED, so it holds only agents this
 * operator is running: a peer's agent has no entry, cannot be tinted, and could not be addressed
 * anyway (their ids are minted on their machine and known to no server).
 */
export function buildAgentMentionIndex(
  candidates: readonly AgentMentionCandidate[]
): AgentMentionIndex {
  const index = new Map<string, string | null>();
  const claim = (handle: string, agentId: string) => {
    if (handle.length === 0) return;
    if (!index.has(handle)) {
      index.set(handle, agentId);
      return;
    }
    const held = index.get(handle);
    if (held !== null && held !== agentId) index.set(handle, null);
  };
  for (const candidate of candidates) {
    const id = candidate.agentId.trim().toLowerCase();
    if (id.length === 0) continue;
    // ⚠ THE ID FORM FIRST, so an agent whose NAME is contested still holds an unambiguous handle.
    claim(agentIdHandle(id), id);
    claim(mentionSlug(candidate.displayName ?? ""), id);
  }
  return index;
}

/**
 * The agent a single token names, or null.
 *
 * ⚠ IT TAKES THE ALREADY-STRIPPED HANDLE, not the raw token: `lib/mentions.ts › mentionHandleOf`
 * owns trailing punctuation and markup, and a second strip rule here would be the two-parsers
 * defect this whole family is built to avoid.
 */
export function resolveAgentHandle(
  handle: string | null,
  index: AgentMentionIndex
): string | null {
  if (handle === null) return null;
  return index.get(handle) ?? null;
}

/**
 * WHY THIS AGENT AND NOT ANOTHER — the one word a surface prints beside a name
 * the author did not type.
 *
 * ⚠ **A CLOSED SET, SHARED BY BOTH TREES**, because it is stored (the server
 * stamps it into `metadata.wake_reason`) and rendered (the MCP read line, the
 * composer's chip). A free-form sentence here would be a second vocabulary the
 * renderers would each narrow differently.
 */
export type ResponderReason =
  /** The channel's configured `default_responder_agent_name`. */
  | "default"
  /** Exactly one agent is live in the room. */
  | "only agent"
  /** Several are live; this one posted here most recently. */
  | "most recent"
  /** Several are live and none has posted lately; this one launched last. */
  | "most recently launched";

export interface ResponderChoice {
  agentId: string;
  reason: ResponderReason;
}

/**
 * **THE CHANNEL'S DEFAULT RESPONDER, RESOLVED — ALL OF RR3, AS ONE PURE
 * FUNCTION** (2026-09-02, v2 wave B slice B10; arms 3a/3b added 2026-09-04).
 *
 * ⚠ **IT LIVES HERE BECAUSE TWO TREES ASK IT AND ONLY ONE OF THEM MAY IMPORT
 * `server-only`.** The rule was written for `server/service-wake-verdict-resilience.ts
 * › defaultResponder`, which still owns WHEN it is asked; the composer's recipient
 * line asks the same question about a draft that has not been sent yet, and a
 * second spelling of it is how the line comes to name an agent the server would
 * not have woken. `defaultResponder` is now a two-line adapter over this, so
 * there is one declaration and the server's own tests still drive it.
 *
 * THE ARMS, IN ORDER:
 *   1. the CONFIGURED handle (`channels.default_responder_agent_name`), if it is
 *      live in this room — tried as written and as its `agent-<id>` form, because
 *      the setting stores a handle and an operator may have typed either;
 *   2. else the room's ONE live agent;
 *   3. else, with several live: the one that POSTED here most recently
 *      (`recentAgentIds`, most-recent-first);
 *   4. else the FIRST candidate in the order the caller supplied — see the
 *      ordering note below.
 *
 * ⚠ **ARMS 3 AND 4 ARE SAMUEL'S B1 RULING APPLIED TO THE CASE IT HAD BEEN LEFT
 * OUT OF** (2026-09-04). "Two live agents and no setting" answered `null`, on the
 * argument that choosing between them is a guess — and the ruling in the same
 * breath is that **a forgotten `@` must never stall a conversation**. Row #966 is
 * what that costs: a person wrote in a room with two live agents and no default,
 * the post stored `verdict=none` and fed 0 of 2, and he had to send it again with
 * a tag. Two agents is the ordinary shape of a multiplayer channel, so the
 * "deliberately nobody" arm was the common case, not the edge.
 * ⚠ **AND IT IS NOT A GUESS, WHICH IS WHY IT IS SAYABLE.** "The one that spoke
 * here last" is the conversation's own answer to who is being talked to, and the
 * choice is STAMPED ({@link ResponderReason}) so the transcript can say why — the
 * thing a silent pick would not have.
 * ⚠ **THE CONFIGURED RESPONDER STILL WINS**, so an operator who has said who
 * answers is never second-guessed by recency.
 *
 * ⚠ **NOTHING HERE ORDERS THE CANDIDATES AND NOTHING SHOULD.** Arm 4 means "the
 * caller's first", and each caller documents its own ordering as its best
 * available answer to *most recently launched*: the server sorts by
 * `started_at` (`service-wake-verdict-resilience.ts › launchOrder`), the composer
 * passes the peer projection's own newest-first order. Baking a sort in would
 * give one caller a rule it did not ask for — the same argument the freshness
 * note below makes.
 *
 * ⚠ **NOTHING HERE FILTERS FOR FRESHNESS AND NOTHING SHOULD.** The caller decides
 * what "live" means: the server passes `freshChannelSessions` (F-418's asymmetric
 * rule), the composer passes what the peer projection last answered. Baking a
 * clock in would give one caller a rule it did not ask for.
 */
export function resolveDefaultResponder(
  configured: string | null | undefined,
  candidates: readonly AgentMentionCandidate[],
  /** Agent ids that have POSTED in this room lately, MOST RECENT FIRST
   *  (`lib/agent-post-stamp.ts › recentAgentPosters`). Empty is a complete
   *  answer — arm 3 then falls to the caller's own ordering. */
  recentAgentIds: readonly string[] = []
): ResponderChoice | null {
  if (typeof configured === "string" && configured.length > 0) {
    const index = buildAgentMentionIndex(candidates);
    const hit =
      resolveAgentHandle(configured, index) ??
      resolveAgentHandle(agentIdHandle(configured), index);
    if (hit !== null) return { agentId: hit, reason: "default" };
  }
  const ids = [...new Set(candidates.map((c) => c.agentId))];
  if (ids.length === 0) return null;
  if (ids.length === 1) return { agentId: ids[0], reason: "only agent" };
  for (const id of recentAgentIds) {
    if (ids.includes(id)) return { agentId: id, reason: "most recent" };
  }
  return { agentId: ids[0], reason: "most recently launched" };
}
