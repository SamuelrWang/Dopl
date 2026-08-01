/**
 * Composer @-MENTION — pure query detection, candidate building, text
 * insertion, and (at send time) RESOLUTION of the typed handles into the agents
 * a chat message addresses.
 *
 * TWO HALVES, and the seam between them is the fix for the operator's core
 * flow. The POPUP half is unchanged and still only writes TEXT: accepting a
 * candidate inserts `@quartz ` into the draft and touches no addressing state.
 * The RESOLUTION half ({@link extractMentionedAgents}) runs on the COMPOSED BODY
 * at send time and is what turns those characters into `toAgents`.
 *
 * Resolving from the BODY rather than from popup state is the deliberate
 * choice: a handle typed straight through without ever opening the popup, one
 * pasted in, and one picked from the list must all mean the same thing, and a
 * handle the user DELETED must stop meaning anything. Popup state cannot say
 * that — it only knows what was accepted, never what survived the next edit.
 */

import { MAX_ADDRESSED_AGENTS } from "../schema";
import type { AgentStatus, ChannelAgent, ChannelMember } from "../types";
import {
  AGENT_STATUS_LABEL,
  isAddressableAgent,
  normalizeAgentHandle,
} from "./agent-display";
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

/**
 * A `@handle` token in a composed body. THE WHOLE LEXER, stated as a regex so
 * there is nothing to guess:
 *
 *   - the `@` must start the body or follow whitespace, so `ada@example.com` is
 *     an email address and not a mention (the same rule the popup's
 *     {@link findMentionQuery} uses, for the same reason);
 *   - the handle is the run of `[A-Za-z0-9-]` after it. That charset is exactly
 *     what {@link AGENT_HANDLE_RE} permits plus uppercase, so any character a
 *     handle cannot contain ENDS the token — which is how trailing punctuation
 *     falls off for free: `@quartz,` `@quartz.` `@quartz?` `@quartz's` all lex
 *     to `quartz`.
 *
 * Deliberately NOT a parser. It does not know about markdown emphasis, links,
 * or block quotes, and it does not need to: an unresolvable token is simply not
 * a mention, and the composer's helper line shows the operator exactly which
 * handles resolved before they press Enter.
 */
const MENTION_TOKEN_RE = /(?:^|\s)@([A-Za-z0-9-]+)/g;

/**
 * Backtick-delimited runs, blanked before the lexer sees the body, so
 * `` `@quartz` `` in a code span does not summon anybody. Cheap on purpose: any
 * run of backticks to the next run of backticks, which covers inline spans and
 * fenced blocks alike. An UNCLOSED backtick matches nothing and the mentions
 * after it still count — the failure direction that keeps a normal sentence
 * containing one stray backtick working.
 */
const CODE_SPAN_RE = /`+[^`]*`+/g;

/**
 * The agents a composed body ADDRESSES: every `@handle` that names an
 * addressable agent of this channel, in first-appearance order, deduped, capped
 * at {@link MAX_ADDRESSED_AGENTS}.
 *
 * MATCHED AGAINST THE CURRENT ROSTER, case-folded through
 * {@link normalizeAgentHandle} — the same fold the server's handle lookup uses
 * (`lower(name)`), so `@Quartz` and `@quartz` reach the one agent. A token that
 * matches nothing on the roster is left alone as TEXT: a typo'd handle must
 * visibly fail to resolve rather than quietly addressing something near it.
 *
 * ADDRESSABLE ONLY (`summoned` / `active`), which is the same population the
 * popup offers and the same predicate that documents why: those are the states
 * a mention can make ACT. A parked or dismissed agent's handle therefore does
 * not resolve here even though the SERVER would accept it (it resolves any
 * status by design, so a handle does not break the instant its owner parks the
 * session). The divergence is deliberate and one-directional — the web only
 * ever addresses a subset of what the server allows — and it is visible, since
 * an unresolved handle drops out of the helper line before the send.
 *
 * The cap is the schema's own constant rather than a restated 8: a tenth handle
 * is dropped on the client so the send still works, instead of building a
 * payload the server rejects whole.
 */
export function extractMentionedAgents(
  body: string,
  agents: readonly ChannelAgent[]
): ChannelAgent[] {
  const byHandle = new Map<string, ChannelAgent>();
  for (const agent of agents) {
    if (!isAddressableAgent(agent)) continue;
    const handle = normalizeAgentHandle(agent.name);
    // Handles are unique per channel (case-folded), so a collision can only be
    // a stale duplicate in the loaded roster. First one wins.
    if (!byHandle.has(handle)) byHandle.set(handle, agent);
  }
  if (byHandle.size === 0) return [];

  const scannable = body.replace(CODE_SPAN_RE, " ");
  const out: ChannelAgent[] = [];
  const seen = new Set<string>();
  for (const match of scannable.matchAll(MENTION_TOKEN_RE)) {
    // A handle may CONTAIN hyphens but never end in one, so a trailing run is
    // punctuation (`@quartz-` in "ping @quartz- then wait"), not part of it.
    const handle = normalizeAgentHandle(match[1].replace(/-+$/, ""));
    const agent = byHandle.get(handle);
    if (!agent || seen.has(handle)) continue;
    seen.add(handle);
    out.push(agent);
    if (out.length >= MAX_ADDRESSED_AGENTS) break;
  }
  return out;
}

/** {@link extractMentionedAgents}, as the ids the `toAgents` wire field takes. */
export function extractMentionedAgentIds(
  body: string,
  agents: readonly ChannelAgent[]
): string[] {
  return extractMentionedAgents(body, agents).map((agent) => agent.id);
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
