/**
 * Composer @-MENTION autocomplete — pure query detection, candidate building,
 * and text insertion.
 *
 * v1 SCOPE, stated once so nothing downstream assumes more: a mention inserted
 * here is TEXT. It is what a human or an agent READS in the transcript; it does
 * NOT change how a send routes. Addressing still travels on the composer's
 * existing `toUserId` (the address picker) and nothing here writes it. The
 * server-side resolution of `@handle` → `to_agent_id` lands in a later lane —
 * until then, typing `@quartz` composes a message that says `@quartz`.
 */

import type { AgentStatus, ChannelAgent, ChannelMember } from "../types";
import { AGENT_STATUS_LABEL, isAddressableAgent } from "./agent-display";
// The human label is shared with the address picker (`channel-display.ts`) so a
// mention inserts exactly the name the picker shows.
import { memberLabel } from "./channel-display";

/** How many rows the popup shows at once. */
export const MENTION_LIMIT = 8;

/** Row height + vertical padding of the popup, in px (mirrors its classes). */
const MENTION_ROW_PX = 30;
const MENTION_PAD_PX = 8;

/**
 * The popup's rendered height for `count` rows, capped at the list's own
 * `max-h`. The composer sits at the BOTTOM of a clipped page surface, so the
 * list has to open UPWARD — and the shared clamp only keeps a panel on-screen,
 * it never flips it — which means the caller has to know roughly how tall the
 * panel is before it exists. Estimated rather than measured: being a few px off
 * moves the panel a few px, while measuring would cost a second render pass.
 */
export function mentionPopupHeight(count: number): number {
  const rows = Math.min(Math.max(count, 1), MENTION_LIMIT);
  return rows * MENTION_ROW_PX + MENTION_PAD_PX;
}

/** The `@…` token being typed, located inside the draft. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Index just past the typed token (the caret). */
  end: number;
  /** What follows the `@`, lowercased; "" right after typing `@`. */
  query: string;
}

/**
 * The `@` token the caret sits in, or null.
 *
 * A mention starts at an `@` that begins the draft or follows whitespace (so an
 * email address never opens the popup) and runs to the caret with no whitespace
 * in between (so the popup closes once the mention is finished).
 */
export function findMentionQuery(
  value: string,
  caret: number
): MentionQuery | null {
  const at = value.lastIndexOf("@", Math.max(0, caret - 1));
  if (at === -1) return null;
  const before = at > 0 ? value[at - 1] : "";
  if (before && !/\s/.test(before)) return null;
  const token = value.slice(at + 1, caret);
  if (/\s/.test(token)) return null;
  return { start: at, end: caret, query: token.toLowerCase() };
}

/** One row of the mention popup. */
export interface MentionCandidate {
  /** Stable react key (`agent:<id>` / `user:<id>`). */
  key: string;
  kind: "agent" | "member";
  /** The text inserted after the `@`. */
  insert: string;
  /** The row's primary label. */
  label: string;
  /** Right-hand hint (status / presence); null when there is nothing to say. */
  detail: string | null;
  /** Avatar identity for the row: an agent's owner, or the member themselves. */
  person: {
    userId: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** Present on agent rows — drives the status dot. */
  status?: AgentStatus;
}

function matches(haystack: string, query: string): boolean {
  return query.length === 0 || haystack.toLowerCase().includes(query);
}

function rank(haystack: string, query: string): number {
  return haystack.toLowerCase().startsWith(query) ? 0 : 1;
}

/**
 * The two populations a mention can name, filtered by what has been typed:
 * ADDRESSABLE agents first (they are the ones a mention can make act), then
 * human members. The viewer is excluded from both — you never @-mention
 * yourself — and so are dismissed/parked agents, which cannot be summoned by a
 * mention.
 */
export function buildMentionCandidates(params: {
  query: string;
  members: readonly ChannelMember[];
  agents: readonly ChannelAgent[];
  currentUserId: string;
  memberNames?: ReadonlyMap<string, string>;
}): MentionCandidate[] {
  const { query, members, agents, currentUserId } = params;
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const agentRows: MentionCandidate[] = agents
    .filter((a) => isAddressableAgent(a) && matches(a.name, query))
    .sort((a, b) => rank(a.name, query) - rank(b.name, query))
    .map((agent) => {
      const owner = memberById.get(agent.ownerUserId);
      return {
        key: `agent:${agent.id}`,
        kind: "agent" as const,
        insert: agent.name,
        label: agent.name,
        detail: AGENT_STATUS_LABEL[agent.status],
        person: {
          userId: agent.ownerUserId,
          email: owner?.email ?? null,
          displayName: owner?.displayName ?? null,
          avatarUrl: owner?.avatarUrl ?? null,
        },
        status: agent.status,
      };
    });

  const memberRows: MentionCandidate[] = members
    .filter((m) => m.userId !== currentUserId)
    .filter((m) => matches(memberLabel(m), query))
    .sort(
      (a, b) =>
        rank(memberLabel(a), query) - rank(memberLabel(b), query)
    )
    .map((member) => ({
      key: `user:${member.userId}`,
      kind: "member" as const,
      insert: memberLabel(member),
      label: memberLabel(member),
      detail: member.agentOnline ? "listening" : null,
      person: {
        userId: member.userId,
        email: member.email,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
      },
    }));

  return [...agentRows, ...memberRows].slice(0, MENTION_LIMIT);
}

/** The draft after accepting a candidate: `@insert ` replaces the typed token. */
export function applyMention(
  value: string,
  mention: MentionQuery,
  insert: string
): { value: string; caret: number } {
  const head = `${value.slice(0, mention.start)}@${insert} `;
  return { value: head + value.slice(mention.end), caret: head.length };
}
