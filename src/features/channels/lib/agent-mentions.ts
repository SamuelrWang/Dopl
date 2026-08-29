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
